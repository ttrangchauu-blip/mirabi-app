import ART from '../../assets/room/room-art.json';
import type { Layout, Placement, Pose, RoomKind } from './types';

/**
 * Room artwork from assets/room/room-art.json, the file the backend also renders photos from (pet_room.py), so the
 * room on screen and the saved photo are drawn from the same shapes, in the same order. Each room kind has its own
 * canvas (personal 420 x 770, the screen above the menu bar; focus 640 x 440): floor and top items stand with their feet on
 * their anchor, wall items and rugs are centred on it. Top items stand on the top of a desk or shelf (its `tops`).
 */
export type Box = [number, number, number, number];
export type Spot = { x: number; feet: number; size: number };
type Geometry = { canvas: { width: number; height: number; floorY: number }; areas: Record<ItemArt['mount'], Box>;
  feet: [number, number]; spots: { rug: Spot; guest: Spot }; vignette: string;
  /** Where the room's content starts: above it the wall goes on behind the app's header (personal room). */
  top: number;
  /** How far around the canvas the wall and floor are drawn, so a screen of any shape is filled (personal room). */
  bleed?: Box;
  /** The size of the room's pets against their spots and seats (the personal room's are a little smaller). */
  petScale?: number };
const ROOMS = (ART as any).rooms as Record<RoomKind, Geometry>;
export const geometry = (kind: RoomKind = 'personal') => ROOMS[kind];
export const CANVAS = ROOMS.personal.canvas;
export type Variant = { id: string; name: string; swatch: string; colors: Record<string, string> };
export type ItemArt = {
  mount: 'wall' | 'floor' | 'rug' | 'top'; role?: Pose; shadow?: [number, number];
  /** Where the pet sits on it. `sink` lowers a pet drawn with its standing artwork, so the item's cover hides its legs;
   * `studySink` lowers its studying strip a little, so it sits behind the desk with its book on the desk top. */
  seat?: { dx: number; dy: number; size: number; sink?: number; studySink?: number };
  /** Mirrors left-right when true; tilts by `rotate[0]` degree steps up to `rotate[1]` either way. */
  flip?: boolean; rotate?: [number, number]; light?: { w: number; len: number };
  /** Its flat tops where top items stand: [x0, x1, dy] around its anchor (unflipped). */
  tops?: [number, number, number][];
  spawn: [number, number]; variants: Variant[]; box: Box; thumb: string; svg: string;
  /** The part of the drawing in front of its seat (a desk's top edge, drawers and what stands on it), drawn again
   * over the seated pet, so the pet sits behind it. */
  cover?: string;
};
export type Palette = { id: string; name: string; swatches: string[]; wall: string; floor: string; prefer: string[] };
const PET_SCALE = (kind: RoomKind) => ROOMS[kind].petScale ?? 1;
export const GUEST_SPOT: Spot = { ...ROOMS.personal.spots.guest, size: ROOMS.personal.spots.guest.size * PET_SCALE('personal') };
const ITEMS = ART.items as unknown as Record<string, ItemArt>;
const SURFACES = (ART as any).surfaces as Record<string, { kind: 'wall' | 'floor'; svg: string; focus: string; thumb: string }>;
export const PALETTES = ((ART as any).palettes ?? []) as Palette[];
const DEFAULTS = (ART as any).defaults as Record<RoomKind, Layout>;

export const itemArt = (id: string): ItemArt | undefined => ITEMS[id];
/** What tells placements apart: a found decoration's copy by its uid, any other item by its id (once per room). */
export const keyOf = (p: Placement) => p.uid ?? p.item;
export const variantOf = (art: ItemArt, id: string) => art.variants.find((v) => v.id === id) ?? art.variants[0];
const transformOf = (p: Placement) => `translate(${p.x} ${p.y})${p.rotate ? ` rotate(${p.rotate})` : ''}${p.flip ? ' scale(-1 1)' : ''}`;
const paint = (svg: string, colors: Record<string, string>) => svg.replace(/@(\w+)/g, (_, key: string) => colors[key] ?? '#000000');
const num = (value: number) => String(Math.round(value * 10) / 10);
// The backend rounds the same way, so a position settles to the same number on both sides.
const round = (value: number) => Math.floor(value + 0.5);
const fit = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high));
const svgDoc = (viewBox: string, body: string, slice = false) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid ${slice ? 'slice' : 'meet'}">${body}</svg>`;
const canvasBox = (kind: RoomKind): Box => [0, 0, ROOMS[kind].canvas.width, ROOMS[kind].canvas.height];
const viewOf = ([x0, y0, x1, y1]: Box) => `${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)}`;

