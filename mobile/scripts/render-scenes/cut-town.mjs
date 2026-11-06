// Cuts Thị trấn Mirabi: the street without what can change, in four tiles (a picture this long is too much for one texture on a
// phone), and a patch for each stage of the fountain and the garden and for each friend's plot. A patch is what differs from the street,
// with a soft edge. node cut-town.mjs <raw folder>/townstreet <the app's assets/world folder>   Prints the numbers for townArt.ts.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'town');
fs.mkdirSync(dir, { recursive: true });
const W = 6000, H = 720, TILE = 1500;
const file = (name) => path.join(raw, `${name}.png`);
const calm = (name) => sharp(file(name)).removeAlpha().median(3);
const webp = (s, name, quality = 84) => s.webp({ quality, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, name));

const mask = await sharp(file('mask')).removeAlpha().extractChannel(0).blur(0.6).raw().toBuffer();
const table = {};
for (const light of ['day', 'night']) {
  const tiles = [];
  const whole = Buffer.alloc(W * H * 3);
  for (let t = 0; t < 4; t++) {
    const px = await calm(`land-${light}-${t}`).raw().toBuffer();
    tiles.push(px);
    for (let y = 0; y < H; y++) px.copy(whole, (y * W + t * TILE) * 3, y * TILE * 3, (y + 1) * TILE * 3);
    const alpha = Buffer.alloc(TILE * H);
    for (let y = 0; y < H; y++) mask.copy(alpha, y * TILE, y * W + t * TILE, y * W + (t + 1) * TILE);
    await webp(sharp(px, { raw: { width: TILE, height: H, channels: 3 } }).joinChannel(await sharp(alpha, { raw: { width: TILE, height: H, channels: 1 } }).png().toBuffer()), `land-${light}-${t}.webp`);
  }
  const soft = await sharp(whole, { raw: { width: W, height: H, channels: 3 } }).blur(1.6).raw().toBuffer();
  const patch = async (name, crop, outName, limit = null) => {
    const px = await calm(name).png().toBuffer();
    const other = await sharp(px).blur(1.6).raw().toBuffer();
    const diff = Buffer.alloc(crop.w * crop.h);
    let top = crop.h, bottom = 0, left = crop.w, right = 0;
    for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
      if (limit && (x + crop.x < limit[0] || x + crop.x > limit[1])) continue;
      const a = (y * crop.w + x) * 3, b = ((y + crop.y) * W + x + crop.x) * 3;
      const d = Math.abs(other[a] - soft[b]) + Math.abs(other[a + 1] - soft[b + 1]) + Math.abs(other[a + 2] - soft[b + 2]);
      if (d > (light === 'day' ? 15 : 12)) { diff[y * crop.w + x] = 255; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
    }
    const pad = 16, lo = limit ? Math.max(0, Math.round(limit[0] - crop.x)) : 0;
    const box = { left: Math.max(lo, left - pad), top: Math.max(0, top - pad) };
    box.width = Math.min(crop.w, right + pad) - box.left; box.height = Math.min(crop.h, bottom + pad) - box.top;
    const grown = await sharp(diff, { raw: { width: crop.w, height: crop.h, channels: 1 } }).blur(5).linear(5, 0).blur(3.5).extractChannel(0).raw().toBuffer();
    for (let y = 0; y < crop.h; y++) for (let x = 0; x < lo; x++) grown[y * crop.w + x] = 0;
    const alpha = await sharp(grown, { raw: { width: crop.w, height: crop.h, channels: 1 } }).png().toBuffer();
    const joined = await sharp(px).joinChannel(alpha).png().toBuffer(); // Two steps: sharp would extract before it joins.
    await webp(sharp(joined).extract(box), `${outName}.webp`);
    return [(box.left + crop.x) / W, (box.top + crop.y) / H, box.width / W, box.height / H].map((n) => +n.toFixed(4));
  };
  const row = { fountain: [], garden: [], houses: [] };
  for (let k = 1; k <= 4; k++) row.fountain.push(await patch(`fountain-${k}-${light}`, { x: 0, y: 100, w: 720, h: 620 }, `fountain-${k}-${light}`));
  for (let k = 1; k <= 4; k++) row.garden.push(await patch(`garden-${k}-${light}`, { x: 560, y: 100, w: 680, h: 620 }, `garden-${k}-${light}`));
  for (let i = 0; i < 12; i++) {
    const mid = (15.65 + i * 1.83) / 37 * 6000;
    const x = Math.min(5400, Math.trunc(mid - 300));
    // Inside its plot, and more to the right, where its shadow falls: it must not lay empty ground over the house on its left.
    row.houses.push(await patch(`house-${i}-${light}`, { x, y: 140, w: 600, h: 580 }, `house-${i}-${light}`, [mid - 145, mid + 220]));
  }
  table[light] = row;
}
console.log(JSON.stringify(table));
let sum = 0;
for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
console.log('town folder', Math.round(sum / 1024), 'KB');
