// Turns a pet's action sheet (attack, jump: 8 frames in a row) into the strip PetArt plays, its pet the same size and in
// the same place as in the idle strip, so nothing jumps when one hands over to the other: the boards draw it smaller than
// the idle and off to one side. The sheet is sliced (slice-sprite-sheet.mjs), its first frame (standing as the idle does)
// is laid over the idle's first frame (see below), and every frame gets that one scale and offset: frames are cut out and
// scaled, never redrawn. The action reaches past the idle's frame (a lunge, a leap), so the strip's frame is `window` times
// the idle's: same centre, same bottom edge. `window`, `cols` and `cell` must match ACTION_WINDOW and SPRITE_LAYOUT in
// src/petSprites.ts. The script fails rather than cut off part of a pose: for a sheet just too tall for the window that every
// other level fits (a higher leap), `fit` draws its pet that much smaller, its middle and ground line kept, and leaves the
// other strips and the app as they are. Keep the strip within 2048 px (docs/GAME_ASSETS.md).
// Usage: node scripts/fit-action-strip.mjs <sheet.png> <idle.png> <out.png> [window=1.2] [cols=8] [cell=256] [fit=1]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { PNG } = createRequire(import.meta.url)('pngjs');

const [sheet, idlePath, output, windowArg, colsArg, cellArg, fitArg] = process.argv.slice(2);
if (!sheet || !idlePath || !output) { console.error('Usage: node scripts/fit-action-strip.mjs <sheet.png> <idle.png> <out.png> [window=1.2] [cols=8] [cell=256] [fit=1]'); process.exit(1); }
const COLS = 8; // the sheet's frames
const OUT_COLS = Number(colsArg) || 8, OUT_ROWS = COLS / OUT_COLS; // the strip's grid
const CELL = Number(cellArg) || 256;
const WINDOW = Number(windowArg) || 1.2;
const WORK = 512; // the slice this works from: no detail lost before the one resample below
const EDGE = 2; // px kept clear around every frame, so a phone's rounding never shows a sliver of the next frame

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attack-'));
const sliced = path.join(dir, 'sliced.png');
execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'slice-sprite-sheet.mjs'), sheet, sliced, String(COLS), '1', String(WORK)]);
const src = PNG.sync.read(fs.readFileSync(sliced));
fs.rmSync(dir, { recursive: true });
const idle = PNG.sync.read(fs.readFileSync(idlePath));
const idleCell = idle.width / COLS;

/** A frame's solid mass, as fractions of it: its area, its centre across, and how low it reaches. */
function massOf(png, frame, cell) {
  let area = 0, sumX = 0, floor = 0;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    if (png.data[(y * png.width + frame * cell + x) * 4 + 3] <= 128) continue;
    area++; sumX += x; floor = Math.max(floor, (y + 1) / cell);
  }
  return { area: area / (cell * cell), x: sumX / area / cell, floor };
}
// The two boards draw the head and body in different proportions, so no one scale lays every part over the other. The
// same amount of pet on screen reads as the same size; its middle stays put, and the lowest any frame reaches is the
// idle's ground line, which is at most GROUND (where the pets' feet are, align-pet-sheets.mjs).
const GROUND = 0.98;
const idleMass = massOf(idle, 0, idleCell), mass = massOf(src, 0, WORK);
const lowest = Math.max(...Array.from({ length: COLS }, (_, f) => massOf(src, f, WORK).floor));
const s = Math.sqrt(idleMass.area / mass.area) * (Number(fitArg) || 1);
const dxFrames = idleMass.x - mass.x * s;
const dyFrames = Math.min(idleMass.floor, GROUND) - lowest * s;

// From the strip's frame to the slice, with the idle's frame in between: (out px / CELL) of the window, in idle frames.
const perOut = WINDOW / CELL; // idle frames per out px
const slicePerIdle = WORK / s; // slice px per idle frame
const toSliceX = (ox) => (ox * perOut - (WINDOW - 1) / 2 - dxFrames) * slicePerIdle;
const toSliceY = (oy) => (oy * perOut - (WINDOW - 1) - dyFrames) * slicePerIdle;
const scale = perOut * slicePerIdle;

const out = new PNG({ width: CELL * OUT_COLS, height: CELL * OUT_ROWS });
for (let f = 0; f < COLS; f++) for (let oy = 0; oy < CELL; oy++) for (let ox = 0; ox < CELL; ox++) {
  const x0 = toSliceX(ox), y0 = toSliceY(oy);
  let red = 0, green = 0, blue = 0, al = 0, area = 0;
  for (let sy = Math.floor(y0); sy < y0 + scale; sy++) {
    const wy = Math.min(sy + 1, y0 + scale) - Math.max(sy, y0);
    for (let sx = Math.floor(x0); sx < x0 + scale; sx++) {
      const w = (Math.min(sx + 1, x0 + scale) - Math.max(sx, x0)) * wy;
      area += w;
      if (sx < 0 || sy < 0 || sx >= WORK || sy >= WORK) continue;
      const i = (sy * src.width + f * WORK + sx) * 4, pa = (src.data[i + 3] / 255) * w;
      red += src.data[i] * pa; green += src.data[i + 1] * pa; blue += src.data[i + 2] * pa; al += pa;
    }
  }
  const o = ((Math.floor(f / OUT_COLS) * CELL + oy) * out.width + (f % OUT_COLS) * CELL + ox) * 4;
  if (al > 0) { out.data[o] = Math.round(red / al); out.data[o + 1] = Math.round(green / al); out.data[o + 2] = Math.round(blue / al); }
  out.data[o + 3] = Math.round((al / area) * 255);
}

// Nothing of a pose may be lost past the window, or lie against its edge.
let lost = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (let f = 0; f < COLS; f++) for (let sy = 0; sy < WORK; sy++) for (let sx = 0; sx < WORK; sx++) {
  if (src.data[(sy * src.width + f * WORK + sx) * 4 + 3] <= 24) continue;
  const ox = (sx - toSliceX(0)) / scale, oy = (sy - toSliceY(0)) / scale;
  minX = Math.min(minX, ox); maxX = Math.max(maxX, ox); minY = Math.min(minY, oy); maxY = Math.max(maxY, oy);
  if (ox < EDGE || oy < EDGE || ox >= CELL - EDGE || oy >= CELL - EDGE) lost++;
}
const fitted = `scale ${s.toFixed(3)}, offset ${(dxFrames * 100).toFixed(1)}%, ${(dyFrames * 100).toFixed(1)}% of a frame, poses in x ${minX.toFixed(0)}-${maxX.toFixed(0)}, y ${minY.toFixed(0)}-${maxY.toFixed(0)} of ${CELL}`;
if (lost) { console.error(`${output}: ${lost} px of the poses fall outside the window (${fitted}): raise the window here and ACTION_WINDOW in src/petSprites.ts, or lower the fit argument`); process.exit(1); }
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, PNG.sync.write(out));
console.log(`${output}: ${fitted}`);