/** What a space of `width` x `height` points shows of the room, and at what scale (points per canvas unit). A room drawn
 * with a `bleed` is as wide as the space, its content (everything below its `top`) between `safeTop` and `safeBottom`
 * points (a header drawn over the room and the menu bar over its bottom edge), never stretched, and the bottom of the
 * canvas, the front edge of the floor items can be placed on, exactly at the bottom of what is shown above the bar: no
 * floor is drawn there that items could not stand on. Whatever is left is more wall above the room (and wall and floor
 * at the sides, on a wide screen). A room without one is shown whole, at the size that fits. Decorating uses the same
 * camera (its header and panel are drawn over the room), so an item is on the same spot of the screen in both. */
export function roomView(kind: RoomKind, width: number, height: number, safeTop = 0, safeBottom = 0): { k: number; view: Box } {
  const geo = ROOMS[kind];
  const { width: w, height: h } = geo.canvas;
  if (!geo.bleed) return { k: Math.min(width / w, height / h), view: canvasBox(kind) };
  const shown = height - safeBottom;
  const k = Math.min(width / w, Math.max(1, shown - safeTop) / (h - geo.top));
  const vw = width / k, vh = height / k;
  const x0 = (w - vw) / 2;
  const y0 = h - shown / k; // on a very tall screen above the drawn wall: roomSvg carries the wall on up there
  return { k, view: [x0, y0, x0 + vw, y0 + vh] };
}

/** Where a point of the personal room's canvas before art v5 (400 wide, floor from 292 to 440) is today: the same
 * arrangement across today's width, the wall spread over the taller wall and the floor evenly over the deeper floor, so
 * a desk a sixth of the way into the old floor is a sixth of the way into today's, and the front of the room is used
 * as before (the backend reads rooms saved on the older canvases the same way, pet_room.legacy_point). */
export function legacyPoint(mount: ItemArt['mount'], x: number, y: number): { x: number; y: number } {
  const geo = ROOMS.personal, { width, height, floorY } = geo.canvas;
  const nx = width / 2 + ((x - 200) * width) / 400;
  if (mount === 'wall') return { x: nx, y: geo.top + (y * (floorY - geo.top)) / 292 };
  const d = y - 292;
  return { x: nx, y: floorY + (d > 0 ? (d * (height - floorY)) / 148 : d) };
}

/** The room a new user gets (a copy, safe to change). */
export function defaultLayout(kind: RoomKind = 'personal'): Layout {
  return JSON.parse(JSON.stringify(DEFAULTS[kind]));
}

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
 * with nothing outside the room. A top item only stays inside the room; its support decides its height. */
export function fitPosition(art: ItemArt, x: number, y: number, flip: boolean, rotate: number, kind: RoomKind = 'personal'): { x: number; y: number } {
  const geo = ROOMS[kind];
  const [x0, y0, x1, y1] = itemBox(art, flip, rotate);
  const [ax0, ay0, ax1, ay1] = geo.areas[art.mount];
  const fx = fit(x, ax0 - x0, ax1 - x1);
  const fy = art.mount === 'floor' ? fit(y, Math.max(geo.feet[0], ay0 - y0), Math.min(geo.feet[1], ay1 - y1)) : fit(y, ay0 - y0, ay1 - y1);
  return { x: round(fx), y: round(fy) };
}

/** The same placement with its position kept inside the room after a move, flip or tilt. */
export function settle(p: Placement, kind: RoomKind = 'personal'): Placement {
  const art = ITEMS[p.item];
  return art ? { ...p, ...fitPosition(art, p.x, p.y, p.flip, p.rotate, kind) } : p;
}

/** A layout as received, with every item inside its part of the room (`settle`): wall items on the wall, everything
 * else on the floor, and what stands on a desk or shelf moved with it. The backend stores rooms that way; this keeps
 * one that comes back otherwise (an outdated server, an old cache) visible and reachable instead of drawn above the
 * room or under the floor. Items already in place are returned as they are. */
