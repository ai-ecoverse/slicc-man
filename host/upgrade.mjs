import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { say } from './io.mjs';
import { lookup } from './path.mjs';

export const LATEST = 'https://github.com/ai-ecoverse/slicc-man/releases/latest/download';

export function version() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function reason(error) {
  return error.cause?.message ?? error.message;
}

function installer(platform, env, path, dir) {
  if (platform === 'win32') {
    const file = ['powershell.exe', 'pwsh.exe'].find((name) => lookup(name, platform, env));
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path];
    return file && { file, tool: lookup(file, platform, env), args: [...args, '-Dir', dir] };
  }
  const tool = lookup('sh', platform, env);
  return tool && { file: 'sh', tool, args: [path, '--dir', dir] };
}

function wait(file, args, options) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(file, args, options);
    } catch (error) {
      done({ error });
      return;
    }
    const out = [];
    let code;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      child.stdout.destroy();
      done({ code, stdout: Buffer.concat(out).toString() });
    };
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.on('error', (error) => done({ error }));
    child.on('close', finish);
    child.on('exit', (status) => {
      code = status ?? 1;
      timer = setTimeout(finish, 500);
    });
  });
}

export async function upgrade({ name, env, platform, fds, fetch }) {
  const fail = (text) => {
    say(fds[2], `${name}: ${text}\n`);
    return 1;
  };
  const dir = env.SCMAN_INSTALL_DIR;
  if (!dir) {
    say(fds[1], 'npm install -g @ai-ecoverse/slicc-man@latest\n');
    return 0;
  }
  const file = platform === 'win32' ? 'install.ps1' : 'install.sh';
  const url = `${(env.SLICC_INSTALL_BASE_URL || LATEST).replace(/\/+$/, '')}/${file}`;
  let text;
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return fail(`could not download ${url}: HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (error) {
    if (error?.name === 'TimeoutError') return fail('download timed out');
    return fail(`could not download ${url}: ${reason(error)}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'scman-upgrade-'));
  try {
    const path = join(scratch, file);
    writeFileSync(path, text);
    const run = installer(platform, env, path, dir);
    if (!run) {
      const tried = platform === 'win32' ? 'powershell.exe, pwsh.exe' : 'sh';
      return fail(`no shell found to run ${file} (tried ${tried})`);
    }
    const child = { ...env };
    delete child.SCMAN_INSTALL_DIR;
    if (platform === 'win32') {
      for (const key of Object.keys(child)) {
        if (key.toUpperCase() === 'PSMODULEPATH') delete child[key];
      }
    }
    const result = await wait(run.tool, run.args, {
      env: child,
      stdio: ['ignore', 'pipe', fds[2]],
      windowsHide: true,
    });
    if (result.error) return fail(`${run.file}: ${result.error.message}`);
    if (result.code !== 0) return 1;
    const installed = /^scman (\S+) installed to /m.exec(result.stdout)?.[1];
    if (!installed) return fail(`${file} did not say which version it installed`);
    const old = version();
    say(
      fds[1],
      installed === old
        ? `${name}: already up to date (${old})\n`
        : `${name}: ${old} → ${installed}\n`
    );
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
