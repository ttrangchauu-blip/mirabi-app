// Cuts the friends' street: the land without houses (its sky cut away), and a patch of the picture for each house, which keeps
// the house's shadow on its own ground. A patch is what differs from the empty street, with a soft edge, so it can't show a seam.
// node cut-street.mjs <raw folder> <the app's assets/world folder>   Prints where each patch goes, for STREET in FriendsSpace.tsx.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'street');
fs.mkdirSync(dir, { recursive: true });
const LOTS = 6, W = 1600, H = 550;
const calm = (name) => sharp(path.join(raw, `${name}.png`)).removeAlpha().median(3);
const pixels = async (s) => (await s.raw().toBuffer({ resolveWithObject: true })).data;
const webp = (s, name, quality = 84) => s.webp({ quality, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, name));

const mask = await sharp(path.join(raw, 'street.mask.png')).removeAlpha().greyscale().resize(W, H).blur(0.6).toBuffer();
const table = {};
for (const light of ['day', 'night']) {
  const base = await calm(`street-none-${light}`).png().toBuffer();
  await webp(sharp(base).joinChannel(mask), `land-${light}.webp`);
  const soft = await pixels(sharp(base).blur(1.6));
  const passes = { even: await calm(`street-even-${light}`).png().toBuffer(), odd: await calm(`street-odd-${light}`).png().toBuffer() };
  const softPass = { even: await pixels(sharp(passes.even).blur(1.6)), odd: await pixels(sharp(passes.odd).blur(1.6)) };
  table[light] = [];
  for (let i = 0; i < LOTS; i++) {
    const pass = i % 2 ? 'odd' : 'even', other = softPass[pass];
    // Only this plot's columns, and more to the right, where its shadow falls: a patch must never lay empty ground over the house
    // on its left, which is drawn before it.
    const lot = W / LOTS * (11 / 11.5), mid = W / 2 + (i - (LOTS - 1) / 2) * lot;
    const x0 = Math.max(0, Math.round(mid - lot * 0.56)), x1 = Math.min(W, Math.round(mid + lot * 0.8));
    const diff = Buffer.alloc(W * H);
    let top = H, bottom = 0, left = W, right = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
      const k = (y * W + x) * 3, d = Math.abs(other[k] - soft[k]) + Math.abs(other[k + 1] - soft[k + 1]) + Math.abs(other[k + 2] - soft[k + 2]);
      if (d > (light === 'day' ? 15 : 12)) { diff[y * W + x] = 255; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
    }
    const pad = 16;
    const box = { left: Math.max(x0, left - pad), top: Math.max(0, top - pad), width: 0, height: 0 };
    box.width = Math.min(W, right + pad) - box.left; box.height = Math.min(H, bottom + pad) - box.top;
    // Grow what changed and soften its edge.
    const grown = await sharp(diff, { raw: { width: W, height: H, channels: 1 } }).blur(5).linear(5, 0).blur(3.5).extractChannel(0).raw().toBuffer();
    // The soft edge may not reach past the left of the plot either.
    for (let y = 0; y < H; y++) for (let x = 0; x < x0; x++) grown[y * W + x] = 0;
    const alpha = await sharp(grown, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
    const whole = await sharp(passes[pass]).joinChannel(alpha).png().toBuffer(); // Two steps: sharp would extract before it joins.
    const cut = await sharp(whole).extract(box).png().toBuffer();
    await webp(sharp(cut), `house-${i}-${light}.webp`);
    table[light].push([box.left / W, box.top / H, box.width / W, box.height / H].map((n) => +n.toFixed(4)));
  }
}
console.log(JSON.stringify(table));
for (const f of fs.readdirSync(dir)) console.log(f, Math.round(fs.statSync(path.join(dir, f)).size / 1024), 'KB');