export function inZones(layout: Layout, kind: RoomKind = 'personal'): Layout {
  const known = layout.items.filter((p) => ITEMS[p.item]);
  const { on } = carried(known);
  const by = (p: Placement, dx: number, dy: number) => (dx || dy ? { ...p, x: p.x + dx, y: p.y + dy } : p);
  const moved = new Map<string, Placement>();
  for (const p of known) {
    if (ITEMS[p.item].mount === 'top') continue;
    const fit = settle(p, kind);
    moved.set(keyOf(p), by(p, fit.x - p.x, fit.y - p.y));
    for (const r of on.get(keyOf(p)) ?? []) moved.set(keyOf(r), by(r, fit.x - p.x, fit.y - p.y));
  }
  for (const p of known) {
    if (ITEMS[p.item].mount !== 'top' || moved.has(keyOf(p))) continue;
    const fit = settle(p, kind); // standing on nothing: only kept inside the room
    moved.set(keyOf(p), by(p, fit.x - p.x, fit.y - p.y));
  }
  const items = layout.items.map((p) => moved.get(keyOf(p)) ?? p);
  return items.every((p, i) => p === layout.items[i]) ? layout : { ...layout, items };
}

/** A new placement of an item where it usually goes, in its first variant. Spawn points are on the 400 x 440 canvas the
 * rooms once had (the focus room still has its floor line): moved onto the personal room's canvas, or spread over the
 * focus room's wider one. The editor then looks for a free place near it (room/rules.ts). */
export function placeNew(item: string, kind: RoomKind = 'personal'): Placement | null {
  const art = ITEMS[item];
  if (!art) return null;
  const [sx, sy] = art.spawn;
  const { x, y } = kind === 'personal' ? legacyPoint(art.mount, sx, sy) : { x: (sx * ROOMS[kind].canvas.width) / 400, y: sy };
  return settle({ item, variant: art.variants[0].id, x, y, flip: false, rotate: 0 }, kind);
}

/** The next tilt: steps one way up to the limit, then back from the other side. */
export function nextRotation(art: ItemArt, rotate: number) {
  if (!art.rotate) return 0;
  const [step, limit] = art.rotate;
  return rotate + step > limit ? -limit : rotate + step;
}

// ------------------------------------------------------------------------------------------------ supports
export type TopLine = { x0: number; x1: number; y: number };
/** The tops of a placed support where top items stand, in canvas units. */
export function topLines(p: Placement): TopLine[] {
  return (ITEMS[p.item]?.tops ?? []).map(([tx0, tx1, dy]) => (p.flip ? { x0: p.x - tx1, x1: p.x - tx0, y: p.y + dy } : { x0: p.x + tx0, x1: p.x + tx1, y: p.y + dy }));
}
/** Whole canvas units within this of a top count as standing on it (positions are whole numbers, tops may not be). */
const SNAP = 1;

/** Whether a top item placed at `p` fits on this top. */
export function fitsOn(p: Placement, line: TopLine): boolean {
  const [bx0, , bx1] = itemBox(ITEMS[p.item], p.flip, p.rotate);
  return Math.abs(p.y - line.y) <= SNAP && p.x + bx0 >= line.x0 - 2 && p.x + bx1 <= line.x1 + 2;
}

/** The support a top item stands on (same rule as the backend's support_of). */
export function supportOf(p: Placement, items: Placement[]): Placement | null {
  for (const s of items) {
    if (keyOf(s) === keyOf(p) || !ITEMS[s.item]?.tops) continue;
    if (topLines(s).some((line) => fitsOn(p, line))) return s;
  }
  return null;
}

/** Top items by the key (`keyOf`) of the support they stand on (back to front), and those standing on nothing. */
export function carried(items: Placement[]): { on: Map<string, Placement[]>; loose: Placement[] } {
  const on = new Map<string, Placement[]>();
  const loose: Placement[] = [];
  for (const p of items) {
    if (ITEMS[p.item]?.mount !== 'top') continue;
    const s = supportOf(p, items);
    if (!s) loose.push(p);
    else on.set(keyOf(s), [...(on.get(keyOf(s)) ?? []), p]);
  }
  on.forEach((list) => list.sort((a, b) => a.y - b.y || a.x - b.x));
  return { on, loose };
}

