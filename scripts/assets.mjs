import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/assets.mjs DIR VERSION');
  process.exit(2);
}
const packed = join(resolve(dir), `ai-ecoverse-slicc-man-${version}.tgz`);
const name = `slicc-man-${version}.tgz`;
const tarball = join(resolve(dir), name);
if (existsSync(packed)) renameSync(packed, tarball);
if (!existsSync(tarball)) {
  console.error(`scripts/assets.mjs: no ${packed}`);
  process.exit(1);
}
const sum = createHash('sha256').update(readFileSync(tarball)).digest('hex');
writeFileSync(join(resolve(dir), 'SHA256SUMS'), `${sum}  ${name}\n`);
console.log(`${sum}  ${name}`);
