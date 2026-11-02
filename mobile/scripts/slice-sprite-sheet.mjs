// Turns a pet's sprite sheet (walk, study, idle, ...: frames in a grid on a transparent background) into the sheet
// PetArt plays: the same COLS x ROWS grid of square CELL px frames, read left to right then top to bottom, every frame
// cropped to the same box so the pet stays put, feet on the bottom edge. `steady` (0 to 1) also pulls each frame's
// horizontal centre that far toward the frames' average, for a sheet whose pet drifts side to side between frames.
// Nothing of a pose is cut: frames that touch are parted where they join and along winding seams, and a pose the picture's own edge cut
// off is mended from a matching frame. The result is cleaned of background haze and lightly sharpened (polish-pet-art).
// Usage: node scripts/slice-sprite-sheet.mjs <sheet.png> <out.png> [cols=8] [rows=1] [cell=256] [steady=0]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dehaze, sharpen } from './polish-pet-art.mjs';
const { PNG } = createRequire(import.meta.url)('pngjs');

const [input, output, colsArg, rowsArg, cellArg, steadyArg] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/slice-sprite-sheet.mjs <sheet.png> <out.png> [cols=8] [rows=1] [cell=256] [steady=0]'); process.exit(1); }
const COLS = Number(colsArg) || 8;
const ROWS = Number(rowsArg) || 1;
const CELL = Number(cellArg) || 256;
const STEADY = Math.max(0, Math.min(1, Number(steadyArg) || 0));
const FRAMES = COLS * ROWS;
const src = PNG.sync.read(fs.readFileSync(input));
// Haze off first, so neither the crop box nor the seams make room for it.
dehaze(src.data);
// The grid follows the picture as drawn; mending below only grows the canvas.
const pitchX = src.width / COLS;
const pitchY = src.height / ROWS;

