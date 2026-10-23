const BOLD = 1;
const UNDERLINE = 2;

export { BOLD, UNDERLINE };

const punctuation = /^[!-/:-@[-`{-~]$/;
const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const rule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const grid = /^ {0,3}\+[-=:+]*\+[ \t]*$/;
const delimiter = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const quote = /^ {0,3}> ?/;
const item = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const setext = /^ {0,3}(=+|-+)[ \t]*$/;
const autolink = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/;
const reference = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/;
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

function expand(line) {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ch;
  return out;
}

export function clean(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(expand)
    .join('\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '');
}

const blank = (line) => /^[ \t]*$/.test(line);
const indentOf = (line) => line.length - line.trimStart().length;

function starts(line) {
  return (
    fence.test(line) ||
    atx.test(line) ||
    rule.test(line) ||
    quote.test(line) ||
    grid.test(line) ||
    /^ {0,3}[-+*][ \t]+\S/.test(line) ||
    /^ {0,3}1[.)][ \t]+\S/.test(line)
  );
}

function cells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.replaceAll('\\|', '|').trim());
}

function matcher(first) {
  const bullet = /^[-+*]$/.test(first[2]);
  const kind = bullet ? first[2] : first[2].slice(-1);
  return (line) => {
    const match = line === undefined ? null : item.exec(line);
    if (!match || rule.test(line)) return undefined;
    const ok = bullet ? match[2] === kind : /\d/.test(match[2]) && match[2].endsWith(kind);
    return ok ? match : undefined;
  };
}

function entry(lines, at, match) {
  const spaces = match[3] ?? '';
  const wide = spaces.length > 4;
  const width = match[1].length + match[2].length + (wide ? 1 : spaces.length || 1);
  const body = [wide ? spaces.slice(1) + match[4] : (match[4] ?? '')];
  let i = at + 1;
  let gap = false;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) body.push('');
    else if (indentOf(line) >= width) {
      if (body.at(-1) === '') gap = true;
      body.push(line.slice(width));
    } else if (body.at(-1) !== '' && !starts(line) && !item.test(line)) body.push(line);
    else break;
    i++;
  }
  let trailing = 0;
  while (body.length > 1 && body.at(-1) === '') {
    body.pop();
    trailing++;
  }
  return { item: { marker: match[2], blocks: blocks(body) }, next: i, gap, trailing };
}

function list(lines, start) {
  const same = matcher(item.exec(lines[start]));
  const items = [];
  let loose = false;
  let i = start;
  let match = same(lines[i]);
  while (match) {
    const found = entry(lines, i, match);
    items.push(found.item);
    loose ||= found.gap;
    i = found.next;
    match = same(lines[i]);
    if (found.trailing > 0 && match) loose = true;
    if (found.trailing > 0 && !match) i -= found.trailing;
  }
  return { block: { type: 'list', items, loose }, next: i };
}

function fenced(lines, i) {
  const open = fence.exec(lines[i]);
  if (!open || (open[2][0] === '`' && open[3].includes('`'))) return undefined;
  const body = [];
  let j = i + 1;
  while (j < lines.length) {
    const close = closing.exec(lines[j]);
    if (close && close[1][0] === open[2][0] && close[1].length >= open[2].length) {
      j++;
      break;
    }
    body.push(lines[j].slice(Math.min(indentOf(lines[j]), open[1].length)));
    j++;
  }
  return { block: { type: 'code', lines: body }, next: j };
}

function heading(lines, i) {
  const found = atx.exec(lines[i]);
  if (!found) return undefined;
  return { block: { type: 'heading', level: found[1].length, text: found[2] ?? '' }, next: i + 1 };
}

function ruled(lines, i) {
  return rule.test(lines[i]) ? { block: { type: 'rule' }, next: i + 1 } : undefined;
}

function gridded(lines, i) {
  if (!grid.test(lines[i])) return undefined;
  const body = [];
  let j = i;
  while (j < lines.length && /^ {0,3}[+|]/.test(lines[j])) body.push(lines[j++].trim());
  const rows = [];
  for (const row of body) {
    if (row.startsWith('+')) rows.push([]);
    else rows.at(-1).push(row);
  }
  const head = rows.find((row) => row.length > 0) ?? [];
  return {
    block: { type: 'grid', lines: body, first: head.map((row) => cells(row).join(' ')) },
    next: j,
  };
}

function piped(lines, i) {
  if (!lines[i].includes('|') || !delimiter.test(lines[i + 1] ?? '')) return undefined;
  const rows = [cells(lines[i])];
  const columns = cells(lines[i + 1]).length;
  let j = i + 2;
  while (j < lines.length && !blank(lines[j]) && lines[j].includes('|') && !starts(lines[j])) {
    rows.push(cells(lines[j++]));
  }
  return { block: { type: 'table', rows, columns }, next: j };
}

function quoted(lines, i) {
  if (!quote.test(lines[i])) return undefined;
  const body = [];
  let j = i;
  while (j < lines.length && !blank(lines[j])) {
    if (quote.test(lines[j])) body.push(lines[j].replace(quote, ''));
    else if (starts(lines[j])) break;
    else body.push(lines[j]);
    j++;
  }
  return { block: { type: 'quote', blocks: blocks(body) }, next: j };
}

function listed(lines, i) {
  const match = item.exec(lines[i]);
  if (!match || (match[3] === undefined && !/^ {0,3}[-+*]$/.test(lines[i]))) return undefined;
  return list(lines, i);
}

function indented(lines, i) {
  if (!/^ {4}/.test(lines[i])) return undefined;
  const body = [];
  let j = i;
  while (j < lines.length && (/^ {4}/.test(lines[j]) || blank(lines[j]))) {
    body.push(lines[j++].slice(4));
  }
  while (blank(body.at(-1))) body.pop();
  return { block: { type: 'code', lines: body }, next: j };
}

function paragraph(lines, i) {
  const body = [lines[i]];
  let j = i + 1;
  while (j < lines.length && !blank(lines[j])) {
    const under = setext.exec(lines[j]);
    if (under) {
      const text = body.map((line) => line.trim()).join(' ');
      const level = under[1][0] === '=' ? 1 : 2;
      return { block: { type: 'heading', level, text }, next: j + 1 };
    }
    if (starts(lines[j])) break;
    body.push(lines[j++]);
  }
  const text = body.map((line) => line.trimStart()).join('\n');
  return { block: { type: 'paragraph', text }, next: j };
}

const parsers = [fenced, heading, ruled, gridded, piped, quoted, listed, indented, paragraph];

export function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (blank(lines[i])) {
      i++;
      continue;
    }
    for (const parser of parsers) {
      const found = parser(lines, i);
      if (found) {
        out.push(found.block);
        i = found.next;
        break;
      }
    }
  }
  return out;
}

export function parse(markdown) {
  return blocks(clean(markdown).split('\n'));
}

function entity(text, at) {
  const match = reference.exec(text.slice(at));
  if (!match) return undefined;
  let value = entities[match[3]?.toLowerCase()];
  if (match[1] !== undefined) value = String.fromCodePoint(Math.min(Number(match[1]), 0x10ffff));
  if (match[2] !== undefined) {
    value = String.fromCodePoint(Math.min(Number.parseInt(match[2], 16), 0x10ffff));
  }
  if (value === undefined) return undefined;
  return { value: clean(value), length: match[0].length };
}

function ticks(text, at) {
  let n = 0;
  while (text[at + n] === '`') n++;
  return n;
}

function span(text, at) {
  const n = ticks(text, at);
  let j = at + n;
  while (j < text.length) {
    const m = ticks(text, j);
    if (m === n) {
      let code = text.slice(at + n, j).replace(/\n/g, ' ');
      if (/^ .*[^ ].* $|^ [^ ] $/.test(code)) code = code.slice(1, -1);
      return { code, end: j + m };
    }
    j += Math.max(m, 1);
  }
  return { end: at + n };
}

function skip(text, at) {
  if (text[at] === '\\') return at + 2;
  if (text[at] === '`') return span(text, at).end;
  return at + 1;
}

function bracket(text, at) {
  let depth = 0;
  for (let j = at; j < text.length; j = skip(text, j)) {
    if (text[j] === '[') depth++;
    if (text[j] === ']' && --depth === 0) return j;
  }
  return -1;
}

function target(text, at) {
  if (text[at] === '[') {
    const close = text.indexOf(']', at);
    return close === -1 ? -1 : close + 1;
  }
  if (text[at] !== '(') return -1;
  let depth = 0;
  for (let j = at; j < text.length; j += text[j] === '\\' ? 2 : 1) {
    if (text[j] === '(') depth++;
    if (text[j] === ')' && --depth === 0) return j + 1;
  }
  return -1;
}

const space = (ch) => ch === undefined || /\s/u.test(ch);
const word = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const mark = (ch) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);

