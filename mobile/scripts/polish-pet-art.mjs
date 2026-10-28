// Cleans a pet picture (a still or a sliced sheet) so it reads crisp on any background:
// - Haze: background removal leaves a veil of faint, half-transparent pixels around the pet (and between its wisps),
//   which shows as a grey fog over whatever is behind it. Alpha below HAZE_LO is dropped and alpha from HAZE_LO to
//   HAZE_HI is stretched to fully opaque, so the outline stays smooth but the veil is gone.
// - Softness: the drawings are small and get scaled up on phone screens, so colour gets a light unsharp mask
//   (alpha-weighted 3x3 blur, so transparent pixels do not darken the edges).
// Run it once per picture, on a freshly sliced or original file: sharpening twice oversharpens.
// Usage: node scripts/polish-pet-art.mjs <in.png> [out.png = in.png]
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HAZE_LO = 72;
export const HAZE_HI = 150;
export const SHARPEN = 0.6;

/** Drops the haze from RGBA pixels, in place. */
export function dehaze(data) {
  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(255 * Math.min(1, Math.max(0, (data[i] - HAZE_LO) / (HAZE_HI - HAZE_LO))));
    if (!data[i]) data[i - 3] = data[i - 2] = data[i - 1] = 0;
  }
}

/** Unsharp-masks the colour of RGBA pixels, in place. */
export function sharpen(data, width, height) {
  const src = Buffer.from(data);
  const k = [1, 2, 1];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (!src[i + 3]) continue;
    let r = 0, g = 0, b = 0, w = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = (ny * width + nx) * 4, weight = k[dx + 1] * k[dy + 1] * src[j + 3];
      r += src[j] * weight; g += src[j + 1] * weight; b += src[j + 2] * weight; w += weight;
    }
    const sharp = (v, blur) => Math.max(0, Math.min(255, Math.round(v + SHARPEN * (v - blur / w))));
    data[i] = sharp(src[i], r); data[i + 1] = sharp(src[i + 1], g); data[i + 2] = sharp(src[i + 2], b);
  }
}

/** Both, in place: the haze first, so the sharpening does not outline it. */
export function polish(data, width, height) {
  dehaze(data);
  sharpen(data, width, height);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [input, output = input] = process.argv.slice(2);
  if (!input) { console.error('Usage: node scripts/polish-pet-art.mjs <in.png> [out.png]'); process.exit(1); }
  const { PNG } = createRequire(import.meta.url)('pngjs');
  const png = PNG.sync.read(fs.readFileSync(input));
  polish(png.data, png.width, png.height);
  fs.writeFileSync(output, PNG.sync.write(png));
  console.log(`${output}: polished ${png.width}x${png.height}`);
}
