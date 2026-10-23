import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { boot, packed } from './kernel.mjs';

const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, 'pages.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'));
const MODIFIED = 'Tue, 22 Sep 2026 13:04:12 GMT';
const state = {};
let server;
let kernel;
let url;
let cache;
let runs = 0;

function reset() {
  state.mode = 'ok';
  state.cacheControl = 'max-age=14400';
  state.log = [];
  state.pages = {
    tree: fixtures['tree.md'],
    man: fixtures['man.md'],
    ls: 'List directory contents.\n',
    grep: 'Print lines that match patterns.\n',
  };
  state.sitemap = ['/man/tree', '/man/ls', '/man/grep', '/man/man', '/use-cases/web'];
}

before(async () => {
  reset();
  server = createServer((request, response) => {
    state.log.push({ path: request.url, since: request.headers['if-modified-since'] });
    if (state.mode === 'down') {
      request.socket.destroy();
      return;
    }
    const head = { 'last-modified': MODIFIED, 'cache-control': state.cacheControl };
    if (request.url === '/sitemap.xml') {
      const locs = state.sitemap.map(
        (path) => `<url><loc>https://elsewhere.example${path}</loc></url>`
      );
      response.writeHead(200, head);
      response.end(`<?xml version="1.0"?>\n<urlset>${locs.join('')}</urlset>\n`);
      return;
    }
    const topic = /^\/man\/(.+)\.md$/.exec(request.url)?.[1];
    const body = topic === undefined ? undefined : state.pages[topic];
    if (body === undefined) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    if (request.headers['if-modified-since'] === MODIFIED) {
      response.writeHead(304, head);
      response.end();
      return;
    }
    response.writeHead(200, head);
    response.end(body);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  url = `http://host.slicc.internal:${port}`;
  kernel = await boot(port);
  const tool = (body) => new TextEncoder().encode(`#!/bin/sh\n${body}\n`);
  await kernel.writeFile(
    '/opt/fake/less',
    tool('printf "%s\\n" "$0" "$@" > /tmp/pager.argv\ncat > /tmp/pager.stdin\necho paged'),
    { mode: 0o755 }
  );
  await kernel.writeFile(
    '/opt/fake/hello',
    tool('printf "Usage: hello \\033[1m[NAME]\\033[0m\\n"\necho "on stderr" >&2\nexit 3'),
    { mode: 0o755 }
  );
  await kernel.writeFile(
    '/opt/fake/links',
    tool(
      [
        'printf "\\033]0;the title\\007Usage: links\\n"',
        'printf "See \\033]8;;https://example.com\\007the site\\033]8;;\\007.\\n"',
        'printf "\\033]8;;https://example.org\\033\\\\\\\\more\\033]8;;\\033\\\\\\\\ \\033P1;2q\\033\\\\\\\\end\\n"',
      ].join('\n')
    ),
    { mode: 0o755 }
  );
  await kernel.writeFile('/tmp/page.md', 'A local page.\n\n## Usage\n\nRead **it**.\n');
});

after(() => {
  kernel?.terminate();
  server?.close();
});

beforeEach(() => {
  reset();
  cache = `/home/run${runs++}`;
});

const PATH = '/opt/fake:/usr/bin:/bin';

function run(argv, options = {}) {
  return kernel.run(argv, {
    cwd: '/tmp',
    stdin: options.stdin,
    env: { HOME: cache, SLICC_MAN_URL: url, PATH, ...options.env },
  });
}

async function terminal(argv, env = {}) {
  const chunks = [];
  const term = await kernel.openTerminal(argv, {
    cwd: '/tmp',
    cols: 100,
    env: { HOME: cache, SLICC_MAN_URL: url, PATH, ...env },
    onData: (data) => chunks.push(Buffer.from(data)),
  });
  const status = await term.exited;
  return { status, output: Buffer.concat(chunks).toString() };
}

const requests = () => state.log.map((entry) => entry.path);
const read = async (path) => new TextDecoder().decode(await kernel.readFile(path));

describe('in SLICC', () => {
  it('installs man, apropos, whatis and scman from the package', async () => {
    const names = ['man', 'apropos', 'whatis', 'scman'];
    const result = await run(['sh', '-c', `command -v ${names.join(' ')}`]);
    assert.equal(result.stdout, names.map((name) => `/usr/bin/${name}\n`).join(''));
    const files = packed();
    for (const command of Object.values(pkg.slicc.commands)) {
      assert.equal(command.abi, 'js');
      assert.ok(files.includes(command.module), command.module);
    }
  });

  it('renders tree as plain text through the network transport', async () => {
    for (const name of ['man', 'scman']) {
      const result = await run([name, 'tree']);
      assert.deepEqual(result, { status: 0, stdout: fixtures['tree.txt'], stderr: '' });
    }
    assert.deepEqual(requests(), ['/man/tree.md']);
  });

  it('prints No manual entry for nope and exits 16', async () => {
    const result = await run(['man', 'nope']);
    assert.deepEqual(result, { status: 16, stdout: '', stderr: 'No manual entry for nope\n' });
  });

  it('searches with man -k and apropos, and shows descriptions with man -f and whatis', async () => {
    const line = (topic, text) => `${`${topic} (1)`.padEnd(20)} - ${text}\n`;
    const tree = line('tree', 'List contents of directories in a tree-like format.');
    const ls = line('ls', 'List directory contents.');
    for (const argv of [
      ['man', '-k', 'list'],
      ['apropos', 'list'],
    ]) {
      const result = await run(argv);
      assert.deepEqual(result, { status: 0, stdout: tree + ls, stderr: '' }, argv.join(' '));
    }
    for (const argv of [
      ['man', '-f', 'ls', 'nope'],
      ['whatis', 'ls', 'nope'],
    ]) {
      const result = await run(argv);
      assert.deepEqual(
        result,
        { status: 16, stdout: ls, stderr: 'nope: nothing appropriate.\n' },
        argv.join(' ')
      );
    }
    const none = await run(['apropos']);
    assert.deepEqual(none, { status: 2, stdout: '', stderr: 'apropos what?\n' });
  });

  it('reuses the cache in ~/.cache/slicc-man, revalidates a stale copy, and shows it offline', async () => {
    assert.equal((await run(['man', 'tree'])).status, 0);
    assert.equal((await run(['man', 'tree'])).stdout, fixtures['tree.txt']);
    assert.deepEqual(requests(), ['/man/tree.md']);
    const port = new URL(url).port;
    const entry = JSON.parse(
      await read(`${cache}/.cache/slicc-man/host.slicc.internal-${port}/page-tree.json`)
    );
    assert.equal(entry.lastModified, MODIFIED);
    assert.equal(entry.body, fixtures['tree.md']);
    await kernel.writeFile(
      `${cache}/.cache/slicc-man/host.slicc.internal-${port}/page-tree.json`,
      JSON.stringify({ ...entry, fetched: 0 })
    );
    state.log = [];
    assert.equal((await run(['man', 'tree'])).stdout, fixtures['tree.txt']);
    assert.deepEqual(state.log, [{ path: '/man/tree.md', since: MODIFIED }]);
    await kernel.writeFile(
      `${cache}/.cache/slicc-man/host.slicc.internal-${port}/page-tree.json`,
      JSON.stringify({ ...entry, fetched: 0 })
    );
    state.mode = 'down';
    const stale = await run(['man', 'tree']);
    assert.equal(stale.status, 0);
    assert.equal(stale.stdout, fixtures['tree.txt']);
    assert.match(
      stale.stderr,
      new RegExp(
        `^man: ${url.replace(/\./g, '\\.')}/man/tree\\.md: .+; showing the copy cached 1970-01-01T00:00:00Z\\n$`
      )
    );
    const missing = await run(['man', 'ls']);
    assert.equal(missing.status, 2);
    assert.match(
      missing.stderr,
      new RegExp(`^man: ${url.replace(/\./g, '\\.')}/man/ls\\.md: .+\\n$`)
    );
  });

  it('falls back to <topic> --help for a command on PATH with no page', async () => {
    const result = await run(['man', 'hello']);
    assert.deepEqual(result, {
      status: 0,
      stdout: 'Usage: hello [NAME]\non stderr\n',
      stderr: 'No manual entry for hello; showing hello --help\n',
    });
    for (const argv of [
      ['man', '-w', 'hello'],
      ['man', '2', 'hello'],
    ]) {
      const none = await run(argv);
      assert.equal(none.status, 16, argv.join(' '));
      assert.match(none.stderr, /^No manual entry for hello( in section 2)?\n$/);
      assert.equal(none.stdout, '');
    }
    const several = await run(['man', 'hello', 'nope']);
    assert.equal(several.status, 16);
    assert.equal(several.stdout, 'Usage: hello [NAME]\non stderr\n');
  });

  it('drops whole OSC and DCS sequences from the --help output, OSC 8 links and titles included', async () => {
    const result = await run(['man', 'links']);
    assert.deepEqual(result, {
      status: 0,
      stdout: 'Usage: links\nSee the site.\nmore end\n',
      stderr: 'No manual entry for links; showing links --help\n',
    });
  });

  it('pages through less -R on a terminal, styled, unless NO_COLOR, -P or MANPAGER say otherwise', async () => {
    const paged = await terminal(['man', 'tree']);
    assert.equal(paged.status, 0);
    assert.match(paged.output, /paged/);
    assert.equal(await read('/tmp/pager.argv'), '/opt/fake/less\n-R\n');
    const styled = await read('/tmp/pager.stdin');
    assert.match(styled, /\x1b\[1m/);
    assert.match(styled, /^TREE\(1\) {37}SLICC Manual {37}TREE\(1\)\n/);
    await terminal(['man', 'tree'], { NO_COLOR: '1', MANWIDTH: '80' });
    assert.equal(await read('/tmp/pager.stdin'), fixtures['tree.txt']);
    const direct = await terminal(['man', '-P', '', 'ls']);
    assert.match(direct.output, /List directory contents\./);
    const failed = await terminal(['man', 'tree'], { MANPAGER: 'no-such-pager' });
    assert.equal(failed.status, 2);
    const help = await terminal(['man', 'hello'], { PAGER: 'cat > /tmp/help.out' });
    assert.equal(help.status, 0);
    assert.equal(await read('/tmp/help.out'), 'Usage: hello [NAME]\non stderr\n');
  });

  it('renders a local file and stdin with -l', async () => {
    const result = await run(['man', '-l', 'page.md', '-'], { stdin: 'From stdin.\n' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^PAGE\(1\) .*\n\nNAME\n {7}page - A local page\.\n/);
    assert.match(result.stdout, /\nUSAGE\n {7}Read it\.\n/);
    assert.match(result.stdout, /\nSTDIN\(1\) .*\n\nNAME\n {7}stdin - From stdin\.\n$/);
    const missing = await run(['man', '-l', 'gone.md']);
    assert.deepEqual(missing, {
      status: 2,
      stdout: '',
      stderr: 'man: gone.md: No such file or directory\n',
    });
  });

  it('prints the pnpm command for --upgrade, the version for -V, and refuses what is not supported', async () => {
    for (const name of ['man', 'apropos', 'whatis', 'scman']) {
      const upgrade = await run([name, '--upgrade']);
      assert.deepEqual(upgrade, {
        status: 0,
        stdout: 'pnpm add -g @ai-ecoverse/slicc-man@latest\n',
        stderr: '',
      });
      const version = await run([name, '--version']);
      assert.deepEqual(version, { status: 0, stdout: `${pkg.version}\n`, stderr: '' });
    }
    const troff = await run(['man', '-t', 'tree']);
    assert.deepEqual(troff, { status: 2, stdout: '', stderr: 'man: -t: not supported\n' });
    const verbose = await run(['whatis', '--verbose', 'tree']);
    assert.deepEqual(verbose, {
      status: 2,
      stdout: '',
      stderr: 'whatis: --verbose: not supported\n',
    });
    const both = await run(['man', '--upgrade', 'tree']);
    assert.equal(both.status, 2);
    assert.match(both.stderr, /^man: --upgrade takes no other arguments\nusage: man /);
    assert.deepEqual(requests(), []);
  });
});
