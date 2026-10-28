import ART from '../../assets/room/room-art.json';
import type { Layout, Placement, Pose } from './types';

/**
 * Room artwork from assets/room/room-art.json, the file the backend also renders photos from (pet_room.py), so the
 * room on screen and the saved photo are drawn from the same shapes, in the same order. Everything is placed on one
 * 400 x 440 canvas: floor items stand with their feet on their anchor, wall items and rugs are centred on it.
 */
export const CANVAS = ART.canvas;
export type Spot = { x: number; feet: number; size: number };
export type Box = [number, number, number, number];
export type Variant = { id: string; name: string; swatch: string; colors: Record<string, string> };
export type ItemArt = {
  mount: 'wall' | 'floor' | 'rug'; role?: Pose; seat?: { dx: number; dy: number; size: number }; shadow?: [number, number];
  /** Mirrors left-right when true; tilts by `rotate[0]` degree steps up to `rotate[1]` either way. */
  flip?: boolean; rotate?: [number, number]; light?: { w: number; len: number };
  spawn: [number, number]; variants: Variant[]; box: Box; thumb: string; svg: string;
};
export const GUEST_SPOT = ART.spots.guest as Spot;
const RUG_SPOT = ART.spots.rug as Spot;
const ITEMS = ART.items as unknown as Record<string, ItemArt>;
const SURFACES = ART.surfaces as Record<string, { kind: 'wall' | 'floor'; svg: string; thumb: string }>;
const AREAS = ART.areas as unknown as Record<ItemArt['mount'], Box>;
const FEET = ART.feet as [number, number];

export const itemArt = (id: string): ItemArt | undefined => ITEMS[id];
export const variantOf = (art: ItemArt, id: string) => art.variants.find((v) => v.id === id) ?? art.variants[0];
const paint = (svg: string, colors: Record<string, string>) => svg.replace(/@(\w+)/g, (_, key: string) => colors[key] ?? '#000000');
const num = (value: number) => String(Math.round(value * 10) / 10);
// The backend rounds the same way, so a position settles to the same number on both sides.
const round = (value: number) => Math.floor(value + 0.5);
const fit = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));
const svgDoc = (viewBox: string, body: string, slice = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid ${slice ? 'slice' : 'meet'}">${body}</svg>`;

// ------------------------------------------------------------------------------------------------ geometry
/** The item's extent around its anchor once flipped (first) and tilted. */
export function itemBox(art: ItemArt, flip: boolean, rotate: number): Box {
  let [x0, y0, x1, y1] = art.box;
  if (flip) [x0, x1] = [-x1, -x0];
  if (rotate) {
    const a = (rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [x * c - y * s, x * s + y * c]);
    x0 = Math.min(...pts.map((p) => p[0])); x1 = Math.max(...pts.map((p) => p[0]));
    y0 = Math.min(...pts.map((p) => p[1])); y1 = Math.max(...pts.map((p) => p[1]));
  }
  return [x0, y0, x1, y1];
}

/** Moves an item back inside its area: wall items stay on the wall, rugs on the floor, floor items stand on the floor
 * with nothing outside the room. */
export function fitPosition(art: ItemArt, x: number, y: number, flip: boolean, rotate: number): { x: number; y: number } {
  const [x0, y0, x1, y1] = itemBox(art, flip, rotate);
  const [ax0, ay0, ax1, ay1] = AREAS[art.mount];
  const fx = fit(x, ax0 - x0, ax1 - x1);
  const fy = art.mount === 'floor' ? fit(y, Math.max(FEET[0], ay0 - y0), Math.min(FEET[1], ay1 - y1)) : fit(y, ay0 - y0, ay1 - y1);
  return { x: round(fx), y: round(fy) };
}

/** The same placement with its position kept inside the room after a move, flip or tilt. */
export function settle(p: Placement): Placement {
  const art = ITEMS[p.item];
  return art ? { ...p, ...fitPosition(art, p.x, p.y, p.flip, p.rotate) } : p;
}

/** A new placement of an item where it usually goes (its spawn point), in its first variant. */
export function placeNew(item: string): Placement | null {
  const art = ITEMS[item];
  if (!art) return null;
  return settle({ item, variant: art.variants[0].id, x: art.spawn[0], y: art.spawn[1], flip: false, rotate: 0 });
}

/** The next tilt: steps one way up to the limit, then back from the other side. */
export function nextRotation(art: ItemArt, rotate: number) {
  if (!art.rotate) return 0;
  const [step, limit] = art.rotate;
  return rotate + step > limit ? -limit : rotate + step;
}

/** Back to front: wall items, rugs, then floor items from the back of the room to the front. */
export function drawOrder(layout: Layout): Placement[] {
  const known = layout.items.filter((p) => ITEMS[p.item]);
  const on = (mount: ItemArt['mount']) => known.filter((p) => ITEMS[p.item].mount === mount);
  return [...on('wall'), ...on('rug'), ...on('floor').sort((a, b) => a.y - b.y)];
}

/** The placement whose box holds a point of the canvas, front-most first. */
export function itemAt(layout: Layout, x: number, y: number): Placement | null {
  const order = drawOrder(layout);
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i];
    const [x0, y0, x1, y1] = itemBox(ITEMS[p.item], p.flip, p.rotate);
    if (x >= p.x + x0 && x <= p.x + x1 && y >= p.y + y0 && y <= p.y + y1) return p;
  }
  return null;
}

