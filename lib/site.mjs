import { describe } from './render.mjs';

export const DEFAULT_BASE = 'https://www.sliccy.com';
export const FRESH = 4 * 60 * 60;
const TIMEOUT = 30000;
const PARALLEL = 8;

export function valid(topic) {
  return /^[A-Za-z0-9_+-][A-Za-z0-9._+-]*$/.test(topic);
}

export function base(env) {
  return (env.SLICC_MAN_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

export function folder(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/[^A-Za-z0-9.-]/g, '_');
  return parsed.port ? `${host}-${parsed.port}` : host;
}

export function key(topic) {
  return `page-${topic.replace(/[A-Z_]/g, (ch) => (ch === '_' ? '__' : `_${ch.toLowerCase()}`))}`;
}

function age(headers) {
  const match = /(?:^|[,\s])max-age\s*=\s*"?(\d+)"?/i.exec(headers.get('cache-control') ?? '');
  return match ? Number(match[1]) : undefined;
}

function reason(error) {
  if (error?.name === 'TimeoutError') return 'timed out';
  const cause = error?.cause;
  return cause?.message || cause?.code || error?.message || String(error);
}

function stamp(time) {
  return new Date(time).toISOString().replace(/\.\d+Z$/, 'Z');
}

export function topics(xml) {
  const seen = new Set();
  const out = [];
  for (const match of String(xml).matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)) {
    const text = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    let path;
    try {
      path = new URL(text, 'https://localhost').pathname;
    } catch {
      continue;
    }
    const found = /^\/man\/([^/]+)$/.exec(path);
    if (!found) continue;
    let topic;
    try {
      topic = decodeURIComponent(found[1]);
    } catch {
      continue;
    }
    if (!valid(topic) || seen.has(topic)) continue;
    seen.add(topic);
    out.push(topic);
  }
  return out;
}

export function site({ url, store, fetch, now = Date.now, name, timeout = TIMEOUT }) {
  const root = url.replace(/\/+$/, '');

  async function load(id) {
    try {
      const text = await store.read(id);
      if (text === undefined) return undefined;
      const entry = JSON.parse(text);
      return entry && typeof entry === 'object' ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  async function save(id, entry) {
    try {
      await store.write(id, JSON.stringify(entry));
    } catch {}
  }

  async function drop(id) {
    try {
      await store.remove(id);
    } catch {}
  }

  const fresh = (entry) =>
    typeof entry?.fetched === 'number' && now() - entry.fetched < (entry.maxAge ?? FRESH) * 1000;

  async function request(address, id, entry) {
    const headers = {};
    if (entry?.lastModified) headers['if-modified-since'] = entry.lastModified;
    const response = await fetch(address, { headers, signal: AbortSignal.timeout(timeout) });
    if (response.status === 304 && typeof entry?.body === 'string') {
      await response.body?.cancel();
      await save(id, { ...entry, fetched: now(), maxAge: age(response.headers) ?? entry.maxAge });
      return { status: 'ok', body: entry.body };
    }
    if (response.status === 200) {
      const body = await response.text();
      const lastModified = response.headers.get('last-modified') ?? undefined;
      const maxAge = age(response.headers) ?? FRESH;
      await save(id, { fetched: now(), maxAge, lastModified, body });
      return { status: 'ok', body };
    }
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) {
      if (entry) await drop(id);
      return { status: 'missing' };
    }
    return { why: `HTTP ${response.status}` };
  }

  async function get(address, id, { offline = false } = {}) {
    const entry = await load(id);
    const kept = typeof entry?.body === 'string' && typeof entry.fetched === 'number';
    if (kept && (fresh(entry) || offline)) return { status: 'ok', body: entry.body };
    if (offline) return { status: 'error', message: `${name}: ${address}: offline` };
    let found;
    try {
      found = await request(address, id, entry);
    } catch (error) {
      found = { why: reason(error), transport: true };
    }
    if (found.status) return found;
    const transport = found.transport ? { transport: true } : {};
    if (!kept) {
      return {
        status: 'error',
        message: `${name}: ${address}: ${found.why}`,
        offline: true,
        ...transport,
      };
    }
    return {
      ...transport,
      status: 'ok',
      body: entry.body,
      stale: true,
      note: `${name}: ${address}: ${found.why}; showing the copy cached ${stamp(entry.fetched)}`,
    };
  }

  const address = (topic) => `${root}/man/${topic}.md`;

  async function page(topic, options) {
    if (!valid(topic)) return { status: 'missing' };
    return get(address(topic), key(topic), options);
  }

  async function build(list, offline) {
    const entries = new Array(list.length);
    let next = 0;
    let down = false;
    let broken = offline;
    async function worker() {
      while (next < list.length) {
        const at = next++;
        const topic = list[at];
        const found = await page(topic, { offline: broken });
        if (found.transport) broken = true;
        if (found.stale || found.offline) down = true;
        entries[at] = { topic, description: found.status === 'ok' ? describe(found.body) : '' };
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
    return { entries, down };
  }

  async function index() {
    const cached = await load('index');
    const usable = Array.isArray(cached?.entries);
    if (usable && fresh(cached)) return { entries: cached.entries };
    const map = `${root}/sitemap.xml`;
    const found = await get(map, 'sitemap');
    if (found.status !== 'ok') {
      const message = found.message ?? `${name}: ${map}: HTTP 404`;
      if (usable && typeof cached.fetched === 'number') {
        const why = message.slice(`${name}: ${map}: `.length);
        return {
          entries: cached.entries,
          note: `${name}: ${map}: ${why}; showing the copy cached ${stamp(cached.fetched)}`,
        };
      }
      return { error: message };
    }
    if (found.stale) {
      if (usable) return { entries: cached.entries, note: found.note };
      return { entries: (await build(topics(found.body), true)).entries, note: found.note };
    }
    const sitemap = await load('sitemap');
    const built = await build(topics(found.body), false);
    if (!built.down) {
      await save('index', {
        fetched: now(),
        maxAge: sitemap?.maxAge ?? FRESH,
        entries: built.entries,
      });
    }
    return { entries: built.entries };
  }

  return { address, page, index };
}
