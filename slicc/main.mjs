import { run } from '../lib/man.mjs';
import { clean } from '../lib/markdown.mjs';
import { reasons } from '../lib/reasons.mjs';
import pkg from '../package.json' with { type: 'json' };

const kinds = { apropos: 'apropos', whatis: 'whatis' };
const decoder = new TextDecoder();
let counter = 0;

function why(error) {
  return reasons[error?.code] ?? error?.message ?? String(error);
}

export function store(fs, dir) {
  const file = (id) => `${dir}/${id}.json`;
  return {
    async read(id) {
      try {
        return decoder.decode(await fs.readFile(file(id)));
      } catch {
        return undefined;
      }
    },
    async write(id, text) {
      await fs.mkdir(dir, { recursive: true });
      const temp = `${dir}/.${id}.${Date.now()}.${counter++}.tmp`;
      try {
        await fs.writeFile(temp, text);
        await fs.rename(temp, file(id));
      } catch (error) {
        await fs.unlink(temp).catch(() => {});
        throw error;
      }
    },
    async remove(id) {
      await fs.unlink(file(id)).catch(() => {});
    },
  };
}

export async function which(ctx, file) {
  for (const dir of String(ctx.env.PATH ?? '').split(':')) {
    const path = ctx.resolve(`${dir || '.'}/${file}`);
    try {
      const stat = await ctx.fs.stat(path);
      if (stat.isFile && (stat.mode ?? 0o755) & 0o111) return true;
    } catch {}
  }
  return false;
}

async function input(ctx) {
  const chunks = [];
  for (;;) {
    const chunk = await ctx.read(0);
    if (chunk.length === 0) break;
    chunks.push(chunk);
  }
  const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return decoder.decode(all);
}

async function read(ctx, file) {
  try {
    if (file === '-') return await input(ctx);
    return decoder.decode(await ctx.fs.readFile(ctx.resolve(file)));
  } catch (error) {
    throw new Error(why(error));
  }
}

export async function page(ctx, name, command, text) {
  const err = (line) => ctx.write(2, line);
  await ctx.signals.on('SIGINT', () => {});
  try {
    let child;
    try {
      child = await ctx.spawn({ argv: ['sh', '-c', command], stdin: 'pipe' });
    } catch (error) {
      await err(`${name}: ${command}: ${why(error)}\n`);
      return 2;
    }
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(text)).catch(() => {});
    await writer.close().catch(() => {});
    const { status } = await child.wait();
    return status === 126 || status === 127 ? 2 : 0;
  } finally {
    await ctx.signals.reset('SIGINT');
  }
}

export function help(ctx, topic) {
  const result = ctx.sync.run({
    argv: [topic, '--help'],
    stdin: 'ignore',
    stderr: 'stdout',
  });
  const text = decoder.decode(result.stdout ?? new Uint8Array());
  return clean(text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-_]/g, ''));
}

async function columns(ctx, tty) {
  if (!tty) return undefined;
  try {
    return (await ctx.tty.size(1)).columns;
  } catch {
    return undefined;
  }
}

export default async function main(ctx) {
  const name = String(ctx.argv[0] ?? 'man')
    .split('/')
    .pop();
  const kind = kinds[name] ?? 'man';
  const tty = await ctx.isatty(1);
  const home = String(ctx.env.HOME || '/root').replace(/\/+$/, '');
  const root = `${home}/.cache/slicc-man`;
  const io = {
    tty,
    columns: await columns(ctx, tty),
    fetch: (url, init) => ctx.fetch(url, init),
    now: Date.now,
    version: pkg.version,
    out: (text) => ctx.write(1, text),
    err: (text) => ctx.write(2, text),
    store: (dir) => store(ctx.fs, `${root}/${dir}`),
    which: (file) => which(ctx, file),
    page: (command, text) => page(ctx, name, command, text),
    read: (file) => read(ctx, file),
    help: (topic) => help(ctx, topic),
    upgrade: async () => {
      await ctx.write(1, 'pnpm add -g @ai-ecoverse/slicc-man@latest\n');
      return 0;
    },
  };
  return run({ kind, name, argv: ctx.argv.slice(1), env: ctx.env, io });
}
