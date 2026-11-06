import { mkdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('public/icons', { recursive: true });
const source = await readFile('public/icon.svg');
for (const [file, size] of [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512], ['maskable-512', 512]] as const) {
  await sharp(source).resize(size, size).png().toFile(`public/icons/${file}.png`);
}
