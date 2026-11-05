// node gen-plates.mjs <the app's src/screens folder> [seats json] : writes main/focusPlates.ts and together/groupPlates.ts from the plates.json of cut-study.mjs.
// The seats come from what scene-grouproom.js prints (window.__rect).
import fs from 'node:fs';
import path from 'node:path';
const [screens, seatsJson] = process.argv.slice(2);
const read = (n) => JSON.parse(fs.readFileSync(path.join('raw', n, 'plates.json'), 'utf8'));
const r = (dir, f) => `require('../../../assets/world/${dir}/${f}')`;
const box = (b) => JSON.stringify(b);
const WALLS = ['wall_cream', 'wall_mint', 'wall_lilac', 'wall_peach', 'wall_sky', 'wall_night'];
const FLOORS = ['floor_wood_light', 'floor_wood_honey', 'floor_wood_rose', 'floor_wood_night', 'floor_tile_cream', 'floor_tile_blue', 'floor_tile_lilac'];
const f = read('focus');
const fr = (n) => r('focusroom', n);
const sway = (file, b, origin, deg, ms) => `{ source: ${fr(file)}, box: ${box(b)}, origin: ${box(origin)}, deg: ${deg}, ms: ${ms} }`;
const items = {
  window: { variant: 'morning', anchor: [320, 118], extra: `glass: [272, 52, 96, 131], sway: [${sway('window-curtainL.webp', f.window.curtainL, [f.window.curtainL[0] + f.window.curtainL[2] / 2, f.window.curtainL[1]], 0.7, 3400)}, ${sway('window-curtainR.webp', f.window.curtainR, [f.window.curtainR[0] + f.window.curtainR[2] / 2, f.window.curtainR[1]], 0.7, 3900)}]` },
  memo_board: { variant: 'oak', anchor: [136, 116] }, wall_clock: { variant: 'mint', anchor: [470, 64], extra: 'clock: [0, 2]' }, calendar: { variant: 'red', anchor: [500, 150] },
  rug_oval: { variant: 'lilac', anchor: [320, 400] },
  desk: { variant: 'oak', anchor: [320, 352], extra: `cover: ${fr('desk-body.webp')}, coverBox: ${box(f.desk.cover)}` },
  book_stack: { variant: 'cool', anchor: [256, 266] }, desk_lamp: { variant: 'sage', anchor: [384, 266] }, mug: { variant: 'cream', anchor: [352, 266] },
  bookcase: { variant: 'oak', anchor: [566, 330] }, desk_plant: { variant: 'terracotta', anchor: [566, 160] },
  plant_monstera: { variant: 'terracotta', anchor: [74, 424], extra: `sway: [${sway('plant_monstera-leaves.webp', f.plant_monstera.leaves, [74, 386], 1.1, 3000)}]` },
};
const focus = `// Written by scripts/render-scenes/gen-plates.mjs from the render's numbers: where each picture of the focus room goes, on its 640 x 440 canvas.
import type { ImageSourcePropType } from 'react-native';

export type Box = [number, number, number, number];
export type SwayPart = { source: ImageSourcePropType; box: Box; origin: [number, number]; deg: number; ms: number };
export type FocusPlate = { variant: string; anchor: [number, number]; source: ImageSourcePropType; box: Box;
  /** Where the sky goes, under the picture. */ glass?: Box; /** The hands' centre, around its anchor. */ clock?: [number, number];
  /** Its own layers that stir. */ sway?: SwayPart[]; /** What goes over a pet at its seat. */ cover?: ImageSourcePropType; coverBox?: Box };

export const FOCUS_ITEMS: Record<string, FocusPlate> = {
${Object.entries(items).map(([id, it]) => `  ${id}: { variant: '${it.variant}', anchor: ${box(it.anchor)}, source: ${fr(`${id}.webp`)}, box: ${box(f[id].box)}${it.extra ? `, ${it.extra}` : ''} },`).join('\n')}
};
export const FOCUS_EXTRAS = { source: ${fr('extras.webp')}, box: ${box(f.extras.box)} as Box };
export const FOCUS_FORE: SwayPart[] = [
  ${sway('fore-left.webp', f['fore.left'].box, [f['fore.left'].box[0], f['fore.left'].box[1] + f['fore.left'].box[3]], 1.6, 3600)},
  ${sway('fore-right.webp', f['fore.right'].box, [f['fore.right'].box[0] + f['fore.right'].box[2], f['fore.right'].box[1] + f['fore.right'].box[3]], 1.6, 4100)},
  ${sway('fore-vine.webp', f['fore.vine'].box, [f['fore.vine'].box[0] + f['fore.vine'].box[2] / 2, f['fore.vine'].box[1]], 1.2, 4600)},
];
export const FOCUS_WALLS: Record<string, { source: ImageSourcePropType; top: ImageSourcePropType }> = {
${WALLS.map((id) => `  ${id}: { source: ${fr(`${id}.jpg`)}, top: ${fr(`${id}-top.jpg`)} },`).join('\n')}
};
export const FOCUS_FLOORS: Record<string, { source: ImageSourcePropType; box: Box; near: ImageSourcePropType }> = {
${FLOORS.map((id) => `  ${id}: { source: ${fr(`${id}.webp`)}, box: ${box(f[id])}, near: ${fr(`${id}-near.jpg`)} },`).join('\n')}
};
`;
fs.writeFileSync(path.join(screens, 'main', 'focusPlates.ts'), focus.replaceAll('\n', '\r\n'));
const g = read('group'), gr = (n) => r('grouproom', n);
const seats = seatsJson ? JSON.parse(fs.readFileSync(seatsJson, 'utf8')).seats : null;
const groupSway = (file, b, origin, deg, ms) => `{ source: ${gr(file)}, box: ${box(b)}, origin: ${box(origin)}, deg: ${deg}, ms: ${ms} }`;
const group = `// Written by scripts/render-scenes/gen-plates.mjs from the render's numbers: where each picture of the group room goes, on its 640 x 440 canvas.
import type { ImageSourcePropType } from 'react-native';

export type Box = [number, number, number, number];
export type SwayPart = { source: ImageSourcePropType; box: Box; origin: [number, number]; deg: number; ms: number };
export const GROUP_ROOM = ${gr('room.jpg')} as ImageSourcePropType;
export const GROUP_TOP = ${gr('room-top.jpg')} as ImageSourcePropType;
export const GROUP_NEAR = ${gr('room-near.jpg')} as ImageSourcePropType;
export const GROUP_TABLE = { source: ${gr('table.webp')} as ImageSourcePropType, box: ${box(g.table.box)} as Box };
export const GROUP_FRAME = { source: ${gr('win-frame.webp')} as ImageSourcePropType, box: ${box(g['win.frame'].box)} as Box };
/** Where the sky goes, under the frame. */
export const GROUP_GLASS: Box = [69, 50, 86, 120];
/** Where the board's writing goes. */
export const GROUP_BOARD: Box = [250, 58, 176, 92];
export const GROUP_SWAY: SwayPart[] = [
  ${groupSway('win-curtainL.webp', g['win.curtainL'].box, [g['win.curtainL'].box[0] + g['win.curtainL'].box[2] / 2, g['win.curtainL'].box[1]], 0.7, 3400)},
  ${groupSway('win-curtainR.webp', g['win.curtainR'].box, [g['win.curtainR'].box[0] + g['win.curtainR'].box[2] / 2, g['win.curtainR'].box[1]], 0.7, 3900)},
];
export const GROUP_FORE: SwayPart[] = [
  ${groupSway('fore-left.webp', g['fore.left'].box, [g['fore.left'].box[0], g['fore.left'].box[1] + g['fore.left'].box[3]], 1.6, 3600)},
  ${groupSway('fore-right.webp', g['fore.right'].box, [g['fore.right'].box[0] + g['fore.right'].box[2], g['fore.right'].box[1] + g['fore.right'].box[3]], 1.6, 4100)},
];
/** The eight seats: five chairs behind the table (their pets go under the table's picture) and three poufs in front. \`foot\` is where a pet's feet go. */
export const GROUP_SEATS: { source: ImageSourcePropType; box: Box; foot: [number, number]; row: 'back' | 'front' }[] = [
${Array.from({ length: 8 }, (_, i) => `  { source: ${gr(`seat${i}.webp`)}, box: ${box(g[`seat${i}`].box)}, foot: ${box(seats ? seats[i].foot : [0, 0])}, row: '${i < 5 ? 'back' : 'front'}' },`).join('\n')}
];
`;
fs.writeFileSync(path.join(screens, 'together', 'groupPlates.ts'), group.replaceAll('\n', '\r\n'));
console.log('written');
