// Copies one frame of a sliced sheet (see slice-sprite-sheet.mjs) out as a still. The evolution stills cut from the
// character boards lose wisps and tails to the board's column edges; a sheet frame has the whole pose, and the still
// then matches the first frame the sheet plays, so the picture does not jump when the sheet takes over.
// Usage: node scripts/still-from-sheet.mjs <sheet.png> <out.png> [cols=8] [rows=4] [frame=0]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

const [input, output, colsArg, rowsArg, frameArg] = process.argv.slice(2);
if (!input || !output) { console.error('Usage: node scripts/still-from-sheet.mjs <sheet.png> <out.png> [cols=8] [rows=4] [frame=0]'); process.exit(1); }
const cols = Number(colsArg) || 8, rows = Number(rowsArg) || 4, frame = Number(frameArg) || 0;
const sheet = PNG.sync.read(fs.readFileSync(input));
const w = sheet.width / cols, h = sheet.height / rows;
const x0 = (frame % cols) * w, y0 = Math.floor(frame / cols) * h;
const out = new PNG({ width: w, height: h });
for (let y = 0; y < h; y++) sheet.data.copy(out.data, y * w * 4, ((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + w) * 4);
fs.writeFileSync(output, PNG.sync.write(out));
console.log(`${output}: frame ${frame} of ${input}, ${w}x${h}`);