/** Where a placed item sits on the canvas, for its selection frame. */
export function placedBox(p: Placement): Box | null {
  const art = ITEMS[p.item];
  if (!art) return null;
  const [x0, y0, x1, y1] = itemBox(art, p.flip, p.rotate);
  return [p.x + x0, p.y + y0, p.x + x1, p.y + y1];
}

const ROLE_SPOT: Record<Pose, Pose> = { rug: 'rug', study: 'study', rest: 'rest' };

/** Where the pet stands: on its rug, at its desk or on its bed, wherever they were put. Without a rug it stands in the
 * middle of the room. */
export function petSpot(layout: Layout, pose: Pose): Spot {
  let spot: Spot = { ...RUG_SPOT };
  const home = layout.items.find((p) => ITEMS[p.item]?.role === ROLE_SPOT[pose]);
  const seat = home && ITEMS[home.item].seat;
  if (home && seat) spot = { x: home.x + (home.flip ? -seat.dx : seat.dx), feet: home.y + seat.dy, size: seat.size };
  const half = spot.size / 2;
  return { ...spot, x: fit(spot.x, half + 2, CANVAS.width - half - 2), feet: fit(spot.feet, CANVAS.floorY + 24, CANVAS.height - 2) };
}

/** The pet studies at its desk and rests on its bed; without that furniture it stays on its rug (as in photos). */
export function poseFor(wanted: Pose, layout: Layout): Pose {
  return wanted === 'rug' || layout.items.some((p) => ITEMS[p.item]?.role === wanted) ? wanted : 'rug';
}

// ------------------------------------------------------------------------------------------------ drawing
function itemMarkup(p: Placement, withShadow = true) {
  const art = ITEMS[p.item];
  const transform = `translate(${p.x} ${p.y})${p.rotate ? ` rotate(${p.rotate})` : ''}${p.flip ? ' scale(-1 1)' : ''}`;
  const shadow = art.shadow && withShadow ?`<ellipse cx='${p.x}' cy='${p.y}' rx='${num(art.shadow[0])}' ry='${num(art.shadow[1])}' fill='#6B4E3C' opacity='.16'/>` : '';
  return `${shadow}<g transform='${transform}'>${paint(art.svg, variantOf(art, p.variant).colors)}</g>`;
}

/** Sunlight (or moonlight) from a window, falling on the floor in front of it. */
function lightMarkup(p: Placement) {
  const art = ITEMS[p.item];
  const colors = variantOf(art, p.variant).colors;
  const w = Math.floor(art.light!.w / 2), length = art.light!.len, top = CANVAS.floorY + 6, gid = `light-${p.item}`;
  return `<defs><linearGradient id='${gid}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${colors.light}' `
    + `stop-opacity='${colors.lightop}'/><stop offset='1' stop-color='${colors.light}' stop-opacity='0'/></linearGradient></defs>`
    + `<path d='M${p.x - w - 10} ${top}H${p.x + w + 10}L${p.x + w + 46} ${top + length + 8}H${p.x - w + 2}Z' fill='url(#${gid})' opacity='.5'/>`
    + `<path d='M${p.x - w} ${top}H${p.x + w}L${p.x + w + 30} ${top + length}H${p.x - w + 10}Z' fill='url(#${gid})'/>`;
}

/** Everything behind the pets as one SVG: wall, floor, wall items, rugs, window light, floor items back to front and a
 * soft vignette. Pets are always drawn on top of it, so no furniture ever covers them. */
export function roomSvg(layout: Layout): string {
  const order = drawOrder(layout);
  const wall = order.filter((p) => ITEMS[p.item].mount === 'wall');
  const rugs = order.filter((p) => ITEMS[p.item].mount === 'rug');
  const floor = order.filter((p) => ITEMS[p.item].mount === 'floor');
  const lights = layout.items.filter((p) => ITEMS[p.item]?.light);
  const body = (SURFACES[layout.wall]?.svg ?? '') + (SURFACES[layout.floor]?.svg ?? '')
    + wall.map((p) => itemMarkup(p)).join('') + rugs.map((p) => itemMarkup(p)).join('') + lights.map(lightMarkup).join('')
    + floor.map((p) => itemMarkup(p)).join('') + ART.vignette;
  return svgDoc(`0 0 ${CANVAS.width} ${CANVAS.height}`, body);
}

/** The floor items standing in front of feet at `feet` (further forward on the floor), back to front. */
export function itemsInFront(layout: Layout, feet: number): Placement[] {
  return drawOrder(layout).filter((p) => ITEMS[p.item].mount === 'floor' && p.y > feet);
}

/** Those items again, without their floor shadows, to draw over a pet that walked behind them. Null when none. */
export function frontSvg(items: Placement[]): string | null {
  if (!items.length) return null;
  const body = items.map((p) => itemMarkup(p, false)).join('');
  return svgDoc(`0 0 ${CANVAS.width} ${CANVAS.height}`, body);
}

/** One item on its own, cropped to it, for the decorating panel. Null when this app version has no drawing for it. */
export function itemThumb(id: string, variant?: string): string | null {
  const art = ITEMS[id];
  return art ? svgDoc(art.thumb, paint(art.svg, variantOf(art, variant ?? art.variants[0].id).colors)) : null;
}

/** A wall or floor swatch for the decorating panel. */
export function surfaceThumb(id: string): string | null {
  const surface = SURFACES[id];
  return surface ? svgDoc(surface.thumb, surface.svg, true) : null;
}