function opens(text, at, n) {
  const before = text[at - 1];
  const after = text[at + n];
  if (space(after)) return false;
  if (mark(after) && !space(before) && !mark(before)) return false;
  return !(text[at] === '_' && word(before));
}

function closes(text, at, n) {
  const before = text[at - 1];
  const after = text[at + n];
  if (space(before)) return false;
  if (mark(before) && !space(after) && !mark(after)) return false;
  return !(text[at] === '_' && word(after));
}

function link(text, at) {
  if (text[at] !== '[' || text[at - 1] === '!') return -1;
  const end = bracket(text, at);
  return end === -1 ? -1 : target(text, end + 1);
}

function closer(text, at, ch, n) {
  let j = at;
  while (j < text.length) {
    if (text[j] === ch) {
      const m = run(text, j, ch);
      if (m >= n && closes(text, j, m)) return j;
      j += m;
      continue;
    }
    const after = link(text, j);
    j = after === -1 ? skip(text, j) : after;
  }
  return -1;
}

function run(text, at, ch) {
  let n = 0;
  while (text[at + n] === ch) n++;
  return n;
}

function escaped(text, i, state) {
  const next = text[i + 1];
  if (next === '\n') return state.br(i + 2);
  if (next !== undefined && punctuation.test(next)) return state.add(next, i + 2);
  return state.add('\\', i + 1);
}

