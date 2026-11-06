// Cuts Học tập's pictures and the money garden's land. node cut-learn.mjs <raw folder> <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const learn = path.join(out, 'learn'), money = path.join(out, 'money');
fs.mkdirSync(learn, { recursive: true });
fs.mkdirSync(money, { recursive: true });
const calm = (name) => sharp(path.join(raw, `${name}.png`)).removeAlpha().median(3).png().toBuffer();
const alpha = (name) => sharp(path.join(raw, `${name}.png`)).removeAlpha().extractChannel(0).blur(0.6).png().toBuffer();
const withAlpha = async (name, mask) => sharp(await calm(name)).joinChannel(await alpha(mask)).png().toBuffer();
const save = (buf, file, quality = 82) => sharp(buf).webp({ quality, alphaQuality: 90, effort: 6 }).toFile(file);

for (const light of ['day', 'night']) {
  await save(await withAlpha(`learn/school-${light}`, 'learn/school.mask'), path.join(learn, `school-${light}.webp`));
  // The hillside: the top third with its ridge, then the part that repeats going down.
  const whole = await withAlpha(`learn/trail-${light}`, 'learn/trail.mask');
  await save(await sharp(whole).extract({ left: 0, top: 0, width: 1170, height: 585 }).png().toBuffer(), path.join(learn, `trail-top-${light}.webp`));
  await save(await sharp(whole).extract({ left: 0, top: 585, width: 1170, height: 1170 }).removeAlpha().png().toBuffer(), path.join(learn, `trail-tile-${light}.webp`), 78);
  // The points of the map, cell by cell.
  const stones = await withAlpha(`learn/stones-${light}`, 'learn/stones.mask');
  const names = ['point-locked', 'point-open', 'point-doing', 'point-done', 'step-0', 'step-1'];
  for (let i = 0; i < names.length; i++) await save(await sharp(stones).extract({ left: i * 240, top: 0, width: 240, height: 240 }).png().toBuffer(), path.join(learn, `${names[i]}-${light}.webp`), 86);
  await save(await withAlpha(`orchard/${light}`, 'orchard/mask'), path.join(money, `land-${light}.webp`));
}
for (const dir of [learn, money]) {
  let sum = 0;
  for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
  console.log(path.basename(dir), fs.readdirSync(dir).length, 'files', Math.round(sum / 1024), 'KB');
}
