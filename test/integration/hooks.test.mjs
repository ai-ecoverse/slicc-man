import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { commitAll, initFixtureRepo } from '@ai-ecoverse/slicc-shared-web/testing';

const root = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'slicc-man-hooks-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

function git(dir, ...args) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(key)) delete env[key];
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
}

function hook(dir) {
  const path = join(dir, 'node_modules/.git-hooks/pre-commit');
  mkdirSync(join(dir, 'node_modules/.git-hooks'), { recursive: true });
  writeFileSync(path, '#!/bin/sh\npwd > "$(git rev-parse --show-toplevel)/ran"\n');
  chmodSync(path, 0o755);
}

describe('the git hooks', () => {
  it('are installed per worktree by slicc-install-hooks', () => {
    assert.equal(pkg.scripts.prepare, 'slicc-install-hooks');
    assert.match(git(root, 'ls-files', '-s', '.githooks/pre-commit').stdout, /^100755 /);
    assert.match(readFileSync(join(root, '.githooks/pre-commit'), 'utf8'), /^#!\/bin\/sh\n/);
  });

  it("run the hook of the worktree a commit runs in, and fail without that worktree's npm install", () => {
    const main = join(scratch, 'main');
    const other = join(scratch, 'other');
    mkdirSync(join(main, '.githooks'), { recursive: true });
    initFixtureRepo(main);
    copyFileSync(join(root, '.githooks/pre-commit'), join(main, '.githooks/pre-commit'));
    chmodSync(join(main, '.githooks/pre-commit'), 0o755);
    writeFileSync(join(main, '.gitignore'), 'node_modules/\nran\n');
    assert.equal(git(main, 'config', 'core.hooksPath', '.githooks').status, 0);
    hook(main);
    commitAll(main, 'first');
    assert.equal(readFileSync(join(main, 'ran'), 'utf8').trim(), main);

    assert.equal(git(main, 'worktree', 'add', '-q', other).status, 0);
    writeFileSync(join(other, 'a'), 'a\n');
    assert.equal(git(other, 'add', 'a').status, 0);
    const missing = git(other, 'commit', '-q', '-m', 'second');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /^pre-commit: run npm install$/m);
    assert.ok(!existsSync(join(other, 'ran')));

    rmSync(join(main, 'ran'));
    hook(other);
    assert.equal(git(other, 'commit', '-q', '-m', 'second').status, 0);
    assert.equal(readFileSync(join(other, 'ran'), 'utf8').trim(), other);
    assert.ok(!existsSync(join(main, 'ran')));
  });
});
