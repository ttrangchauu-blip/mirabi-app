import { drawOrder, itemArt, itemAt, nextRotation, petSpot, placedBox, placeNew, poseFor, roomSvg, settle } from '../src/room/art';
import type { Layout } from '../src/room/types';

const at = (item: string, x: number, y: number, more = {}) => ({ item, variant: itemArt(item)!.variants[0].id, x, y, flip: false, rotate: 0, ...more });
const ROOM: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('plant_monstera', 60, 436), at('window', 200, 124), at('desk', 96, 318), at('rug_oval', 200, 372), at('pet_cushion', 318, 356),
] };

describe('room artwork', () => {
  it('keeps a dragged item inside its part of the room', () => {
    for (const [item, x, y] of [['window', -300, 600], ['desk', 900, -40], ['rug_oval', 200, 0], ['toy_ball', 1000, 1000]] as const) {
      const p = settle(at(item, x, y));
      const [x0, y0, x1, y1] = placedBox(p)!;
      expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(400);
      expect(y0).toBeGreaterThanOrEqual(0); expect(y1).toBeLessThanOrEqual(440);
      if (itemArt(item)!.mount === 'wall') expect(y1).toBeLessThanOrEqual(292); else expect(p.y).toBeGreaterThan(292);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    }
    expect(settle(at('desk', 96, 318))).toEqual(at('desk', 96, 318)); // already inside: unchanged
  });

  it('draws the wall, rugs, then floor items back to front, and picks the front-most item under a finger', () => {
    expect(drawOrder(ROOM).map((p) => p.item)).toEqual(['window', 'rug_oval', 'desk', 'pet_cushion', 'plant_monstera']);
    expect(itemAt(ROOM, 200, 380)?.item).toBe('rug_oval');
    expect(itemAt(ROOM, 60, 400)?.item).toBe('plant_monstera'); // in front of the desk it overlaps
    expect(itemAt(ROOM, 200, 20)).toBeNull();
    const svg = roomSvg(ROOM);
    expect(svg.indexOf("id='window-glow'")).toBeLessThan(svg.indexOf("id='desk-glow'"));
    expect(svg).not.toMatch(/@\w/); // every colour of the chosen variants is filled in
  });

  it('turns only what the artwork allows and puts new items where they belong', () => {
    const ball = itemArt('toy_ball')!;
    const steps = [0];
    for (let i = 0; i < 6; i++) steps.push(nextRotation(ball, steps[steps.length - 1]));
    expect(steps).toEqual([0, 15, 30, 45, -45, -30, -15]);
    expect(nextRotation(itemArt('desk')!, 0)).toBe(0);
    expect(placeNew('toy_plush')).toEqual(settle(at('toy_plush', ...itemArt('toy_plush')!.spawn)));
    expect(placeNew('no_such_item')).toBeNull();
  });

  it('seats the pet at its own desk and bed wherever they stand, else on the rug', () => {
    const moved: Layout = { ...ROOM, items: ROOM.items.map((p) => (p.item === 'desk' ? { ...p, x: 300, flip: true } : p)) };
    const seat = itemArt('desk')!.seat!;
    expect(petSpot(moved, 'study')).toEqual({ x: 300 - seat.dx, feet: 318 + seat.dy, size: seat.size });
    const bare: Layout = { ...ROOM, items: [] };
    expect(poseFor('rest', bare)).toBe('rug');
    expect(petSpot(bare, 'rug')).toEqual({ x: 200, feet: 372, size: 116 });
  });
});
