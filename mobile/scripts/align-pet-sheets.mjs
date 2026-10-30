// Lines the pet sheets up so the pet stays put while they play and when one hands over to another:
// - Idle (8 x 4): the character boards draw some rows of the idle smaller and higher than the first (often the last
//   row, by up to a fifth), so every few blinks the pet shrank and floated up, then snapped back. Each row is matched
//   to the first one (scale and offset found by overlaying their outlines) and redrawn at that size and place. A row
//   that already matches is left as it is.
// - Ground: a sheet whose pet stands above the frame's floor line (most stand at 98%) is lowered onto it, and its
//   still with it, so the pet does not drop when it starts walking (the walk strips all stand on that line).
// - Move left / right: both ways should stand on the same line, or the pet hops up or down each time it turns. The
//   left strip is lowered (or raised) whole, by whole pixels, onto the right one's line.
// Nothing is cut: an offset that would push a frame over its edge is reduced. Run it once on freshly sliced sheets:
// a second run only finds leftovers of a few px near its thresholds, and each run that rescales a row softens it.
// Usage: node scripts/align-pet-sheets.mjs [assets/pets] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ROOT = args.find((a) => !a.startsWith('--')) ?? 'assets/pets';
const SOLID = 40; // alpha that counts as part of the pet
const FLOOR = 0.98; // where the pets' feet are, as a share of the frame height
const FLOAT_TOLERANCE = 0.025; // a pet this far above the floor line is lowered onto it
const EDGE = 2; // px kept clear around a rescaled pose, so smoothing does not spill over the cell edge

const read = (file) => PNG.sync.read(fs.readFileSync(file));
const write = (file, png) => { if (!DRY) fs.writeFileSync(file, PNG.sync.write(png)); };
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[s.length >> 1]; };

/** Lowest solid row of a frame (cell px), or -1 when it is empty. */
function bottomOf(png, x0, y0, cell) {
  for (let y = cell - 1; y >= 0; y--) for (let x = 0; x < cell; x++) if (png.data[((y0 + y) * png.width + x0 + x) * 4 + 3] > SOLID) return y;
  return -1;
}
/** Highest solid row of a frame (cell px). */
function topOf(png, x0, y0, cell) {
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) if (png.data[((y0 + y) * png.width + x0 + x) * 4 + 3] > SOLID) return y;
  return cell;
}

/** Share of the row's frames covering each pixel, at `res` px: the row's outline with its blinks and waves averaged out. */
function rowMask(png, row, cols, cell, res) {
  const mask = new Float32Array(res * res);
  const k = cell / res;
  for (let i = 0; i < cols; i++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const sx = Math.floor((x + 0.5) * k), sy = Math.floor((y + 0.5) * k);
    if (png.data[((row * cell + sy) * png.width + i * cell + sx) * 4 + 3] > SOLID) mask[y * res + x] += 1 / cols;
  }
  return mask;
}

/** How far `mask` drawn at scale s, moved by (dx, dy), differs from `ref` (all at `res` px; nearest sampling). */
function mismatch(ref, mask, res, s, dx, dy) {
  let cost = 0;
  for (let y = 0; y < res; y++) {
    const my = Math.floor((y - dy) / s);
    for (let x = 0; x < res; x++) {
      const mx = Math.floor((x - dx) / s);
      const m = mx >= 0 && my >= 0 && mx < res && my < res ? mask[my * res + mx] : 0;
      cost += Math.abs(ref[y * res + x] - m);
    }
  }
  return cost;
}

