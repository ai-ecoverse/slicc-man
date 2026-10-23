import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
export const OUT = 'dist/slicc.mjs';

const version = {
  name: 'version',
  setup(on) {
    on.onLoad({ filter: /[\\/]package\.json$/ }, (args) => ({
      contents: JSON.stringify({ version: JSON.parse(readFileSync(args.path, 'utf8')).version }),
      loader: 'json',
    }));
  },
};

export async function bundle() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['slicc/main.mjs'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    legalComments: 'none',
    minifyWhitespace: true,
    minifySyntax: true,
    logLevel: 'silent',
    plugins: [version],
  });
  return result.outputFiles[0].text;
}

export async function write() {
  const text = await bundle();
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, OUT), text);
}

if (import.meta.main) await write();
