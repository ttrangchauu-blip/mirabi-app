import type { ImageSourcePropType } from 'react-native';
import { WALK_CYCLE_MS } from '../../petSprites';

type Picture = { day: ImageSourcePropType; night: ImageSourcePropType; x: number; y: number; w: number; h: number };

/**
 * Khám phá's valley: rendered 3D (`scripts/render-scenes/scenes/scene-wild.js`, `cut-wild.mjs` prints the boxes and the road), every box a share of a whole picture.
 * Everything in a picture repeats across its width, so any picture of a layer can follow any other: the road comes in three stretches, the hills in two, the near flowers in two.
 * They go by at different speeds, so the same view does not come round again for a long while. No sky in them: the app draws the real one.
 */
export const WILD: { far: Picture; mids: Picture[]; lands: Picture[]; fronts: Picture[]; nears: Picture[] } = {
  far: { day: require('../../../assets/world/wild/far-day.webp'), night: require('../../../assets/world/wild/far-night.webp'), x: 0, y: 0, w: 1, h: 0.34 },
  mids: [
    { day: require('../../../assets/world/wild/mid0-day.webp'), night: require('../../../assets/world/wild/mid0-night.webp'), x: 0, y: 0.05, w: 1, h: 0.45 },
    { day: require('../../../assets/world/wild/mid1-day.webp'), night: require('../../../assets/world/wild/mid1-night.webp'), x: 0, y: 0.05, w: 1, h: 0.45 },
  ],
  lands: [
    { day: require('../../../assets/world/wild/land0-day.webp'), night: require('../../../assets/world/wild/land0-night.webp'), x: 0, y: 0.28, w: 1, h: 0.3129 },
    { day: require('../../../assets/world/wild/land1-day.webp'), night: require('../../../assets/world/wild/land1-night.webp'), x: 0, y: 0.28, w: 1, h: 0.3129 },
    { day: require('../../../assets/world/wild/land2-day.webp'), night: require('../../../assets/world/wild/land2-night.webp'), x: 0, y: 0.28, w: 1, h: 0.3129 },
  ],
  fronts: [
    { day: require('../../../assets/world/wild/front0-day.webp'), night: require('../../../assets/world/wild/front0-night.webp'), x: 0, y: 0.5, w: 1, h: 0.5 },
    { day: require('../../../assets/world/wild/front1-day.webp'), night: require('../../../assets/world/wild/front1-night.webp'), x: 0, y: 0.5, w: 1, h: 0.5 },
    { day: require('../../../assets/world/wild/front2-day.webp'), night: require('../../../assets/world/wild/front2-night.webp'), x: 0, y: 0.5, w: 1, h: 0.5 },
  ],
  nears: [
    { day: require('../../../assets/world/wild/near0-day.webp'), night: require('../../../assets/world/wild/near0-night.webp'), x: 0, y: 0.7, w: 1, h: 0.3 },
    { day: require('../../../assets/world/wild/near1-day.webp'), night: require('../../../assets/world/wild/near1-night.webp'), x: 0, y: 0.7, w: 1, h: 0.3 },
  ],
};
/** The few trees that move with the wind, per hill picture, each from its foot, in its own time. */
export const SWAY: (Picture & { ms: number; depth: number })[][] = [
  [
    { ...{ day: require('../../../assets/world/wild/h0t1-day.webp'), night: require('../../../assets/world/wild/h0t1-night.webp'), x: 0.124, y: 0.1129, w: 0.0828, h: 0.2307 }, ms: 3700, depth: 0.5 },
    { ...{ day: require('../../../assets/world/wild/h0t2-day.webp'), night: require('../../../assets/world/wild/h0t2-night.webp'), x: 0.5883, y: 0.1621, w: 0.0588, h: 0.1729 }, ms: 3300, depth: 0.6 },
    { ...{ day: require('../../../assets/world/wild/h0t3-day.webp'), night: require('../../../assets/world/wild/h0t3-night.webp'), x: 0.8286, y: 0.1414, w: 0.0727, h: 0.1986 }, ms: 3900, depth: 0.48 },
  ],
  [
    { ...{ day: require('../../../assets/world/wild/h1t1-day.webp'), night: require('../../../assets/world/wild/h1t1-night.webp'), x: 0.0656, y: 0.1686, w: 0.0597, h: 0.1664 }, ms: 3870, depth: 0.5 },
    { ...{ day: require('../../../assets/world/wild/h1t2-day.webp'), night: require('../../../assets/world/wild/h1t2-night.webp'), x: 0.389, y: 0.1036, w: 0.0786, h: 0.2393 }, ms: 3470, depth: 0.6 },
    { ...{ day: require('../../../assets/world/wild/h1t3-day.webp'), night: require('../../../assets/world/wild/h1t3-night.webp'), x: 0.7312, y: 0.1507, w: 0.0614, h: 0.1886 }, ms: 4070, depth: 0.48 },
  ],
];
/** The road through each stretch, measured through the render's own camera: [share of the width, share of the height, how many of the picture's heights one unit stands there]. Every stretch starts and ends on the same row. */
export const ROADS: readonly (readonly (readonly [number, number, number])[])[] = [[[0,0.4259,0.1286],[0.025,0.4261,0.1288],[0.05,0.4267,0.1292],[0.075,0.4276,0.1298],[0.1,0.4289,0.1307],[0.125,0.4305,0.1318],[0.15,0.4324,0.1331],[0.175,0.4346,0.1346],[0.2,0.4369,0.1362],[0.225,0.4393,0.1378],[0.25,0.4418,0.1396],[0.275,0.4442,0.1413],[0.3,0.4467,0.1429],[0.325,0.449,0.1445],[0.35,0.4511,0.146],[0.375,0.453,0.1473],[0.4,0.4546,0.1484],[0.425,0.4559,0.1493],[0.45,0.4568,0.1499],[0.475,0.4574,0.1503],[0.5,0.4576,0.1505],[0.525,0.4574,0.1503],[0.55,0.4568,0.1499],[0.575,0.4559,0.1493],[0.6,0.4546,0.1484],[0.625,0.453,0.1473],[0.65,0.4511,0.146],[0.675,0.449,0.1445],[0.7,0.4467,0.1429],[0.725,0.4442,0.1413],[0.75,0.4418,0.1396],[0.775,0.4393,0.1378],[0.8,0.4369,0.1362],[0.825,0.4346,0.1346],[0.85,0.4324,0.1331],[0.875,0.4305,0.1318],[0.9,0.4289,0.1307],[0.925,0.4276,0.1298],[0.95,0.4267,0.1292],[0.975,0.4261,0.1288],[1,0.4259,0.1286]],[[0,0.4259,0.1286],[0.025,0.426,0.1287],[0.05,0.4261,0.1287],[0.075,0.426,0.1287],[0.1,0.4255,0.1283],[0.125,0.4241,0.1274],[0.15,0.4219,0.1259],[0.175,0.4188,0.1237],[0.2,0.4151,0.1212],[0.225,0.4113,0.1186],[0.25,0.408,0.1163],[0.275,0.4059,0.1148],[0.3,0.4054,0.1145],[0.325,0.407,0.1156],[0.35,0.4106,0.1181],[0.375,0.4157,0.1216],[0.4,0.4218,0.1258],[0.425,0.4279,0.13],[0.45,0.4331,0.1336],[0.475,0.4366,0.136],[0.5,0.4378,0.1368],[0.525,0.4366,0.136],[0.55,0.4331,0.1336],[0.575,0.4279,0.13],[0.6,0.4218,0.1258],[0.625,0.4157,0.1216],[0.65,0.4106,0.1181],[0.675,0.407,0.1156],[0.7,0.4054,0.1145],[0.725,0.4059,0.1148],[0.75,0.408,0.1163],[0.775,0.4113,0.1186],[0.8,0.4151,0.1212],[0.825,0.4188,0.1237],[0.85,0.4219,0.1259],[0.875,0.4241,0.1274],[0.9,0.4255,0.1283],[0.925,0.426,0.1287],[0.95,0.4261,0.1287],[0.975,0.426,0.1287],[1,0.4259,0.1286]],[[0,0.4259,0.1286],[0.025,0.4256,0.1284],[0.05,0.4249,0.1279],[0.075,0.4238,0.1272],[0.1,0.4226,0.1263],[0.125,0.4213,0.1255],[0.15,0.4203,0.1248],[0.175,0.4198,0.1244],[0.2,0.42,0.1246],[0.225,0.421,0.1253],[0.25,0.4229,0.1266],[0.275,0.4257,0.1285],[0.3,0.4292,0.1309],[0.325,0.4334,0.1338],[0.35,0.4378,0.1368],[0.375,0.4424,0.14],[0.4,0.4466,0.1429],[0.425,0.4503,0.1455],[0.45,0.4532,0.1474],[0.475,0.455,0.1487],[0.5,0.4556,0.1491],[0.525,0.455,0.1487],[0.55,0.4532,0.1474],[0.575,0.4503,0.1455],[0.6,0.4466,0.1429],[0.625,0.4424,0.14],[0.65,0.4378,0.1368],[0.675,0.4334,0.1338],[0.7,0.4292,0.1309],[0.725,0.4257,0.1285],[0.75,0.4229,0.1266],[0.775,0.421,0.1253],[0.8,0.42,0.1246],[0.825,0.4198,0.1244],[0.85,0.4203,0.1248],[0.875,0.4213,0.1255],[0.9,0.4226,0.1263],[0.925,0.4238,0.1272],[0.95,0.4249,0.1279],[0.975,0.4256,0.1284],[1,0.4259,0.1286]]];

