import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, 'pages.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const installPs1 = join(root, 'install.ps1');
const onWindows = process.platform === 'win32';
const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const powershell = join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const cmd = join(system, 'cmd.exe');

function withPath(env, value) {
  const out = {};
  for (const [key, entry] of Object.entries(env)) {
    if (key.toUpperCase() !== 'PATH') out[key] = entry;
  }
  out.PATH = value;
  return out;
}

function pathOf(env) {
  return Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
}

function clean(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      !['SCMAN_INSTALL_DIR', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS', 'PSMODULEPATH'].includes(
        key.toUpperCase()
      )
    ) {
      out[key] = value;
    }
  }
  return { ...out, ...extra };
}

function run(file, args, options = {}) {
  return new Promise((done) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => done({ status: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

function lines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

function ps(shell, script, env) {
  return run(
    shell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env,
    }
  );
}

function batch(line, env) {
  return run(cmd, ['/d', '/s', '/c', `"${line}"`], { env, windowsVerbatimArguments: true });
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('on real Windows', { skip: !onWindows && 'not Windows' }, () => {
  let scratch;
  let server;
  let url;
  let served;
  let userPath;
  let pwsh;

  function npm(args, cwd) {
    const cli = /\.c?js$/.test(process.env.npm_execpath ?? '')
      ? process.env.npm_execpath
      : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  }

  function release(name, as) {
    const dir = join(served, name);
    mkdirSync(dir, { recursive: true });
    const source = mkdtempSync(join(scratch, 'source-'));
    for (const file of ['LICENSE', 'README.md', 'package.json', 'host', 'lib']) {
      cpSync(join(root, file), join(source, file), { recursive: true });
    }
    const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    pkg.version = as;
    delete pkg.scripts;
    writeFileSync(join(source, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    const pack = npm(['pack', '--ignore-scripts', '--pack-destination', dir], source);
    assert.equal(pack.status, 0, `${pack.stdout}${pack.stderr}${pack.error?.message ?? ''}`);
    const assets = spawnSync(process.execPath, [join(root, 'scripts', 'assets.mjs'), dir, as], {
      encoding: 'utf8',
    });
    assert.equal(assets.status, 0, assets.stderr);
    return `${url}/${name}`;
  }

  function install(shell, dir, local, base, extra = {}) {
    return run(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installPs1,
        '-Dir',
        dir,
      ],
      { env: clean({ LOCALAPPDATA: local, SLICC_INSTALL_BASE_URL: base, ...extra }) }
    );
  }

  before(async () => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'slicc-man-windows-')));
    served = join(scratch, 'served');
    mkdirSync(join(served, 'man'), { recursive: true });
    writeFileSync(join(served, 'man', 'tree.md'), fixtures['tree.md']);
    server = createServer((request, response) => {
      const path = resolve(served, `.${decodeURIComponent(request.url.split('?')[0])}`);
      if (!path.startsWith(served + sep) || !existsSync(path)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200);
      response.end(readFileSync(path));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${server.address().port}`;
    const saved = spawnSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
      ],
      { encoding: 'utf8' }
    );
    userPath = saved.stdout.replace(/\r?\n$/, '');
    pwsh =
      spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'pwsh' : undefined;
  });

  after(() => {
    server?.close();
    spawnSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::SetEnvironmentVariable('Path', $(if ($env:SLICC_USER_PATH) { $env:SLICC_USER_PATH } else { $null }), 'User')",
      ],
      { env: { ...process.env, SLICC_USER_PATH: userPath } }
    );
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  for (const shell of ['powershell.exe', 'pwsh']) {
    it(`installs with ${shell}, and both launchers run, keep their arguments and leak nothing`, async (t) => {
      const exe = shell === 'pwsh' ? pwsh : powershell;
      if (!exe) {
        t.skip('pwsh is not installed');
        return;
      }
      const base = release(`r-${shell}`, version);
      const local = mkdtempSync(join(scratch, 'local-'));
      const bin = join(local, "my 'bin' (x86) & 100%");
      const result = await install(exe, bin, local, base);
      assert.equal(result.status, 0, result.stderr);
      const out = lines(result.stdout);
      assert.equal(out[0], `scman ${version} installed to ${join(bin, 'scman.ps1')}`);
      assert.ok(existsSync(join(local, 'slicc-man', version, 'host', 'scman.mjs')));
      const ps1 = join(bin, 'scman.ps1');
      const launcher = join(bin, 'scman.cmd');
      assert.deepEqual([...readFileSync(ps1).subarray(0, 3)], [0xef, 0xbb, 0xbf]);

      const env = clean();
      for (const argv of [['--version'], ['--help']]) {
        const viaCmd = await batch(`"${launcher}" ${argv.join(' ')}`, env);
        const viaPs = await ps(exe, `& $env:T_LAUNCHER ${argv.join(' ')}; exit $LASTEXITCODE`, {
          ...env,
          T_LAUNCHER: ps1,
        });
        for (const [how, got] of [
          ['cmd', viaCmd],
          ['ps1', viaPs],
        ]) {
          assert.equal(got.status, 0, `${how} ${argv}: ${got.stderr}`);
          if (argv[0] === '--version') assert.equal(got.stdout.trim(), version, how);
          else assert.match(got.stdout, /^usage: scman /, how);
        }
      }
      assert.equal((await batch(`"${launcher}" --nope`, env)).status, 2);
      assert.equal(
        (
          await ps(exe, '& $env:T_LAUNCHER --nope 2>$null; exit $LASTEXITCODE', {
            ...env,
            T_LAUNCHER: ps1,
          })
        ).status,
        2
      );

      const pages = await batch(`chcp & "${launcher}" --version & chcp`, env);
      const [before, , after] = lines(pages.stdout);
      assert.equal(before, after, pages.stdout);

      const leak = await batch(
        `"${launcher}" --version & set SCMAN_INSTALL_DIR & set NODE_USE_ENV_PROXY`,
        env
      );
      assert.equal(leak.stdout.trim(), version, leak.stdout);
      const show = (name) =>
        `'${name}=' + $(if ($null -eq $env:${name}) { 'unset' } else { $env:${name} })`;
      for (const [setup, dir, proxy] of [
        ["$env:SCMAN_INSTALL_DIR = 'before'; $env:NODE_USE_ENV_PROXY = '0'", 'before', '0'],
        ['', 'unset', 'unset'],
      ]) {
        const session = await ps(
          exe,
          `${setup}; & $env:T_LAUNCHER --version | Out-Null; 'code=' + $LASTEXITCODE; ${show('SCMAN_INSTALL_DIR')}; ${show('NODE_USE_ENV_PROXY')}`,
          { ...env, T_LAUNCHER: ps1 }
        );
        assert.deepEqual(
          lines(session.stdout),
          ['code=0', `SCMAN_INSTALL_DIR=${dir}`, `NODE_USE_ENV_PROXY=${proxy}`],
          session.stderr
        );
      }

      const entry = join(local, 'slicc-man', version, 'host', 'scman.mjs');
      const argv = join(local, 'argv.mjs');
      writeFileSync(argv, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
      const probePs1 = join(bin, 'probe.ps1');
      const probeCmd = join(bin, 'probe.cmd');
      const replaced = (file) => {
        const text = readFileSync(file, 'utf8');
        assert.ok(text.includes(entry), file);
        return text.replace(entry, argv);
      };
      writeFileSync(probePs1, replaced(ps1));
      writeFileSync(probeCmd, replaced(launcher));
      const tricky = ['a )&%^ b "q" c', 'x"y\\', 'sp ace\\', 'tail\\', '', '%SCMAN_NOPE%', "it's"];
      const typed = ['a )&%^ b "q" c', 'x"y" z', 'tail\\', '%SCMAN_NOPE%'];
      const modes =
        shell === 'pwsh'
          ? [
              "$PSNativeCommandArgumentPassing = 'Standard'; ",
              "$PSNativeCommandArgumentPassing = 'Legacy'; ",
              'Remove-Variable PSNativeCommandArgumentPassing; ',
            ]
          : [''];
      for (const mode of modes) {
        const all = await ps(
          exe,
          `${mode}$a = ConvertFrom-Json $env:T_ARGS; & $env:T_LAUNCHER @a; exit $LASTEXITCODE`,
          { ...env, T_LAUNCHER: probePs1, T_ARGS: JSON.stringify(tricky) }
        );
        assert.equal(all.status, 0, `${mode}${all.stderr}`);
        assert.deepEqual(JSON.parse(all.stdout), tricky, `ps1 ${mode}`);
        const listed = await ps(exe, `${mode}& $env:T_LAUNCHER a,'b c' d; exit $LASTEXITCODE`, {
          ...env,
          T_LAUNCHER: probePs1,
        });
        assert.equal(listed.status, 0, `${mode}${listed.stderr}`);
        assert.deepEqual(JSON.parse(listed.stdout), ['a', 'b c', 'd'], `list ${mode}`);
      }
      const viaCmd = await batch(
        `"${probeCmd}" "a )&%^ b \\"q\\" c" "x\\"y\\" z" tail\\ %SCMAN_NOPE%`,
        env
      );
      assert.equal(viaCmd.status, 0, viaCmd.stderr);
      assert.deepEqual(JSON.parse(viaCmd.stdout), typed, 'cmd');

      const site = clean({ SLICC_MAN_URL: url, LOCALAPPDATA: local });
      for (const [how, got] of [
        ['cmd', await batch(`"${launcher}" tree`, site)],
        [
          'ps1',
          await ps(exe, '& $env:T_LAUNCHER tree; exit $LASTEXITCODE', { ...site, T_LAUNCHER: ps1 }),
        ],
      ]) {
        assert.equal(got.status, 0, `${how}: ${got.stderr}`);
        assert.equal(got.stdout.replaceAll('\r\n', '\n'), fixtures['tree.txt'], how);
      }
      assert.ok(existsSync(join(local, 'slicc-man', 'cache', `127.0.0.1-${new URL(url).port}`)));
      const missing = await batch(`"${launcher}" nope`, site);
      assert.deepEqual([missing.status, missing.stderr], [16, 'No manual entry for nope\n']);

      const added = out.find((line) => line.startsWith('Added '));
      const undo = out.find((line) => line.startsWith('To undo: '));
      if (shell === 'powershell.exe') {
        assert.equal(added, `Added ${bin} to your user PATH; open a new terminal to use scman`);
        const listed = await ps(
          powershell,
          "[Environment]::GetEnvironmentVariable('Path', 'User')",
          clean()
        );
        assert.ok(listed.stdout.trim().split(';').includes(bin), listed.stdout);
        const undone = await ps(
          powershell,
          `${undo.slice('To undo: '.length)}; [Environment]::GetEnvironmentVariable('Path', 'User')`,
          clean()
        );
        assert.equal(undone.status, 0, undone.stderr);
        assert.ok(!undone.stdout.trim().split(';').includes(bin), undone.stdout);
      }
    });
  }

  it('upgrades in place from the installed scman.cmd and scman.ps1', async () => {
    const local = mkdtempSync(join(scratch, 'local-'));
    const bin = join(local, 'bin');
    const first = await install(powershell, bin, local, release('old', version));
    assert.equal(first.status, 0, first.stderr);
    const newer = release('new', '99.0.0');
    const modules = pwsh
      ? spawnSync(pwsh, ['-NoProfile', '-Command', '$env:PSModulePath'], {
          encoding: 'utf8',
        }).stdout.trim()
      : join(process.env.ProgramFiles, 'PowerShell', '7', 'Modules');
    const env = clean({
      LOCALAPPDATA: local,
      SLICC_INSTALL_BASE_URL: newer,
      PSModulePath: modules,
    });
    const upgraded = await batch(`"${join(bin, 'scman.cmd')}" --upgrade`, env);
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(upgraded.stdout, `scman: ${version} → 99.0.0\n`);
    const reported = await batch(`"${join(bin, 'scman.cmd')}" --version`, clean());
    assert.equal(reported.stdout.trim(), '99.0.0');
    assert.ok(existsSync(join(local, 'slicc-man', '99.0.0', 'host', 'scman.mjs')));
    const again = await ps(powershell, '& $env:T_LAUNCHER --upgrade; exit $LASTEXITCODE', {
      ...env,
      T_LAUNCHER: join(bin, 'scman.ps1'),
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(again.stdout.trim(), 'scman: already up to date (99.0.0)');
  });

  it('downloads Node as a .zip when PATH has none, and the launchers use it', async () => {
    const arch = { AMD64: 'x64', ARM64: 'arm64' }[process.env.PROCESSOR_ARCHITECTURE];
    const dist = join(served, 'dist');
    const name = `node-v24.99.0-win-${arch}`;
    const build = join(scratch, 'build');
    mkdirSync(join(build, name), { recursive: true });
    copyFileSync(process.execPath, join(build, name, 'node.exe'));
    mkdirSync(join(dist, 'v24.99.0'), { recursive: true });
    const archive = join(dist, 'v24.99.0', `${name}.zip`);
    const zipped = spawnSync(
      join(system, 'tar.exe'),
      ['-a', '-c', '--options', 'zip:compression=store', '-f', `${name}.zip`, '-C', build, name],
      { cwd: dirname(archive), encoding: 'utf8' }
    );
    assert.equal(zipped.status, 0, zipped.stderr);
    writeFileSync(
      join(dist, 'v24.99.0', 'SHASUMS256.txt'),
      `${'0'.repeat(64)}  ${name}.7z\n${sha256(archive)}  ${name}.zip\n`
    );
    writeFileSync(
      join(dist, 'index.json'),
      JSON.stringify([
        { version: 'v25.0.0', lts: false },
        { version: 'v24.99.0', lts: 'Krypton' },
        { version: 'v22.0.0', lts: 'Jod' },
      ])
    );
    const local = mkdtempSync(join(scratch, 'local-'));
    const bin = join(local, 'bin');
    const bare = `${system};${dirname(system)};${dirname(powershell)}`;
    const result = await run(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installPs1,
        '-Dir',
        bin,
      ],
      {
        env: withPath(
          clean({
            LOCALAPPDATA: local,
            SLICC_INSTALL_BASE_URL: release('zip', version),
            SLICC_NODE_DIST_BASE: `${url}/dist`,
          }),
          bare
        ),
      }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Node v24\.99\.0 installed to /);
    const managed = join(local, 'slicc-man', 'node', 'node.exe');
    assert.ok(existsSync(managed));
    assert.ok(readFileSync(join(bin, 'scman.ps1'), 'utf8').includes(`'${managed}'`));
    assert.ok(readFileSync(join(bin, 'scman.cmd'), 'utf8').includes(`"${managed}"`));
    const reported = await batch(`"${join(bin, 'scman.cmd')}" --version`, withPath(clean(), bare));
    assert.equal(reported.stdout.trim(), version, reported.stderr);
  });
});
