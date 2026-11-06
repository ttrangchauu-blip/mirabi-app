// Cuts the Explore road's three layers. node cut-road.mjs <raw folder>/road <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'road');
fs.mkdirSync(dir, { recursive: true });
// The far hills are soft and small on the screen: they need fewer pixels than what the pet walks on.
const SIZE = { far: 1170, mid: 1560, road: 1560 };
for (const part of ['far', 'mid', 'road']) {
  const size = SIZE[part];
  const mask = await sharp(path.join(raw, `${part}.mask.png`)).removeAlpha().extractChannel(0).blur(0.6).resize(size, size, { kernel: 'lanczos3' }).linear(2.4, -1.4 * 255).png().toBuffer(); // Takes the edge in by a pixel: the pale sky mixed into it would draw a line along each layer's top.
  for (const light of ['day', 'night']) {
    // Rendered in four squares; the noise filter runs on the whole layer so the joins don't show.
    const tiles = [0, 1, 2, 3].map((i) => ({ input: path.join(raw, `${part}-${light}-${i}.png`), left: (i % 2) * 975, top: Math.floor(i / 2) * 975 }));
    const joined = await sharp({ create: { width: 1950, height: 1950, channels: 3, background: '#000' } }).composite(tiles).removeAlpha().png().toBuffer();
    const color = await sharp(joined).median(3).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
    const whole = await sharp(color).joinChannel(mask).png().toBuffer();
    await sharp(whole).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${part}-${light}.webp`));
    console.log(part, light, Math.round(fs.statSync(path.join(dir, `${part}-${light}.webp`)).size / 1024), 'KB');
  }
}
