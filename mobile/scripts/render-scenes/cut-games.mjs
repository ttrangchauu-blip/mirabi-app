// Cuts the worlds of the learning games. node cut-games.mjs <raw folder>/games <the app's assets/world folder>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const [raw, out] = process.argv.slice(2);
const dir = path.join(out, 'games');
fs.mkdirSync(dir, { recursive: true });
const file = (n) => path.join(raw, `${n}.png`);
const calm = (n) => sharp(file(n)).removeAlpha().median(3).png().toBuffer();
const save = (buf, name, quality = 80) => sharp(buf).webp({ quality, alphaQuality: 90, effort: 6 }).toFile(path.join(dir, `${name}.webp`));
const cutout = async (name) => sharp(await calm(name)).joinChannel(await sharp(file(`${name}.mask`)).removeAlpha().extractChannel(0).blur(0.6).png().toBuffer()).png().toBuffer();
for (const w of ['forest', 'cave', 'castle', 'boss']) for (const l of ['far', 'mid', 'near']) await save(await cutout(`${w}-${l}`), `${w}-${l}`);
for (const l of ['far', 'near']) await save(await cutout(`space-${l}`), `space-${l}`);
await save(await cutout('field'), 'field');
if (fs.existsSync(file('brook'))) await save(await cutout('brook'), 'brook');
for (const w of ['stone', 'bronze', 'feudal', 'modern', 'map', 'lab']) await save(await calm(w), w, 78);
let sum = 0;
for (const f of fs.readdirSync(dir)) sum += fs.statSync(path.join(dir, f)).size;
console.log('games', fs.readdirSync(dir).length, 'files', Math.round(sum / 1024), 'KB');