// A pose drawn against the picture's right or bottom edge (the last column or row of frames) has lost what lay beyond
// it: a cheek, an ear tip, a book corner, feet. Borrow it from the frame that best matches the band along the edge
// (any frame off that edge, searched over small shifts), copying each cut line onward until that frame's own outline
// fades out or another pose begins. A small shape on an edge is a sliver of some further pose the picture cut off, not
// the pet: dropped. The canvas grows by MEND px right and down to hold what is mended.
const MEND = 64;
function mendEdges({ width: W0, height: H0, data: d0 }) {
  const at = (x, y) => (y * W0 + x) * 4;
  // Lines where a pet runs into an edge: rows on the right edge, columns on the bottom one.
  const cutRight = new Set(), cutBottom = new Set();
  const widen = (lines, line, length, alphaOn) => {
    for (let d = -3; d <= 3; d++) if (line + d >= 0 && line + d < length && alphaOn(line + d) > 0) lines.add(line + d);
  };
  const seen = new Uint8Array(W0 * H0);
  const onEdge = [];
  for (let y = 0; y < H0; y++) onEdge.push(y * W0 + W0 - 1);
  for (let x = 0; x < W0; x++) onEdge.push((H0 - 1) * W0 + x);
  for (const start of onEdge) {
    if (seen[start] || d0[start * 4 + 3] <= 24) continue;
    const blob = [start]; seen[start] = 1;
    for (let i = 0; i < blob.length; i++) {
      const x = blob[i] % W0, y = (blob[i] / W0) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, n = ny * W0 + nx;
        if (nx < 0 || ny < 0 || nx >= W0 || ny >= H0 || seen[n] || d0[n * 4 + 3] <= 24) continue;
        seen[n] = 1; blob.push(n);
      }
    }
    if (blob.length < pitchX * pitchY * 0.1) { for (const p of blob) d0.fill(0, p * 4, p * 4 + 4); continue; }
    for (const p of blob) {
      const x = p % W0, y = (p / W0) | 0;
      if (x === W0 - 1) widen(cutRight, y, H0, (v) => d0[at(W0 - 1, v) + 3]);
      if (y === H0 - 1) widen(cutBottom, x, W0, (v) => d0[at(v, H0 - 1) + 3]);
    }
  }
  const W = W0 + MEND, H = H0 + MEND, data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H0; y++) d0.copy(data, y * W * 4, y * W0 * 4, (y + 1) * W0 * 4);
  let mended = 0;
  if (!cutRight.size && !cutBottom.size) return { W, H, data, mended };

  // Which frame each visible pixel belongs to: the one whose centre reaches it first moving through visible pixels
  // only, so a foot touching an ear of the pose below still belongs to its own body.
  const frameOf0 = new Int8Array(W0 * H0).fill(-1);
  const queue = [];
  for (let f = 0; f < FRAMES; f++) {
    const cx = ((f % COLS) + 0.5) * pitchX, cy = (Math.floor(f / COLS) + 0.5) * pitchY;
    for (let y = Math.round(cy - pitchY * 0.15); y < cy + pitchY * 0.15; y++) for (let x = Math.round(cx - pitchX * 0.15); x < cx + pitchX * 0.15; x++) {
      const p = y * W0 + x;
      if (d0[p * 4 + 3] > 200 && frameOf0[p] < 0) { frameOf0[p] = f; queue.push(p); }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], x = p % W0, y = (p / W0) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, n = ny * W0 + nx;
      if (nx < 0 || ny < 0 || nx >= W0 || ny >= H0 || frameOf0[n] >= 0 || d0[n * 4 + 3] <= 24) continue;
      frameOf0[n] = frameOf0[p]; queue.push(n);
    }
  }

  // Both edges in one frame of reference: `u` runs across the edge (toward it), `v` along it.
  const edges = [
    { lines: cutRight, U: W0, V: H0, pitchU: pitchX, pitchV: pitchY, nU: COLS, nV: ROWS, xy: (u, v) => [u, v] },
    { lines: cutBottom, U: H0, V: W0, pitchU: pitchY, pitchV: pitchX, nU: ROWS, nV: COLS, xy: (u, v) => [v, u] },
  ];
  for (const { lines, U, V, pitchU, pitchV, nU, nV, xy } of edges) {
    const byFrame = new Map();
    for (const v of lines) {
      const f = Math.min(nV - 1, Math.floor(v / pitchV));
      if (!byFrame.has(f)) byFrame.set(f, []);
      byFrame.get(f).push(v);
    }
    for (const [fv, vs] of byFrame) {
      vs.sort((a, b) => a - b);
      const vLo = Math.max(0, vs[0] - 30), vHi = Math.min(V - 1, vs[vs.length - 1] + 30);
      // How unlike the band along the edge is to the same band shifted onto another frame.
      const costOf = (gu, gv, du, dv, step, limit) => {
        const ou = Math.round((nU - 1 - gu) * pitchU) + du, ov = Math.round((fv - gv) * pitchV) + dv;
        let cost = 0;
        for (let v = vLo; v <= vHi && cost < limit; v += step) for (let u = U - 70; u < U; u += step) {
          const i = at(...xy(u, v)), su = u - ou, sv = v - ov;
          if (su < 0 || sv < 0 || sv >= V) { cost += d0[i + 3] * 4; continue; }
          const j = at(...xy(su, sv)), a = d0[i + 3] / 255, b = d0[j + 3] / 255;
          cost += Math.abs(d0[i] * a - d0[j] * b) + Math.abs(d0[i + 1] * a - d0[j + 1] * b) + Math.abs(d0[i + 2] * a - d0[j + 2] * b) + Math.abs(d0[i + 3] - d0[j + 3]);
        }
        return { cost, ou, ov, gu, gv, du, dv };
      };
      // Coarse search over every frame off this edge, then a fine one around the best shift.
      let best = { cost: Infinity };
      for (let gu = 0; gu < nU - 1; gu++) for (let gv = 0; gv < nV; gv++) for (let dv = -16; dv <= 16; dv += 2) for (let du = -16; du <= 16; du += 2) {
        const c = costOf(gu, gv, du, dv, 3, best.cost);
        if (c.cost < best.cost) best = c;
      }
      if (!Number.isFinite(best.cost)) continue;
      const coarse = best;
      best = { cost: Infinity };
      for (let dv = coarse.dv - 1; dv <= coarse.dv + 1; dv++) for (let du = coarse.du - 1; du <= coarse.du + 1; du++) {
        const c = costOf(coarse.gu, coarse.gv, du, dv, 2, best.cost);
        if (c.cost < best.cost) best = c;
      }
      const [gc, gr] = xy(best.gu, best.gv), donor = gr * COLS + gc;
      for (const v of vs) for (let u = U; u < U + MEND; u++) {
        const su = u - best.ou, sv = v - best.ov;
        if (su < 0 || sv < 0 || sv >= V) break;
        const [sx, sy] = xy(su, sv), j = at(sx, sy), own = frameOf0[sy * W0 + sx];
        if (d0[j + 3] < 8 || (own >= 0 && own !== donor)) break;
        const [x, y] = xy(u, v);
        d0.copy(data, (y * W + x) * 4, j, j + 4); mended++;
      }
    }
  }
  return { W, H, data, mended };
}
const { W, H, data, mended } = mendEdges(src);
const alpha = (x, y) => data[(y * W + x) * 4 + 3];

