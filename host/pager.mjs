import { spawn } from 'node:child_process';
import { say } from './io.mjs';
import { variable } from './path.mjs';

export function shell(command, platform, env) {
  if (platform === 'win32') {
    return {
      file: variable(env, 'COMSPEC') || 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `"${command} & if errorlevel 9009 if not errorlevel 9010 exit 9009"`,
      ],
      options: { windowsVerbatimArguments: true },
    };
  }
  return { file: '/bin/sh', args: ['-c', command], options: {} };
}

export function page(command, text, { name, platform, env, fds }) {
  const run = shell(command, platform, env);
  const ignore = () => {};
  process.on('SIGINT', ignore);
  return new Promise((done) => {
    let failed = false;
    const child = spawn(run.file, run.args, {
      ...run.options,
      env,
      stdio: ['pipe', fds[1], fds[2]],
    });
    child.on('error', (error) => {
      failed = true;
      say(fds[2], `${name}: ${command}: ${error.message}\n`);
    });
    child.stdin.on('error', ignore);
    child.stdin.end(text);
    child.on('close', (code) => {
      process.off('SIGINT', ignore);
      const missing = platform === 'win32' ? [9009] : [126, 127];
      done(failed || missing.includes(code) ? 2 : 0);
    });
  });
}
