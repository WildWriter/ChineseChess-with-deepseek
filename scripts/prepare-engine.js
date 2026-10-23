import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = '96ec030c4f502bcf96b3234f918b3405fbd73199';
const files = [
  ['engine/Pikafish-Windows-x86-64-universal.exe',6944256,'92610a60c00e2c1a2e9ce1b0b34f8de6f8bc2361'],
  ['engine/nnue-parts/pikafish.nnue.part001',12676595,'5be2092dcb4d365a7563f0a7737097600dbf7167'],
  ['engine/nnue-parts/pikafish.nnue.part002',12676595,'464ea84b57f5834dabf6ec45ffec6e017de01bbb'],
  ['engine/nnue-parts/pikafish.nnue.part003',12676595,'026d66ed996f6908740ffcaef77333336f203058'],
  ['engine/nnue-parts/pikafish.nnue.part004',12676593,'2ff97958a65153afd9e5a8d072c02cf26c3f615d'],
  ['engine/source/Pikafish-2026-09-06-source.zip',559168,'fcf0c825366c0f1c232f8629cbdbca0ba5f0608b']
];
const hashBlob = buffer => createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
for (const [relative, size, expected] of files) {
  const target = path.join(root, relative);
  let buffer;
  try { if ((await stat(target)).size === size) buffer = await readFile(target); } catch {}
  if (!buffer || hashBlob(buffer) !== expected) {
    if (!process.argv.includes('--download')) throw new Error(`${relative} 缺失或校验失败。运行 node scripts/prepare-engine.js --download 补齐。`);
    for (let retry = 0; retry < 3; retry++) {
      console.log(`Downloading ${relative} (${retry + 1}/3)`);
      try {
        const response = await fetch(`https://raw.githubusercontent.com/WildWriter/ChineseChess-with-deepseek/${commit}/${relative}`, { signal: AbortSignal.timeout(90000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = Buffer.from(await response.arrayBuffer());
        if (data.length !== size || hashBlob(data) !== expected) throw new Error('Downloaded blob does not match pinned commit');
        await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data); buffer = data; break;
      } catch(error) { if (retry === 2) throw error; }
    }
  }
  console.log(`Verified ${relative}`);
}
const parts = await Promise.all(files.filter(([name]) => name.includes('nnue-parts')).map(([name]) => readFile(path.join(root, name))));
const network = Buffer.concat(parts);
await writeFile(path.join(root, 'engine', 'pikafish.nnue'), network);
console.log(`Ready: ${network.length} bytes, SHA256 ${createHash('sha256').update(network).digest('hex')}`);