// Poses side by side that touch (a cheek against the next frame's tail) would make one blob, and a seam across it knows
// nothing of whose pixel is whose: it can hand a tail tip to the frame before. So each such pair is parted first along the
// cheapest line between the two frames' centres (a minimum vertex cut over visible pixels, found with augmenting paths),
// where a pixel costs more the paler it is: a line along the dark outlines where the poses meet, never across a pale cheek
// that happens to be as narrow. Those few pixels go. Poses that do not touch lose nothing. Returns the pixels cleared.
function partTouchingPoses() {
  const STEPS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]; // step d and step 7 - d are opposites
  let cleared = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) {
    const x0 = Math.round((c + 0.5) * pitchX), y0 = Math.round(r * pitchY);
    const w = Math.round((c + 1.5) * pitchX) - x0 + 1, h = (r === ROWS - 1 ? H : Math.round((r + 1) * pitchY)) - y0, n = w * h;
    const solid = (i) => data[((y0 + ((i / w) | 0)) * W + x0 + i % w) * 4 + 3] > 24;
    const neighbour = (i, d) => {
      const x = i % w + STEPS[d][0], y = ((i / w) | 0) + STEPS[d][1];
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      const j = y * w + x;
      return solid(j) ? j : -1;
    };
    // Each pixel is two nodes, in (2i) and out (2i + 1), joined by what the pixel costs.
    const used = new Int32Array(n), flow = new Int32Array(n * 8), cameFrom = new Int32Array(n * 2);
    const cost = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const p = ((y0 + ((i / w) | 0)) * W + x0 + i % w) * 4;
      cost[i] = 1 + Math.floor((Math.min(data[p], data[p + 1], data[p + 2]) * data[p + 3]) / 65025 * 24);
    }
    const search = () => {
      cameFrom.fill(-1);
      const queue = [];
      for (let y = 0; y < h; y++) if (solid(y * w)) { cameFrom[(y * w) * 2 + 1] = -2; queue.push((y * w) * 2 + 1); }
      for (let q = 0; q < queue.length; q++) {
        const node = queue[q], i = node >> 1;
        const visit = (to) => { if (cameFrom[to] === -1) { cameFrom[to] = node; queue.push(to); } };
        if (node & 1) {
          for (let d = 0; d < 8; d++) { const j = neighbour(i, d); if (j >= 0) visit(j * 2); }
          if (used[i] > 0) visit(i * 2);
        } else {
          if (i % w === w - 1) return node;
          if (used[i] < cost[i]) visit(i * 2 + 1);
          for (let d = 0; d < 8; d++) { const j = neighbour(i, d); if (j >= 0 && flow[j * 8 + 7 - d] > 0) visit(j * 2 + 1); }
        }
      }
      return -1;
    };
    const stepTo = (a, b) => STEPS.findIndex(([dx, dy]) => a % w + dx === b % w && ((a / w) | 0) + dy === ((b / w) | 0));
    for (let end = search(); end >= 0; end = search()) {
      let room = Infinity;
      for (let to = end, from = cameFrom[to]; from !== -2; to = from, from = cameFrom[to]) {
        const a = from >> 1, b = to >> 1;
        if (a === b) room = Math.min(room, from & 1 ? used[a] : cost[a] - used[a]);
        else if (!(from & 1)) room = Math.min(room, flow[b * 8 + 7 - stepTo(a, b)]);
      }
      for (let to = end, from = cameFrom[to]; from !== -2; to = from, from = cameFrom[to]) {
        const a = from >> 1, b = to >> 1;
        if (a === b) used[a] += from & 1 ? -room : room;
        else if (from & 1) flow[a * 8 + stepTo(a, b)] += room;
        else flow[b * 8 + 7 - stepTo(a, b)] -= room;
      }
    }
    for (let i = 0; i < n; i++) {
      if (cameFrom[i * 2] === -1 || cameFrom[i * 2 + 1] !== -1 || !solid(i)) continue;
      const p = (y0 + ((i / w) | 0)) * W + x0 + i % w;
      data.fill(0, p * 4, p * 4 + 4);
      cleared++;
    }
  }
  return cleared;
}
const parted = partTouchingPoses();

