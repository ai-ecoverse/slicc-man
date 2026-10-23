import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, process.env.SLICC_UNIT_COVERAGE_DIR ?? 'coverage/unit');
const tests = join(root, 'test/unit');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function selected() {
  const chosen = process.env.SLICC_UNIT_TESTS;
  if (chosen !== undefined) return chosen.split('\n').filter(Boolean);
  if (!existsSync(tests)) return [];
  return readdirSync(tests, { recursive: true })
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join(tests, name));
}

function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const lcov = join(out, 'lcov.info');
  const files = selected();
  if (files.length === 0) {
    writeFileSync(lcov, '');
    console.log('no unit tests in test/unit/');
    return 0;
  }
  const include = (pkg.slicc?.unitSources ?? []).map((dir) => `--test-coverage-include=${dir}/**`);
  const run = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      ...include,
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=lcov',
      `--test-reporter-destination=${lcov}`,
      ...files,
    ],
    { cwd: root, stdio: 'inherit' }
  );
  if (existsSync(lcov)) {
    writeFileSync(lcov, readFileSync(lcov, 'utf8').replaceAll(`SF:${root}/`, 'SF:'));
  }
  return run.status ?? 1;
}

process.exit(main());
