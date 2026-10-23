import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';

export function variable(env, name) {
  const found = Object.keys(env).find((key) => key.toUpperCase() === name);
  return found === undefined ? undefined : env[found];
}

export function lookup(file, platform, env) {
  const windows = platform === 'win32';
  const dirs = String((windows ? variable(env, 'PATH') : env.PATH) ?? '')
    .split(windows ? ';' : ':')
    .filter(Boolean);
  const exts = windows
    ? [
        '',
        ...String(variable(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean),
      ]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const path = join(dir, file + ext);
      try {
        if (!statSync(path).isFile()) continue;
        if (!windows) accessSync(path, constants.X_OK);
        return path;
      } catch {}
    }
  }
  return undefined;
}