// Drop specks left over from background removal: small blobs that are not part of the pet. Every other blob is
// owned by the frame its centre falls in, so a frame that overlaps its neighbour's cell keeps its own pixels.
// Blobs spanning several frames (poses that touch) are owned per grid cell instead (owner -1, see `seamsX`/`seamsY`).
const seen = new Uint8Array(W * H);
const owner = new Int8Array(W * H).fill(-1);
for (let start = 0; start < W * H; start++) {
  if (seen[start] || data[start * 4 + 3] <= 24) continue;
  const blob = [start]; seen[start] = 1;
  for (let i = 0; i < blob.length; i++) {
    const x = blob[i] % W, y = (blob[i] / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, n = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[n] || data[n * 4 + 3] <= 24) continue;
      seen[n] = 1; blob.push(n);
    }
  }
  if (blob.length < 200) { for (const p of blob) data.fill(0, p * 4, p * 4 + 4); continue; }
  let loX = W, hiX = 0, loY = H, hiY = 0, sumX = 0, sumY = 0;
  for (const p of blob) {
    const x = p % W, y = (p / W) | 0;
    loX = Math.min(loX, x); hiX = Math.max(hiX, x); loY = Math.min(loY, y); hiY = Math.max(hiY, y); sumX += x; sumY += y;
  }
  if (hiX - loX < pitchX * 1.3 && hiY - loY < pitchY * 1.3) {
    const c = Math.min(COLS - 1, Math.floor(sumX / blob.length / pitchX));
    const r = Math.min(ROWS - 1, Math.floor(sumY / blob.length / pitchY));
    for (const p of blob) owner[p] = r * COLS + c;
  }
}

// Frames sit on an even grid, but poses that reach toward a neighbour (a tail, a wing, a book) touch it. For pixels no
// single frame owns, cut along a seam near each grid line that winds through the gap between the two poses (the
// cheapest path through transparent pixels, moving up to 2px sideways per step) instead of a straight line, so a
// tail or book corner poking past the grid line stays whole. `costAt(pos, t)` is the alpha at position `pos` across
// the seam, step `t` along it; returns the seam's position at every step.
function seam(steps, nominal, reach, costAt) {
  const lo = nominal - reach, n = reach * 2 + 1;
  let cost = new Float64Array(n), next = new Float64Array(n);
  const from = new Int8Array(steps * n);
  const own = (i, t) => { const a = costAt(lo + i, t); return (a > 24 ? 1000 + a : a) + Math.abs(i - reach) * 0.05; };
  for (let i = 0; i < n; i++) cost[i] = own(i, 0);
  for (let t = 1; t < steps; t++) {
    for (let i = 0; i < n; i++) {
      let best = Infinity, move = 0;
      for (let d = -2; d <= 2; d++) {
        const j = i + d;
        if (j < 0 || j >= n) continue;
        const c = cost[j] + Math.abs(d) * 0.1;
        if (c < best) { best = c; move = d; }
      }
      next[i] = best + own(i, t); from[t * n + i] = move;
    }
    [cost, next] = [next, cost];
  }
  let i = 0;
  for (let j = 1; j < n; j++) if (cost[j] < cost[i]) i = j;
  const path = new Int32Array(steps);
  for (let t = steps - 1; t >= 0; t--) { path[t] = lo + i; i += from[t * n + i]; }
  return path;
}
const seamsX = Array.from({ length: COLS - 1 }, (_, k) => seam(H, Math.round((k + 1) * pitchX), Math.round(pitchX * 0.3), (x, y) => alpha(x, y)));
const seamsY = Array.from({ length: ROWS - 1 }, (_, k) => seam(W, Math.round((k + 1) * pitchY), Math.round(pitchY * 0.3), (y, x) => alpha(x, y)));
const frameOf = (x, y) => {
  const o = owner[y * W + x];
  if (o >= 0) return o;
  let c = 0, r = 0;
  while (c < COLS - 1 && x >= seamsX[c][y]) c++;
  while (r < ROWS - 1 && y >= seamsY[r][x]) r++;
  return r * COLS + c;
};

