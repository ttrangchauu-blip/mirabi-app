// node cut-study.mjs <focus|group> <the app's assets/world folder> : cuts a study room's passes into what the app draws, and writes plates.json
// with where each goes (canvas units, 640 x 440). An item keeps its own shadow: outside its mask it is black, with the alpha of how much darker the
// empty room got there, so it multiplies over any wall or floor it is moved to. Walls and floors are one render each, tinted per colour of the catalog.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOMS } from './study-rooms.mjs';
const [name, outRoot] = process.argv.slice(2);
const room = ROOMS[name], raw = path.join('raw', name), out = path.join(outRoot, name === 'focus' ? 'focusroom' : 'grouproom');
fs.mkdirSync(out, { recursive: true });
const FW = 1280, FH = 880;
const WALLS = { wall_cream: '#F1E2C8', wall_mint: '#CBE7D5', wall_lilac: '#BEB1E8', wall_peach: '#F6D3BF', wall_sky: '#CFE5F6', wall_night: '#3C4878' };
const FLOORS = { floor_wood_light: ['', '#D9BC97'], floor_wood_honey: ['', '#CF9E68'], floor_wood_rose: ['', '#E3B5A3'], floor_wood_night: ['', '#6E4F3E'], floor_tile_cream: ['tile', '#F1E8D6'], floor_tile_blue: ['tile', '#CBE0F0'], floor_tile_lilac: ['tile', '#DCD2EE'] };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const png = (f) => path.join(raw, f);
const rgb = async (s) => { const { data, info } = await s.removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; };
const calm = (f) => sharp(png(f)).removeAlpha().median(3);
const maskOf = async (f, crop, soft = 0.55) => {
  const first = await sharp(png(f)).removeAlpha().extractChannel(0).png().toBuffer();
  const blurred = await sharp(first).blur(soft).png().toBuffer();
  let s = sharp(blurred).extractChannel(0);
  if (crop) s = s.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h });
  return (await s.raw().toBuffer({ resolveWithObject: true })).data;
};
const table = {};
async function write(pixels, w, h, file, at, quality = 86) {
  // Cropped to what shows: fewer pixels to decode and to draw.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error(`nothing in ${file}`);
  const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).extract(box).webp({ quality, alphaQuality: 92, effort: 6 }).toFile(path.join(out, file));
  return [(at.x + x0) / 2, (at.y + y0) / 2, box.width / 2, box.height / 2].map((n) => +n.toFixed(2));
}
const WHOLE = { x: 0, y: 0, w: FW, h: FH };
const fileOf = (n) => n.replaceAll('.', '-');
const cutout = (colour, m, w, h) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { px[i * 4] = colour.data[i * 3]; px[i * 4 + 1] = colour.data[i * 3 + 1]; px[i * 4 + 2] = colour.data[i * 3 + 2]; px[i * 4 + 3] = m[i]; } return px; };
for (const it of room.items) {
  const crop = it.fromBase ? WHOLE : JSON.parse(fs.readFileSync(png(`${it.name}.crop.json`), 'utf8')), { w, h } = crop;
  const colour = await rgb(it.fromBase ? calm('base.png') : calm(`${it.name}.png`));
  const m = await maskOf(`${it.name}.mask.png`, crop);
  const entry = (table[it.name] = {});
  // Parts cut apart and left out of the main picture.
  const partMasks = [];
  for (const p of it.parts ?? []) {
    const pm = await maskOf(`${p}.mask.png`, crop); partMasks.push(pm);
    entry[p.split('.').pop()] = await write(cutout(colour, pm, w, h), w, h, `${fileOf(p)}.webp`, crop);
  }
  if (it.cover) entry.cover = await write(cutout(colour, await maskOf(`${it.cover}.mask.png`, crop), w, h), w, h, `${fileOf(it.cover)}.webp`, crop);
  let shadow = null;
  if (!it.noShadow && !it.fromBase) {
    const soft = async (s) => rgb(sharp(await s.png().toBuffer()).blur(2.2));
    const A = await soft(sharp(png(`${it.name}.png`)).removeAlpha().median(3));
    const B = await soft(it.on?.length ? sharp(png(`${it.name}.under.png`)).removeAlpha().median(3)
      : sharp(await sharp(png('base.png')).removeAlpha().median(3).png().toBuffer()).extract({ left: crop.x, top: crop.y, width: w, height: h }));
    const dark = Buffer.alloc(w * h), floor = 0.045;
    for (let i = 0; i < w * h; i++) {
      const la = A.data[i * 3] + A.data[i * 3 + 1] + A.data[i * 3 + 2], lb = B.data[i * 3] + B.data[i * 3 + 1] + B.data[i * 3 + 2];
      dark[i] = Math.max(0, Math.min(255, ((1 - la / Math.max(1, lb) - floor) / (1 - floor)) * 255));
    }
    if (it.glass) {
      const [gx0, gy0, gx1, gy1] = it.glass.map((v) => v * 2);
      for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) { const px = x - crop.x, py = y - crop.y; if (px >= 0 && py >= 0 && px < w && py < h) dark[py * w + px] = 0; }
    }
    shadow = await sharp(await sharp(dark, { raw: { width: w, height: h, channels: 1 } }).blur(1.5).png().toBuffer()).extractChannel(0).raw().toBuffer();
    // A sliver of noise far away would make the picture as big as its crop.
    for (let i = 0; i < w * h; i++) if (shadow[i] < 6) shadow[i] = 0;
    // Where the crop of the pass ended inside the frame, the blur leaves a faint line: a shadow fades out before that edge.
    const FADE = 18, far = 1e9;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.min(crop.x > 0 ? x : far, crop.y > 0 ? y : far, crop.x + w < FW ? w - 1 - x : far, crop.y + h < FH ? h - 1 - y : far);
      if (d < FADE) shadow[y * w + x] = Math.round(shadow[y * w + x] * (d / FADE));
    }
  }
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let mm = m[i] / 255;
    for (const pm of partMasks) mm = Math.max(0, mm - pm[i] / 255);
    const s = shadow ? (shadow[i] / 255) * (1 - m[i] / 255) : 0, a = mm + s;
    if (a <= 0) continue;
    const k = mm / a; // colour for what is the item, black for what is its shadow
    px[i * 4] = colour.data[i * 3] * k; px[i * 4 + 1] = colour.data[i * 3 + 1] * k; px[i * 4 + 2] = colour.data[i * 3 + 2] * k; px[i * 4 + 3] = Math.min(255, a * 255);
  }
  entry.box = await write(px, w, h, `${fileOf(it.name)}.webp`, crop);
  console.log('cut', it.name);
}
const meanOver = async (file, maskFile) => {
  const c = await rgb(sharp(png(file)).removeAlpha()), m = await maskOf(maskFile, null);
  const sum = [0, 0, 0]; let n = 0;
  for (let y = 0; y < c.h; y += 2) for (let x = 0; x < c.w; x += 2) { const i = y * c.w + x; if (m[i] > 250) { for (let k = 0; k < 3; k++) sum[k] += c.data[i * 3 + k]; n++; } }
  return sum.map((v) => v / n);
};
if (name === 'focus') {
  const base = await rgb(calm('base.png')), paint = await maskOf('paint.mask.png', null), floor = await maskOf('floor.mask.png', null);
  const top = await rgb(calm('top.png')), topPaint = await maskOf('paint.top.mask.png', null);
  const wallMean = await meanOver('base.png', 'paint.mask.png');
  console.log('wall mean', wallMean);
  for (const [id, target] of Object.entries(WALLS)) {
    const f = hex(target).map((v, k) => v / wallMean[k]);
    const tint = (src, mask) => { const o = Buffer.from(src.data); for (let i = 0; i < src.w * src.h; i++) { const a = mask[i] / 255; if (!a) continue; for (let k = 0; k < 3; k++) o[i * 3 + k] = Math.min(255, src.data[i * 3 + k] * (1 - a + a * f[k])); } return o; };
    await sharp(tint(base, paint), { raw: { width: base.w, height: base.h, channels: 3 } }).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(out, `${id}.jpg`));
    await sharp(tint(top, topPaint), { raw: { width: top.w, height: top.h, channels: 3 } }).resize(960).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(out, `${id}-top.jpg`));
  }
  const floorMean = { '': await meanOver('base.png', 'floor.mask.png'), tile: await meanOver('base-tile.png', 'floor.mask.png') };
  const src = { '': base, tile: await rgb(calm('base-tile.png')) }, near = { '': await rgb(calm('near.png')), tile: await rgb(calm('near-tile.png')) };
  for (const [id, [kind, target]] of Object.entries(FLOORS)) {
    const f = hex(target).map((v, k) => v / floorMean[kind][k]), s = src[kind], n = near[kind];
    const px = Buffer.alloc(s.w * s.h * 4);
    for (let i = 0; i < s.w * s.h; i++) { for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.min(255, s.data[i * 3 + k] * f[k]); px[i * 4 + 3] = floor[i]; }
    table[id] = await write(px, s.w, s.h, `${id}.webp`, { x: 0, y: 0 }, 84);
    const o = Buffer.from(n.data); for (let i = 0; i < o.length; i++) o[i] = Math.min(255, n.data[i] * f[i % 3]);
    await sharp(o, { raw: { width: n.w, height: n.h, channels: 3 } }).resize(960).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(out, `${id}-near.jpg`));
  }
} else {
  await calm('base.png').jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(out, 'room.jpg'));
  await calm('top.png').resize(960).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(out, 'room-top.jpg'));
  await calm('near.png').resize(960).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(out, 'room-near.jpg'));
}
fs.writeFileSync(path.join(raw, 'plates.json'), JSON.stringify(table));
let bytes = 0;
for (const f of fs.readdirSync(out)) bytes += fs.statSync(path.join(out, f)).size;
console.log(JSON.stringify(table));
console.log(Math.round(bytes / 1024), 'KB in', fs.readdirSync(out).length, 'files');
