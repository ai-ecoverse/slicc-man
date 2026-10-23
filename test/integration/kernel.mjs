import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createNodeKernel, nodeTransport } from '@ai-ecoverse/slicc-kernel/node';

const root = resolve(import.meta.dirname, '../..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

export function packed() {
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(pack.stderr);
  return JSON.parse(pack.stdout)[0].files.map((file) => file.path);
}

async function install(kernel, name, dir, files) {
  for (const path of files) {
    const rel = relative(dir, path).replaceAll('\\', '/');
    await kernel.writeFile(`/node_modules/${name}/${rel}`, readFileSync(path));
  }
}

export async function boot(port) {
  const kernel = await createNodeKernel({
    network: { transport: nodeTransport({ hostLoopback: [port] }) },
  });
  for (const name of ['@ai-ecoverse/wasm-bash', '@ai-ecoverse/wasm-coreutils']) {
    const dir = join(root, 'node_modules', name);
    await install(kernel, name, dir, walk(dir));
  }
  const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  await install(
    kernel,
    name,
    root,
    packed().map((path) => join(root, path))
  );
  return kernel;
}
