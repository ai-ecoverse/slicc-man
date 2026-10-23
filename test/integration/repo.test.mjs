import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const tracked = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .stdout.split('\n')
  .filter(Boolean)
  .filter((path) => existsSync(join(root, path)));

describe('the repository', () => {
  it('has ci.yml as its only workflow, on the pipeline at the devDependency version', () => {
    assert.deepEqual(readdirSync(join(root, '.github/workflows')), ['ci.yml']);
    const ci = read('.github/workflows/ci.yml');
    const uses = [...ci.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    assert.deepEqual(uses, [
      `ai-ecoverse/slicc-shared-web/.github/workflows/pipeline.yml@v${pkg.devDependencies['@ai-ecoverse/slicc-shared-web']}`,
    ]);
    assert.match(ci, /^\s*secrets: inherit$/m);
    assert.doesNotMatch(ci, /runs-on|workflow_dispatch|schedule|#/);
    for (const scope of [
      'contents',
      'issues',
      'pull-requests',
      'statuses',
      'id-token',
      'attestations',
    ]) {
      assert.match(ci, new RegExp(`^  ${scope}: write$`, 'm'), scope);
    }
    assert.match(ci, /^ {2}actions: read$/m);
    assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    assert.match(ci, /^\s*review-prompt: \|\n\s+SLICC-MAN$/m);
    const glob = /^\s*test-glob:\s*(\S+)$/m.exec(ci)?.[1];
    assert.ok(glob && pkg.scripts.test.endsWith(` ${glob}`), pkg.scripts.test);
    assert.match(ci, /^ {6}windows-test: npm run test:windows$/m);
    assert.match(
      pkg.scripts['test:windows'],
      /^node --test .* test\/integration\/windows\.test\.mjs$/
    );
  });

  it('publishes to npm from ci.yml through semantic-release, with provenance', () => {
    assert.equal(pkg.fledgling.workflow, 'ci.yml');
    assert.equal(pkg.fledgling.repo, 'ai-ecoverse/slicc-man');
    assert.equal(pkg.fledgling.publish, true);
    assert.equal(pkg.publishConfig.access, 'public');
    assert.equal(pkg.publishConfig.provenance, true);
    const release = JSON.parse(read('.releaserc.json'));
    assert.deepEqual(release.branches, ['main']);
    assert.equal(release.tagFormat, 'v${version}');
    const plugin = (name) => release.plugins.find((entry) => [entry].flat()[0] === name);
    assert.deepEqual(plugin('@semantic-release/npm'), [
      '@semantic-release/npm',
      { tarballDir: 'release' },
    ]);
    assert.equal(
      plugin('@semantic-release/exec')[1].prepareCmd,
      'node scripts/assets.mjs release ${nextRelease.version}'
    );
    assert.deepEqual(
      plugin('@semantic-release/github')[1].assets.map((asset) => asset.path),
      ['release/slicc-man-*.tgz', 'release/SHA256SUMS', 'release/install.sh', 'release/install.ps1']
    );
    assert.ok(read('.gitignore').split('\n').includes('release/'));
    assert.doesNotMatch(JSON.stringify(release), /npmPublish/);
  });

  it('is @ai-ecoverse/slicc-man, an Apache-2.0 ES module package for Node 24 and later', () => {
    assert.equal(pkg.name, '@ai-ecoverse/slicc-man');
    assert.equal(pkg.version, '0.0.0');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.license, 'Apache-2.0');
    assert.equal(pkg.engines.node, '>=24');
    assert.equal(pkg.repository.url, 'git+https://github.com/ai-ecoverse/slicc-man.git');
    assert.match(read('LICENSE'), /Apache License\s+Version 2\.0/);
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
      assert.match(version, /^\d+\.\d+\.\d+(-[\w.]+)?$/, `${name} is pinned exactly`);
    }
    const [major, minor] = pkg.devDependencies['@ai-ecoverse/slicc-shared-web']
      .split('.')
      .map(Number);
    assert.ok(major === 2 && minor >= 12, 'windows-test needs slicc-shared-web 2.12.0 or later');
  });

  it('installs only scman on a host, and man, apropos, whatis and scman in SLICC', () => {
    assert.deepEqual(pkg.bin, { scman: 'host/scman.mjs' });
    assert.match(read('host/scman.mjs'), /^#!\/usr\/bin\/env node\n/);
    assert.deepEqual(Object.keys(pkg.slicc.commands).sort(), ['apropos', 'man', 'scman', 'whatis']);
  });

  it('packs the license, the README, package.json and every command, and no tests', () => {
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr);
    const files = JSON.parse(pack.stdout)[0]
      .files.map((file) => file.path)
      .sort();
    const expected = [
      'LICENSE',
      'README.md',
      'package.json',
      ...pkg.files.flatMap((dir) =>
        readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
      ),
    ].sort();
    assert.deepEqual(files, expected);
    assert.ok(!files.some((path) => path.startsWith('test/')));
    for (const path of Object.values(pkg.bin ?? {})) assert.ok(files.includes(path), path);
    for (const command of Object.values(pkg.slicc?.commands ?? {})) {
      for (const key of ['script', 'module', 'glue', 'wasm']) {
        if (command[key] !== undefined) assert.ok(files.includes(command[key]), command[key]);
      }
    }
  });

  it('builds dist/slicc.mjs at pack time from the current sources, and keeps it out of git', async () => {
    assert.equal(pkg.scripts.prepack, 'node scripts/bundle.mjs');
    assert.ok(read('.gitignore').split('\n').includes('dist/'));
    assert.ok(!tracked.some((path) => path.startsWith('dist/')));
    const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(pack.status, 0, pack.stderr);
    assert.ok(JSON.parse(pack.stdout)[0].files.some((file) => file.path === 'dist/slicc.mjs'));
    const { bundle } = await import('../../scripts/bundle.mjs');
    assert.equal(read('dist/slicc.mjs'), await bundle());
    assert.match(pkg.engines['slicc-kernel'], /^>=\d+\.\d+\.\d+$/);
    for (const [name, command] of Object.entries(pkg.slicc.commands)) {
      assert.deepEqual(command, { abi: 'js', module: 'dist/slicc.mjs', argv0: name });
    }
  });

  it('has README.md as its spec, an AGENTS.md of at most 1,000 characters, and no other .md', () => {
    const docs = tracked.filter((path) => /\.md$/i.test(path)).sort();
    assert.deepEqual(docs, ['AGENTS.md', 'README.md']);
    assert.ok([...read('AGENTS.md')].length <= 1000, 'AGENTS.md is too long');
    assert.ok(!tracked.some((path) => /(^|\/)CLAUDE\.md$/i.test(path)));
  });

  it('keeps unit tests out of git', () => {
    assert.ok(read('.gitignore').split('\n').includes('test/unit/'));
    const tests = tracked.filter((path) => /(^|\/)tests?\/|\.(test|spec)\./.test(path));
    assert.ok(
      tests.every((path) => path.startsWith('test/integration/')),
      tests.join(' ')
    );
  });

  it('has no comments in any file', () => {
    const hash = /^(\s*#|.*\s#\s)/;
    const slash = /^\s*(\/\/|\/\*|\*\s|\*\/)/;
    for (const path of tracked) {
      if (path === 'LICENSE' || /\.md$/i.test(path)) continue;
      const lines = read(path).split('\n');
      const pattern = /\.(m?js|cjs|ts|json|css)$/.test(path) ? slash : hash;
      lines.forEach((line, index) => {
        if (index === 0 && line.startsWith('#!')) return;
        assert.doesNotMatch(line, pattern, `${path}:${index + 1}`);
        if (/\.(m?js|cjs|ts|css|html)$/.test(path)) {
          assert.doesNotMatch(line, /(^|\s)(\/\/\s|\/\*)|<!-{2}/, `${path}:${index + 1}`);
        }
      });
    }
  });
});