/** Back to front: wall items, rugs, then floor items from the back of the room to the front; a support's top items
 * right after it, and top items standing on nothing last. */
export function drawOrder(layout: Layout): Placement[] {
  const known = layout.items.filter((p) => ITEMS[p.item]);
  const { on, loose } = carried(known);
  const mount = (m: ItemArt['mount']) => known.filter((p) => ITEMS[p.item].mount === m);
  const order: Placement[] = [];
  for (const p of [...mount('wall'), ...mount('rug'), ...mount('floor').sort((a, b) => a.y - b.y)]) order.push(p, ...(on.get(keyOf(p)) ?? []));
  return [...order, ...loose];
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

/** The furniture the pet uses for a pose (its rug, desk or bed), if the room has one. */
export const homeOf = (layout: Layout, pose: Pose) => layout.items.find((p) => ITEMS[p.item]?.role === ROLE_SPOT[pose]);

/** Where the pet stands: on its rug, at its desk or on its bed, wherever they were put. Without a rug it stands in the
 * middle of the room. At a desk it sits on the chair behind it, above the floor. */
export function petSpot(layout: Layout, pose: Pose, kind: RoomKind = 'personal'): Spot {
  const geo = ROOMS[kind];
  let spot: Spot = { ...geo.spots.rug };
  const home = homeOf(layout, pose);
  const seat = home && ITEMS[home.item].seat;
  if (home && seat) spot = { x: home.x + (home.flip ? -seat.dx : seat.dx), feet: home.y + seat.dy, size: seat.size };
  spot.size *= PET_SCALE(kind);
  const half = spot.size / 2, behind = Boolean(seat && ITEMS[home!.item].cover);
  return { ...spot, x: fit(spot.x, half + 2, geo.canvas.width - half - 2),
    feet: fit(spot.feet, behind ? spot.size : geo.canvas.floorY + 24, geo.canvas.height - 2) };
}

/** The front of the furniture the pet sits behind (its desk) and what stands on it, to draw over the pet (on the
 * canvas), and how far to lower a pet drawn with its standing artwork. Null when its spot has nothing in front of it. */
export function seatCover(layout: Layout, pose: Pose, kind: RoomKind = 'personal'):
  { svg: string; sink: number; studySink: number } | null {
  const home = homeOf(layout, pose);
  const art = home ? ITEMS[home.item] : undefined;
  if (!home || !art?.cover || !art.seat) return null;
  const onDesk = carried(layout.items.filter((p) => ITEMS[p.item])).on.get(keyOf(home)) ?? [];
  const body = `<g transform='${transformOf(home)}'>${paint(art.cover, variantOf(art, home.variant).colors)}</g>` + onDesk.map((p) => itemMarkup(p)).join('');
  const scale = PET_SCALE(kind);
  return { svg: svgDoc(viewOf(canvasBox(kind)), body), sink: (art.seat.sink ?? 0) * scale, studySink: (art.seat.studySink ?? 0) * scale };
}

/** The pet studies at its desk and rests on its bed; without that furniture it stays on its rug (as in photos). */
export function poseFor(wanted: Pose, layout: Layout): Pose {
  return wanted === 'rug' || layout.items.some((p) => ITEMS[p.item]?.role === wanted) ? wanted : 'rug';
}

// ------------------------------------------------------------------------------------------------ the pet's room
/** The strip of floor a floor item stands on (as walk.obstacles, without the pet's width). */
export function footprint(p: Placement): Box {
  const [x0, , x1] = itemBox(ITEMS[p.item], p.flip, p.rotate);
  const depth = Math.min(36, Math.max(14, (x1 - x0) * 0.3));
  return [p.x + x0 + 4, p.y - depth - 6, p.x + x1 - 4, p.y + 6];
}

/** Every spot the pet uses in this room and the item it belongs to: rug, desk and bed in the personal room; the desk
 * (or, without one, its rug) in the focus room. */
export function petHomes(layout: Layout, kind: RoomKind): { spot: Spot; home: string | null }[] {
  const poses: Pose[] = kind === 'personal' ? ['rug', 'study', 'rest'] : ['study'];
  const out: { spot: Spot; home: string | null }[] = [];
  for (const wanted of poses) {
    const pose = poseFor(wanted, layout);
    const home = homeOf(layout, pose);
    const entry = { spot: petSpot(layout, pose, kind), home: home ? keyOf(home) : null };
    if (!out.some((o) => o.home === entry.home && o.spot.x === entry.spot.x && o.spot.feet === entry.spot.feet)) out.push(entry);
  }
  return out;
}

/** Floor items standing where the pet stands, or in front of it hiding most of it, by `keyOf` (same rule as the backend). */
export function blockingItems(layout: Layout, kind: RoomKind): Set<string> {
  const blocked = new Set<string>();
  for (const { spot, home } of petHomes(layout, kind)) {
    const half = spot.size * 0.32;
    const zone: Box = [spot.x - half, spot.feet - spot.size * 0.85, spot.x + half, spot.feet];
    const area = (zone[2] - zone[0]) * (zone[3] - zone[1]);
    for (const p of layout.items) {
      const art = ITEMS[p.item];
      if (!art || art.mount !== 'floor' || keyOf(p) === home) continue;
      const [fx0, fy0, fx1, fy1] = footprint(p);
      if (fx0 < spot.x && spot.x < fx1 && fy0 < spot.feet && spot.feet < fy1) { blocked.add(keyOf(p)); continue; }
      if (p.y > spot.feet) {
        const [x0, y0, x1, y1] = itemBox(art, p.flip, p.rotate);
        const w = Math.min(zone[2], p.x + x1) - Math.max(zone[0], p.x + x0);
        const h = Math.min(zone[3], p.y + y1) - Math.max(zone[1], p.y + y0);
        if (w > 0 && h > 0 && w * h > 0.25 * area) blocked.add(keyOf(p));
      }
    }
  }
  return blocked;
}

// ------------------------------------------------------------------------------------------------ palettes
/** A colour palette: its wall and floor, and every placed item in the first variant of `prefer` it has. A found
 * decoration's copy keeps its colour: it is the copy the inventory holds. */
export function applyPalette(layout: Layout, palette: Palette): Layout {
  const items = layout.items.map((p) => {
    if (p.uid) return p;
    const ids = ITEMS[p.item]?.variants.map((v) => v.id) ?? [];
    const pick = palette.prefer.find((id) => ids.includes(id));
    return pick ? { ...p, variant: pick } : p;
  });
  return { wall: SURFACES[palette.wall] ? palette.wall : layout.wall, floor: SURFACES[palette.floor] ? palette.floor : layout.floor, items };
}

// ------------------------------------------------------------------------------------------------ drawing
function itemMarkup(p: Placement, withShadow = true) {
  const art = ITEMS[p.item];
  const shadow = art.shadow && withShadow ? `<ellipse cx='${p.x}' cy='${p.y}' rx='${num(art.shadow[0])}' ry='${num(art.shadow[1])}' fill='#6B4E3C' opacity='.16'/>` : '';
  return `${shadow}<g transform='${transformOf(p)}'>${ownIds(paint(art.svg, variantOf(art, p.variant).colors), p)}</g>`;
}

/** A copy's gradient ids get its uid, so two copies in other colours never share one (same as the backend's _own_ids). */
function ownIds(svg: string, p: Placement) {
  if (!p.uid) return svg; // item ids are plain [a-z_]
  return svg.replace(new RegExp(`(id='|url\\(#)(${p.item}-[\\w-]*)`, 'g'), (_, a: string, b: string) => `${a}${b}-${p.uid}`);
}

/** Sunlight (or moonlight) from a window, falling on the floor in front of it. */
function lightMarkup(p: Placement, kind: RoomKind) {
  const art = ITEMS[p.item];
  const colors = variantOf(art, p.variant).colors;
  const w = Math.floor(art.light!.w / 2), length = art.light!.len, top = ROOMS[kind].canvas.floorY + 6, gid = `light-${keyOf(p)}`;
  return `<defs><linearGradient id='${gid}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${colors.light}' `
    + `stop-opacity='${colors.lightop}'/><stop offset='1' stop-color='${colors.light}' stop-opacity='0'/></linearGradient></defs>`
    + `<path d='M${p.x - w - 10} ${top}H${p.x + w + 10}L${p.x + w + 46} ${top + length + 8}H${p.x - w + 2}Z' fill='url(#${gid})' opacity='.5'/>`
    + `<path d='M${p.x - w} ${top}H${p.x + w}L${p.x + w + 30} ${top + length}H${p.x - w + 10}Z' fill='url(#${gid})'/>`;
}

/** Everything behind the pets as one SVG: wall, floor, wall items (with what stands on wall shelves), rugs, window
 * light, floor items back to front (each with what stands on it) and a soft vignette. Pets are drawn on top of it;
 * only a desk's front (`seatCover`) and the items a walking pet went behind (`frontSvg`) are drawn again over them.
 * `view` is the part of the room shown (`roomView`; the canvas by default), at most its `bleed` around the canvas. */
export function roomSvg(layout: Layout, kind: RoomKind = 'personal', view: Box = canvasBox(kind)): string {
  const order = drawOrder(layout);
  const known = layout.items.filter((p) => ITEMS[p.item]);
  const onWall = (p: Placement) => {
    const m = ITEMS[p.item].mount;
    if (m === 'wall') return true;
    const s = m === 'top' ? supportOf(p, known) : null;
    return !!s && ITEMS[s.item].mount === 'wall';
  };
  const wall = order.filter(onWall);
  const rest = order.filter((p) => !onWall(p));
  const rugs = rest.filter((p) => ITEMS[p.item].mount === 'rug');
  const lights = layout.items.filter((p) => ITEMS[p.item]?.light);
  const surface = kind === 'personal' ? 'svg' : 'focus';
  // Above its drawn bleed (a very tall screen) the wall goes on in its top colour (its gradient pads it).
  const bleedTop = ROOMS[kind].bleed?.[1];
  const above = bleedTop !== undefined && view[1] < bleedTop && SURFACES[layout.wall]
    ? `<rect x='${num(view[0])}' y='${num(view[1])}' width='${num(view[2] - view[0])}' height='${num(bleedTop - view[1] + 1)}' fill='url(#${layout.wall}-g)'/>` : '';
  const body = (SURFACES[layout.wall]?.[surface] ?? '') + above + (SURFACES[layout.floor]?.[surface] ?? '')
    + wall.map((p) => itemMarkup(p)).join('') + rugs.map((p) => itemMarkup(p)).join('') + lights.map((p) => lightMarkup(p, kind)).join('')
    + rest.filter((p) => !rugs.includes(p)).map((p) => itemMarkup(p)).join('')
    + ROOMS[kind].vignette;
  return svgDoc(viewOf(view), body);
}

/** The floor items standing in front of feet at `feet` (further forward on the floor), with what stands on them. With
 * `over` (the pet's box on the canvas), only those that overlap it; `home` (the bed or desk it is on) is never one. */
export function itemsInFront(layout: Layout, feet: number, over?: Box, home?: string | null): Placement[] {
  const order = drawOrder(layout);
  const overlaps = (p: Placement) => {
    if (!over) return true;
    const [x0, y0, x1, y1] = placedBox(p)!;
    return x0 < over[2] && x1 > over[0] && y0 < over[3] && y1 > over[1];
  };
  const front = new Set(order.filter((p) => ITEMS[p.item].mount === 'floor' && p.y > feet && keyOf(p) !== home && overlaps(p)).map(keyOf));
  const { on } = carried(layout.items.filter((p) => ITEMS[p.item]));
  return order.filter((p) => front.has(keyOf(p)) || [...front].some((s) => on.get(s)?.includes(p)));
}

/** Those items again, without their floor shadows, to draw over a pet that walked behind them (on the canvas). Null
 * when none. */
export function frontSvg(items: Placement[], kind: RoomKind = 'personal'): string | null {
  if (!items.length) return null;
  const body = items.map((p) => itemMarkup(p, false)).join('');
  return svgDoc(viewOf(canvasBox(kind)), body);
}

/** Items picked up while decorating (one, with what stands on it), back to front with their shadows, on the canvas:
 * drawn once when the drag starts and moved with the finger, over the room drawn without them. */
export function liftedSvg(items: Placement[], kind: RoomKind = 'personal'): string {
  const body = drawOrder({ wall: '', floor: '', items }).map((p) => itemMarkup(p)).join('');
  return svgDoc(viewOf(canvasBox(kind)), body);
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
