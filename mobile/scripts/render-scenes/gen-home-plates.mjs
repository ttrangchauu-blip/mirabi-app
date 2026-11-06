// node gen-home-plates.mjs <raw dir> <the app's src/screens folder> : writes room/homePlates.ts from the plates.json of cut-home.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { ITEMS } from './home-items.mjs';
const [raw, screens] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(path.join(raw, 'plates.json'), 'utf8'));
const r = (f) => `require('../../../assets/world/home/${f}')`;
const fileOf = (n, v) => `${n.replaceAll('.', '-')}${v ? `@${v}` : ''}.webp`;
const b = (x) => JSON.stringify(x);
// How each moving part stirs: its pivot (canvas units, as rendered), how far at most and how slowly.
const SWAY = { 'window.curtainL': { deg: 0.7, ms: 3400, at: 'top' }, 'window.curtainR': { deg: 0.7, ms: 3900, at: 'top' },
  'curtains.curtainL': { deg: 0.7, ms: 3600, at: 'top' }, 'curtains.curtainR': { deg: 0.7, ms: 4100, at: 'top' },
  'plant_flowers.top': { deg: 1.6, ms: 3200, from: [0, -32] }, 'plant_monstera.leaves': { deg: 1.1, ms: 3000, from: [0, -50] } };
const lines = [];
for (const it of ITEMS) {
  const e = t.items[it.id];
  if (!e) continue;
  const [ax, ay] = e.anchor;
  const variants = Object.entries(e.variants).map(([v, x]) => {
    const parts = (it.parts ?? []).map((p) => {
      const box = x.parts[p.split('.').pop()], s = SWAY[p];
      const origin = s.at === 'top' ? [box[0] + box[2] / 2, box[1]] : [ax + s.from[0], ay + s.from[1]];
      return `{ source: ${r(fileOf(p, v))}, box: ${b(box)}, origin: ${b(origin.map((n) => +n.toFixed(1)))}, deg: ${s.deg}, ms: ${s.ms} }`;
    });
    return `      ${v}: { source: ${r(fileOf(it.id, v))}, box: ${b(x.box)}${parts.length ? `, sway: [${parts.join(', ')}]` : ''}${x.cover ? `, cover: { source: ${r(fileOf(it.cover, v))}, box: ${b(x.cover)} }` : ''} },`;
  });
  const extra = [it.glass ? `glass: ${b([ax + it.glass[0], ay + it.glass[1], it.glass[2] - it.glass[0], it.glass[3] - it.glass[1]])}` : '', it.round ? 'glassRound: true' : '',
    it.id === 'wall_clock' ? 'clock: [1.5, 2]' : '', it.swayAll ? `swayAll: { origin: ${b([ax + it.swayAll[0], ay + it.swayAll[1]])}, deg: ${it.id === 'lace_curtain' ? 0.6 : 1.3}, ms: ${it.id === 'wind_chime' ? 2800 : 3600} }` : ''].filter(Boolean);
  lines.push(`  ${it.id}: { anchor: ${b(e.anchor)},${extra.length ? ` ${extra.join(', ')},` : ''} variants: {\n${variants.join('\n')}\n  } },`);
}
const src = `// Written by scripts/render-scenes/gen-home-plates.mjs from the render's numbers: where each picture of Nhà của Pet goes, in canvas units of
// the 420 x 770 room (rooms.personal in room-art.json), as rendered with each item at its anchor.
import type { ImageSourcePropType } from 'react-native';

export type Box = [number, number, number, number];
export type Picture = { source: ImageSourcePropType; box: Box };
export type SwayPart = Picture & { origin: [number, number]; deg: number; ms: number };
export type HomeVariant = Picture & { /** Its own layers that stir. */ sway?: SwayPart[]; /** What goes over a pet at its seat. */ cover?: Picture };
export type HomePlate = { anchor: [number, number]; variants: Record<string, HomeVariant>;
  /** Where the sky goes, under the picture; glassRound: a round window. */ glass?: Box; glassRound?: boolean; /** The hands' centre, around its anchor. */ clock?: [number, number];
  /** The whole thing stirs around this point (it hangs from it). */ swayAll?: { origin: [number, number]; deg: number; ms: number } };

export const HOME_ITEMS: Record<string, HomePlate> = {
${lines.join('\n')}
};
export const HOME_WALLS: Record<string, Picture> = {
${Object.entries(t.walls).map(([id, box]) => `  ${id}: { source: ${r(`${id}.webp`)}, box: ${b(box)} },`).join('\n')}
};
export const HOME_FLOORS: Record<string, Picture> = {
${Object.entries(t.floors).map(([id, box]) => `  ${id}: { source: ${r(`${id}.webp`)}, box: ${b(box)} },`).join('\n')}
};
`;
fs.writeFileSync(path.join(screens, 'room', 'homePlates.ts'), src.replaceAll('\n', '\r\n'));
console.log('written', lines.length, 'items');
