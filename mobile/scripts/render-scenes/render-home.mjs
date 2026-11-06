// node render-home.mjs <samples> [variant samples] : every pass of Nhà của Pet, in raw/home/. A pass already there is kept, so a stopped run goes
// on where it was. Prints one line a pass, and `ALL DONE` at the end.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ITEMS, MARGIN, PX, SHELL } from './home-items.mjs';
const [samples = '96', vsamples = '64'] = process.argv.slice(2);
const S = +samples, VS = +vsamples, dir = process.env.OUT || path.join('raw', 'home');
fs.mkdirSync(dir, { recursive: true });
const ART = JSON.parse(fs.readFileSync('room-art.json', 'utf8'));
const started = Date.now();
const say = (t) => console.log(`${new Date().toTimeString().slice(0, 8)} ${Math.round((Date.now() - started) / 1000)}s ${t}`);
let rect = null; // what the scene says about itself (where each item stands): read from the first pass rendered in this run
function pass(out, w, h, s, query) {
  const file = path.join(dir, out);
  if (fs.existsSync(file)) return;
  const log = execFileSync('bash', ['one.sh', file.replaceAll('\\', '/'), String(w), String(h), String(s), `&scene=scenes/scene-home&${query}`], { encoding: 'utf8', env: { ...process.env, LIMIT: process.env.PASS_LIMIT || '150000' } });
  if (!fs.existsSync(file)) throw new Error(`no picture for ${out}: ${log.slice(-400)}`);
  const r = log.split('\n').find((l) => l.startsWith('rect '));
  if (r && !rect) { rect = JSON.parse(r.slice(5)); fs.writeFileSync(path.join(dir, 'rect.json'), JSON.stringify(rect)); }
  say(`done ${out}`);
}
/** A pass over the room's own part of the bleed, in tiles (a very tall page can hang at the screenshot), joined. */
async function tiled(out, s, query) {
  const file = path.join(dir, out);
  if (fs.existsSync(file)) return;
  const x = SHELL.x0 * PX, y = SHELL.y0 * PX, w = (SHELL.x1 - SHELL.x0) * PX, h = (SHELL.y1 - SHELL.y0) * PX, n = 4, th = h / n;
  for (let i = 0; i < n; i++) pass(`${out}.t${i}.png`, w, th, s, `${query}&vw=${w}&vh=${th}&ox=${x}&oy=${y + i * th}`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } })
    .composite(Array.from({ length: n }, (_, i) => ({ input: path.join(dir, `${out}.t${i}.png`), left: 0, top: i * th }))).png().toFile(file);
  say(`joined ${out}`);
}
const shows = ITEMS.map((it) => it.id).join(',');
// The empty room (planks, tiles), and what is wall paint, floor, and room at all.
await tiled('base.png', S, 'show=');
await tiled('base-tile.png', S, 'show=&floor=tile');
for (const m of ['paint', 'floor', 'paint,shell,floor']) await tiled(`${m.split(',').length > 1 ? 'room' : m}.mask.png`, 1, `show=&mask=${m}&light=mask`);
// Each wallpaper and each floor of the catalog, in 3D (scene-home.js `wallid`, `floorid`), and what is floor and room with them.
const SURF = Object.entries(ART.surfaces);
for (const [id, sf] of SURF) await tiled(`${id}.png`, S, sf.kind === 'wall' ? `show=&wallid=${id}` : `show=&floorid=${id}`);
await tiled('floor3d.mask.png', 1, 'show=&floorid=floor_wood_honey&mask=floor&light=mask');
await tiled('room3d.mask.png', 1, 'show=&wallid=wall_cream&floorid=floor_wood_honey&mask=paint,shell,floor&light=mask');
rect = rect ?? JSON.parse(fs.readFileSync(path.join(dir, 'rect.json'), 'utf8'));
const later = [];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const it of ITEMS) {
  if (only && !only.includes(it.id)) continue;
  const art = ART.items[it.id], [ax, ay] = rect.stage[it.id], [l, r, t, b] = MARGIN[it.mount];
  const [bx0, by0, bx1, by1] = art.box;
  const crop = { x: Math.floor((ax + bx0 - l) * PX), y: Math.floor((ay + by0 - t) * PX), w: 0, h: 0 };
  crop.w = Math.ceil((ax + bx1 + r) * PX) - crop.x; crop.h = Math.ceil((ay + by1 + b) * PX) - crop.y;
  fs.writeFileSync(path.join(dir, `${it.id}.crop.json`), JSON.stringify(crop));
  const q = `vw=${crop.w}&vh=${crop.h}&ox=${crop.x}&oy=${crop.y}`, show = [it.on, it.id].filter(Boolean).join(',');
  pass(`${it.id}.mask.png`, crop.w, crop.h, 1, `show=${show}&mask=${it.id}&light=mask&${q}`);
  for (const p of [...(it.parts ?? []), ...(it.cover ? [it.cover] : [])]) pass(`${p}.mask.png`, crop.w, crop.h, 1, `show=${show}&mask=${p}&light=mask&${q}`);
  pass(`${it.id}.png`, crop.w, crop.h, it.samples ?? S, `show=${show}&${q}`);
  if (it.on) pass(`${it.id}.under.png`, crop.w, crop.h, S, `show=${it.on}&${q}`);
  const first = ART.defaults.personal.items.find((p) => p.item === it.id)?.variant ?? art.variants[0].id;
  for (const v of art.variants) if (v.id !== first) {
    const args = [`${it.id}@${v.id}.png`, crop.w, crop.h, it.samples ? Math.round(it.samples * 0.75) : VS, `show=${show}&v=${it.id}:${v.id}&${q}`];
    try { pass(...args); } catch { say(`SKIPPED ${args[0]}, tried again at the end`); later.push(args); }
  }
}
fs.writeFileSync(path.join(dir, 'firsts.json'), JSON.stringify(Object.fromEntries(ITEMS.map((it) => [it.id, ART.defaults.personal.items.find((p) => p.item === it.id)?.variant ?? ART.items[it.id].variants[0].id]))));
for (const args of later) { try { pass(args[0], args[1], args[2], 48, args[4]); } catch { say(`GAVE UP ${args[0]}`); } }
say('ALL DONE');
