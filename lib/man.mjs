import { clean } from './markdown.mjs';
import { parse, usage } from './options.mjs';
import { render } from './render.mjs';
import { cut, line, matcher, search } from './search.mjs';
import { base, folder, site } from './site.mjs';

const OK = 0;
const USAGE = 2;
const NONE = 16;

function worse(a, b) {
  if (a === USAGE || b === USAGE) return USAGE;
  return a === NONE || b === NONE ? NONE : OK;
}

function width(env, io) {
  const manwidth = String(env.MANWIDTH ?? '').trim();
  if (/^\d+$/.test(manwidth) && Number(manwidth) > 0) return Number(manwidth);
  if (io.tty && Number.isInteger(io.columns) && io.columns > 0) return io.columns;
  return 80;
}

function sections(text) {
  return text.split(/[:,]/).filter(Boolean);
}

const sectionName = /^[0-9][A-Za-z]*$/;

async function show(text, ctx) {
  const { io, env, values } = ctx;
  if (!io.tty) {
    await io.out(text);
    return OK;
  }
  let pager = values.pager ?? env.MANPAGER ?? env.PAGER;
  if (pager === undefined) pager = (await io.which('less')) ? 'less -R' : '';
  if (pager.trim() === '') {
    await io.out(text);
    return OK;
  }
  return io.page(pager, text);
}

function choose(kind, flags) {
  if (flags.regex) return 'regex';
  if (flags.wildcard) return 'wildcard';
  if (flags.exact || kind === 'whatis') return 'exact';
  return 'regex';
}

async function compile(kind, ctx, flags, operands) {
  const mode = choose(kind, flags);
  const matchers = [];
  for (const keyword of operands) {
    try {
      matchers.push(matcher(kind, mode, keyword));
    } catch {
      await ctx.io.err(`${ctx.name}: ${keyword}: invalid regular expression\n`);
      return undefined;
    }
  }
  return matchers;
}

async function keywords(kind, ctx, parsed) {
  const { io } = ctx;
  const { flags, values, operands } = parsed;
  if (operands.length === 0) {
    await io.err(`${kind} what?\n`);
    return USAGE;
  }
  const matchers = await compile(kind, ctx, flags, operands);
  if (!matchers) return USAGE;
  const all = Boolean(flags.and);
  const nothing = async () => {
    if (all) await io.err(`${operands.join(' ')}: nothing appropriate.\n`);
    else for (const keyword of operands) await io.err(`${keyword}: nothing appropriate.\n`);
    return NONE;
  };
  if (values.sections !== undefined && !sections(values.sections).includes('1')) return nothing();
  const index = await ctx.site.index();
  if (index.note) await io.err(`${index.note}\n`);
  if (index.error) {
    await io.err(`${index.error}\n`);
    return USAGE;
  }
  const { found, hits } = search(index.entries, matchers, all);
  const columns = width(ctx.env, io);
  const long = flags.long || !io.tty;
  let out = '';
  for (const entry of found) {
    const text = clean(line(entry));
    out += `${long ? text : cut(text, columns)}\n`;
  }
  if (out) await io.out(out);
  if (all) return found.length === 0 ? nothing() : OK;
  let code = OK;
  for (const [n, keyword] of operands.entries()) {
    if (!hits[n]) {
      await io.err(`${keyword}: nothing appropriate.\n`);
      code = NONE;
    }
  }
  return code;
}

function title(file) {
  if (file === '-') return 'stdin';
  const leaf = file.split(/[/\\]/).pop() || file;
  return clean(leaf.replace(/\.(md|markdown)$/i, '')) || 'stdin';
}

async function local(ctx, files) {
  const { io, name } = ctx;
  let code = OK;
  for (const file of files) {
    let text;
    try {
      text = await io.read(file);
    } catch (error) {
      await io.err(`${name}: ${clean(file)}: ${error.message}\n`);
      code = worse(code, USAGE);
      continue;
    }
    const page = render(text, { topic: title(file), width: ctx.width, styled: ctx.styled });
    const shown = await show(page, ctx);
    if (shown !== OK) return worse(code, shown);
  }
  return code;
}

async function pages(ctx, parsed) {
  const { io, flags, values } = ctx;
  let operands = parsed.operands;
  let given = values.sections;
  if (given === undefined && operands.length >= 2 && sectionName.test(operands[0])) {
    given = operands[0];
    operands = operands.slice(1);
  }
  let code = OK;
  for (const operand of operands) {
    let topic = operand;
    let section = given;
    const suffix = /^(.+)\(([0-9][A-Za-z]*)\)$/.exec(operand);
    if (suffix) {
      topic = suffix[1];
      section = suffix[2];
    }
    const shown = clean(topic);
    const where = section === undefined ? '' : ` in section ${clean(section)}`;
    if (section !== undefined && !sections(section).includes('1')) {
      await io.err(`No manual entry for ${shown}${where}\n`);
      code = worse(code, NONE);
      continue;
    }
    const wanted = flags.match ? topic : topic.toLowerCase();
    const found = await ctx.site.page(wanted);
    if (found.note) await io.err(`${found.note}\n`);
    if (found.status === 'error') {
      await io.err(`${found.message}\n`);
      code = worse(code, USAGE);
      continue;
    }
    if (found.status === 'missing') {
      await io.err(`No manual entry for ${shown}${where}\n`);
      code = worse(code, NONE);
      continue;
    }
    if (flags.where) {
      await io.out(`${ctx.site.address(wanted)}\n`);
      continue;
    }
    const page = render(found.body, { topic: wanted, width: ctx.width, styled: ctx.styled });
    const paged = await show(page, ctx);
    if (paged !== OK) return worse(code, paged);
  }
  return code;
}

export async function run({ kind = 'man', name, argv, env, io }) {
  const parsed = parse(kind, argv);
  if (parsed.error) {
    await io.err(`${name}: ${parsed.error}\n${parsed.usage ? usage(kind, name) : ''}`);
    return USAGE;
  }
  if (parsed.help) {
    await io.out(usage(kind, name));
    return OK;
  }
  if (parsed.version) {
    await io.out(`${io.version}\n`);
    return OK;
  }
  if (parsed.flags.upgrade) return io.upgrade();
  const url = base(env);
  const ctx = {
    io,
    env,
    name,
    flags: parsed.flags,
    values: parsed.values,
    width: width(env, io),
    styled: Boolean(io.tty) && !env.NO_COLOR,
    site: site({ url, store: io.store(folder(url)), fetch: io.fetch, now: io.now, name }),
  };
  if (kind !== 'man') return keywords(kind, ctx, parsed);
  if (parsed.flags.apropos) return keywords('apropos', ctx, parsed);
  if (parsed.flags.whatis) return keywords('whatis', ctx, parsed);
  if (parsed.operands.length === 0) {
    await io.err("What manual page do you want?\nFor example, try 'man man'.\n");
    return USAGE;
  }
  if (parsed.flags.local) return local(ctx, parsed.operands);
  return pages(ctx, parsed);
}
