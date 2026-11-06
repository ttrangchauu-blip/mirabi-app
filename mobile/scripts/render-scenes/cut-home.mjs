// node cut-home.mjs <raw dir> <the app's assets/world folder> : cuts Nhà của Pet's passes into what the app draws, and writes plates.json (in the
// raw dir) with where each goes, in canvas units of the 420 x 770 room, as rendered (items at their stage anchor).
// An item keeps its own shadow: outside its mask it is black, with the alpha of how much darker the empty room got there, so it multiplies over any
// wall or floor it is moved to. Every variant has its own colour pass and shares the first one's mask and shadow. Walls and floors are one render
// each, tinted per colour of the catalog; what is not the room (above the wall's cap, under the slab) is transparent: the app draws a backdrop there.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ITEMS, PX, SHELL } from './home-items.mjs';
const [raw, outRoot] = process.argv.slice(2);
const out = path.join(outRoot, 'home');
fs.mkdirSync(out, { recursive: true });
const ART = JSON.parse(fs.readFileSync('room-art.json', 'utf8'));
const firsts = JSON.parse(fs.readFileSync(path.join(raw, 'firsts.json'), 'utf8'));
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
/** Writes the pixels cropped to what shows; returns their box in canvas units: [x, y, w, h]. `at` is where the pixels' origin is, in frame pixels. */
async function write(pixels, w, h, file, at, quality = 86) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error(`nothing in ${file}`);
  const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).extract(box).webp({ quality, alphaQuality: 92, effort: 6 }).toFile(path.join(out, file));
  return [(at.x + x0) / PX, (at.y + y0) / PX, box.width / PX, box.height / PX].map((n) => +n.toFixed(2));
}
const fileOf = (n, v) => `${n.replaceAll('.', '-')}${v ? `@${v}` : ''}.webp`;
const cutout = (colour, m, w, h) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { px[i * 4] = colour.data[i * 3]; px[i * 4 + 1] = colour.data[i * 3 + 1]; px[i * 4 + 2] = colour.data[i * 3 + 2]; px[i * 4 + 3] = m[i]; } return px; };
const table = { items: {}, walls: {}, floors: {} };
const shellAt = { x: SHELL.x0 * PX, y: SHELL.y0 * PX };
const base = await rgb(calm('base.png'));
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const it of ITEMS) {
  if (only && !only.includes(it.id)) continue;
  const crop = JSON.parse(fs.readFileSync(png(`${it.id}.crop.json`), 'utf8')), { w, h } = crop;
  const m = await maskOf(`${it.id}.mask.png`, null);
  const partMasks = [];
  for (const p of it.parts ?? []) partMasks.push({ name: p, m: await maskOf(`${p}.mask.png`, null) });
  const coverMask = it.cover ? await maskOf(`${it.cover}.mask.png`, null) : null;
  // The shadow: how much darker the item made what is under it (the empty room, or the thing it stands on).
  const soft = async (s) => rgb(sharp(await s.png().toBuffer()).blur(2.2));
  const A = await soft(sharp(png(`${it.id}.png`)).removeAlpha().median(3));
  let under;
  if (it.on) under = await soft(sharp(png(`${it.id}.under.png`)).removeAlpha().median(3));
  else {
    // The empty room under the crop; where the crop goes past the room's own pictures, the item's own pass stands in (no shadow there).
    const px = Buffer.from(A.data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bx = crop.x + x - shellAt.x, by = crop.y + y - shellAt.y;
      if (bx >= 0 && by >= 0 && bx < base.w && by < base.h) for (let k = 0; k < 3; k++) px[(y * w + x) * 3 + k] = base.data[(by * base.w + bx) * 3 + k];
    }
    under = await soft(sharp(px, { raw: { width: w, height: h, channels: 3 } }));
  }
  const dark = Buffer.alloc(w * h), floorCut = 0.045;
  for (let i = 0; i < w * h; i++) {
    const la = A.data[i * 3] + A.data[i * 3 + 1] + A.data[i * 3 + 2], lb = under.data[i * 3] + under.data[i * 3 + 1] + under.data[i * 3 + 2];
    dark[i] = Math.max(0, Math.min(255, ((1 - la / Math.max(1, lb) - floorCut) / (1 - floorCut)) * 255));
  }
  if (it.glass) {
    const [ax, ay] = JSON.parse(fs.readFileSync(png('rect.json'), 'utf8')).stage[it.id];
    const [gx0, gy0, gx1, gy1] = it.glass.map((v, i) => Math.round((v + (i % 2 ? ay : ax)) * PX));
    for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) { const px = x - crop.x, py = y - crop.y; if (px >= 0 && py >= 0 && px < w && py < h) dark[py * w + px] = 0; }
  }
  const shadow = await sharp(await sharp(dark, { raw: { width: w, height: h, channels: 1 } }).blur(1.5).png().toBuffer()).extractChannel(0).raw().toBuffer();
  for (let i = 0; i < w * h; i++) if (shadow[i] < 6) shadow[i] = 0;
  // A shadow fades out before the crop's edges: the blur leaves a faint line there.
  const FADE = 18;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.min(x, y, w - 1 - x, h - 1 - y); if (d < FADE) shadow[y * w + x] = Math.round(shadow[y * w + x] * (d / FADE)); }
  const entry = (table.items[it.id] = { anchor: JSON.parse(fs.readFileSync(png('rect.json'), 'utf8')).stage[it.id], variants: {} });
  for (const v of ART.items[it.id].variants) {
    const file = v.id === firsts[it.id] ? `${it.id}.png` : `${it.id}@${v.id}.png`;
    if (!fs.existsSync(png(file))) { console.log('missing', file); continue; }
    const colour = await rgb(calm(file)), e = (entry.variants[v.id] = {});
    for (const pm of partMasks) (e.parts ??= {})[pm.name.split('.').pop()] = await write(cutout(colour, pm.m, w, h), w, h, fileOf(pm.name, v.id), crop);
    if (coverMask) e.cover = await write(cutout(colour, coverMask, w, h), w, h, fileOf(it.cover, v.id), crop);
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      let mm = m[i] / 255;
      for (const pm of partMasks) mm = Math.max(0, mm - pm.m[i] / 255);
      const s = (shadow[i] / 255) * (1 - m[i] / 255), a = mm + s;
      if (a <= 0) continue;
      const k = mm / a;
      px[i * 4] = colour.data[i * 3] * k; px[i * 4 + 1] = colour.data[i * 3 + 1] * k; px[i * 4 + 2] = colour.data[i * 3 + 2] * k; px[i * 4 + 3] = Math.min(255, a * 255);
    }
    e.box = await write(px, w, h, fileOf(it.id, v.id), crop);
  }
  console.log('cut', it.id, Object.keys(entry.variants).length);
}
if (!only || process.env.WALLS) {
  // Each wallpaper and floor was rendered in 3D with its own pattern (scene-home.js `wallid`, `floorid`). Lit, they come out a little darker
  // than the flat colours of the catalog: each is brought back to the 2D drawing's mean brightness (one factor, so the pattern and the
  // shading keep their own contrast). What is not the room stays transparent.
  const room = await maskOf('room3d.mask.png', null, 0.4), paint = await maskOf('paint.mask.png', null), floor = await maskOf('floor3d.mask.png', null);
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const toCanvas = (i, w) => [(i % w) / PX + SHELL.x0, Math.floor(i / w) / PX + SHELL.y0];
  for (const [id, sf] of Object.entries(ART.surfaces)) {
    const c = await rgb(calm(`${id}.png`)), wall = sf.kind === 'wall', mask = wall ? paint : floor;
    // The 2D drawing's mean over the part of the room seen in the app, against the render's over the same part.
    const flat = wall ? await rgb(sharp(`walltex/${id}.png`)) : null;
    const twoD = wall ? null : [...new Set(sf.svg.match(/#[0-9A-Fa-f]{6}/g))].filter((h) => !['#3B2618', '#FFFFFF'].includes(h.toUpperCase())).slice(0, 2).map(hex);
    let sr = 0, st = 0;
    for (let i = 0; i < c.w * c.h; i += 7) {
      if (mask[i] < 250) continue;
      const [cx, cy] = toCanvas(i, c.w);
      if (cx < 0 || cx > 420 || cy < (wall ? 170 : 445) || cy > (wall ? 350 : 770)) continue;
      sr += lum(c.data[i * 3], c.data[i * 3 + 1], c.data[i * 3 + 2]);
      if (wall) { const tx = Math.round((cx + 120) * 3), ty = Math.round((cy + 240) * 3), j = (ty * flat.w + tx) * 3; st += lum(flat.data[j], flat.data[j + 1], flat.data[j + 2]); }
      else st += (lum(...twoD[0]) + lum(...twoD[1])) / 2;
    }
    const f = Math.min(wall ? 1.3 : 1.5, Math.max(0.92, st / Math.max(1, sr)));
    const px = Buffer.alloc(c.w * c.h * 4);
    for (let i = 0; i < c.w * c.h; i++) {
      const a = wall ? paint[i] / 255 : 1, k = 1 - a + a * f;
      for (let ch = 0; ch < 3; ch++) px[i * 4 + ch] = Math.min(255, c.data[i * 3 + ch] * k);
      px[i * 4 + 3] = wall ? room[i] : floor[i];
    }
    (wall ? table.walls : table.floors)[id] = await write(px, c.w, c.h, `${id}.webp`, shellAt, 84);
    console.log('surface', id, f.toFixed(3));
  }
}
const prev = fs.existsSync(path.join(raw, 'plates.json')) ? JSON.parse(fs.readFileSync(path.join(raw, 'plates.json'), 'utf8')) : { items: {}, walls: {}, floors: {} };
const merged = { items: { ...prev.items, ...table.items }, walls: { ...prev.walls, ...table.walls }, floors: { ...prev.floors, ...table.floors } };
fs.writeFileSync(path.join(raw, 'plates.json'), JSON.stringify(merged));
let bytes = 0;
for (const f of fs.readdirSync(out)) bytes += fs.statSync(path.join(out, f)).size;
console.log(Math.round(bytes / 1024), 'KB in', fs.readdirSync(out).length, 'files');
