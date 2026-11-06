// Cuts the project islands, the sea and the chests. node cut-work.mjs <raw folder>/work <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'work');
fs.mkdirSync(dir, { recursive: true });
const file = (n) => path.join(raw, `${n}.png`);
const cutout = async (name) => {
  const color = await sharp(file(name)).removeAlpha().median(3).png().toBuffer();
  const alpha = await sharp(file(`${name}.mask`)).removeAlpha().extractChannel(0).blur(0.6).png().toBuffer();
  return sharp(color).joinChannel(alpha).png().toBuffer();
};
const save = (buf, name, quality = 84) => sharp(buf).webp({ quality, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${name}.webp`));
await save(await sharp(file('sea')).removeAlpha().median(3).png().toBuffer(), 'sea', 78);
for (let i = 0; i < 3; i++) await save(await sharp(await cutout(`chest-${i}`)).resize(240, 240, { kernel: 'lanczos3' }).png().toBuffer(), `chest-${i}`);
for (const theme of ['meadow', 'beach', 'forest', 'snow', 'desert', 'sky']) {
  const row = await cutout(`isle-${theme}`);
  for (let stage = 0; stage < 6; stage++) await save(await sharp(row).extract({ left: stage * 240, top: 0, width: 240, height: 300 }).png().toBuffer(), `isle-${theme}-${stage}`);
}
let sum = 0;
for (const f of fs.readdirSync(dir).filter((n) => /^(sea|chest|isle)/.test(n))) sum += fs.statSync(path.join(dir, f)).size;
console.log('work pictures', Math.round(sum / 1024), 'KB');
