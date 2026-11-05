// Cuts Vườn tài chính's pictures. node cut-grove.mjs <raw folder>/grove <the app's assets/world folder>
// A plant comes in two pictures of the same box. `plants/`: the plant alone, which sways. `ground/`: its ring of stones and the shadow it casts on the ring and the lawn, which stays.
// The ground is what differs from the empty lawn, with a soft edge, so it lies on the app's lawn without a seam. Under the plant it comes from the pass without plants.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'money');
for (const d of ['', 'plants', 'ground']) fs.mkdirSync(path.join(dir, d), { recursive: true });
const file = (n) => path.join(raw, `${n}.png`);
const calm = (n) => sharp(file(n)).removeAlpha().median(3).png().toBuffer();
const webp = (s, n, q = 84) => s.webp({ quality: q, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${n}.webp`));
const maskOf = (n, w, h) => sharp(file(`${n}.mask`)).removeAlpha().extractChannel(0).resize(w, h, { kernel: 'lanczos3' }).blur(0.5).png().toBuffer();
const withMask = async (n, m, w, h) => sharp(await calm(n)).joinChannel(await maskOf(m, w, h)).png().toBuffer();
const grey = async (buffer) => sharp(buffer).extractChannel(0).raw().toBuffer();
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The valley. What lies below 80% of its height is always under the lawn.
for (const light of ['day', 'night']) {
  await webp(sharp(await withMask(`vale-${light}`, 'vale', 1400, 700)).extract({ left: 0, top: 0, width: 1400, height: 560 }), `vale-${light}`, 82);
  // The lawn repeats sideways; its top fades into the valley.
  const W = 1180, H = 528, alpha = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = (x / W) * Math.PI * 2, edge = 0.09 + 0.035 * Math.sin(a * 2 + 0.6) + 0.022 * Math.sin(a * 5 + 2.1) + 0.012 * Math.sin(a * 11 + 4);
    alpha[y * W + x] = Math.round(255 * smooth(edge, edge + 0.2, y / H));
  }
  const a = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  const flat = await sharp(file(`meadow-${light}`)).removeAlpha().png().toBuffer();
  const wrapped = await sharp({ create: { width: W * 3, height: H, channels: 3, background: '#000' } }).composite([0, 1, 2].map((i) => ({ input: flat, left: i * W, top: 0 }))).png().toBuffer();
  const calmed = await sharp(wrapped).median(3).extract({ left: W, top: 0, width: W, height: H }).png().toBuffer();
  await webp(sharp(calmed).joinChannel(a), `meadow-${light}`, 80);
  await webp(sharp(await withMask(`sails-${light}`, 'sails', 360, 360)), `sails-${light}`, 86);
  await webp(sharp(await withMask(`sign-${light}`, 'sign', 700, 460)), `sign-${light}`, 86);
  const bloom = await withMask(`bloom-${light}`, 'bloom', 1200, 420);
  for (const [name, left] of [['bloom-l', 0], ['bloom-r', 600]]) await webp(sharp(await sharp(bloom).extract({ left, top: 0, width: 600, height: 420 }).png().toBuffer()), `${name}-${light}`, 84);
}
{
  const icons = await withMask('icons', 'icons', 1600, 200);
  const names = ['target', 'piggy', 'coins', 'flower-on', 'flower-off', 'fly-0', 'fly-1', 'fly-2'];
  for (let i = 0; i < names.length; i++) await webp(sharp(await sharp(icons).extract({ left: i * 200, top: 0, width: 200, height: 200 }).png().toBuffer()), `icon-${names[i]}`, 88);
}

// The plants.
const W = 4032, H = 600, CELL = 672, TOP = 280, PLANTS = ['sakura', 'oak', 'sunflower', 'bamboo', 'maple', 'lotus'];
const rawOf = async (n) => (await sharp(await calm(n)).raw().toBuffer({ resolveWithObject: true })).data;
for (const light of ['day', 'night']) {
const tail = light === 'day' ? '' : '-night', Q = light === 'day' ? 84 : 76, Qg = light === 'day' ? 80 : 72, CUT = light === 'day' ? 14 : 9;
const none = await rawOf('none' + tail);
const softNone = await sharp(none, { raw: { width: W, height: H, channels: 3 } }).blur(1.6).raw().toBuffer();
const rings = { soil: await rawOf('soil' + tail), water: await rawOf('water' + tail) };

/** Colours to alpha: what differs from the empty lawn, grown and softened, and fading out at the edge of its cell. */
const groundAlpha = async (rgb) => {
  const soft = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).blur(1.6).raw().toBuffer();
  const diff = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) { const k = i * 3; const d = Math.abs(soft[k] - softNone[k]) + Math.abs(soft[k + 1] - softNone[k + 1]) + Math.abs(soft[k + 2] - softNone[k + 2]); diff[i] = d > CUT ? 255 : 0; }
  const png = await sharp(diff, { raw: { width: W, height: H, channels: 1 } }).blur(4).linear(4, 0).blur(3).extractChannel(0).raw().toBuffer();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = x % CELL, edge = Math.min(smooth(0, 40, c), smooth(0, 60, CELL - 1 - c), smooth(TOP, TOP + 40, y), smooth(0, 12, H - 1 - y));
    png[y * W + x] = png[y * W + x] * edge;
  }
  return sharp(png, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
};
const saveGround = async (rgb, alpha, cellIndex, name) => {
  const whole = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const joined = await sharp(whole).joinChannel(alpha).png().toBuffer();
  await webp(sharp(await sharp(joined).extract({ left: cellIndex * CELL, top: TOP, width: CELL, height: H - TOP }).png().toBuffer()), name, Qg);
};
// The empty plot, for a goal not yet sown.
await saveGround(rings.soil, await groundAlpha(rings.soil), 0, 'ground/plot' + tail);
for (const plant of PLANTS) {
  if (!fs.existsSync(file(plant + tail))) { console.log('no raw for', plant + tail); continue; }
  const colour = await rawOf(plant + tail);
  const maskBuf = await maskOf(plant, W, H);
  const m = await grey(maskBuf);
  const grown = await sharp(m, { raw: { width: W, height: H, channels: 1 } }).blur(2.2).extractChannel(0).raw().toBuffer();
  const ring = rings[plant === 'lotus' ? 'water' : 'soil'];
  const mixed = Buffer.alloc(colour.length);
  for (let i = 0; i < W * H; i++) { const k = Math.min(1, (grown[i] / 255) * 5); for (let c = 0; c < 3; c++) mixed[i * 3 + c] = colour[i * 3 + c] * (1 - k) + ring[i * 3 + c] * k; }
  const alpha = await groundAlpha(mixed);
  const cut = await sharp(await sharp(colour, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).joinChannel(maskBuf).png().toBuffer();
  for (let s = 0; s < 6; s++) {
    await webp(sharp(await sharp(cut).extract({ left: s * CELL, top: 0, width: CELL, height: H }).png().toBuffer()), `plants/${plant}-${s}${tail}`, Q);
    await saveGround(mixed, alpha, s, `ground/${plant}-${s}${tail}`);
  }
  console.log('cut', plant + tail);
}
}
let sum = 0, n = 0;
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { sum += fs.statSync(p).size; n++; } } };
walk(dir);
console.log('money', n, 'files', Math.round(sum / 1024), 'KB');
