import { CANVAS, itemArt, itemBox } from './art';
import type { Layout } from './types';

/**
 * Walking the pet around its room (tap the floor). Everything is in canvas units (400 x 440, room/art.ts) and about
 * the pet's feet: the point under it, where its shadow is. The pet stays on the floor inside the room, and floor items
 * block it by their footprint (the strip of floor they stand on), widened by the pet's own width; rugs are walked on.
 */
export type Point = { x: number; feet: number };
type Rect = [number, number, number, number];

const CELL = 5; // grid step for the path search
/** The furthest the room's back wall lets the feet go (the floor starts at CANVAS.floorY). */
const BACK = CANVAS.floorY + 24;
/** A blocked tap leads to a free spot at most this far from it; further away, the pet stays where it is. */
export const NEAR_TARGET = 70;
/** Canvas units per second: an unhurried walk, about a third of the room per second. */
export const WALK_SPEED = 120;

/** Where the feet may be for a pet of this size: the whole pet stays inside the room's walls. */
export function walkBounds(size: number): Rect {
  const half = size / 2;
  return [half + 2, BACK, CANVAS.width - half - 2, CANVAS.height - 2];
}

/** The floor each floor item stands on, widened by half the pet's foot width and a little front and back. */
export function obstacles(layout: Layout, size: number): Rect[] {
  const foot = size * 0.2;
  const out: Rect[] = [];
  for (const p of layout.items) {
    const art = itemArt(p.item);
    if (!art || art.mount !== 'floor') continue;
    const [x0, , x1] = itemBox(art, p.flip, p.rotate);
    const width = x1 - x0;
    const depth = Math.min(36, Math.max(14, width * 0.3)); // how far back from its front edge an item reaches
    out.push([p.x + x0 + 4 - foot, p.y - depth - 6, p.x + x1 - 4 + foot, p.y + 6]);
  }
  return out;
}

const inside = (r: Rect, x: number, y: number) => x > r[0] && x < r[2] && y > r[1] && y < r[3];

/** A point the pet's feet may stand on. */
export function isFree(layout: Layout, size: number, at: Point, blocks = obstacles(layout, size)): boolean {
  const [bx0, by0, bx1, by1] = walkBounds(size);
  return at.x >= bx0 && at.x <= bx1 && at.feet >= by0 && at.feet <= by1 && !blocks.some((r) => inside(r, at.x, at.feet));
}

function clear(a: Point, b: Point, free: (p: Point) => boolean) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.feet - a.feet) / 2);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!free({ x: a.x + (b.x - a.x) * t, feet: a.feet + (b.feet - a.feet) * t })) return false;
  }
  return true;
}

/**
 * The way from `from` to the tapped point: a list of points to walk through (the first is `from`, the last is where
 * the pet stops), or null when it should stay where it is. A tap on a blocked spot leads to the nearest spot the pet
 * can reach when there is one near it (NEAR_TARGET); a pet standing inside an item's footprint (just after decorating)
 * first steps out of it.
 */
export function findPath(layout: Layout, size: number, from: Point, to: Point): Point[] | null {
  const blocks = obstacles(layout, size);
  const free = (p: Point) => isFree(layout, size, p, blocks);
  const [bx0, by0, bx1, by1] = walkBounds(size);
  const cols = Math.floor((bx1 - bx0) / CELL) + 1;
  const rows = Math.floor((by1 - by0) / CELL) + 1;
  const point = (i: number): Point => ({ x: bx0 + (i % cols) * CELL, feet: by0 + Math.floor(i / cols) * CELL });
  const cellOf = (p: Point) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round((p.x - bx0) / CELL)));
    const r = Math.min(rows - 1, Math.max(0, Math.round((p.feet - by0) / CELL)));
    return r * cols + c;
  };
  const open = new Uint8Array(cols * rows);
  for (let i = 0; i < open.length; i++) open[i] = free(point(i)) ? 1 : 0;

  // Start from the pet's cell, or the nearest free one when it stands where it now can't (an item was moved onto it).
  let start = cellOf(from);
  if (!open[start]) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < open.length; i++) {
      if (!open[i]) continue;
      const p = point(i), d = Math.hypot(p.x - from.x, p.feet - from.feet);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return null;
    start = best;
  }

  // Dijkstra over the free cells (8 directions, no cutting the corner of a blocked cell).
  const dist = new Float64Array(open.length).fill(Infinity);
  const prev = new Int32Array(open.length).fill(-1);
  const done = new Uint8Array(open.length);
  dist[start] = 0;
  const queue: number[] = [start];
  while (queue.length) {
    let k = 0;
    for (let j = 1; j < queue.length; j++) if (dist[queue[j]] < dist[queue[k]]) k = j;
    const i = queue.splice(k, 1)[0];
    if (done[i]) continue;
    done[i] = 1;
    const c = i % cols, r = Math.floor(i / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const n = nr * cols + nc;
        if (!open[n] || done[n] || (dr && dc && (!open[r * cols + nc] || !open[nr * cols + c]))) continue;
        const d = dist[i] + (dr && dc ? Math.SQRT2 : 1);
        if (d < dist[n]) { dist[n] = d; prev[n] = i; queue.push(n); }
      }
    }
  }

  // The reachable cell nearest to the tap (the tap itself when it is free and reachable).
  let goal = -1, goalD = Infinity;
  for (let i = 0; i < open.length; i++) {
    if (!done[i]) continue;
    const p = point(i), d = Math.hypot(p.x - to.x, p.feet - to.feet);
    if (d < goalD) { goalD = d; goal = i; }
  }
  if (goal < 0 || goalD > NEAR_TARGET) return null; // no way there, nor anywhere near it
  const end = free(to) && goalD <= CELL ? to : point(goal);
  if (Math.hypot(end.x - from.x, end.feet - from.feet) < CELL) return null; // nowhere better to go: stay

  const cells: Point[] = [];
  for (let i = goal; i !== -1 && i !== start; i = prev[i]) cells.unshift(point(i));
  // A pet that stands where it can't (an item was put on it) first steps to the nearest free spot, then walks.
  const first = start === cellOf(from) && free(from) ? from : point(start);
  const raw = [first, ...cells.slice(0, -1), end];
  // Straighten the grid steps: keep only the corners the pet really has to turn at.
  const path: Point[] = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !clear(raw[i], raw[j], free)) j--;
    path.push(raw[j]);
    i = j;
  }
  return first === from ? path : [from, ...path];
}

/** Where along a path the pet is after walking `distance` canvas units, and which way it faces (1 right, -1 left). */
export function along(path: Point[], distance: number): { at: Point; facing: 1 | -1; done: boolean } {
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b.x - a.x, b.feet - a.feet);
    const facing: 1 | -1 = b.x < a.x - 0.5 ? -1 : 1;
    if (left <= len) {
      const t = len ? left / len : 1;
      return { at: { x: a.x + (b.x - a.x) * t, feet: a.feet + (b.feet - a.feet) * t }, facing, done: false };
    }
    left -= len;
  }
  const last = path[path.length - 1], before = path[path.length - 2] ?? last;
  return { at: last, facing: last.x < before.x - 0.5 ? -1 : 1, done: true };
}

export const pathLength = (path: Point[]) => path.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - path[i].x, b.feet - path[i].feet), 0);