// Horizontal shift per frame (source px) for `steady`, measured on the solid body so the glow does not skew it.
const sumX = new Float64Array(FRAMES), count = new Float64Array(FRAMES);
if (STEADY) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (alpha(x, y) <= 128) continue;
  const f = frameOf(x, y);
  sumX[f] += x - (f % COLS) * pitchX; count[f]++;
}
const centres = Array.from(sumX, (s, f) => (count[f] ? s / count[f] : 0));
const meanCentre = centres.reduce((a, b) => a + b, 0) / FRAMES;
const shift = centres.map((cx) => (STEADY ? STEADY * (meanCentre - cx) : 0));

// One box (relative to each frame's grid cell) that holds every frame, so the pet does not jitter between frames.
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (alpha(x, y) <= 24) continue;
  const f = frameOf(x, y);
  const rx = x - (f % COLS) * pitchX + shift[f], ry = y - Math.floor(f / COLS) * pitchY;
  minX = Math.min(minX, rx); maxX = Math.max(maxX, rx); minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
}
const pad = 4;
const side = Math.ceil(Math.max(maxX - minX, maxY - minY) + 1 + pad * 2);
const left = minX - pad - (side - (maxX - minX + 1 + pad * 2)) / 2;  // centered horizontally
const top = maxY + 1 + pad - side;                                    // feet on the bottom edge

// Area-average resample with premultiplied alpha, so edges do not pick up dark fringes from transparent pixels.
const out = new PNG({ width: CELL * COLS, height: CELL * ROWS });
const scale = side / CELL;
const sample = (f, sx, sy) => {
  const x = Math.floor(sx), y = Math.floor(sy);
  if (x < 0 || x >= W || y < 0 || y >= H || frameOf(x, y) !== f) return null;
  return (y * W + x) * 4;
};
for (let f = 0; f < FRAMES; f++) for (let oy = 0; oy < CELL; oy++) for (let ox = 0; ox < CELL; ox++) {
  const c = f % COLS, r = Math.floor(f / COLS);
  const x0 = c * pitchX + left - shift[f] + ox * scale, y0 = r * pitchY + top + oy * scale;
  let red = 0, green = 0, blue = 0, a = 0, area = 0;
  for (let sy = Math.floor(y0); sy < y0 + scale; sy++) {
    const wy = Math.min(sy + 1, y0 + scale) - Math.max(sy, y0);
    for (let sx = Math.floor(x0); sx < x0 + scale; sx++) {
      const w = (Math.min(sx + 1, x0 + scale) - Math.max(sx, x0)) * wy;
      area += w;
      const i = sample(f, sx, sy);
      if (i === null) continue;
      const pa = data[i + 3] / 255 * w;
      red += data[i] * pa; green += data[i + 1] * pa; blue += data[i + 2] * pa; a += pa;
    }
  }
  const o = ((r * CELL + oy) * CELL * COLS + c * CELL + ox) * 4;
  if (a > 0) { out.data[o] = Math.round(red / a); out.data[o + 1] = Math.round(green / a); out.data[o + 2] = Math.round(blue / a); }
  out.data[o + 3] = Math.round(a / area * 255);
}
sharpen(out.data, out.width, out.height);
fs.writeFileSync(output, PNG.sync.write(out));
const span = (path) => `${Math.min(...path)}-${Math.max(...path)}`;
console.log(`${output}: ${COLS}x${ROWS} frames, seams at x ${seamsX.map(span).join(', ')} / y ${seamsY.map(span).join(', ') || '-'}, source box ${side}px${parted ? `, parted touching poses at ${parted}px` : ''}${mended ? `, mended ${mended}px past the right or bottom edge` : ''}`);
