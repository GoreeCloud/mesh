/**
 * Read-only provenance and license inventory for the locked production tree.
 * This does not execute package code and is not a substitute for legal review.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
if (lock.lockfileVersion !== 3 || lock.name !== '@goreecloud/mesh-code-mode-fixture') {
  throw new Error('Unexpected lockfile');
}
const entries = Object.entries(lock.packages ?? {}).filter(([path, p]) => path &&
  p && typeof p === 'object' && !p.dev && !p.link);
const permissive = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  'ISC', '0BSD', 'CC0-1.0', 'Unlicense', 'Zlib', 'BlueOak-1.0.0',
  'MIT-0', // verified MIT No Attribution SPDX license
]);
const review = new Map();
let registry = 0, verified = 0, installed = 0;
for (const [path, info] of entries) {
  if (typeof info.resolved === 'string') {
    if (!info.resolved.startsWith('https://registry.npmjs.org/') ||
        !/^sha(?:256|384|512)-[A-Za-z0-9+/=]+(?:\s+sha(?:256|384|512)-[A-Za-z0-9+/=]+)*$/.test(info.integrity ?? '')) {
      throw new Error('Unapproved or unhashed registry source at ' + path);
    }
    registry++; verified++;
  }
  const manifestFile = join(process.cwd(), path, 'package.json');
  if (!existsSync(manifestFile)) {
    if (!info.optional && !info.os && !info.cpu) {
      throw new Error('Required production package missing: ' + path);
    }
    continue;
  }
  installed++;
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const license = typeof manifest.license === 'string' ? manifest.license.trim()
    : 'UNDECLARED';
  const ids = license.replace(/[()]/g, ' ').split(/\s+(?:AND|OR|WITH)\s+|\s+/).filter(Boolean);
  if (ids.length === 0 || ids.some(id => !permissive.has(id))) {
    const name = manifest.name ?? path;
    review.set(name + '@' + (manifest.version ?? 'unknown'), license);
  }
}
if (registry === 0 || installed === 0) throw new Error('Empty dependency inventory');
console.log('Locked production package entries:', entries.length);
console.log('Verified npm-registry integrity entries:', verified);
console.log('Installed production packages:', installed);
console.log('Licenses needing manual review:', review.size);
for (const [name, license] of [...review].sort((a,b) => a[0].localeCompare(b[0]))) {
  console.log('REVIEW:', name, '| license:', license);
}
console.log('Review is advisory; redistribution and SPDX obligations require explicit signoff.');