/** The scale and offset (cell px) that lay row `row` over row 0: a coarse search, then a finer one around the best. */
function register(png, row, cols, cell) {
  const coarse = cell / 4;
  let best = { s: 1, dx: 0, dy: 0, cost: Infinity };
  const ref = rowMask(png, 0, cols, cell, coarse), mask = rowMask(png, row, cols, cell, coarse);
  for (let s = 0.84; s <= 1.26; s += 0.02) for (let dx = -10; dx <= 10; dx++) for (let dy = -14; dy <= 14; dy++) {
    const cost = mismatch(ref, mask, coarse, s, dx, dy);
    if (cost < best.cost) best = { s, dx: dx * 4, dy: dy * 4, cost };
  }
  const fine = cell / 2;
  const refF = rowMask(png, 0, cols, cell, fine), maskF = rowMask(png, row, cols, cell, fine);
  let bestF = { ...best, cost: Infinity };
  for (let s = best.s - 0.024; s <= best.s + 0.024; s += 0.004) for (let dx = best.dx / 2 - 3; dx <= best.dx / 2 + 3; dx++) for (let dy = best.dy / 2 - 3; dy <= best.dy / 2 + 3; dy++) {
    const cost = mismatch(refF, maskF, fine, s, dx, dy);
    if (cost < bestF.cost) bestF = { s, dx: dx * 2, dy: dy * 2, cost };
  }
  return bestF;
}

/** The row's frames' joint outline box (cell px). */
function rowBox(png, row, cols, cell) {
  let l = cell, r = -1, t = cell, b = -1;
  for (let i = 0; i < cols; i++) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    if (png.data[((row * cell + y) * png.width + i * cell + x) * 4 + 3] <= SOLID) continue;
    if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
  }
  return { l, r, t, b };
}

/** Narrows a row's move so no frame is pushed over its cell's edge: the offset first, then the scale if it must. */
function keepInside(png, row, cols, cell, s, dx, dy) {
  const { l, r, t, b } = rowBox(png, row, cols, cell);
  s = Math.min(s, (cell - 1 - 2 * EDGE) / Math.max(1, r - l + 1), (cell - 1 - 2 * EDGE) / Math.max(1, b - t + 1));
  const clamp = (d, lo, hi) => Math.round(Math.max(EDGE - lo * s, Math.min(cell - 1 - EDGE - hi * s, d)));
  return { s, dx: clamp(dx, l, r), dy: clamp(dy, t, b) };
}

/** Redraws one cell of `src` into `dst`: out(x, y) = in((x - dx) / s, (y - dy) / s), bilinear on premultiplied colour. */
function transformCell(src, dst, x0, y0, cell, s, dx, dy) {
  const at = (x, y) => ((y0 + y) * src.width + x0 + x) * 4;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    const fx = (x + 0.5 - dx) / s - 0.5, fy = (y + 0.5 - dy) / s - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [px, py, w] of [[ix, iy, (1 - tx) * (1 - ty)], [ix + 1, iy, tx * (1 - ty)], [ix, iy + 1, (1 - tx) * ty], [ix + 1, iy + 1, tx * ty]]) {
      if (px < 0 || py < 0 || px >= cell || py >= cell || !w) continue;
      const i = at(px, py), pa = src.data[i + 3] / 255 * w;
      r += src.data[i] * pa; g += src.data[i + 1] * pa; b += src.data[i + 2] * pa; a += pa;
    }
    const o = at(x, y);
    dst.data[o + 3] = Math.round(a * 255);
    if (a > 0) { dst.data[o] = Math.round(r / a); dst.data[o + 1] = Math.round(g / a); dst.data[o + 2] = Math.round(b / a); }
    else dst.data[o] = dst.data[o + 1] = dst.data[o + 2] = 0;
  }
}

/** Moves every frame of a `cols` x `rows` sheet down by `dy` whole px (up when negative). */
function shiftSheet(png, cols, rows, dy) {
  const cell = png.width / cols;
  const out = new PNG({ width: png.width, height: png.height });
  for (let j = 0; j < rows; j++) for (let y = 0; y < cell; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= cell) continue;
    png.data.copy(out.data, (j * cell + y) * png.width * 4, (j * cell + sy) * png.width * 4, (j * cell + sy + 1) * png.width * 4);
  }
  return out;
}

