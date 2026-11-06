// Cuts Vườn nhà's plants: each plant's sheet of five stages (render-crops.sh) into one picture per stage, day and night, with the mask's
// alpha. node cut-crops.mjs <raw folder>/crops <the app's assets/world folder>. Writes crops/<art>-<stage>-<day|night>.webp, 300 by 420
// like the plants before them (a plant's foot at PLANT_FOOT of its height), and lists the arts it wrote for `src/screens/garden/gardenArt.ts`.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'crops');
fs.mkdirSync(dir, { recursive: true });
const W = 1500, H = 420, CELL = 300, STAGES = 5;
const file = (n) => path.join(raw, `${n}.png`);
const done = [];
for (const name of fs.readdirSync(raw).filter((f) => f.endsWith('.mask.png')).map((f) => f.slice(0, -'.mask.png'.length)).sort()) {
  if (!fs.existsSync(file(`${name}-day`)) || !fs.existsSync(file(`${name}-night`))) { console.log('skipped', name, '(no day or night picture)'); continue; }
  // sharp extracts before it joins a channel: one step each.
  const alpha = await sharp(file(`${name}.mask`)).removeAlpha().extractChannel(0).resize(W, H, { kernel: 'lanczos3' }).blur(0.5).png().toBuffer();
  for (const light of ['day', 'night']) {
    const rgb = await sharp(file(`${name}-${light}`)).removeAlpha().median(3).png().toBuffer();
    const whole = await sharp(rgb).joinChannel(alpha).png().toBuffer();
    for (let s = 0; s < STAGES; s++) {
      await sharp(whole).extract({ left: s * CELL, top: 0, width: CELL, height: H })
        .webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${name}-${s}-${light}.webp`));
    }
  }
  done.push(name);
}
let sum = 0;
for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
console.log('plants', done.length, JSON.stringify(done));
console.log('crops', fs.readdirSync(dir).length, 'files', Math.round(sum / 1024), 'KB');
