// node walltex.mjs : the wallpapers of the catalog as flat pictures for scene-home.js (walltex/<id>.png: canvas x -120..540, y -240..440 at
// 3 px a unit), and the night wall's stars alone, which glow a little.
import fs from 'node:fs';
import sharp from 'sharp';
const A = JSON.parse(fs.readFileSync('room-art.json', 'utf8'));
fs.mkdirSync('walltex', { recursive: true });
for (const [id, s] of Object.entries(A.surfaces)) {
  if (s.kind !== 'wall') continue;
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1980" height="2040" viewBox="-120 -240 660 680" preserveAspectRatio="none">${s.svg}</svg>`)).png().toFile(`walltex/${id}.png`);
  if (id !== 'wall_night') continue;
  const { data, info } = await sharp(`walltex/${id}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2]; out[i] = Math.max(0, Math.min(255, (r + g - 2 * b) * 2 + (r > 150 && g > 140 ? 120 : 0))); }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toFile('walltex/wall_night-stars.png');
}
console.log('walltex written');
