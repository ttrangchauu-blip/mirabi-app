import { CANVAS, frontSvg, itemsInFront } from '../src/room/art';
import type { Layout, Placement } from '../src/room/types';
import { along, findPath, isFree, obstacles, pathLength, Point, walkBounds } from '../src/room/walk';

const SIZE = 116; // the pet on its rug
const item = (id: string, x: number, y: number): Placement => ({ item: id, variant: 'v1', x, y, flip: false, rotate: 0 });
const room = (...items: Placement[]): Layout => ({ wall: 'wall_cream', floor: 'floor_wood', items });

/** Every step of the path stays on free floor (sampled every canvas unit). */
function walksOnFreeFloor(layout: Layout, path: Point[]) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.feet - a.feet));
    for (let s = 0; s <= n; s++) {
      const t = n ? s / n : 1;
      const p = { x: a.x + (b.x - a.x) * t, feet: a.feet + (b.feet - a.feet) * t };
      if (!isFree(layout, SIZE, p)) return false;
    }
  }
  return true;
}

test('an empty floor is walked in a straight line, to exactly the tapped point', () => {
  const path = findPath(room(), SIZE, { x: 200, feet: 372 }, { x: 300, feet: 400 })!;
  expect(path).toEqual([{ x: 200, feet: 372 }, { x: 300, feet: 400 }]);
});

test('the pet walks around a bookcase, never through it', () => {
  const layout = room(item('bookcase', 200, 390));
  const from = { x: 200, feet: 432 }, to = { x: 200, feet: 330 }; // right in front of it, to right behind it
  const path = findPath(layout, SIZE, from, to)!;
  expect(path.length).toBeGreaterThan(2); // it has to turn
  expect(walksOnFreeFloor(layout, path)).toBe(true);
  expect(path[path.length - 1]).toEqual(to);
  expect(pathLength(path)).toBeGreaterThan(102); // longer than the straight line through the shelf
});

test('a tap on furniture or outside the floor leads to the nearest spot the pet can reach', () => {
  const layout = room(item('desk', 200, 400));
  const [, by0, , by1] = walkBounds(SIZE);
  const onDesk = findPath(layout, SIZE, { x: 80, feet: 430 }, { x: 200, feet: 395 })!;
  const end = onDesk[onDesk.length - 1];
  expect(isFree(layout, SIZE, end)).toBe(true);
  expect(Math.hypot(end.x - 200, end.feet - 395)).toBeLessThan(50);
  // Just behind the floor's back edge: the pet stops at the back of the floor; far up the wall: it stays.
  const back = findPath(room(), SIZE, { x: 200, feet: 372 }, { x: 200, feet: 300 })!;
  expect(back[back.length - 1].feet).toBe(by0);
  expect(findPath(room(), SIZE, { x: 200, feet: 372 }, { x: 200, feet: 120 })).toBeNull();
  // The very edge of the room: it stays whole inside.
  const edge = findPath(room(), SIZE, { x: 200, feet: 372 }, { x: 395, feet: 439 })!;
  expect(edge[edge.length - 1].x).toBeLessThanOrEqual(CANVAS.width - SIZE / 2);
  expect(edge[edge.length - 1].feet).toBeLessThanOrEqual(by1);
});

test('no way to the tap: a pet shut in by furniture stays where it is', () => {
  // A row of shelves behind the pet across the whole room, and shelves at both of its sides down to the front edge.
  const behind = [60, 130, 200, 270, 340].map((x) => item('bookcase', x, 375));
  const sides = [90, 310].flatMap((x) => [item('bookcase', x, 410), item('bookcase', x, 436)]);
  const layout = room(...behind, ...sides);
  const pet = { x: 200, feet: 415 };
  expect(isFree(layout, SIZE, pet)).toBe(true);
  expect(findPath(layout, SIZE, pet, { x: 330, feet: 325 })).toBeNull(); // the free floor behind the shelves
  expect(findPath(layout, SIZE, pet, { x: 205, feet: 430 })).not.toBeNull(); // its own corner is fine
});

test('a pet standing where an item was just put steps out first, then walks around it', () => {
  const layout = room(item('pouf', 200, 375));
  const from = { x: 200, feet: 372 };
  expect(isFree(layout, SIZE, from)).toBe(false);
  const path = findPath(layout, SIZE, from, { x: 320, feet: 420 })!;
  expect(path[0]).toEqual(from);
  expect(walksOnFreeFloor(layout, path.slice(1))).toBe(true);
});

test('along: the position after a distance, facing the way of the walk, and the end', () => {
  const path = [{ x: 300, feet: 400 }, { x: 200, feet: 400 }, { x: 200, feet: 350 }];
  expect(along(path, 50)).toEqual({ at: { x: 250, feet: 400 }, facing: -1, done: false });
  expect(along(path, 125).at).toEqual({ x: 200, feet: 375 });
  expect(along(path, 1000)).toEqual({ at: { x: 200, feet: 350 }, facing: 1, done: true });
});

test('items standing in front of the feet are drawn over the pet; rugs and wall items never are', () => {
  const layout = room(item('rug_oval', 200, 372), item('window', 200, 150), item('plant_flowers', 120, 420), item('chair', 300, 330));
  expect(itemsInFront(layout, 360).map((p) => p.item)).toEqual(['plant_flowers']);
  expect(itemsInFront(layout, 300).map((p) => p.item)).toEqual(['chair', 'plant_flowers']);
  expect(frontSvg([])).toBeNull();
  expect(frontSvg(itemsInFront(layout, 360))).toContain('<svg');
  expect(obstacles(layout, SIZE)).toHaveLength(2); // the rug is walked on
});
