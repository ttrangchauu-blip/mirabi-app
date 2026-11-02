import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { PNG } = require('pngjs');
const PITCH = 128, CELL = 128, FRAMES = 8;

/** A sheet of 8 poses, red and blue in turn, each but the last with a cheek reaching past the grid line to lie along the next pose's tail. */
function touchingSheet(file: string) {
  const png = new PNG({ width: PITCH * FRAMES, height: PITCH });
  const box = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= png.width) continue;
      png.data.set([r, g, b, 255], (y * png.width + x) * 4);
    }
  };
  for (let f = 0; f < FRAMES; f++) {
    const c = (f + 0.5) * PITCH, red = f % 2 === 0;
    const line = red ? [120, 0, 0] : [0, 0, 120], pale = red ? [255, 190, 190] : [190, 190, 255];
    const shapes = [[c - 36, 50, c + 36, 124], [c - 56, 60, c - 48, 118], [c - 56, 100, c - 30, 118]];
    if (f < FRAMES - 1) shapes.push([c + 30, 70, c + 72, 92]);
    for (const [x0, y0, x1, y1] of shapes) box(x0, y0, x1, y1, line);
    for (const [x0, y0, x1, y1] of shapes) box(x0 + 2, y0 + 2, x1 - 2, y1 - 2, pale);
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

it('parts poses that touch where they meet: no frame keeps a piece of its neighbour', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const sheet = path.join(dir, 'sheet.png'), out = path.join(dir, 'out.png');
  touchingSheet(sheet);
  execFileSync(process.execPath, [path.join(__dirname, '../scripts/slice-sprite-sheet.mjs'), sheet, out, String(FRAMES), '1', String(CELL)]);
  const strip = PNG.sync.read(fs.readFileSync(out));
  fs.rmSync(dir, { recursive: true });
  for (let f = 0; f < FRAMES; f++) {
    let own = 0;
    const foreign = new Set<number>();
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const i = (y * strip.width + f * CELL + x) * 4;
      if (strip.data[i + 3] < 128) continue;
      if (strip.data[i] > strip.data[i + 2] === (f % 2 === 0)) own++; else foreign.add(x);
    }
    expect(own).toBeGreaterThan(1000);
    expect(foreign.size).toBeLessThanOrEqual(1); // one column at most: the outline where the two poses meet
  }
});