/** The largest move toward `want` px (down when positive) that keeps every frame inside its cell. */
function safeShift(png, cols, rows, want) {
  const cell = png.width / cols;
  let room = want > 0 ? Infinity : -Infinity;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const b = bottomOf(png, i * cell, j * cell, cell);
    if (b < 0) continue;
    room = want > 0 ? Math.min(room, cell - 1 - b) : Math.max(room, -topOf(png, i * cell, j * cell, cell));
  }
  return want > 0 ? Math.min(want, room) : Math.max(want, room);
}

const frameBottoms = (png, cols, rows) => {
  const cell = png.width / cols, out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const b = bottomOf(png, i * cell, j * cell, cell); if (b >= 0) out.push(b); }
  return out;
};

const report = [];
for (const element of fs.readdirSync(ROOT).sort()) {
  const dir = path.join(ROOT, element);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const idleName of fs.readdirSync(path.join(dir, 'idle')).sort()) {
    const stage = idleName.replace('_Idle.png', '');
    const idleFile = path.join(dir, 'idle', idleName);
    let idle = read(idleFile);
    const cols = 8, rows = 4, cell = idle.width / cols;
    const notes = [];

    // Rows onto the first one.
    const fixed = new PNG({ width: idle.width, height: idle.height });
    idle.data.copy(fixed.data);
    for (let row = 1; row < rows; row++) {
      let { s, dx, dy } = register(idle, row, cols, cell);
      // Within the search's own precision: only a clear offset is worth moving, and then by whole pixels, unblurred.
      if (Math.abs(s - 1) < 0.03) { s = 1; if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) continue; }
      ({ s, dx, dy } = keepInside(idle, row, cols, cell, s, dx, dy));
      for (let i = 0; i < cols; i++) transformCell(idle, fixed, i * cell, row * cell, cell, s, dx, dy);
      notes.push(`row ${row + 1} x${s.toFixed(3)} ${dx >= 0 ? '+' : ''}${dx},${dy >= 0 ? '+' : ''}${dy}px`);
    }
    idle = fixed;

    // Onto the floor line, with its still.
    const floor = Math.round(cell * FLOOR) - 1;
    const feet = median(frameBottoms(idle, cols, rows));
    if (floor - feet > cell * FLOAT_TOLERANCE) {
      const dy = safeShift(idle, cols, rows, floor - feet);
      idle = shiftSheet(idle, cols, rows, dy);
      notes.push(`lowered ${dy}px`);
      const stillFile = path.join(dir, `${stage}.png`);
      if (fs.existsSync(stillFile)) {
        const still = read(stillFile);
        const sdy = safeShift(still, 1, 1, Math.round(dy * still.width / cell));
        write(stillFile, shiftSheet(still, 1, 1, sdy));
        notes.push(`still lowered ${sdy}px`);
      }
    }
    if (notes.length) { write(idleFile, idle); report.push(`${element}/idle/${idleName}: ${notes.join(', ')}`); }

    // Left strip onto the right one's line.
    const left = path.join(dir, 'move', `${stage}_Move_Left.png`), right = path.join(dir, 'move', `${stage}_Move_Right.png`);
    if (fs.existsSync(left) && fs.existsSync(right)) {
      const l = read(left), r = read(right);
      const want = median(frameBottoms(r, 8, 1)) - median(frameBottoms(l, 8, 1));
      if (Math.abs(want) > 2) {
        const dy = safeShift(l, 8, 1, want);
        write(left, shiftSheet(l, 8, 1, dy));
        report.push(`${element}/move/${stage}_Move_Left.png: ${dy > 0 ? 'lowered' : 'raised'} ${Math.abs(dy)}px onto the right strip's line`);
      }
    }
  }
}
console.log(report.length ? report.join('\n') : 'All pet sheets already line up.');
if (DRY) console.log('(dry run: nothing written)');
