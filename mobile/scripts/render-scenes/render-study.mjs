// node render-study.mjs <focus|group> <samples> : every pass of a study room, in raw/<room>/. A pass already there is kept, so a stopped run
// goes on where it was. Masks come first: each item's colour pass is only as big as its mask plus room for its shadow. Prints one line a pass.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOMS } from './study-rooms.mjs';
const [name, samples = '96'] = process.argv.slice(2);
const room = ROOMS[name], S = +samples, dir = path.join('raw', name);
fs.mkdirSync(dir, { recursive: true });
const FW = 1280, FH = 880, BLEED = 860;
const started = Date.now();
const say = (t) => console.log(`${Math.round((Date.now() - started) / 1000)}s ${t}`);
function pass(out, w, h, s, query) {
  const file = path.join(dir, out);
  if (fs.existsSync(file)) return;
  const log = execFileSync('bash', ['one.sh', file.replaceAll('\\', '/'), String(w), String(h), String(s), `&scene=scenes/${room.scene}&${query}`], { encoding: 'utf8', env: { ...process.env, LIMIT: '600000' } });
  if (!fs.existsSync(file)) throw new Error(`no picture for ${out}: ${log.slice(-400)}`);
  say(`done ${out}`);
}
const mask = (out, show, names) => pass(`${out}.mask.png`, FW, FH, 1, `show=${show}&mask=${names}&light=mask`);
async function boxOf(out) {
  const { data, info } = await sharp(path.join(dir, `${out}.mask.png`)).removeAlpha().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
// The empty room, for all to be compared with, and what only photo mode shows: above and below the picture.
const empty = room.empty;
pass('base.png', FW, FH, S, `show=${empty}`);
for (const f of room.floors) pass(`base-${f}.png`, FW, FH, S, `show=${empty}&floor=${f}`);
pass('top.png', FW, BLEED, Math.ceil(S * 0.6), `show=${empty}&vw=${FW}&vh=${BLEED}&oy=${-BLEED}`);
pass('near.png', FW, BLEED, Math.ceil(S * 0.6), `show=${empty}&vw=${FW}&vh=${BLEED}&oy=${FH}`);
for (const f of room.floors) pass(`near-${f}.png`, FW, BLEED, Math.ceil(S * 0.6), `show=${empty}&floor=${f}&vw=${FW}&vh=${BLEED}&oy=${FH}`);
for (const m of room.shellMasks) { pass(`${m}.mask.png`, FW, FH, 1, `show=${empty}&mask=${m}&light=mask`); pass(`${m}.top.mask.png`, FW, BLEED, 1, `show=${empty}&mask=${m}&light=mask&vw=${FW}&vh=${BLEED}&oy=${-BLEED}`); }
for (const it of room.items) {
  if (it.fromBase) { mask(it.name, empty, it.name); continue; }
  const under = (it.on ?? []).concat(room.empty ? [room.empty] : []).join(',');
  const show = [under, it.show ?? it.name].filter(Boolean).join(',');
  mask(it.name, show, it.name);
  for (const p of [...(it.parts ?? []), ...(it.cover ? [it.cover] : [])]) mask(p, show, p);
  const b = await boxOf(it.name), m = it.noShadow ? 12 : 90;
  const crop = { x: Math.max(0, b.x0 - m), y: Math.max(0, b.y0 - m), w: 0, h: 0 };
  crop.w = Math.min(FW, b.x1 + (it.noShadow ? m : m + 90)) - crop.x; crop.h = Math.min(FH, b.y1 + m) - crop.y;
  fs.writeFileSync(path.join(dir, `${it.name}.crop.json`), JSON.stringify(crop));
  const q = `vw=${crop.w}&vh=${crop.h}&ox=${crop.x}&oy=${crop.y}`;
  pass(`${it.name}.png`, crop.w, crop.h, S, `show=${show}&${q}`);
  if (it.on?.length) pass(`${it.name}.under.png`, crop.w, crop.h, S, `show=${under}&${q}`);
}
say('ALL DONE');
