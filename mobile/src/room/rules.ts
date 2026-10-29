import { blockingItems, carried, drawOrder, fitsOn, itemArt, itemBox, keyOf, nextRotation, petSpot, placeNew, poseFor, settle, supportOf, topLines } from './art';
import type { Layout, Placement, RoomKind } from './types';
import { isFree, obstacles, walkBounds } from './walk';

/**
 * Editing a room while decorating: every change is a whole new layout plus whether it may stay. The backend refuses
 * the same places (pet_room.checked_layout): a top item that stands on no desk or shelf, and an item that stands where
 * the pet stands or hides it. The app also keeps a way for the pet to walk in the personal room. Things standing on a
 * desk or shelf move, flip and go back to the storage with it. Placements are named by their key (`keyOf`): a starter
 * item's id, or a found decoration copy's uid, so a room may hold several copies of one found item.
 */
export type Problem = 'unsupported' | 'blocks_pet' | 'trapped';
export const PROBLEM_TEXT: Record<Problem, string> = {
  unsupported: 'Hãy đặt lên mặt bàn hoặc kệ',
  blocks_pet: 'Chỗ này che mất chỗ của pet',
  trapped: 'Hãy chừa lối đi cho pet',
};
export type Change = { layout: Layout; problem: Problem | null };

/** Below this share of the floor reachable from its rug, the personal room counts as blocking the pet's walks. */
export const MIN_FREE_FLOOR = 0.25;
const STEP = 8;

