// What Nhà của Pet is made of: which passes `render-home.mjs` renders and `cut-home.mjs` cuts. Every variant of each item here
// gets its own picture; anything else in the catalog keeps its 2D drawing in the app.
// `parts`: cut out apart (they sway). `cover`: drawn again over the pet at its seat. `swayAll`: the whole item sways in the app.
import { MORE } from './scenes/home-more.js';
const WALL_EXTRA = { window_round: { glass: [-40, -40, 40, 40], round: true }, curtains: { parts: ['curtains.curtainL', 'curtains.curtainR'] },
  wind_chime: { swayAll: [0, -37] }, lace_curtain: { swayAll: [0, -51] } };
/** Clear glass is noisy: more samples. */
const GLASSY = ['fish_tank', 'thunder_lamp', 'snow_globe', 'wave_jar', 'mist_jar'];
export const ITEMS = [
  { id: 'window', mount: 'wall', parts: ['window.curtainL', 'window.curtainR'], glass: [-46, -64, 46, 62] },
  { id: 'garland', mount: 'wall' }, { id: 'hanging_plant', mount: 'wall', swayAll: [0, -50] }, { id: 'wall_clock', mount: 'wall' },
  { id: 'painting_tulips', mount: 'wall' }, { id: 'cork_board', mount: 'wall' }, { id: 'memo_board', mount: 'wall' }, { id: 'wall_shelf', mount: 'wall' },
  { id: 'fairy_lights', mount: 'wall' },
  { id: 'desk', mount: 'floor', cover: 'desk.body' }, { id: 'chair', mount: 'floor' }, { id: 'cube_shelf', mount: 'floor' }, { id: 'bookcase', mount: 'floor' },
  { id: 'floor_lamp', mount: 'floor' }, { id: 'pet_bed_basket', mount: 'floor' }, { id: 'pet_bowl', mount: 'floor' }, { id: 'toy_plush', mount: 'floor' },
  { id: 'toy_basket', mount: 'floor' }, { id: 'toy_ball', mount: 'floor' }, { id: 'toy_blocks', mount: 'floor' },
  { id: 'plant_flowers', mount: 'floor', parts: ['plant_flowers.top'] }, { id: 'teddy_bear', mount: 'floor' },
  { id: 'plant_monstera', mount: 'floor', parts: ['plant_monstera.leaves'] },
  { id: 'rug_round', mount: 'rug' }, { id: 'rug_stripes', mount: 'rug' }, { id: 'rug_oval', mount: 'rug' },
  { id: 'book_stack', mount: 'top', on: 'cube_shelf' }, { id: 'night_lamp', mount: 'top', on: 'cube_shelf' }, { id: 'desk_lamp', mount: 'top', on: 'desk' },
  { id: 'pencil_cup', mount: 'top', on: 'desk' }, { id: 'notebook', mount: 'top', on: 'desk' }, { id: 'mug', mount: 'top', on: 'desk' }, { id: 'desk_plant', mount: 'top', on: 'desk' },
  ...MORE.wall.map((id) => ({ id, mount: 'wall', ...WALL_EXTRA[id] })),
  ...MORE.floor.map((id) => ({ id, mount: 'floor' })),
  ...MORE.rug.map((id) => ({ id, mount: 'rug' })),
  ...MORE.top.map((id) => ({ id, mount: 'top', on: 'desk', ...(GLASSY.includes(id) ? { samples: 192 } : {}) })),
];
/** Pixels per canvas unit, and the part of the bleed the room's own pictures cover (canvas units): from the wall's cap to under the slab. */
export const PX = 2;
export const SHELL = { x0: -120, y0: 128, x1: 540, y1: 840 };
/** Room round an item's catalog box for its shadow (canvas units): the sun is in front, to the left and high, so shadows fall right and back. */
export const MARGIN = { floor: [16, 46, 48, 14], top: [12, 30, 30, 10], wall: [14, 30, 26, 14], rug: [8, 8, 8, 8] }; // left, right, top, bottom
