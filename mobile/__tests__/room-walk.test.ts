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
  const path = findPath(room(), SIZE, { x: 180, feet: 516 }, { x: 280, feet: 544 })!;
  expect(path).toEqual([{ x: 180, feet: 516 }, { x: 280, feet: 544 }]);
});

test('the pet walks down to the front edge of the room, and no further', () => {
  expect(walkBounds(SIZE)[3]).toBe(CANVAS.height - 2);
  const path = findPath(room(), SIZE, { x: 180, feet: 624 }, { x: 180, feet: 750 })!;
  expect(path[path.length - 1]).toEqual({ x: 180, feet: 750 });
  // A tap far below the room (there is none on screen): the pet stays.
  expect(findPath(room(), SIZE, { x: 180, feet: 624 }, { x: 180, feet: 900 })).toBeNull();
});

test('the pet walks around a bookcase, never through it', () => {
  const layout = room(item('bookcase', 180, 534));
  const from = { x: 180, feet: 576 }, to = { x: 180, feet: 474 }; // right in front of it, to right behind it
  const path = findPath(layout, SIZE, from, to)!;
  expect(path.length).toBeGreaterThan(2); // it has to turn
  expect(walksOnFreeFloor(layout, path)).toBe(true);
  expect(path[path.length - 1]).toEqual(to);
  expect(pathLength(path)).toBeGreaterThan(102); // longer than the straight line through the shelf
});

test('a tap on furniture or outside the floor leads to the nearest spot the pet can reach', () => {
  const layout = room(item('desk', 180, 544));
  const [, by0, , by1] = walkBounds(SIZE);
  const onDesk = findPath(layout, SIZE, { x: 60, feet: 574 }, { x: 180, feet: 539 })!;
  const end = onDesk[onDesk.length - 1];
  expect(isFree(layout, SIZE, end)).toBe(true);
  expect(Math.hypot(end.x - 180, end.feet - 539)).toBeLessThan(50);
  // Just behind the floor's back edge: the pet stops at the back of the floor; far up the wall: it stays.
  const back = findPath(room(), SIZE, { x: 180, feet: 516 }, { x: 180, feet: 444 })!;
  expect(back[back.length - 1].feet).toBe(by0);
  expect(findPath(room(), SIZE, { x: 180, feet: 516 }, { x: 180, feet: 264 })).toBeNull();
  // The very edge of the room: it stays whole inside.
  const edge = findPath(room(), SIZE, { x: 180, feet: 516 }, { x: 355, feet: 758 })!;
  expect(edge[edge.length - 1].x).toBeLessThanOrEqual(CANVAS.width - SIZE / 2);
  expect(edge[edge.length - 1].feet).toBeLessThanOrEqual(by1);
});

test('no way to the tap: a pet shut in by furniture stays where it is', () => {
  // Rows of shelves behind and in front of the pet across the whole room, and shelves at both of its sides.
  const behind = [40, 110, 180, 250, 320].map((x) => item('bookcase', x, 519));
  const sides = [70, 290].flatMap((x) => [item('bookcase', x, 554), item('bookcase', x, 580)]);
  const front = [40, 110, 180, 250, 320].map((x) => item('bookcase', x, 640));
  const layout = room(...behind, ...sides, ...front);
  const pet = { x: 180, feet: 559 };
  expect(isFree(layout, SIZE, pet)).toBe(true);
  expect(findPath(layout, SIZE, pet, { x: 300, feet: 469 })).toBeNull(); // the free floor behind the shelves
  expect(findPath(layout, SIZE, pet, { x: 300, feet: 720 })).toBeNull(); // nor the floor in front of them
  expect(findPath(layout, SIZE, pet, { x: 185, feet: 574 })).not.toBeNull(); // its own corner is fine
});

test('a pet standing where an item was just put steps out first, then walks around it', () => {
  const layout = room(item('pouf', 180, 519));
  const from = { x: 180, feet: 516 };
  expect(isFree(layout, SIZE, from)).toBe(false);
  const path = findPath(layout, SIZE, from, { x: 300, feet: 564 })!;
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
  const layout = room(item('rug_oval', 180, 516), item('window', 180, 294), item('plant_flowers', 100, 564), item('chair', 280, 474));
  expect(itemsInFront(layout, 504).map((p) => p.item)).toEqual(['plant_flowers']);
  expect(itemsInFront(layout, 444).map((p) => p.item)).toEqual(['chair', 'plant_flowers']);
  expect(frontSvg([])).toBeNull();
  expect(frontSvg(itemsInFront(layout, 504))).toContain('<svg');
  expect(obstacles(layout, SIZE)).toHaveLength(2); // the rug is walked on
});
