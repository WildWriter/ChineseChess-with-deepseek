import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'SOURCE-MANIFEST.json'), 'utf8'));
if (manifest.application !== 'qili-study' || !Array.isArray(manifest.files)) throw new Error('Invalid source manifest');
const expected = new Map();
for (const entry of manifest.files) {
  const name = entry.path;
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || name.includes(':') ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      expected.has(name) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid or duplicate manifest entry');
  expected.set(name, entry);
}
for (const name of ['README.md', 'SUBMISSION.md', 'TESTING.md', 'server.js', 'package.json',
  'public/import-lab.js', 'src/position-vision.js', 'src/position-worker.js', 'tests/import-position.test.js',
  'THIRD_PARTY.md', 'engine/Pikafish-GPL-3.0.txt', 'engine/NNUE-License.md',
  'engine/source/Pikafish-2026-09-06-source.zip']) {
  if (!expected.has(name)) throw new Error(`Missing required package entry: ${name}`);
}
const actual = new Set();
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    const name = path.relative(root, target).split(path.sep).join('/');
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`Linked entry is not allowed: ${name}`);
    if (['.git', 'node_modules', 'evidence'].includes(item.name) ||
        (item.name === '.env' || item.name.startsWith('.env.')) && item.name !== '.env.example' ||
        /\.(log|tmp|bak)$/i.test(item.name)) throw new Error(`Private or generated entry is not allowed: ${name}`);
    if (item.isDirectory()) await walk(target);
    else {
      if (!item.isFile()) throw new Error(`Not a regular file: ${name}`);
      actual.add(name);
      if (name === 'SOURCE-MANIFEST.json' || name === 'engine/pikafish.nnue') continue;
      const entry = expected.get(name);
      if (!entry) throw new Error(`Unexpected file: ${name}`);
      const data = await readFile(target);
      if (data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`File mismatch: ${name}`);
      // Report only the filename, never a possible credential value.
      if (/\.(js|json|md|html|css|txt|ps1|cmd)$/.test(item.name) && /\bsk-[a-zA-Z0-9_-]{24,}\b/.test(data.toString('utf8'))) {
        throw new Error(`Possible API credential requires review: ${name}`);
      }
    }
  }
}
await walk(root);
for (const name of expected.keys()) if (!actual.has(name)) throw new Error(`File is missing: ${name}`);
if (expected.has('engine/pikafish.nnue')) throw new Error('Generated full network must not be packaged twice');
if (actual.has('engine/pikafish.nnue')) {
  const parts = [...expected.keys()].filter(name => /^engine\/nnue-parts\/pikafish\.nnue\.part\d{3}$/.test(name)).sort();
  if (parts.length !== 4) throw new Error('Expected four network parts');
  const combined = Buffer.concat(await Promise.all(parts.map(name => readFile(path.join(root, name)))));
  const generated = await readFile(path.join(root, 'engine', 'pikafish.nnue'));
  if (sha256(combined) !== sha256(generated)) throw new Error('Generated network does not match the bundled parts');
}
console.log(`Package verified: ${expected.size} manifest files; SHA-256 and expected paths match.`);
console.log('No .env, evidence directory, logs or obvious API credentials found.');
console.log('Run node scripts/prepare-engine.js before tests when using a fresh extraction.');
