import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { variable } from './path.mjs';

export function cacheRoot(platform, env) {
  if (platform === 'win32') {
    const local = variable(env, 'LOCALAPPDATA') || join(homedir(), 'AppData', 'Local');
    return join(local, 'slicc-man', 'cache');
  }
  const xdg = env.XDG_CACHE_HOME;
  if (xdg && isAbsolute(xdg)) return join(xdg, 'slicc-man');
  return join(env.HOME || homedir(), '.cache', 'slicc-man');
}

let counter = 0;

export function store(dir) {
  const file = (id) => join(dir, `${id}.json`);
  return {
    async read(id) {
      try {
        return await readFile(file(id), 'utf8');
      } catch {
        return undefined;
      }
    },
    async write(id, text) {
      await mkdir(dir, { recursive: true });
      const temp = join(dir, `.${id}.${process.pid}.${Date.now()}.${counter++}.tmp`);
      try {
        await writeFile(temp, text);
        await rename(temp, file(id));
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async remove(id) {
      await rm(file(id), { force: true });
    },
  };
}
