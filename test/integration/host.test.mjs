import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { main } from '../../host/main.mjs';
import { fakeExe } from './fake-windows.mjs';

const root = resolve(import.meta.dirname, '../..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'slicc-man-host-')));
const onWindows = process.platform === 'win32';
const posix = { skip: onWindows && 'needs POSIX fakes' };
const system = onWindows
  ? Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        ['SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'WINDIR'].includes(key.toUpperCase())
      )
    )
  : {};
const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, 'pages.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const MODIFIED = 'Tue, 22 Sep 2026 13:04:12 GMT';

const state = {};
let server;
let url;

function reset() {
  state.mode = 'ok';
  state.cacheControl = 'max-age=14400, must-revalidate';
  state.log = [];
  state.files = {};
  state.pages = {
    tree: { body: fixtures['tree.md'], modified: MODIFIED },
    man: { body: fixtures['man.md'], modified: MODIFIED },
    ls: {
      body: 'List directory contents.\n\n## Synopsis\n\nls \\[OPTION]...\n',
      modified: MODIFIED,
    },
    find: { body: 'Search for files in a directory hierarchy.\n', modified: MODIFIED },
    grep: { body: 'Print lines that match patterns.\n', modified: MODIFIED },
    'c++': { body: 'The *C++* compiler, `g++` style.\n', modified: MODIFIED },
  };
  state.sitemap = [
    '/',
    '/man/tree',
    '/man/ls',
    '/man/find',
    '/man/grep',
    '/man/broken',
    '/man/c%2B%2B',
    '/man/ls',
    '/man/nested/page',
    '/use-cases/web',
    '/man/.hidden',
  ];
}

function sitemap() {
  const entries = state.sitemap.map(
    (path) => `  <url><loc>https://elsewhere.example${path}</loc></url>`
  );
  return `<?xml version="1.0" encoding="utf-8"?>\n<urlset>\n${entries.join('\n')}\n</urlset>\n`;
}

function headers(extra = {}) {
  const out = { 'last-modified': MODIFIED, ...extra };
  if (state.cacheControl) out['cache-control'] = state.cacheControl;
  return out;
}

