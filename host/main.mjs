import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../lib/man.mjs';
import { cacheRoot, store } from './cache.mjs';
import { say } from './io.mjs';
import { page } from './pager.mjs';
import { lookup } from './path.mjs';
import { upgrade, version } from './upgrade.mjs';

const reasons = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  EISDIR: 'Is a directory',
  ENOTDIR: 'Not a directory',
};

function read(file, fds) {
  try {
    return readFileSync(file === '-' ? fds[0] : file, 'utf8');
  } catch (error) {
    throw new Error(reasons[error.code] ?? error.message);
  }
}

export async function main({
  name,
  argv,
  env,
  platform,
  fds,
  tty,
  columns,
  fetch = globalThis.fetch,
  now,
}) {
  const child = { ...env };
  delete child.SCMAN_INSTALL_DIR;
  const root = cacheRoot(platform, env);
  const io = {
    tty,
    columns,
    fetch,
    now,
    version: version(),
    out: (text) => say(fds[1], text),
    err: (text) => say(fds[2], text),
    store: (dir) => store(join(root, dir)),
    which: (file) => lookup(file, platform, env) !== undefined,
    page: (command, text) => page(command, text, { name, platform, env: child, fds }),
    read: (file) => read(file, fds),
    upgrade: () => upgrade({ name, env, platform, fds, fetch }),
  };
  return run({ kind: 'man', name, argv, env, io });
}
