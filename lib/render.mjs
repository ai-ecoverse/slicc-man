import { BOLD, inline, parse, plain, UNDERLINE } from './markdown.mjs';

const BODY = 7;
const SUB = 3;

function paint(cells, styled) {
  let out = '';
  let current = 0;
  for (const cell of cells) {
    const style = styled ? cell.style : 0;
    if (style !== current) {
      if (current !== 0) out += '\x1b[0m';
      if (style & BOLD) out += '\x1b[1m';
      if (style & UNDERLINE) out += '\x1b[4m';
      current = style;
    }
    out += cell.ch;
  }
  if (current !== 0) out += '\x1b[0m';
  return out;
}

function words(runs) {
  const lines = [[]];
  let word = [];
  const end = () => {
    if (word.length > 0) lines.at(-1).push(word);
    word = [];
  };
  for (const run of runs) {
    if (run.br) {
      end();
      lines.push([]);
      continue;
    }
    for (const ch of run.text) {
      if (/\s/u.test(ch) && ch !== '\u00a0') end();
      else word.push({ ch, style: run.style });
    }
  }
  end();
  return lines;
}

function wrap(runs, indent, width, styled, lead = '') {
  const hang = ' '.repeat(indent + lead.length);
  const room = Math.max(width - indent - lead.length, 1);
  const out = [];
  let first = true;
  for (const line of words(runs)) {
    let cur = [];
    let size = 0;
    const emit = () => {
      const text = cur.map((w) => paint(w, styled)).join(' ');
      out.push(`${first ? ' '.repeat(indent) + lead : hang}${text}`.trimEnd());
      first = false;
      cur = [];
      size = 0;
    };
    for (const w of line) {
      if (cur.length > 0 && size + 1 + w.length > room) emit();
      size += (cur.length > 0 ? 1 : 0) + w.length;
      cur.push(w);
    }
    if (cur.length > 0 || out.length === 0 || line.length === 0) emit();
  }
  return out;
}

function upper(runs) {
  return runs.map((run) => ({ ...run, text: run.text.toUpperCase() }));
}

function table(block, indent, styled) {
  const rows = block.rows.map((row) => {
    const out = [];
    for (let c = 0; c < block.columns; c++) {
      const runs = inline(row[c] ?? '');
      const cells = [];
      for (const line of words(runs)) {
        for (const w of line) {
          if (cells.length > 0) cells.push({ ch: ' ', style: 0 });
          cells.push(...w);
        }
      }
      out.push(cells);
    }
    return out;
  });
  const widths = [];
  for (let c = 0; c < block.columns; c++) {
    widths.push(Math.max(3, ...rows.map((row) => row[c].length)));
  }
  const line = (row) =>
    `${' '.repeat(indent)}| ${row
      .map((cells, c) => paint(cells, styled) + ' '.repeat(widths[c] - cells.length))
      .join(' | ')} |`;
  const rule = `${' '.repeat(indent)}| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(rows[0]), rule, ...rows.slice(1).map(line)];
}

function emit(block, indent, ctx, out) {
  const { width, styled } = ctx;
  switch (block.type) {
    case 'paragraph':
      out.push(...wrap(inline(block.text), indent, width, styled));
      break;
    case 'code':
      out.push(...block.lines.map((line) => `${' '.repeat(indent)}${line}`.trimEnd()));
      break;
    case 'grid':
      out.push(...block.lines.map((line) => `${' '.repeat(indent)}${line}`));
      break;
    case 'table':
      out.push(...table(block, indent, styled));
      break;
    case 'quote':
      sequence(block.blocks, indent + 4, ctx, out);
      break;
    case 'list':
      for (const [index, entry] of block.items.entries()) {
        if (index > 0 && block.loose) out.push('');
        const lead = `${entry.marker} `;
        const [head, ...rest] = entry.blocks;
        if (head?.type === 'paragraph') {
          out.push(...wrap(inline(head.text), indent, width, styled, lead));
        } else {
          out.push(`${' '.repeat(indent)}${entry.marker}`);
          if (head) rest.unshift(head);
        }
        for (const inner of rest) {
          if (block.loose || inner.type !== 'list') out.push('');
          emit(inner, indent + lead.length, ctx, out);
        }
      }
      break;
    case 'heading': {
      const runs = inline(block.text);
      if (block.level <= 2) out.push(paint(cellsOf(upper(runs)), styled));
      else out.push(' '.repeat(SUB) + paint(cellsOf(runs), styled));
      break;
    }
  }
}

function cellsOf(runs) {
  const cells = [];
  for (const line of words(runs)) {
    for (const w of line) {
      if (cells.length > 0) cells.push({ ch: ' ', style: BOLD });
      cells.push(...w.map((cell) => ({ ...cell, style: cell.style | BOLD })));
    }
  }
  return cells;
}

function sequence(list, indent, ctx, out) {
  let after = true;
  for (const block of list) {
    if (block.type === 'rule') continue;
    if (block.type === 'heading') {
      if (out.length > 0) out.push('');
      emit(block, indent, ctx, out);
      after = true;
      continue;
    }
    if (!after) out.push('');
    emit(block, indent, ctx, out);
    after = false;
  }
}

function metadata(block) {
  if (block?.type === 'grid') return block.first.join(' ').trim() === 'Metadata';
  if (block?.type === 'table') return block.rows[0].join(' ').trim() === 'Metadata';
  return false;
}

function header(topic, width) {
  const side = `${topic.toUpperCase()}(1)`;
  const middle = 'SLICC Manual';
  const free = width - side.length * 2 - middle.length;
  if (free < 2) return `${side} ${middle} ${side}`;
  const left = Math.max(1, Math.floor((width - middle.length) / 2) - side.length);
  const right = free - left;
  if (right < 1) return `${side}${' '.repeat(free - 1)}${middle} ${side}`;
  return `${side}${' '.repeat(left)}${middle}${' '.repeat(right)}${side}`;
}

export function render(markdown, { topic, width = 80, styled = false }) {
  const list = parse(markdown);
  while (list.length > 0 && list.at(-1).type === 'rule') list.pop();
  if (metadata(list.at(-1))) list.pop();
  const ctx = { width, styled };
  const out = [header(topic, width), ''];
  out.push(paint(cellsOf([{ text: 'NAME', style: 0 }]), styled));
  const name = [{ text: topic, style: 0 }];
  if (list[0]?.type === 'paragraph') {
    name.push({ text: ' - ', style: 0 }, ...inline(list.shift().text));
  }
  out.push(...wrap(name, BODY, width, styled));
  const body = [];
  sequence(list, BODY, ctx, body);
  if (body.length > 0) {
    if (body[0] !== '') out.push('');
    out.push(...body);
  }
  return `${out.join('\n')}\n`;
}

export function describe(markdown) {
  const first = parse(markdown)[0];
  return first?.type === 'paragraph' ? plain(inline(first.text)) : '';
}
