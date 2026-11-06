// Turns the raw renders into the app's pictures: calms the last of the noise, cuts sheets into cells, applies the masks.
// node toy/cut.mjs <raw folder> <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const at = (...p) => { const f = path.join(out, ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); return f; };
const calm = (name) => sharp(path.join(raw, `${name}.png`)).removeAlpha().median(3);
const jpg = async (name, ...to) => { await calm(name).jpeg({ quality: 84, mozjpeg: true }).toFile(at(...to)); };
/** The picture with the shape of its mask as alpha, as raw pixels. */
const cutout = async (name, maskName = name) => {
  const color = await calm(name).toBuffer();
  const meta = await sharp(color).metadata();
  const maskFile = sharp(path.join(raw, `${maskName}.mask.png`));
  const sameSize = (await maskFile.metadata()).width === meta.width;
  const shaped = maskFile.removeAlpha().greyscale().resize(meta.width, meta.height, { kernel: 'lanczos3' });
  const alpha = await (sameSize ? shaped.blur(0.7) : shaped).toBuffer();
  return sharp(color).joinChannel(alpha).png().toBuffer();
};
const webp = (buf, ...to) => sharp(buf).webp({ quality: 82, alphaQuality: 92, effort: 6 }).toFile(at(...to));
/** Cuts a row of `names.length` equal cells out of a cut-out. */
const row = async (buf, names, folder) => {
  const meta = await sharp(buf).metadata();
  const w = Math.floor(meta.width / names.length);
  for (let i = 0; i < names.length; i++) await webp(await sharp(buf).extract({ left: i * w, top: 0, width: w, height: meta.height }).toBuffer(), folder, `${names[i]}.webp`);
};

for (const p of ['sakura', 'oak', 'sunflower', 'bamboo', 'maple', 'lotus']) await row(await cutout(`plant-${p}`), [0, 1, 2, 3, 4, 5].map((s) => `${p}-${s}`), 'garden/plants');
await webp(await cutout('can'), 'garden/can.webp');
await webp(await cutout('garden-day'), 'garden/land-day.webp');
await webp(await cutout('garden-night', 'garden-day'), 'garden/land-night.webp');

await jpg('desk-day', 'work/day.jpg');
await jpg('desk-night', 'work/night.jpg');
await jpg('desktop', 'work/top.jpg');

await jpg('lib-wall', 'library/wall.jpg');
await jpg('lib-niche', 'library/niche.jpg');
await row(await cutout('lib-books'), [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `book-${i}`), 'library');
await row(await cutout('lib-tops'), ['top-plant', 'top-globe', 'top-cup'], 'library');

await jpg('hall-room', 'hall/room.jpg');
await webp(await cutout('hall-board'), 'hall/board.webp');
await webp(await cutout('hall-table'), 'hall/table.webp');

for (const b of [0, 1, 2, 3, 4, 5]) await jpg(`land-${b}`, 'career', `land-${b}.jpg`);
await row(await cutout('stones'), ['stone-locked', 'stone-available', 'stone-in_progress', 'stone-practiced', 'stone-assessed'], 'career');
await webp(await cutout('hedge'), 'career/hedge.webp');

// The rest of the town comes from cut-town.mjs.
await webp(await cutout('town-lantern'), 'town/lantern.webp');

let total = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else total += fs.statSync(f).size; });
walk(out);
console.log('total KB', Math.round(total / 1024));