function coded(text, i, state) {
  const found = span(text, i);
  if (found.code === undefined) return state.add(text.slice(i, found.end), found.end);
  return state.push({ text: found.code, style: state.style | BOLD }, found.end);
}

function entityRef(text, i, state) {
  const found = entity(text, i);
  return found ? state.add(found.value, i + found.length) : state.add('&', i + 1);
}

function autolinked(text, i, state) {
  const found = autolink.exec(text.slice(i));
  return found ? state.add(found[1], i + found[0].length) : state.add('<', i + 1);
}

function imaged(text, i, state) {
  return text[i + 1] === '[' ? linked(text, i + 1, state, i) : state.add('!', i + 1);
}

function linked(text, i, state, from = i) {
  const end = bracket(text, i);
  const after = end === -1 ? -1 : target(text, end + 1);
  if (after === -1) return state.add(text.slice(from, i + 1), i + 1);
  state.flush();
  inline(text.slice(i + 1, end), state.style, state.out);
  return after;
}

function emphasized(text, i, state) {
  const ch = text[i];
  const n = run(text, i, ch);
  let use = Math.min(n, 3);
  let end = -1;
  for (; use > 0 && end === -1; use--) {
    end = opens(text, i + n - use, use) ? closer(text, i + n, ch, use) : -1;
  }
  use++;
  if (end === -1) return state.add(ch.repeat(n), i + n);
  state.add(ch.repeat(n - use), i);
  state.flush();
  const flag = [0, UNDERLINE, BOLD, BOLD | UNDERLINE][use];
  inline(text.slice(i + n, end), state.style | flag, state.out);
  return end + use;
}

function newline(text, i, state) {
  if (!/ {2,}$/.test(state.buffer)) return state.add(' ', i + 1);
  state.buffer = state.buffer.replace(/ +$/, '');
  return state.br(i + 1);
}

const handlers = {
  '\\': escaped,
  '`': coded,
  '&': entityRef,
  '<': autolinked,
  '!': imaged,
  '[': linked,
  '*': emphasized,
  _: emphasized,
  '\n': newline,
};

export function inline(text, style = 0, out = []) {
  const state = {
    style,
    out,
    buffer: '',
    flush() {
      if (state.buffer !== '') out.push({ text: state.buffer, style });
      state.buffer = '';
    },
    add(value, next) {
      state.buffer += value;
      return next;
    },
    push(value, next) {
      state.flush();
      out.push(value);
      return next;
    },
    br(next) {
      return state.push({ text: '\n', style: 0, br: true }, next);
    },
  };
  let i = 0;
  while (i < text.length) {
    const handler = handlers[text[i]];
    i = handler ? handler(text, i, state) : state.add(text[i], i + 1);
  }
  state.flush();
  return out;
}

export function plain(runs) {
  return runs
    .map((run) => (run.br ? ' ' : run.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}
