// Cuts Khám phá's valley into its layers. node cut-wild.mjs <raw folder>/wild <the app's assets/world folder> [day|night ...]
// Prints the boxes and the road for `src/screens/life/exploreArt.ts`, as shares of the whole picture.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out, ...which] = process.argv.slice(2);
const lights = which.length ? which : ['day', 'night'];
const dir = path.join(out, 'wild');
fs.mkdirSync(dir, { recursive: true });
const FW = 3080, FH = 1400, COL = FW / 4;
const MID = { top: 70, height: 630 }, LAND = { top: 392, height: 1008 }, NEAR = { top: 980, height: 420 };
// The road's band and the meadow in front of it are one render, cut in two along a soft wavy line: the meadow in front slides faster. Nothing but grass lies on that line.
const BAND_END = 830, FRONT_TOP = 700; // The band goes on below the lowest row where the meadow is still see-through.
const edgeRow = (u) => 0.53 + 0.012 * Math.sin(Math.PI * 2 * 3 * u) + 0.006 * Math.sin(Math.PI * 2 * 7 * u + 1);
const FEATHER = 0.024;
const file = (n) => path.join(raw, `${n}.png`);
const webp = (s, n, q = 80) => s.webp({ quality: q, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${n}.webp`));
const grey = async (s) => s.extractChannel(0).raw().toBuffer();
/** The mask of a layer, in the picture's own pixels, its edge taken in by a pixel: the pale sky mixed into the edge would draw a line round everything. */
const maskOf = async (name, top, height, take = true) => {
  let s = sharp(file(`${name}.mask`)).removeAlpha().extractChannel(0).extract({ left: 0, top, width: FW, height }).blur(0.6);
  if (take) s = s.linear(2.4, -1.4 * 255);
  return s.extractChannel(0).png().toBuffer();
};
const joined = async (name, height) => {
  const tiles = [0, 1, 2, 3].map((i) => ({ input: file(`${name}-${i}`), left: i * COL, top: 0 }));
  const j = await sharp({ create: { width: FW, height, channels: 3, background: '#000' } }).composite(tiles).removeAlpha().png().toBuffer();
  return sharp(j).median(3).removeAlpha().png().toBuffer();
};
const EDGE = 170;
const firsts = {};
const meetFirst = async (key, png) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const first = firsts[key];
  if (!first) { firsts[key] = data; return png; }
  const { width, height, channels } = info;
  for (let y = 0; y < height; y++) for (let i = 0; i < EDGE; i++) {
    const t = (i + 0.5) / EDGE, keep = t * t * (3 - 2 * t);
    for (const x of [i, width - 1 - i]) for (let c = 0; c < channels; c++) { const at = (y * width + x) * channels + c; data[at] = first[at] * (1 - keep) + data[at] * keep; }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
};
// The stones on the line between the road's band and the meadow in front, as they stand in scene-wild's render: a stone cut there would come apart when the two slide.
// Each goes whole to one of them. One that ends inside the band stays in the band; one that goes on below it moves to the meadow, and the band gets grass in its place from another stretch.
const STONES = [
  { seg: 0, x: 430, y: 734, rx: 76, ry: 46, to: 'band' },
  { seg: 0, x: 1292, y: 700, rx: 54, ry: 36, to: 'band' },
  { seg: 0, x: 2248, y: 771, rx: 88, ry: 56, to: 'front', grass: 2 },
  { seg: 1, x: 2694, y: 723, rx: 86, ry: 48, to: 'band' },
  { seg: 2, x: 800, y: 773, rx: 86, ry: 58, to: 'front', grass: 0 },
  { seg: 2, x: 2588, y: 756, rx: 80, ry: 54, to: 'front', grass: 0 },
];
const stoneCover = (stone) => {
  const cover = Buffer.alloc(FW * LAND.height), edge = 12;
  for (let y = stone.y - stone.ry - edge; y <= stone.y + stone.ry + edge; y++) for (let x = stone.x - stone.rx - edge; x <= stone.x + stone.rx + edge; x++) {
    const far = Math.hypot((x - stone.x) / stone.rx, (y - stone.y) / stone.ry), t = Math.max(0, Math.min(1, (1 + edge / stone.ry - far) / (edge / stone.ry)));
    cover[(y - LAND.top) * FW + x] = 255 * t * t * (3 - 2 * t);
  }
  return cover;
};
const boxes = {};
const share = (x, y, w, h) => ({ x: +(x / FW).toFixed(4), y: +(y / FH).toFixed(4), w: +(w / FW).toFixed(4), h: +(h / FH).toFixed(4) });

for (const light of lights) {
  // Far: soft and small on the screen, half the pixels.
  const farRows = 238;
  const farColor = await sharp(file(`far-${light}`)).removeAlpha().median(3).extract({ left: 0, top: 0, width: 1540, height: farRows }).png().toBuffer();
  const farMaskWhole = await sharp(file('far.mask')).removeAlpha().extractChannel(0).resize(1540, 700, { kernel: 'lanczos3' }).png().toBuffer();
  const farMask = await sharp(farMaskWhole).extract({ left: 0, top: 0, width: 1540, height: farRows }).blur(0.6).linear(2.4, -1.4 * 255).extractChannel(0).png().toBuffer();
  await webp(sharp(farColor).joinChannel(farMask), `far-${light}`, 78);
  boxes.far = share(0, 0, FW, farRows * 2);

  for (const h of [0, 1]) {
    // What sways is cut out of the whole picture; under it, the pass without it. The whole picture stays everywhere else, so the ground keeps their shadows.
    const whole = await joined(`mid${h}-${light}`, MID.height);
    const still = await joined(`midstill${h}-${light}`, MID.height);
    const treeMasks = {};
    const trees = ['t1', 't2', 't3'];
    for (const t of trees) treeMasks[t] = await maskOf(`h${h}${t}`, MID.top, MID.height, false);
    const under = Buffer.alloc(FW * MID.height);
    for (const t of trees) { const g = await grey(sharp(treeMasks[t])); for (let i = 0; i < g.length; i++) under[i] = Math.max(under[i], g[i]); }
    const grown = await sharp(under, { raw: { width: FW, height: MID.height, channels: 1 } }).blur(2.4).extractChannel(0).raw().toBuffer();
    const a = await sharp(whole).raw().toBuffer(), b = await sharp(still).raw().toBuffer(), mixed = Buffer.alloc(a.length);
    for (let i = 0; i < FW * MID.height; i++) { const k = Math.min(255, grown[i] * 5) / 255; for (let c = 0; c < 3; c++) mixed[i * 3 + c] = a[i * 3 + c] * (1 - k) + b[i * 3 + c] * k; }
    const color = await meetFirst(`mid-${light}`, await sharp(mixed, { raw: { width: FW, height: MID.height, channels: 3 } }).png().toBuffer());
    await webp(sharp(color).joinChannel(await meetFirst(`mid-${light}-mask`, await maskOf(`mid${h}`, MID.top, MID.height))), `mid${h}-${light}`, 78);
    boxes.mid = share(0, MID.top, FW, MID.height);
    for (const t of trees) {
      const g = await grey(sharp(treeMasks[t]));
      let x0 = FW, x1 = 0, y0 = MID.height, y1 = 0;
      for (let y = 0; y < MID.height; y++) for (let x = 0; x < FW; x++) if (g[y * FW + x] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const left = Math.max(0, x0 - 3), top = Math.max(0, y0 - 3), width = Math.min(FW, x1 + 4) - left, height = Math.min(MID.height, y1 + 4) - top;
      const cut = await sharp(whole).joinChannel(treeMasks[t]).png().toBuffer();
      await webp(sharp(cut).extract({ left, top, width, height }), `h${h}${t}-${light}`, 82);
      boxes[`h${h}${t}`] = share(left, top + MID.top, width, height);
    }
  }

  for (const s of [0, 1, 2]) {
    const color = await meetFirst(`land-${light}`, await joined(`land${s}-${light}`, LAND.height));
    const alpha = await meetFirst(`land-${light}-mask`, await maskOf(`land${s}`, LAND.top, LAND.height));
    const landRaw = await sharp(color).removeAlpha().raw().toBuffer();
    const remove = Buffer.alloc(FW * LAND.height), keep = Buffer.alloc(FW * LAND.height);
    for (const stone of STONES.filter((one) => one.seg === s)) {
      const cover = stoneCover(stone);
      if (stone.to === 'band') { for (let i = 0; i < cover.length; i++) remove[i] = Math.max(remove[i], cover[i]); continue; }
      const grass = await sharp(await joined(`land${stone.grass}-${light}`, LAND.height)).removeAlpha().raw().toBuffer();
      for (let i = 0; i < cover.length; i++) { if (!cover[i]) continue; keep[i] = Math.max(keep[i], cover[i]); const k = cover[i] / 255; for (let c = 0; c < 3; c++) landRaw[i * 3 + c] = landRaw[i * 3 + c] * (1 - k) + grass[i * 3 + c] * k; }
    }
    const patched = await sharp(landRaw, { raw: { width: FW, height: LAND.height, channels: 3 } }).png().toBuffer();
    // The band with the road: from the swell down to under the line where the front begins.
    const bandH = BAND_END - LAND.top;
    const bandAlpha = await sharp(alpha).extract({ left: 0, top: 0, width: FW, height: bandH }).extractChannel(0).png().toBuffer();
    const bandColor = await sharp(patched).extract({ left: 0, top: 0, width: FW, height: bandH }).png().toBuffer();
    await webp(sharp(bandColor).joinChannel(bandAlpha), `land${s}-${light}`, 80);
    boxes.land = share(0, LAND.top, FW, bandH);
    // The meadow in front: everything under the wavy line, its top edge soft.
    const frontH = FH - FRONT_TOP, skip = FRONT_TOP - LAND.top;
    const frontA = Buffer.alloc(FW * frontH);
    for (let y = 0; y < frontH; y++) for (let x = 0; x < FW; x++) { const row = (y + FRONT_TOP) / FH, t = Math.max(0, Math.min(1, (row - edgeRow(x / FW)) / FEATHER)); frontA[y * FW + x] = 255 * t * t * (3 - 2 * t); }
    const frontColor = await sharp(color).extract({ left: 0, top: skip, width: FW, height: frontH }).png().toBuffer();
    for (let i = 0; i < frontA.length; i++) { const at = i + skip * FW, from = remove[at] / 255, to = keep[at]; frontA[i] = Math.max(frontA[i] * (1 - from), to); }
    const frontAlpha = await sharp(frontA, { raw: { width: FW, height: frontH, channels: 1 } }).png().toBuffer();
    await webp(sharp(frontColor).joinChannel(frontAlpha), `front${s}-${light}`, 80);
    boxes.front = share(0, FRONT_TOP, FW, frontH);
  }

  for (const f of [0, 1]) {
    // Near: blurred a little, as what is close to a camera focused on the pet. Two steps: in one pipeline sharp resizes before it joins the channel.
    const sharpMask = await maskOf(`near${f}`, NEAR.top, NEAR.height);
    const raw = await sharp(await joined(`near${f}-${light}`, NEAR.height)).raw().toBuffer(), cover = await grey(sharp(sharpMask).blur(1.6).threshold(238));
    const mean = [0, 0, 0]; let count = 0;
    for (let i = 0; i < cover.length; i++) if (cover[i] > 200 && raw[i * 3 + 1] > raw[i * 3] && raw[i * 3 + 1] > raw[i * 3 + 2]) { count++; for (let c = 0; c < 3; c++) mean[c] += raw[i * 3 + c]; }
    for (let i = 0; i < cover.length; i++) { const k = cover[i] / 255; for (let c = 0; c < 3; c++) raw[i * 3 + c] = raw[i * 3 + c] * k + (mean[c] / Math.max(1, count)) * (1 - k); }
    const color = await meetFirst(`near-${light}`, await sharp(await sharp(raw, { raw: { width: FW, height: NEAR.height, channels: 3 } }).png().toBuffer()).blur(1.5).png().toBuffer());
    const soft = await grey(sharp(sharpMask).blur(1.5).linear(1.5, -0.12 * 255));
    const FOOT = 70;
    for (let x = 0; x < FW; x++) { let run = 0; for (let y = NEAR.height - 1; y >= 0; y--) { const at = y * FW + x; const green = raw[at * 3 + 1] > raw[at * 3] + 10 && raw[at * 3 + 1] > raw[at * 3 + 2] + 10; run = soft[at] <= 10 ? 0 : green ? run + 1 : FOOT; const t = Math.min(1, run / FOOT); soft[at] *= t * t * (3 - 2 * t); } }
    const alpha = await meetFirst(`near-${light}-mask`, await sharp(await sharp(soft, { raw: { width: FW, height: NEAR.height, channels: 1 } }).blur(1).extractChannel(0).png().toBuffer()).extractChannel(0).png().toBuffer());
    const whole = await sharp(color).joinChannel(alpha).png().toBuffer();
    const small = await sharp(whole).resize(Math.round(FW * 0.6), Math.round(NEAR.height * 0.6), { kernel: 'lanczos3' }).png().toBuffer();
    await webp(sharp(small), `near${f}-${light}`, 80);
    boxes.near = share(0, NEAR.top, FW, NEAR.height);
  }
}
console.log('boxes', JSON.stringify(boxes));
const roads = [0, 1, 2].map((s) => { const m = fs.readFileSync(path.join(raw, `road${s}.txt`), 'utf8').match(/\{.*\}/); return JSON.parse(m[0]).road; });
console.log('roads', JSON.stringify(roads));
let sum = 0; for (const f of fs.readdirSync(dir)) { sum += fs.statSync(path.join(dir, f)).size; }
console.log('wild', fs.readdirSync(dir).length, 'files', Math.round(sum / 1024), 'KB');