/** The share of the floor the pet can walk to from its rug (personal room; tap-to-walk uses the same rules). */
export function reachableShare(layout: Layout): number {
  const spot = petSpot(layout, poseFor('rug', layout));
  const blocks = obstacles(layout, spot.size);
  const [bx0, by0, bx1, by1] = walkBounds(spot.size);
  const cols = Math.floor((bx1 - bx0) / STEP) + 1, rows = Math.floor((by1 - by0) / STEP) + 1;
  const free = new Uint8Array(cols * rows);
  let total = 0;
  for (let i = 0; i < free.length; i++) {
    if (isFree(layout, spot.size, { x: bx0 + (i % cols) * STEP, feet: by0 + Math.floor(i / cols) * STEP }, blocks)) { free[i] = 1; total++; }
  }
  if (!total) return 0;
  // From the free cell nearest to the pet.
  let start = -1, best = Infinity;
  for (let i = 0; i < free.length; i++) {
    if (!free[i]) continue;
    const d = Math.hypot(bx0 + (i % cols) * STEP - spot.x, by0 + Math.floor(i / cols) * STEP - spot.feet);
    if (d < best) { best = d; start = i; }
  }
  const seen = new Uint8Array(free.length);
  const queue = [start];
  seen[start] = 1;
  let reached = 0;
  while (queue.length) {
    const i = queue.pop()!;
    reached++;
    const c = i % cols, r = Math.floor(i / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr, n = nr * cols + nc;
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && free[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  return reached / (cols * rows);
}

/** What is wrong with `after`, where `changed` items (keys) were placed or moved (null: it may stay). */
export function problemOf(before: Layout, after: Layout, changed: string[], kind: RoomKind): Problem | null {
  for (const id of changed) {
    const p = after.items.find((entry) => keyOf(entry) === id);
    if (p && itemArt(p.item)?.mount === 'top' && !supportOf(p, after.items)) return 'unsupported';
  }
  const was = blockingItems(before, kind);
  const now = blockingItems(after, kind);
  for (const id of now) if (changed.includes(id) || !was.has(id)) return 'blocks_pet';
  if (kind === 'personal') {
    const share = reachableShare(after);
    if (share < MIN_FREE_FLOOR && share < reachableShare(before) - 0.001) return 'trapped';
  }
  return null;
}

const replace = (layout: Layout, changes: Placement[], removed: string[] = []): Layout => {
  const byKey = new Map(changes.map((p) => [keyOf(p), p]));
  return { ...layout, items: layout.items.filter((p) => !removed.includes(keyOf(p))).map((p) => byKey.get(keyOf(p)) ?? p) };
};
const find = (layout: Layout, key: string) => layout.items.find((entry) => keyOf(entry) === key);
/** What stands on an item (a desk or shelf; by its key): it moves, flips and is stored with it. */
export const ridersOf = (layout: Layout, key: string) => carried(layout.items.filter((p) => itemArt(p.item))).on.get(key) ?? [];

/** A top item over the canvas point (x, y): on the nearest top under it that it fits on, else where it is dragged. */
function onTop(layout: Layout, p: Placement, x: number, y: number, kind: RoomKind): Placement {
  const [bx0, , bx1] = itemBox(itemArt(p.item)!, p.flip, p.rotate);
  let best: Placement | null = null, bestD = Infinity;
  for (const s of layout.items) {
    if (keyOf(s) === keyOf(p)) continue;
    for (const line of topLines(s)) {
      if (line.x1 - line.x0 < bx1 - bx0 - 4) continue;
      const cx = Math.min(Math.max(x, line.x0 - bx0), line.x1 - bx1);
      const d = Math.hypot(cx - x, (line.y - y) * 0.8);
      if (d < bestD && Math.abs(line.y - y) <= 48 && Math.abs(cx - x) <= 28) {
        const at = { ...p, x: Math.floor(cx + 0.5), y: Math.floor(line.y + 0.5) };
        if (fitsOn(at, line)) { best = at; bestD = d; }
      }
    }
  }
  return best ?? settle({ ...p, x, y }, kind);
}

/** Where an item dragged to (x, y) lands: inside its part of the room, a top item on the top under it. Cheap, for
 * every frame of a drag (the rules are checked by `moveItem`). */
export function dragTo(layout: Layout, key: string, x: number, y: number, kind: RoomKind): Placement | null {
  const p = find(layout, key);
  const art = p && itemArt(p.item);
  if (!p || !art) return null;
  return art.mount === 'top' ? onTop(layout, p, x, y, kind) : settle({ ...p, x, y }, kind);
}

/** Moves an item (dragged to x, y); what stands on it comes along. */
export function moveItem(layout: Layout, key: string, x: number, y: number, kind: RoomKind): Change {
  const p = find(layout, key);
  const next = dragTo(layout, key, x, y, kind);
  if (!p || !next) return { layout, problem: null };
  if (itemArt(p.item)!.mount === 'top') {
    const after = replace(layout, [next]);
    return { layout: after, problem: problemOf(layout, after, [key], kind) };
  }
  const riders = ridersOf(layout, key).map((r) => ({ ...r, x: r.x + next.x - p.x, y: r.y + next.y - p.y }));
  const after = replace(layout, [next, ...riders]);
  return { layout: after, problem: problemOf(layout, after, [key, ...riders.map(keyOf)], kind) };
}

/** Mirrors an item; what stands on it is mirrored around it too. */
export function flipItem(layout: Layout, key: string, kind: RoomKind): Change {
  const p = find(layout, key);
  if (!p) return { layout, problem: null };
  const next = settle({ ...p, flip: !p.flip }, kind);
  const riders = ridersOf(layout, key).map((r) => ({ ...r, x: next.x - (r.x - p.x), y: r.y + next.y - p.y }));
  const after = replace(layout, [next, ...riders]);
  return { layout: after, problem: problemOf(layout, after, [key, ...riders.map(keyOf)], kind) };
}

/** The next tilt (supports never tilt, so nothing stands on a tilting item). */
export function rotateItem(layout: Layout, key: string, kind: RoomKind): Change {
  const p = find(layout, key);
  const art = p && itemArt(p.item);
  if (!p || !art) return { layout, problem: null };
  const after = replace(layout, [settle({ ...p, rotate: nextRotation(art, p.rotate) }, kind)]);
  return { layout: after, problem: problemOf(layout, after, [key], kind) };
}

/** Puts an item back in the storage, with what stands on it. `stored` lists their item ids (a found decoration's copy
 * goes back to the inventory, where it is free again once the room is saved). */
export function storeItem(layout: Layout, key: string, kind: RoomKind): Change & { stored: string[] } {
  const p = find(layout, key);
  const riders = ridersOf(layout, key);
  const after = replace(layout, [], [key, ...riders.map(keyOf)]);
  return { layout: after, problem: problemOf(layout, after, [], kind), stored: [...(p ? [p.item] : []), ...riders.map((r) => r.item)] };
}

/** Adds an item from the storage at the first good place near where it usually goes: a top item on a desk or shelf
 * in the room, anything else around its spawn point. A problem when there is no such place. A found decoration comes
 * as one copy (`copy`: its variant and a new uid). */
export function addItem(layout: Layout, item: string, kind: RoomKind, copy?: { variant: string; uid: string }): Change {
  const spawn = placeNew(item, kind);
  const art = itemArt(item);
  if (!spawn || !art) return { layout, problem: null };
  const base: Placement = copy ? { ...spawn, variant: copy.variant, uid: copy.uid } : spawn;
  const key = keyOf(base);
  const tryAt = (p: Placement): Layout | null => {
    const after = { ...layout, items: [...layout.items, p] };
    return problemOf(layout, after, [key], kind) ? null : after;
  };
  if (art.mount === 'top') {
    const [bx0, , bx1] = itemBox(art, false, 0);
    // What already stands on each top: a new item goes to a free part of it, never on top of another one.
    const taken = (s: Placement) => (carried(layout.items.filter((p) => itemArt(p.item))).on.get(keyOf(s)) ?? [])
      .map((p) => { const [x0, , x1] = itemBox(itemArt(p.item)!, p.flip, p.rotate); return [p.x + x0, p.x + x1]; });
    for (const s of drawOrder(layout)) {
      const busy = taken(s);
      for (const line of topLines(s)) {
        const lo = line.x0 - bx0, hi = line.x1 - bx1;
        if (lo > hi) continue;
        const mid = (lo + hi) / 2;
        for (let k = 0; k <= Math.ceil((hi - lo) / 6); k++) {
          for (const sign of k ? [1, -1] : [1]) {
            const x = Math.floor(mid + sign * k * 6 + 0.5);
            if (x < lo || x > hi || busy.some(([a, b]) => x + bx0 < b - 1 && x + bx1 > a + 1)) continue;
            const found = tryAt({ ...base, x, y: Math.floor(line.y + 0.5) });
            if (found) return { layout: found, problem: null };
          }
        }
      }
    }
    return { layout, problem: 'unsupported' };
  }
  for (let r = 0; r <= 240; r += 16) {
    const steps = r ? Math.max(8, Math.round(r / 6)) : 1;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const found = tryAt(settle({ ...base, x: base.x + r * Math.cos(a), y: base.y + r * Math.sin(a) * 0.6 }, kind));
      if (found) return { layout: found, problem: null };
    }
  }
  return { layout, problem: 'blocks_pet' };
}
