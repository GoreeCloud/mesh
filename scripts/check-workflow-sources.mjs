import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const allowed = new Set([
  '.github','ai','android-defaults','android-toolkit','app-store','brand-assets',
  'containers','database','firefox-add-ons','gc-ui','gif','goreecloud',
  'goreeshield','index','mesh','metrics','static-websites','wardveil'
]);
const dir = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const errors = [];
for (const name of readdirSync(dir).filter(n => /\.ya?ml$/i.test(n))) {
  const body = readFileSync(join(dir, name), 'utf8');
  for (const match of body.matchAll(/GoreeCloud\/([A-Za-z0-9_.-]+)/gi)) {
    if (!allowed.has(match[1].toLowerCase())) errors.push(name + ': unavailable source ' + match[1]);
  }
  if (/^\s*repository:\s*.*\$\{\{/m.test(body)) errors.push(name + ': dynamic checkout requires explicit review');
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Workflow source allowlist passed; this checks references, not live availability or authorization.');
}
