const MAN_UNSUPPORTED_SHORT = 'tTHXZMmLCdDWcuepREKr';
const MAN_UNSUPPORTED_LONG = [
  'troff',
  'troff-device',
  'html',
  'gxditview',
  'ditroff',
  'manpath',
  'systems',
  'locale',
  'config-file',
  'debug',
  'default',
  'where-cat',
  'catman',
  'update',
  'extension',
  'preprocessor',
  'recode',
  'encoding',
  'global-apropos',
  'prompt',
  'regex',
  'wildcard',
  'names-only',
  'no-subpages',
];
const SEARCH_UNSUPPORTED_SHORT = 'MmLCdv';
const SEARCH_UNSUPPORTED_LONG = ['manpath', 'systems', 'locale', 'config-file', 'debug', 'verbose'];

const common = { h: 'help', V: 'version' };
const commonLong = { help: 'help', version: 'version', upgrade: 'upgrade' };

export const tables = {
  man: {
    short: { ...common, k: 'apropos', f: 'whatis', a: 'all', w: 'where', l: 'local' },
    shortExtra: { i: 'ignore', I: 'match' },
    values: { s: 'sections', P: 'pager' },
    long: {
      ...commonLong,
      apropos: 'apropos',
      whatis: 'whatis',
      all: 'all',
      where: 'where',
      path: 'where',
      location: 'where',
      'local-file': 'local',
      'ignore-case': 'ignore',
      'match-case': 'match',
      nh: 'nh',
      'no-hyphenation': 'nh',
      nj: 'nj',
      'no-justification': 'nj',
    },
    longValues: { sections: 'sections', pager: 'pager' },
    unsupportedShort: MAN_UNSUPPORTED_SHORT,
    unsupportedLong: MAN_UNSUPPORTED_LONG,
  },
  apropos: {
    short: { ...common, r: 'regex', w: 'wildcard', e: 'exact', a: 'and', l: 'long' },
    shortExtra: {},
    values: { s: 'sections' },
    long: {
      ...commonLong,
      regex: 'regex',
      wildcard: 'wildcard',
      exact: 'exact',
      and: 'and',
      long: 'long',
    },
    longValues: { sections: 'sections' },
    unsupportedShort: SEARCH_UNSUPPORTED_SHORT,
    unsupportedLong: SEARCH_UNSUPPORTED_LONG,
  },
  whatis: {
    short: { ...common, r: 'regex', w: 'wildcard', e: 'exact', l: 'long' },
    shortExtra: {},
    values: { s: 'sections' },
    long: { ...commonLong, regex: 'regex', wildcard: 'wildcard', exact: 'exact', long: 'long' },
    longValues: { sections: 'sections' },
    unsupportedShort: SEARCH_UNSUPPORTED_SHORT,
    unsupportedLong: SEARCH_UNSUPPORTED_LONG,
  },
};

export function usage(kind, name) {
  if (kind === 'man') {
    return `usage: ${name} [options] [section] topic...
       ${name} -k [options] keyword...
       ${name} -f [options] topic...
       ${name} -l [options] file...

  -s, --sections=LIST   look only in the sections in LIST, separated by : or ,
  -k, --apropos         search the topics and descriptions, as apropos does
  -f, --whatis          show the topics' one-line descriptions, as whatis does
  -a, --all             show every matching page
  -w, --where           print the page's URL instead of showing it
  -P, --pager=PAGER     page the output with PAGER
  -l, --local-file      render the operands, local Markdown files (- for stdin)
  -i, --ignore-case     look the topic up in lower case (the default)
  -I, --match-case      look the topic up as typed
      --nh, --nj        accepted; nothing is hyphenated or justified
  -h, --help            print this help and exit
  -V, --version         print the version and exit
      --upgrade         upgrade to the latest release
`;
  }
  const and = kind === 'apropos' ? '  -a, --and             a page must match every keyword\n' : '';
  const what = kind === 'apropos' ? 'keyword' : 'topic';
  return `usage: ${name} [options] ${what}...

  -r, --regex           each ${what} is a regular expression${kind === 'apropos' ? ' (the default)' : ''}
  -w, --wildcard        each ${what} is a shell wildcard
  -e, --exact           each ${what} must match exactly${kind === 'whatis' ? ' (the default)' : ''}
${and}  -l, --long            don't cut lines to the terminal width
  -s, --sections=LIST   look only in the sections in LIST, separated by : or ,
  -h, --help            print this help and exit
  -V, --version         print the version and exit
      --upgrade         upgrade to the latest release
`;
}

const pairs = { match: 'ignore', ignore: 'match', apropos: 'whatis', whatis: 'apropos' };

function longOption(table, state, arg, argv) {
  const eq = arg.indexOf('=');
  const long = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
  if (table.unsupportedLong.includes(long)) return { error: `--${long}: not supported` };
  const value = table.longValues[long];
  if (value !== undefined) {
    if (eq !== -1) state.values[value] = arg.slice(eq + 1);
    else if (state.i < argv.length) state.values[value] = argv[state.i++];
    else return { error: `--${long}: needs a value`, usage: true };
    return undefined;
  }
  const flag = eq === -1 ? table.long[long] : undefined;
  if (flag === undefined) return { error: `unknown option: ${arg}`, usage: true };
  return state.set(flag);
}

function shortOptions(table, state, arg, argv) {
  for (let j = 1; j < arg.length; j++) {
    const ch = arg[j];
    if (table.unsupportedShort.includes(ch)) return { error: `-${ch}: not supported` };
    const value = table.values[ch];
    if (value !== undefined) {
      if (j + 1 < arg.length) state.values[value] = arg.slice(j + 1);
      else if (state.i < argv.length) state.values[value] = argv[state.i++];
      else return { error: `-${ch}: needs a value`, usage: true };
      return undefined;
    }
    const flag = table.short[ch] ?? table.shortExtra[ch];
    if (flag === undefined) return { error: `unknown option: -${ch}`, usage: true };
    const stop = state.set(flag);
    if (stop) return stop;
  }
  return undefined;
}

export function parse(kind, argv) {
  const table = tables[kind];
  const flags = {};
  const values = {};
  const operands = [];
  const state = {
    i: 0,
    values,
    set(flag) {
      if (flag === 'help' || flag === 'version') return { [flag]: true };
      flags[flag] = true;
      delete flags[pairs[flag]];
      return undefined;
    },
  };
  const done = (extra) => ({ flags, values, operands, ...extra });
  while (state.i < argv.length) {
    const arg = argv[state.i++];
    if (arg === '--') {
      operands.push(...argv.slice(state.i));
      break;
    }
    let stop;
    if (arg.startsWith('--')) stop = longOption(table, state, arg, argv);
    else if (arg.startsWith('-') && arg !== '-') stop = shortOptions(table, state, arg, argv);
    else operands.push(arg);
    if (stop) return done(stop);
  }
  if (flags.upgrade && argv.length > 1) {
    return done({ error: '--upgrade takes no other arguments', usage: true });
  }
  return done({});
}