before(async () => {
  reset();
  server = createServer((request, response) => {
    state.log.push({ path: request.url, since: request.headers['if-modified-since'] });
    if (state.files[request.url] !== undefined) {
      response.writeHead(200);
      response.end(state.files[request.url]);
      return;
    }
    if (state.mode === 'down') {
      request.socket.destroy();
      return;
    }
    if (state.mode === '503') {
      response.writeHead(503);
      response.end('busy');
      return;
    }
    if (request.url === '/sitemap.xml') {
      response.writeHead(200, headers({ 'content-type': 'application/xml' }));
      response.end(sitemap());
      return;
    }
    const topic = /^\/man\/(.+)\.md$/.exec(request.url)?.[1];
    const page = topic === undefined ? undefined : state.pages[decodeURIComponent(topic)];
    if (!page) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    if (page.hang) return;
    if (page.status) {
      response.writeHead(page.status);
      response.end('failed');
      return;
    }
    if (request.headers['if-modified-since'] === page.modified) {
      response.writeHead(304, headers());
      response.end();
      return;
    }
    response.writeHead(
      200,
      headers({ 'content-type': 'text/markdown', 'last-modified': page.modified })
    );
    response.end(page.body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20 });
});

let cache;
beforeEach(() => {
  reset();
  cache = mkdtempSync(join(scratch, 'cache-'));
});

function tools(scripts, exe = onWindows) {
  const dir = mkdtempSync(join(scratch, 'bin-'));
  for (const [name, body] of Object.entries(scripts)) {
    if (exe) {
      fakeExe(dir, name.endsWith('.exe') ? name : `${name}.exe`, body);
      continue;
    }
    writeFileSync(join(dir, name), `#!${process.execPath}\n${body}`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

const pager = (name) => `const fs = require('node:fs');
const path = require('node:path');
const log = (file) => path.join(process.env.FAKE_LOG, ${JSON.stringify(name)} + file);
fs.writeFileSync(log('.argv'), [${JSON.stringify(name)}, ...process.argv.slice(2)].map((arg) => arg + '\\n').join(''));
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  fs.writeFileSync(log('.stdin'), Buffer.concat(chunks));
  process.stdout.write('paged by ${name}\\n');
  process.exitCode = Number(process.env.FAKE_STATUS || 0);
});
`;

const onPath = (bin) => (onWindows ? bin : `${bin}:/usr/bin:/bin`);

async function scman(argv, options = {}) {
  const dir = mkdtempSync(join(scratch, 'run-'));
  writeFileSync(join(dir, 'in'), options.stdin ?? '');
  const fds = [
    openSync(join(dir, 'in'), 'r'),
    openSync(join(dir, 'out'), 'w'),
    openSync(join(dir, 'err'), 'w'),
  ];
  const env = {
    ...system,
    PATH: options.path ?? (onWindows ? join(scratch, 'none') : '/usr/bin:/bin'),
    HOME: join(scratch, 'home'),
    XDG_CACHE_HOME: cache,
    LOCALAPPDATA: cache,
    SLICC_MAN_URL: url,
    FAKE_LOG: dir,
  };
  for (const key of Object.keys(options.env ?? {})) {
    for (const old of Object.keys(env))
      if (old.toUpperCase() === key.toUpperCase()) delete env[old];
  }
  Object.assign(env, options.env);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  let code;
  try {
    code = await main({
      name: 'scman',
      argv,
      env,
      platform: options.platform ?? process.platform,
      fds,
      tty: options.tty ?? false,
      columns: options.columns,
      now: options.now,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeout: options.timeout,
    });
  } finally {
    for (const fd of fds) closeSync(fd);
  }
  const read = (name) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined;
  return { code, stdout: read('out'), stderr: read('err'), read };
}

const requests = () => state.log.map((entry) => entry.path);
const site = () =>
  join(cache, 'slicc-man', ...(onWindows ? ['cache'] : []), `127.0.0.1-${new URL(url).port}`);

describe('man pages', () => {
  it('renders tree.md as a man page, plain through a pipe', async () => {
    const result = await scman(['tree']);
    assert.deepEqual(result, { ...result, code: 0, stderr: '' });
    assert.equal(result.stdout, fixtures['tree.txt']);
    assert.doesNotMatch(result.stdout, /\x1b|Metadata|\\\[|\\--|https?:/);
    assert.match(
      result.stdout,
      /^TREE\(1\) {27}SLICC Manual {27}TREE\(1\)\n\nNAME\n {7}tree - List/
    );
    assert.match(result.stdout, /\nSYNOPSIS\n {7}tree \[OPTION\]\.\.\. \[DIRECTORY\]\.\.\.\n/);
    assert.match(result.stdout, /\n {7}--help Display help and exit\.\n/);
    assert.match(result.stdout, /\nSEE ALSO\n {7}ls, find, du\n$/);
    assert.deepEqual(requests(), ['/man/tree.md']);
  });

  it('renders man.md, with the site escapes undone', async () => {
    const result = await scman(['man']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, fixtures['man.txt']);
    assert.match(result.stdout, /\n {7}man <topic>\n/);
  });

  it('shows several topics in turn, lower-cased, and exits 16 for the one with no page', async () => {
    const result = await scman(['TREE', 'nope', 'Man']);
    assert.equal(result.code, 16);
    assert.equal(result.stdout, fixtures['tree.txt'] + fixtures['man.txt']);
    assert.equal(result.stderr, 'No manual entry for nope\n');
  });

  it('fetches nothing for a topic that is not a page name', async () => {
    for (const topic of ['', '.hidden', '../etc/passwd', 'a/b', 'x y', 'tr%65e', '\x1b[31m']) {
      const result = await scman([topic]);
      assert.equal(result.code, 16, JSON.stringify(topic));
      assert.equal(result.stderr, `No manual entry for ${topic.replace(/\x1b/g, '')}\n`);
    }
    assert.deepEqual(requests(), []);
  });

  it('looks a topic up as typed with -I, in lower case with -i', async () => {
    const typed = await scman(['-I', 'Tree']);
    assert.equal(typed.code, 16);
    assert.equal(typed.stderr, 'No manual entry for Tree\n');
    assert.deepEqual(requests(), ['/man/Tree.md']);
    const lower = await scman(['-I', '-i', 'Tree']);
    assert.equal(lower.code, 0);
    assert.equal(lower.stdout, fixtures['tree.txt']);
    const plus = await scman(['C++']);
    assert.equal(plus.code, 0);
    assert.match(
      plus.stdout,
      /^C\+\+\(1\) .*\n\nNAME\n {7}c\+\+ - The C\+\+ compiler, g\+\+ style\.\n$/
    );
  });

  it('prints the URL with -w, --where, --path and --location, and exits 16 for a missing one', async () => {
    for (const flag of ['-w', '--where', '--path', '--location']) {
      const result = await scman([flag, 'tree', 'nope', 'ls']);
      assert.equal(result.code, 16);
      assert.equal(result.stdout, `${url}/man/tree.md\n${url}/man/ls.md\n`);
      assert.equal(result.stderr, 'No manual entry for nope\n');
    }
  });

  it('accepts -a, --nh, --nj and their long names, which change nothing', async () => {
    const result = await scman([
      '-a',
      '--all',
      '--nh',
      '--no-hyphenation',
      '--nj',
      '--no-justification',
      'tree',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, fixtures['tree.txt']);
  });

  it('renders lists, code blocks, tables, subheadings, quotes, breaks and setext headings', async () => {
    state.pages.shape = { body: fixtures['shape.md'], modified: MODIFIED };
    const result = await scman(['shape']);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, fixtures['shape.txt']);
    assert.match(result.stdout, /\n {7}- a bullet item .*,\n {9}hanging after its marker\n/);
    assert.match(
      result.stdout,
      /\n {9}kept {3}as is, never wrapped even when it is much longer than the width of the terminal window\n/
    );
    assert.match(result.stdout, /\n {7}\| option \| does {9}\|\n {7}\| -{6} \| -{12} \|\n/);
    assert.match(result.stdout, /\n {3}A subheading\n/);
    assert.doesNotMatch(result.stdout, /Metadata|image\]|https:\/\/example\.com\/a/);
    const styled = await scman(['shape'], { tty: true, env: { PAGER: '', MANWIDTH: '200' } });
    assert.match(
      styled.stdout,
      /Shows \x1b\[1mevery\x1b\[0m shape: \x1b\[4memphasis\x1b\[0m, \x1b\[4munderline\x1b\[0m, \x1b\[1mcode\x1b\[0m \x1b\[1m\\\[kept\]\x1b\[0m, snake_case,/
    );
    assert.match(styled.stdout, /\n\x1b\[1mSETEXT HEADING\x1b\[0m\n$/);
    assert.match(styled.stdout, /\| \x1b\[1m-s\x1b\[0m {5}\| the \x1b\[1msections\x1b\[0m \|/);
  });

  it('drops control characters from a page, and makes tabs spaces', async () => {
    state.pages.evil = {
      body: 'Bad \x1b[31mred\x1b[0m \x07bell\x9b2J.\n\n## Code\n\n```\na\tb\x1b]0;x\x07\n```\n',
      modified: MODIFIED,
    };
    const result = await scman(['evil'], { tty: true, env: { NO_COLOR: '1', PAGER: '' } });
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    assert.match(result.stdout, /evil - Bad \[31mred\[0m bell2J\./);
    assert.match(result.stdout, /\n {7}a {3}b\]0;x\n/);
  });
});

describe('sections', () => {
  it('takes section 1 as an operand, a suffix or -s, and refuses the others without fetching', async () => {
    for (const argv of [['1', 'tree'], ['tree(1)'], ['-s', '1', 'tree'], ['-s1', 'tree']]) {
      const result = await scman(argv);
      assert.equal(result.code, 0, argv.join(' '));
      assert.equal(result.stdout, fixtures['tree.txt']);
    }
    for (const argv of [
      ['--sections=8:1', 'tree'],
      ['--sections', '1,8', 'tree'],
      ['-s', '3p:1', 'tree'],
    ]) {
      assert.equal((await scman(argv)).code, 0, argv.join(' '));
    }
    state.log = [];
    const cases = [
      [['3', 'tree'], 'No manual entry for tree in section 3\n'],
      [
        ['3p', 'tree', 'ls'],
        'No manual entry for tree in section 3p\nNo manual entry for ls in section 3p\n',
      ],
      [['tree(8)'], 'No manual entry for tree in section 8\n'],
      [['-s', '3:5', 'tree'], 'No manual entry for tree in section 3:5\n'],
      [['--sections=2,3', 'tree'], 'No manual entry for tree in section 2,3\n'],
    ];
    for (const [argv, stderr] of cases) {
      const result = await scman(argv);
      assert.equal(result.code, 16, argv.join(' '));
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, stderr);
    }
    assert.deepEqual(requests(), []);
  });

  it('reads a lone section-like operand as a topic, and says the section for a missing page', async () => {
    const lone = await scman(['1']);
    assert.equal(lone.code, 16);
    assert.equal(lone.stderr, 'No manual entry for 1\n');
    const missing = await scman(['1', 'nope']);
    assert.equal(missing.stderr, 'No manual entry for nope in section 1\n');
    const both = await scman(['-s', '1', '3', 'tree']);
    assert.equal(both.code, 16);
    assert.equal(both.stderr, 'No manual entry for 3 in section 1\n');
    assert.equal(both.stdout, fixtures['tree.txt']);
  });
});

describe('-l', () => {
  it('renders local files and stdin, and exits 2 for a file it cannot read', async () => {
    const file = join(scratch, 'local-page.md');
    writeFileSync(file, 'A local page.\n\n## Usage\n\nIt works.\n');
    const result = await scman(['-l', file]);
    assert.equal(result.code, 0);
    assert.match(
      result.stdout,
      /^LOCAL-PAGE\(1\) +SLICC Manual +LOCAL-PAGE\(1\)\n\nNAME\n {7}local-page - A local page\.\n\nUSAGE\n {7}It works\.\n$/
    );
    const stdin = await scman(['--local-file', '-'], { stdin: 'From stdin.\n' });
    assert.equal(stdin.code, 0);
    assert.match(stdin.stdout, /^STDIN\(1\).*\n\nNAME\n {7}stdin - From stdin\.\n$/);
    const missing = await scman(['-l', join(scratch, 'nope.md'), file]);
    assert.equal(missing.code, 2);
    assert.equal(missing.stderr, `scman: ${join(scratch, 'nope.md')}: No such file or directory\n`);
    assert.match(missing.stdout, /^LOCAL-PAGE\(1\)/);
    assert.deepEqual(requests(), []);
  });
});

describe('on a terminal', () => {
  it('pages through less -R when it is on PATH, with bold and underline', async () => {
    const bin = tools({ less: pager('less') });
    const result = await scman(['tree'], { tty: true, path: onPath(bin), columns: 100 });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'paged by less\n');
    assert.equal(result.read('less.argv'), 'less\n-R\n');
    const paged = result.read('less.stdin');
    assert.match(paged, /^TREE\(1\) {37}SLICC Manual {37}TREE\(1\)\n\n\x1b\[1mNAME\x1b\[0m\n/);
    assert.match(paged, /\n\x1b\[1mSEE ALSO\x1b\[0m\n/);
    state.pages.styled = { body: 'Is **bold**, *under* and `code`.\n', modified: MODIFIED };
    const styled = await scman(['styled'], { tty: true, path: onPath(bin) });
    assert.match(
      styled.read('less.stdin'),
      /styled - Is \x1b\[1mbold\x1b\[0m, \x1b\[4munder\x1b\[0m and \x1b\[1mcode\x1b\[0m\.\n$/
    );
  });

  it('takes -P, then MANPAGER, then PAGER, and an empty one means stdout', async () => {
    const bin = tools({
      less: pager('less'),
      one: pager('one'),
      two: pager('two'),
      three: pager('three'),
    });
    const path = onPath(bin);
    const env = { MANPAGER: 'two --flag', PAGER: 'three' };
    const p = await scman(['-P', 'one "a b"', 'tree'], { tty: true, path, env });
    assert.equal(p.read('one.argv'), 'one\na b\n');
    const attached = await scman(['-Pone', 'tree'], { tty: true, path, env });
    assert.equal(attached.stdout, 'paged by one\n');
    const long = await scman(['--pager=one', 'tree'], { tty: true, path, env });
    assert.equal(long.stdout, 'paged by one\n');
    const manpager = await scman(['tree'], { tty: true, path, env });
    assert.equal(manpager.read('two.argv'), 'two\n--flag\n');
    const plain = await scman(['tree'], { tty: true, path, env: { PAGER: 'three' } });
    assert.equal(plain.stdout, 'paged by three\n');
    for (const empty of [{ MANPAGER: '', PAGER: 'three' }, { PAGER: '' }]) {
      const direct = await scman(['tree'], { tty: true, path, env: { ...empty, NO_COLOR: '1' } });
      assert.equal(direct.stdout, fixtures['tree.txt']);
    }
    const flag = await scman(['-P', '', 'tree'], {
      tty: true,
      path,
      env: { ...env, NO_COLOR: 'y' },
    });
    assert.equal(flag.stdout, fixtures['tree.txt']);
  });

  it('writes straight to stdout with no less on PATH, and plain with NO_COLOR', async () => {
    const empty = mkdtempSync(join(scratch, 'empty-'));
    const colour = await scman(['tree'], { tty: true, path: empty });
    assert.match(colour.stdout, /\x1b\[1mNAME\x1b\[0m/);
    const plain = await scman(['tree'], { tty: true, path: empty, env: { NO_COLOR: '1' } });
    assert.equal(plain.stdout, fixtures['tree.txt']);
    const blank = await scman(['tree'], { tty: true, path: empty, env: { NO_COLOR: '' } });
    assert.match(blank.stdout, /\x1b\[1m/);
  });

  it('keeps the exit code when the pager fails, and exits 2 when it cannot run', async () => {
    const bin = tools({ less: pager('less') });
    const path = onPath(bin);
    const failing = await scman(['tree'], { tty: true, path, env: { FAKE_STATUS: '3' } });
    assert.equal(failing.code, 0);
    const missing = await scman(['nope', 'tree'], { tty: true, path, env: { FAKE_STATUS: '3' } });
    assert.equal(missing.code, 16);
    const broken = await scman(['tree', 'man'], {
      tty: true,
      path,
      env: { PAGER: 'no-such-pager-here' },
    });
    assert.equal(broken.code, 2);
    assert.match(broken.stderr, /no-such-pager-here/);
  });

  it('looks less up with PATHEXT on Windows and runs the pager with cmd /d /s /c', async () => {
    const shell = tools({ comspec: pager('comspec') });
    const comspec = join(shell, onWindows ? 'comspec.exe' : 'comspec');
    const bare = mkdtempSync(join(scratch, 'bare-'));
    writeFileSync(join(bare, 'less'), '');
    const env = { COMSPEC: comspec, NO_COLOR: '1' };
    const direct = await scman(['tree'], { platform: 'win32', tty: true, path: bare, env });
    assert.deepEqual([direct.code, direct.stdout], [0, fixtures['tree.txt']]);
    assert.equal(direct.read('comspec.argv'), undefined);
    const found = mkdtempSync(join(scratch, 'found-'));
    writeFileSync(join(found, 'less.EXE'), '');
    const paged = await scman(['tree'], { platform: 'win32', tty: true, path: found, env });
    assert.deepEqual([paged.code, paged.stdout], [0, 'paged by comspec\n']);
    const argv = paged.read('comspec.argv').split('\n');
    assert.deepEqual(argv.slice(0, 4), ['comspec', '/d', '/s', '/c']);
    assert.equal(
      argv[4].replace(/^"(.*)"$/, '$1'),
      'less -R & if errorlevel 9009 if not errorlevel 9010 exit 9009'
    );
    assert.equal(paged.read('comspec.stdin'), fixtures['tree.txt']);
    for (const [status, code] of [...(onWindows ? [['9009', 2]] : []), ['127', 0], ['1', 0]]) {
      const result = await scman(['tree'], {
        platform: 'win32',
        tty: true,
        path: found,
        env: { ...env, FAKE_STATUS: status },
      });
      assert.equal(result.code, code, status);
    }
  });

  it('wraps at MANWIDTH, else the terminal width, else 80', async () => {
    state.pages.wide = { body: `${'word '.repeat(40)}\n`, modified: MODIFIED };
    const width = (text) => Math.max(...text.split('\n').map((line) => line.length));
    const env = { NO_COLOR: '1', PAGER: '' };
    assert.equal(width((await scman(['wide'], { tty: true, columns: 50, env })).stdout), 50);
    assert.equal(
      width(
        (await scman(['wide'], { tty: true, columns: 50, env: { ...env, MANWIDTH: '40' } })).stdout
      ),
      40
    );
    assert.equal(
      width(
        (await scman(['wide'], { tty: true, columns: 50, env: { ...env, MANWIDTH: '0' } })).stdout
      ),
      50
    );
    assert.equal(width((await scman(['wide'], { tty: true, env })).stdout), 80);
    assert.equal(width((await scman(['wide'], { columns: 50 })).stdout), 80);
    assert.equal(width((await scman(['wide'], { env: { MANWIDTH: '60' } })).stdout), 60);
    assert.equal(width((await scman(['wide'], { env: { MANWIDTH: 'x' } })).stdout), 80);
  });
});

describe('the cache', () => {
  it('keeps pages fresh for max-age, and 4 hours without one', async () => {
    await scman(['tree']);
    const again = await scman(['tree']);
    assert.equal(again.stdout, fixtures['tree.txt']);
    assert.deepEqual(requests(), ['/man/tree.md']);
    const entry = JSON.parse(readFileSync(join(site(), 'page-tree.json'), 'utf8'));
    assert.equal(entry.body, fixtures['tree.md']);
    assert.equal(entry.lastModified, MODIFIED);
    assert.equal(entry.maxAge, 14400);
    state.cacheControl = '';
    await scman(['ls']);
    const later = Date.now() + 4 * 3600 * 1000;
    state.log = [];
    await scman(['ls'], { now: () => later - 60000 });
    assert.deepEqual(requests(), []);
    await scman(['ls'], { now: () => later + 60000 });
    assert.deepEqual(state.log, [{ path: '/man/ls.md', since: MODIFIED }]);
  });

  it('revalidates a stale copy with If-Modified-Since: 304 keeps it, 200 replaces it, 404 drops it', async () => {
    state.cacheControl = 'max-age=0';
    await scman(['tree']);
    const kept = await scman(['tree']);
    assert.equal(kept.stdout, fixtures['tree.txt']);
    assert.deepEqual(state.log, [
      { path: '/man/tree.md', since: undefined },
      { path: '/man/tree.md', since: MODIFIED },
    ]);
    state.pages.tree = { body: 'Changed.\n', modified: 'Wed, 23 Sep 2026 10:00:00 GMT' };
    const replaced = await scman(['tree']);
    assert.match(replaced.stdout, /tree - Changed\.\n$/);
    assert.equal(
      JSON.parse(readFileSync(join(site(), 'page-tree.json'), 'utf8')).body,
      'Changed.\n'
    );
    delete state.pages.tree;
    const dropped = await scman(['tree']);
    assert.equal(dropped.code, 16);
    assert.equal(dropped.stderr, 'No manual entry for tree\n');
    assert.ok(!existsSync(join(site(), 'page-tree.json')));
    assert.deepEqual(
      readdirSync(site()).filter((name) => name.endsWith('.tmp')),
      []
    );
  });

  it('shows a stale copy with a note when the site is down or answers 5xx', async () => {
    state.cacheControl = 'max-age=0';
    await scman(['tree']);
    for (const mode of ['down', '503']) {
      state.mode = mode;
      const result = await scman(['tree']);
      assert.equal(result.code, 0, mode);
      assert.equal(result.stdout, fixtures['tree.txt']);
      assert.match(
        result.stderr,
        new RegExp(
          `^scman: ${url}/man/tree\\.md: ${mode === '503' ? 'HTTP 503' : '[^\\n;]+'}; showing the copy cached \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\n$`
        )
      );
      const none = await scman(['ls', 'tree']);
      assert.equal(none.code, 2);
      assert.match(
        none.stderr,
        new RegExp(`^scman: ${url}/man/ls\\.md: ${mode === '503' ? 'HTTP 503' : '[^\\n;]+'}\\n`)
      );
      assert.equal(none.stdout, fixtures['tree.txt']);
    }
  });

  it('names the directory by host and port, and skips a cache it cannot write', posix, async () => {
    await scman(['tree']);
    assert.ok(existsSync(join(site(), 'page-tree.json')));
    const file = join(scratch, 'not-a-directory');
    writeFileSync(file, '');
    const result = await scman(['tree'], { env: { XDG_CACHE_HOME: file } });
    assert.deepEqual([result.code, result.stderr], [0, '']);
    assert.equal(result.stdout, fixtures['tree.txt']);
    const home = mkdtempSync(join(scratch, 'home-'));
    await scman(['tree'], { env: { XDG_CACHE_HOME: undefined, HOME: home } });
    assert.ok(
      existsSync(join(home, '.cache/slicc-man', `127.0.0.1-${new URL(url).port}`, 'page-tree.json'))
    );
    const relative = await scman(['tree'], { env: { XDG_CACHE_HOME: 'relative', HOME: home } });
    assert.equal(relative.code, 0);
    assert.ok(!existsSync(join(root, 'relative')));
  });

  it('is in %LOCALAPPDATA%\\slicc-man\\cache on Windows, whatever XDG_CACHE_HOME says', async () => {
    const local = mkdtempSync(join(scratch, 'local-'));
    const xdg = mkdtempSync(join(scratch, 'xdg-'));
    const env = { LOCALAPPDATA: undefined, localappdata: local, XDG_CACHE_HOME: xdg };
    const result = await scman(['tree'], { platform: 'win32', env });
    assert.deepEqual([result.code, result.stderr], [0, '']);
    const port = new URL(url).port;
    assert.ok(existsSync(join(local, 'slicc-man', 'cache', `127.0.0.1-${port}`, 'page-tree.json')));
    assert.deepEqual(readdirSync(xdg), []);
    state.mode = 'down';
    const offline = await scman(['tree'], { platform: 'win32', env });
    assert.deepEqual([offline.code, offline.stdout], [0, fixtures['tree.txt']]);
    state.mode = 'ok';
    const file = join(scratch, 'local-file');
    writeFileSync(file, '');
    const unwritable = await scman(['tree'], {
      platform: 'win32',
      env: { LOCALAPPDATA: file, XDG_CACHE_HOME: xdg },
    });
    assert.deepEqual([unwritable.code, unwritable.stderr], [0, '']);
    assert.equal(unwritable.stdout, fixtures['tree.txt']);
  });

  it('keeps -I pages apart from lower-case ones', async () => {
    state.pages.Tree = { body: 'Upper.\n', modified: MODIFIED };
    await scman(['tree']);
    const upper = await scman(['-I', 'Tree']);
    assert.match(upper.stdout, /Tree - Upper\./);
    const lower = await scman(['tree']);
    assert.equal(lower.stdout, fixtures['tree.txt']);
  });
});

const index = [
  'tree (1)             - List contents of directories in a tree-like format.',
  'ls (1)               - List directory contents.',
  'find (1)             - Search for files in a directory hierarchy.',
  'grep (1)             - Print lines that match patterns.',
  'broken (1)           -',
  'c++ (1)              - The C++ compiler, g++ style.',
];

describe('-k and -f', () => {
  it('builds the index from the sitemap and the pages, in order, and caches it', async () => {
    const result = await scman(['-k', '.']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, `${index.join('\n')}\n`);
    assert.deepEqual(
      requests().sort(),
      [
        '/sitemap.xml',
        '/man/tree.md',
        '/man/ls.md',
        '/man/find.md',
        '/man/grep.md',
        '/man/broken.md',
        '/man/c++.md',
      ].sort()
    );
    state.log = [];
    const again = await scman(['--apropos', 'dir']);
    assert.equal(again.stdout, `${[index[0], index[1], index[2]].join('\n')}\n`);
    assert.deepEqual(requests(), []);
    assert.ok(existsSync(join(site(), 'index.json')));
  });

  it('matches apropos keywords as case-insensitive regular expressions, each match once', async () => {
    const result = await scman(['-k', 'LIST', '^l', 'nothing-here']);
    assert.equal(result.code, 16);
    assert.equal(result.stdout, `${index[0]}\n${index[1]}\n`);
    assert.equal(result.stderr, 'nothing-here: nothing appropriate.\n');
    const bad = await scman(['-k', '(']);
    assert.equal(bad.code, 2);
    assert.equal(bad.stderr, 'scman: (: invalid regular expression\n');
    assert.deepEqual(requests().filter((path) => path === '/sitemap.xml').length, 1);
  });

  it('looks topics up exactly with -f', async () => {
    const result = await scman(['-f', 'TREE', 'tre', 'ls']);
    assert.equal(result.code, 16);
    assert.equal(result.stdout, `${index[0]}\n${index[1]}\n`);
    assert.equal(result.stderr, 'tre: nothing appropriate.\n');
    const long = await scman(['--whatis', 'c++']);
    assert.equal(long.stdout, `${index[5]}\n`);
  });

  it('cuts lines to the width on a terminal, and never pages', async () => {
    const bin = tools({ less: pager('less') });
    const result = await scman(['-k', 'tree'], {
      tty: true,
      columns: 40,
      path: onPath(bin),
    });
    assert.equal(result.stdout, `${index[0].slice(0, 37)}...\n`);
    const wide = await scman(['-k', 'tree'], { tty: true, env: { MANWIDTH: '200' } });
    assert.equal(wide.stdout, `${index[0]}\n`);
    const pipe = await scman(['-k', 'tree'], { columns: 40 });
    assert.equal(pipe.stdout, `${index[0]}\n`);
  });

  it('matches nothing outside section 1, without fetching', async () => {
    const result = await scman(['-k', '-s', '3', 'tree', 'ls']);
    assert.equal(result.code, 16);
    assert.equal(result.stderr, 'tree: nothing appropriate.\nls: nothing appropriate.\n');
    assert.deepEqual(requests(), []);
    const inside = await scman(['-f', '-s', '8:1', 'tree']);
    assert.equal(inside.stdout, `${index[0]}\n`);
  });

  it('asks what with no keyword, and the last of -k and -f wins', async () => {
    const k = await scman(['-k']);
    assert.deepEqual([k.code, k.stderr], [2, 'apropos what?\n']);
    const f = await scman(['-k', '-f']);
    assert.deepEqual([f.code, f.stderr], [2, 'whatis what?\n']);
    const last = await scman(['-f', '-k', 'tree-like']);
    assert.equal(last.stdout, `${index[0]}\n`);
  });

  it('uses a stale index with a note offline, and exits 2 with nothing cached', async () => {
    const down = await scman(['-k', 'tree'], {});
    assert.equal(down.code, 0);
    state.mode = 'down';
    const later = Date.now() + 5 * 3600 * 1000;
    const stale = await scman(['-k', 'tree'], { now: () => later });
    assert.equal(stale.code, 0);
    assert.equal(stale.stdout, `${index[0]}\n`);
    assert.match(
      stale.stderr,
      new RegExp(`^scman: ${url}/sitemap\\.xml: [^\\n]+; showing the copy cached [^\\n]+Z\\n$`)
    );
    rmSync(join(site(), 'index.json'));
    const rebuilt = await scman(['-k', 'tree'], { now: () => later });
    assert.equal(rebuilt.stdout, `${index[0]}\n`);
    assert.match(rebuilt.stderr, /sitemap\.xml: .*; showing the copy cached /);
    rmSync(join(site(), 'sitemap.json'));
    const sitemapless = await scman(['-k', 'tree'], { now: () => later });
    assert.equal(sitemapless.code, 2);
    assert.match(sitemapless.stderr, new RegExp(`^scman: ${url}/sitemap\\.xml: [^\\n;]+\\n$`));
    cache = mkdtempSync(join(scratch, 'cache-'));
    const nothing = await scman(['-f', 'tree']);
    assert.equal(nothing.code, 2);
  });

  it('keeps a failure to its own page, with more topics than are fetched at once', async () => {
    const names = Array.from({ length: 20 }, (_, n) => `p${n}`);
    state.sitemap = names.map((name) => `/man/${name}`);
    for (const name of names) state.pages[name] = { body: `Page ${name}.\n`, modified: MODIFIED };
    state.pages.p0.status = 503;
    const result = await scman(['-k', '^p']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `${names.map((name) => `${`${name} (1)`.padEnd(20)} -${name === 'p0' ? '' : ` Page ${name}.`}`).join('\n')}\n`
    );
    assert.deepEqual(
      requests()
        .filter((path) => path.startsWith('/man/'))
        .sort(),
      names.map((name) => `/man/${name}.md`).sort()
    );
    assert.ok(!existsSync(join(site(), 'index.json')));
    delete state.pages.p0.status;
    state.log = [];
    const again = await scman(['-f', 'p0']);
    assert.equal(again.stdout, `${'p0 (1)'.padEnd(20)} - Page p0.\n`);
    assert.deepEqual(requests(), ['/man/p0.md']);
  });

  it('stops starting fetches once the network hangs, and reads the rest from the cache', async () => {
    const names = Array.from({ length: 40 }, (_, n) => `p${n}`);
    state.sitemap = names.map((name) => `/man/${name}`);
    for (const name of names) state.pages[name] = { body: `Page ${name}.\n`, modified: MODIFIED };
    state.cacheControl = 'max-age=0';
    assert.equal((await scman(['-k', '^p'])).code, 0);
    for (const name of names) state.pages[name].hang = true;
    state.log = [];
    const started = Date.now();
    const result = await scman(['-k', '^p'], { timeout: 500 });
    const took = Date.now() - started;
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.stdout,
      `${names.map((name) => `${`${name} (1)`.padEnd(20)} - Page ${name}.`).join('\n')}\n`
    );
    assert.equal(result.stderr, '');
    assert.ok(
      requests().filter((path) => path.startsWith('/man/')).length <= 8,
      requests().join(' ')
    );
    assert.ok(took < 1500, `took ${took} ms`);
  });

  it('lists a page without a first paragraph without a description', async () => {
    state.pages.tree.body = '## No first paragraph\n';
    const result = await scman(['-f', 'tree']);
    assert.equal(result.stdout, 'tree (1)             -\n');
    cache = mkdtempSync(join(scratch, 'cache-'));
    state.sitemap = ['/man/tree'];
    const only = await scman(['-k', '.']);
    assert.equal(only.stdout, 'tree (1)             -\n');
  });
});

describe('options', () => {
  const unsupported = {
    man: [
      ['-t', '--troff'],
      ['-T', '--troff-device'],
      ['-H', '--html'],
      ['-X', '--gxditview'],
      ['-Z', '--ditroff'],
      ['-M', '--manpath'],
      ['-m', '--systems'],
      ['-L', '--locale'],
      ['-C', '--config-file'],
      ['-d', '--debug'],
      ['-D', '--default'],
      ['-W', '--where-cat'],
      ['-c', '--catman'],
      ['-u', '--update'],
      ['-e', '--extension'],
      ['-p', '--preprocessor'],
      ['-R', '--recode'],
      ['-E', '--encoding'],
      ['-K', '--global-apropos'],
      ['-r', '--prompt'],
      [undefined, '--regex'],
      [undefined, '--wildcard'],
      [undefined, '--names-only'],
      [undefined, '--no-subpages'],
    ],
  };

  it('refuses man-db options that cannot work, before fetching anything', async () => {
    for (const pair of unsupported.man) {
      for (const option of pair.filter(Boolean)) {
        const result = await scman([option, 'tree']);
        assert.equal(result.code, 2, option);
        assert.equal(result.stderr, `scman: ${option}: not supported\n`);
        assert.equal(result.stdout, '');
      }
    }
    const attached = await scman(['-Tutf8', 'tree']);
    assert.equal(attached.stderr, 'scman: -T: not supported\n');
    const valued = await scman(['--troff-device=utf8', 'tree']);
    assert.equal(valued.stderr, 'scman: --troff-device: not supported\n');
    const cluster = await scman(['-at', 'tree']);
    assert.equal(cluster.stderr, 'scman: -t: not supported\n');
    assert.deepEqual(requests(), []);
  });

  it('prints the usage for an unknown option or a missing value, and exits 2', async () => {
    for (const [argv, line] of [
      [['-x', 'tree'], 'scman: unknown option: -x\n'],
      [['--nope', 'tree'], 'scman: unknown option: --nope\n'],
      [['--all=yes', 'tree'], 'scman: unknown option: --all=yes\n'],
      [['tree', '-s'], 'scman: -s: needs a value\n'],
      [['tree', '-P'], 'scman: -P: needs a value\n'],
      [['tree', '--sections'], 'scman: --sections: needs a value\n'],
      [['tree', '--pager'], 'scman: --pager: needs a value\n'],
    ]) {
      const result = await scman(argv);
      assert.equal(result.code, 2, argv.join(' '));
      assert.ok(
        result.stderr.startsWith(`${line}usage: scman [options] [section] topic...\n`),
        result.stderr
      );
    }
    assert.deepEqual(requests(), []);
  });

  it('prints help and version to stdout, and asks for a topic without one', async () => {
    for (const flag of ['-h', '--help']) {
      const result = await scman([flag, '-t']);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /^usage: scman \[options\] \[section\] topic\.\.\.\n/);
      assert.match(result.stdout, /\n {6}--upgrade {9}upgrade to the latest release\n$/);
    }
    for (const flag of ['-V', '--version']) {
      const result = await scman(['tree', flag]);
      assert.deepEqual([result.code, result.stdout, result.stderr], [0, `${version}\n`, '']);
    }
    const none = await scman([]);
    assert.deepEqual(
      [none.code, none.stdout, none.stderr],
      [2, '', "What manual page do you want?\nFor example, try 'man man'.\n"]
    );
    assert.equal((await scman(['-a'])).code, 2);
  });

  it('ends the options at --, and takes options after operands', async () => {
    const dashed = await scman(['--', '-w']);
    assert.equal(dashed.stderr, 'No manual entry for -w\n');
    const after = await scman(['tree', '-w']);
    assert.equal(after.stdout, `${url}/man/tree.md\n`);
  });
});

describe('--upgrade', () => {
  const installer = (lines) => `#!/bin/sh\n${lines}\n`;

  it('prints the npm command when scman was not installed by the installer', async () => {
    const result = await scman(['--upgrade']);
    assert.deepEqual(
      [result.code, result.stdout, result.stderr],
      [0, 'npm install -g @ai-ecoverse/slicc-man@latest\n', '']
    );
  });

  it('runs the latest installer with --dir, and reports the versions', posix, async () => {
    const bin = mkdtempSync(join(scratch, 'installed-'));
    const record = join(scratch, 'installer-args');
    state.files['/release/install.sh'] = installer(
      `printf '%s\\n' "$@" > '${record}'\nprintf 'dir=%s\\n' "\${SCMAN_INSTALL_DIR:-unset}" >> '${record}'\necho "scman 1.2.3 installed to $2/scman"\necho 'Add it to your PATH'`
    );
    const env = { SCMAN_INSTALL_DIR: bin, SLICC_INSTALL_BASE_URL: `${url}/release/` };
    const result = await scman(['--upgrade'], { env });
    assert.deepEqual(
      [result.code, result.stdout, result.stderr],
      [0, `scman: ${version} → 1.2.3\n`, '']
    );
    assert.equal(readFileSync(record, 'utf8'), `--dir\n${bin}\ndir=unset\n`);
    state.files['/release/install.sh'] = installer(`echo "scman ${version} installed to $2/scman"`);
    const same = await scman(['--upgrade'], { env });
    assert.equal(same.stdout, `scman: already up to date (${version})\n`);
    state.files['/release/install.sh'] = installer(
      `echo 'install.sh: could not download x' >&2\nexit 1`
    );
    const failed = await scman(['--upgrade'], { env });
    assert.deepEqual(
      [failed.code, failed.stdout, failed.stderr],
      [1, '', 'install.sh: could not download x\n']
    );
    state.files['/release/install.sh'] = installer('echo done');
    const silent = await scman(['--upgrade'], { env });
    assert.deepEqual(
      [silent.code, silent.stderr],
      [1, 'scman: install.sh did not say which version it installed\n']
    );
    delete state.files['/release/install.sh'];
    const missing = await scman(['--upgrade'], { env });
    assert.deepEqual(
      [missing.code, missing.stderr],
      [1, `scman: could not download ${url}/release/install.sh: HTTP 404\n`]
    );
    state.mode = 'down';
    const down = await scman(['--upgrade'], { env });
    assert.equal(down.code, 1);
    assert.match(
      down.stderr,
      new RegExp(`^scman: could not download ${url}/release/install\\.sh: .+\\n$`)
    );
  });

  it('runs install.ps1 with -Dir through PowerShell on Windows, without PSModulePath', async () => {
    const record = join(scratch, 'powershell-call.json');
    const powershell = `const fs = require('node:fs');
const argv = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SCMAN_INSTALL_DIR', 'PSMODULEPATH', 'FAKE_KEPT'].includes(key.toUpperCase())));
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv, env, file: fs.readFileSync(argv[5], 'utf8') }));
process.stdout.write('scman 99.2.0 installed to x\\n');
`;
    const bin = tools({ 'powershell.exe': powershell, 'pwsh.exe': powershell });
    state.files['/win/install.ps1'] = 'param($Dir)';
    const dir = 'C:\\Users\\me\\bin';
    for (const key of ['PSModulePath', 'PSMODULEPATH', 'psmodulepath']) {
      rmSync(record, { force: true });
      const result = await scman(['--upgrade'], {
        platform: 'win32',
        path: bin,
        env: {
          SCMAN_INSTALL_DIR: dir,
          SLICC_INSTALL_BASE_URL: `${url}/win`,
          [key]: 'C:\\Program Files\\PowerShell\\7\\Modules',
          FAKE_KEPT: 'kept',
        },
      });
      assert.deepEqual(
        [result.code, result.stdout, result.stderr],
        [0, `scman: ${version} → 99.2.0\n`, ''],
        key
      );
      const call = JSON.parse(readFileSync(record, 'utf8'));
      assert.deepEqual(call.argv.slice(0, 5), [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
      ]);
      assert.match(call.argv[5], /install\.ps1$/);
      assert.deepEqual(call.argv.slice(6), ['-Dir', dir]);
      assert.equal(call.file, 'param($Dir)');
      assert.deepEqual(call.env, { FAKE_KEPT: 'kept' }, key);
    }
    const none = await scman(['--upgrade'], {
      platform: 'win32',
      path: mkdtempSync(join(scratch, 'none-')),
      env: { SCMAN_INSTALL_DIR: dir, SLICC_INSTALL_BASE_URL: `${url}/win` },
    });
    assert.deepEqual(
      [none.code, none.stderr],
      [1, 'scman: no shell found to run install.ps1 (tried powershell.exe, pwsh.exe)\n']
    );
  });

  it('keeps PSModulePath for the installer outside Windows', posix, async () => {
    const record = join(scratch, 'sh-modules');
    state.files['/release/install.sh'] = installer(
      `printf '%s' "\${PSModulePath-unset}" > '${record}'\necho "scman 1.2.3 installed to $2/scman"`
    );
    const result = await scman(['--upgrade'], {
      env: {
        SCMAN_INSTALL_DIR: scratch,
        SLICC_INSTALL_BASE_URL: `${url}/release`,
        PSModulePath: '/opt/modules',
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(record, 'utf8'), '/opt/modules');
  });

  it(
    'returns once the installer exits, even when something it started holds stdout',
    posix,
    async () => {
      state.files['/release/install.sh'] = installer(
        'sleep 20 &\necho "scman 1.2.3 installed to $2/scman"'
      );
      const started = Date.now();
      const result = await scman(['--upgrade'], {
        env: { SCMAN_INSTALL_DIR: scratch, SLICC_INSTALL_BASE_URL: `${url}/release` },
      });
      assert.deepEqual([result.code, result.stdout], [0, `scman: ${version} → 1.2.3\n`]);
      assert.ok(Date.now() - started < 10000, `${Date.now() - started} ms`);
    }
  );

  it('gives the download 60 seconds, then says it timed out', async () => {
    let signal;
    const fetch = async (address, init) => {
      signal = init.signal;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const env = { SCMAN_INSTALL_DIR: scratch, SLICC_INSTALL_BASE_URL: `${url}/release` };
    const result = await scman(['--upgrade'], { env, fetch });
    assert.deepEqual(
      [result.code, result.stdout, result.stderr],
      [1, '', 'scman: download timed out\n']
    );
    assert.ok(signal instanceof AbortSignal);
  });

  it('takes no other arguments', async () => {
    for (const argv of [
      ['--upgrade', 'tree'],
      ['-a', '--upgrade'],
    ]) {
      const result = await scman(argv);
      assert.equal(result.code, 2);
      assert.match(result.stderr, /^scman: --upgrade takes no other arguments\nusage: scman /);
    }
  });
});

function spawned(file, args, env) {
  return new Promise((done) => {
    const child = spawn(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => done([status, stdout, stderr]));
  });
}

describe('the scman command', () => {
  it('runs from host/scman.mjs, through a pipe', async () => {
    const home = mkdtempSync(join(scratch, 'home-'));
    const env = {
      ...system,
      PATH: process.env.PATH,
      HOME: home,
      LOCALAPPDATA: home,
      SLICC_MAN_URL: url,
    };
    const bin = join(root, 'host/scman.mjs');
    const scman = (args) => spawned(process.execPath, [bin, ...args], env);
    assert.deepEqual(await scman(['tree']), [0, fixtures['tree.txt'], '']);
    assert.deepEqual(await scman(['nope']), [16, '', 'No manual entry for nope\n']);
    assert.deepEqual(await scman(['-k', 'tree']), [0, `${index[0]}\n`, '']);
    assert.ok(existsSync(join(home, onWindows ? 'slicc-man/cache' : '.cache/slicc-man')));
  });

  it('runs as a program, and stops quietly when the pipe closes', posix, async () => {
    const home = mkdtempSync(join(scratch, 'home-'));
    const env = { PATH: process.env.PATH, HOME: home, SLICC_MAN_URL: url };
    const bin = join(root, 'host/scman.mjs');
    assert.deepEqual(await spawned(bin, ['tree'], env), [0, fixtures['tree.txt'], '']);
    const head = await spawned('sh', ['-c', '"$0" -k . | head -1', bin], env);
    assert.deepEqual(head, [0, `${index[0]}\n`, '']);
  });
});
