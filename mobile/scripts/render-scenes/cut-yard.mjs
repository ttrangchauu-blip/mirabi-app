// Cuts the home garden: the land, what sways over it, the plots, each plant's stages and the clouds. node cut-yard.mjs <raw folder>/yard <the app's assets/world folder>
// Prints the boxes of what sways for `src/screens/garden/gardenArt.ts`. The plants' raws are only needed when they change: without them they stay as they are.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'yard');
fs.mkdirSync(dir, { recursive: true });
const file = (n) => path.join(raw, `${n}.png`);
const calm = (n) => sharp(file(n)).removeAlpha().median(3).png().toBuffer();
const webp = (s, n, q = 84) => s.webp({ quality: q, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${n}.webp`));
const alphaOf = async (maskName, w, h) => sharp(file(maskName)).removeAlpha().extractChannel(0).resize(w, h, { kernel: 'lanczos3' }).blur(0.5).png().toBuffer();
const rawGrey = async (buffer) => sharp(buffer).extractChannel(0).raw().toBuffer();

// What sways is cut out of the whole picture. The land under it comes from a pass without it, and everywhere else from the whole picture, so the land keeps
// the shadows of what stands on it, and nothing is left behind when a tree moves.
const W = 1000, H = 1500;
const SWAYING = ['treeL', 'treeR', 'blossom', 'flowersL', 'flowersR'];
const masks = {};
for (const name of SWAYING) masks[name] = await alphaOf(`${name}.mask`, W, H);
const under = Buffer.alloc(W * H);
for (const name of SWAYING) { const g = await rawGrey(masks[name]); for (let i = 0; i < g.length; i++) under[i] = Math.max(under[i], g[i]); }
const grown = await sharp(under, { raw: { width: W, height: H, channels: 1 } }).blur(2.2).extractChannel(0).raw().toBuffer();
for (let i = 0; i < grown.length; i++) grown[i] = Math.min(255, grown[i] * 5);
const landAlpha = await alphaOf('yard.mask', W, H);
for (const light of ['day', 'night']) {
  const whole = await sharp(await calm(`yard-${light}`)).raw().toBuffer();
  const still = await sharp(await calm(`yard-still-${light}`)).raw().toBuffer();
  const mixed = Buffer.alloc(whole.length);
  for (let i = 0; i < W * H; i++) { const k = grown[i] / 255; for (let c = 0; c < 3; c++) mixed[i * 3 + c] = whole[i * 3 + c] * (1 - k) + still[i * 3 + c] * k; }
  const rgb = await sharp(mixed, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  await webp(sharp(rgb).joinChannel(landAlpha), `land-${light}`, 82);
}
const boxes = {};
for (const name of SWAYING) {
  const g = await rawGrey(masks[name]);
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const left = Math.max(0, x0 - 3), top = Math.max(0, y0 - 3), width = Math.min(W, x1 + 4) - left, height = Math.min(H, y1 + 4) - top;
  boxes[name] = { x: +(left / W).toFixed(4), y: +(top / H).toFixed(4), w: +(width / W).toFixed(4), h: +(height / H).toFixed(4), px: [width, height] };
  for (const light of ['day', 'night']) {
    const whole = await sharp(await calm(`yard-${light}`)).joinChannel(masks[name]).png().toBuffer();
    await webp(sharp(whole).extract({ left, top, width, height }), `${name}-${light}`);
  }
}
console.log('sways', JSON.stringify(boxes));

for (const b of ['dry', 'wet']) for (const light of ['day', 'night']) await webp(sharp(await calm(`bed-${b}-${light}`)).joinChannel(await alphaOf(`bed-${b}.mask`, 640, 320)), `bed-${b}-${light}`);
{
  const alpha = await alphaOf('clouds.mask', 1440, 480);
  const sizes = {};
  for (const light of ['day', 'night']) {
    const whole = await sharp(await calm(`clouds-${light}`)).joinChannel(alpha).png().toBuffer();
    for (let s = 0; s < 3; s++) {
      const piece = await sharp(whole).extract({ left: s * 480, top: 0, width: 480, height: 480 }).png().toBuffer();
      const trimmed = await sharp(piece).trim({ threshold: 0 }).png().toBuffer({ resolveWithObject: true });
      sizes[s] = [trimmed.info.width, trimmed.info.height];
      await webp(sharp(trimmed.data), `cloud-${s}-${light}`);
    }
  }
  console.log('clouds', JSON.stringify(sizes));
}
for (const plant of ['daisy', 'sunflower', 'tulip', 'lavender', 'succulent', 'strawberry', 'seedling']) {
  if (!fs.existsSync(file(`${plant}.mask`))) continue;
  const alpha = await alphaOf(`${plant}.mask`, 900, 420);
  for (const light of ['day', 'night']) {
    const whole = await sharp(await calm(`${plant}-${light}`)).joinChannel(alpha).png().toBuffer();
    for (let s = 0; s < 3; s++) await webp(sharp(whole).extract({ left: s * 300, top: 0, width: 300, height: 420 }), `${plant}-${s}-${light}`);
  }
}
let sum = 0;
for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
console.log('yard', fs.readdirSync(dir).length, 'files', Math.round(sum / 1024), 'KB');