/** The whole picture's width over its height. */
export const WIDE = 2.2;
/** How fast each layer slides against the road's 1, by how far away it is. */
export const RATE = { far: 0.06, mid: 0.36, front: 1.5, near: 2.1 };
/** Where the pet walks across the screen, as a share of its width; it stays there and the world goes by. */
export const WALK_X = 0.44;
/** Points walked per full loop of the walk strip, as a share of the pet's size (the same as LivingPet's stroll). */
const STRIDE_SHARE = 0.62;
/** The row of the mountains' peaks. */
const RIDGE = 0.05;
/** The land starts this far down the screen, and goes on past its bottom. */
const SKY_SHARE = 0.26;
const LAND_SHARE = 0.82;
/** The tab bar, the gap and the card as they usually stand: the road stays above them, also on the smallest phone. */
const BELOW_ROAD = 84 + 10 + 190 + 16;

const allRows = ROADS.flat();
const HOME_SHARE = ROADS[0][0][2];
/** How much bigger or smaller the pet is where the road comes nearer or goes further off: most of what the camera says, not all. */
export const scaleAt = (share: number) => Math.round((1 + (share / HOME_SHARE - 1) * 0.7) * 1000) / 1000;

export type ValleyLayout = ReturnType<typeof valleyLayout>;
/**
 * Everything in the scene, from the size of the window: not the space left over by the app's bars, so hiding them moves
 * nothing. The picture keeps its shape: a taller window shows more of it, a wider one more of the road at each moment.
 * The pet goes by the window's height alone: its art fills about 95% of its box, which makes it 12-14% of the scene on a phone.
 */
