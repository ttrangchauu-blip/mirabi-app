// Cuts the walk's two layers. node cut-walk.mjs <raw folder>/walk <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'walk');
fs.mkdirSync(dir, { recursive: true });
for (const part of ['near', 'far']) {
  const mask = await sharp(path.join(raw, `${part}.mask.png`)).removeAlpha().extractChannel(0).blur(0.6).png().toBuffer();
  for (const light of ['day', 'night']) {
    const color = await sharp(path.join(raw, `${part}-${light}.png`)).removeAlpha().median(3).png().toBuffer();
    const whole = await sharp(color).joinChannel(mask).png().toBuffer();
    await sharp(whole).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${part}-${light}.webp`));
    console.log(part, light, Math.round(fs.statSync(path.join(dir, `${part}-${light}.webp`)).size / 1024), 'KB');
  }
}