export function valleyLayout(width: number, height: number) {
  const lowest = Math.max(...allRows.map(([, row]) => row));
  // Never so small that lifting the road above the card leaves a gap at the bottom of a short phone.
  const tall = Math.max(height * LAND_SHARE, (width * 1.25) / WIDE, (BELOW_ROAD + 6) / (1 - lowest));
  const wide = tall * WIDE;
  const top = Math.min(height * SKY_SHARE, height - BELOW_ROAD - lowest * tall);
  return { wide, tall, top, bottom: top + tall, pet: Math.round(Math.max(84, Math.min(124, height * 0.128))), ridge: RIDGE };
}

/** The pace of the walk: a whole number of strip loops per picture, so the road moves exactly as fast as its feet. */
export function pacing(wide: number, petSize: number, cycleMs = WALK_CYCLE_MS) {
  const steps = Math.max(1, Math.round(wide / (petSize * STRIDE_SHARE)));
  return { steps, stride: wide / steps, tileMs: steps * cycleMs };
}

/** How long one loop of a layer takes: `pictures` of them, each going by `rate` times as fast as the road's. */
export const loopMs = (tileMs: number, pictures: number, rate: number) => (tileMs * pictures) / rate;

/** Where a loop is after this long: only the clock counts, so it needs nothing to be remembered. */
export const loopAt = (elapsedMs: number, ms: number) => { const at = (elapsedMs % ms) / ms; return at < 0 ? at + 1 : at; };

/**
 * Which pictures of a loop to keep mounted: those on the screen or within `margin` of it. A strip has one more slot than it
 * has pictures, the first again, so the slide starts over without a jump; just before that, the first slot comes on too.
 */
export function shownSlots(pictures: number, wide: number, width: number, at: number, margin: number) {
  const span = pictures * wide, x = at * span;
  const slots: number[] = [];
  for (let slot = 0; slot <= pictures; slot++) {
    const left = slot * wide;
    if (left < x + width + margin && left + wide > x - margin) slots.push(slot);
  }
  if (x + margin >= span && !slots.includes(0)) slots.unshift(0);
  return slots;
}

/**
 * The road under the pet over one whole loop of the road: for a value 0 to 1 of the loop, the row its feet are on and how
 * near it stands. Both ends are the same place, so a new loop starts with no jump.
 */
export function roadTrack(petShare: number) {
  const count = ROADS.length;
  const points: { at: number; row: number; scale: number }[] = [];
  ROADS.forEach((road, stretch) => road.slice(0, -1).forEach(([u, row, share]) => {
    const along = stretch + u; // Where this point of the road is, in pictures from the first.
    const at = (((along - petShare) / count) % 1 + 1) % 1;
    points.push({ at, row, scale: scaleAt(share) });
  }));
  points.sort((a, b) => a.at - b.at);
  // Where the line between the last point and the first crosses the start of the loop.
  const first = points[0], last = points[points.length - 1], gap = first.at + 1 - last.at, t = gap > 0 ? (1 - last.at) / gap : 0;
  const mix = (a: number, b: number) => a + (b - a) * t;
  const seam = { row: mix(last.row, first.row), scale: mix(last.scale, first.scale) };
  const line = [{ at: 0, ...seam }, ...points.filter((p) => p.at > 0 && p.at < 1), { at: 1, ...seam }];
  return { at: line.map((p) => p.at), rows: line.map((p) => p.row), scales: line.map((p) => p.scale) };
}
