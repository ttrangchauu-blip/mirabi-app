import { CANVAS, drawOrder, geometry, inZones, itemArt, itemAt, itemsInFront, legacyPoint, nextRotation, petSpot, placedBox, placeNew, poseFor, roomSvg, roomView, seatCover, settle } from '../src/room/art';
import type { Layout } from '../src/room/types';

const at = (item: string, x: number, y: number, more = {}) => ({ item, variant: itemArt(item)!.variants[0].id, x, y, flip: false, rotate: 0, ...more });
const ROOM: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('plant_monstera', 60, 747), at('window', 180, 277), at('desk', 96, 467), at('rug_oval', 180, 567), at('pet_cushion', 286, 533),
] };

describe('room artwork', () => {
  it('keeps a dragged item inside its part of the room', () => {
    for (const [item, x, y] of [['window', -300, 600], ['desk', 900, -40], ['rug_oval', 200, 0], ['toy_ball', 1000, 1000]] as const) {
      const p = settle(at(item, x, y));
      const [x0, y0, x1, y1] = placedBox(p)!;
      expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(CANVAS.width);
      expect(y0).toBeGreaterThanOrEqual(0); expect(y1).toBeLessThanOrEqual(CANVAS.height);
      if (itemArt(item)!.mount === 'wall') expect(y1).toBeLessThanOrEqual(CANVAS.floorY); else expect(p.y).toBeGreaterThan(CANVAS.floorY);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    }
    expect(settle(at('desk', 96, 467))).toEqual(at('desk', 96, 467)); // already inside: unchanged
  });

  it('draws the wall, rugs, then floor items back to front, and picks the front-most item under a finger', () => {
    expect(drawOrder(ROOM).map((p) => p.item)).toEqual(['window', 'rug_oval', 'desk', 'pet_cushion', 'plant_monstera']);
    expect(itemAt(ROOM, 180, 575)?.item).toBe('rug_oval');
    expect(itemAt(ROOM, 260, 540)?.item).toBe('pet_cushion'); // over the rug it overlaps
    expect(itemAt(ROOM, 200, 20)).toBeNull();
    const svg = roomSvg(ROOM);
    expect(svg.indexOf("id='window-glow'")).toBeLessThan(svg.indexOf('translate(96 467)'));
    expect(svg).not.toMatch(/@\w/); // every colour of the chosen variants is filled in
  });

  it('turns only what the artwork allows and puts new items where they belong', () => {
    const ball = itemArt('toy_ball')!;
    const steps = [0];
    for (let i = 0; i < 6; i++) steps.push(nextRotation(ball, steps[steps.length - 1]));
    expect(steps).toEqual([0, 15, 30, 45, -45, -30, -15]);
    expect(nextRotation(itemArt('desk')!, 0)).toBe(0);
    // Spawn points are on the old 400 x 440 canvas: moved onto the personal room's, spread over the focus room's.
    expect(itemArt('toy_plush')!.spawn).toEqual([236, 426]);
    expect(placeNew('toy_plush')).toEqual(at('toy_plush', 248, 739));
    expect(placeNew('toy_plush', 'focus')).toEqual(at('toy_plush', 378, 426));
    expect(placeNew('no_such_item')).toBeNull();
  });

  it('seats the pet at its own desk and bed wherever they stand, else on the rug', () => {
    const moved: Layout = { ...ROOM, items: ROOM.items.map((p) => (p.item === 'desk' ? { ...p, x: 250, flip: true } : p)) };
    const seat = itemArt('desk')!.seat!;
    expect(petSpot(moved, 'study')).toEqual({ x: 250 - seat.dx, feet: 467 + seat.dy, size: seat.size * 0.8 }); // a little smaller than its seat
    expect(467 + seat.dy).toBeLessThan(CANVAS.floorY); // on the chair behind the desk, not on the floor
    // The desk's front, turned with the desk, is drawn over the seated pet; nothing covers it on its rug or bed.
    const cover = seatCover(moved, 'study')!;
    expect(cover.svg).toContain("translate(250 467) scale(-1 1)");
    expect(cover.svg).toContain('viewBox="0 0 420 770"'); // laid over the canvas
    expect(cover.svg).not.toMatch(/@\w/);
    expect(cover.sink).toBeCloseTo(seat.sink! * 0.8);
    expect(cover.studySink).toBeGreaterThan(0); // its studying strip sits behind the desk's edge, the book on the top
    expect(cover.studySink).toBeLessThan(cover.sink);
    expect(seatCover(moved, 'rug')).toBeNull();
    expect(seatCover(moved, 'rest')).toBeNull();
    const bare: Layout = { ...ROOM, items: [] };
    expect(poseFor('rest', bare)).toBe('rug');
    expect(petSpot(bare, 'rug')).toEqual({ x: 210, feet: 640, size: 116 });
  });

  it('fills the space above the menu bar with the room, the floor line at 57 %, never a stretched room', () => {
    expect(CANVAS).toEqual({ width: 420, height: 770, floorY: 440 });
    expect(roomSvg(ROOM)).toContain('viewBox="0 0 420 770"');
    const onScreen = (r: { k: number; view: number[] }, y: number) => (y - r.view[1]) * r.k;
    // A Galaxy S23 Ultra: 740 points above the menu bar (26 of them under its rounded corners), the header 150 high.
    const phone = roomView('personal', 384, 740, 150, 26);
    expect(phone.view[0]).toBeCloseTo(0); // as wide as the screen, nothing cut at the sides
    expect(phone.view[2]).toBeCloseTo(420);
    expect(onScreen(phone, 160)).toBeGreaterThanOrEqual(150); // the room's content under the header
    // The front edge of the floor items can stand on is the bottom of what is shown above the menu bar: no strip of
    // floor below it where nothing could be put.
    expect(onScreen(phone, 770)).toBeCloseTo(714, 6);
    // A wider screen keeps the whole room, with more wall and floor at its sides instead of bands.
    const wide = roomView('personal', 360, 640, 150, 26);
    expect(wide.view[0]).toBeLessThan(-20);
    expect(wide.view[2] - wide.view[0]).toBeCloseTo(360 / wide.k);
    expect(onScreen(wide, 770)).toBeCloseTo(614);
    // A narrower (taller) one: the floor still reaches the bottom; what is left is more wall above the room.
    const narrow = roomView('personal', 360, 900, 120);
    expect(narrow.view[0]).toBeCloseTo(0);
    expect(onScreen(narrow, 770)).toBeCloseTo(900, 6);
    expect(onScreen(narrow, 160)).toBeGreaterThan(120);
    expect(roomSvg(ROOM, 'personal', [-40, -20, 400, 760])).toContain('viewBox="-40 -20 440 780"');
    // The focus room has no wall drawn around it: it is shown whole, as large as fits.
    expect(roomView('focus', 320, 676)).toEqual({ k: 0.5, view: [0, 0, 640, 440] });
  });

  it('shows the whole room in the same place on screens of any size, and maps touches back exactly', () => {
    // Small and large phones, a tablet and a desktop browser window; the header and the bar the room is kept clear of.
    for (const [w, h, top, bottom] of [[320, 568, 140, 26], [360, 640, 160, 26], [384, 740, 150, 26], [430, 932, 180, 26],
      [768, 1024, 180, 26], [1280, 800, 150, 26], [384, 740, 106, 316]]) {
      const { k, view } = roomView('personal', w, h, top, bottom);
      const screen = (x: number, y: number) => [(x - view[0]) * k, (y - view[1]) * k];
      const canvas = (sx: number, sy: number) => [sx / k + view[0], sy / k + view[1]];
      // The room's content (below its `top`) is between the header and the bar, never stretched or cut at the sides.
      expect(screen(0, 160)[1]).toBeGreaterThanOrEqual(top - 0.01);
      expect(screen(0, CANVAS.height)[1]).toBeLessThanOrEqual(h - bottom + 0.01);
      expect(screen(0, 0)[0]).toBeGreaterThanOrEqual(-0.01);
      expect(screen(CANVAS.width, 0)[0]).toBeLessThanOrEqual(w + 0.01);
      expect((view[2] - view[0]) / (view[3] - view[1])).toBeCloseTo(w / h, 6);
      // A touch over an item finds that item; screen and canvas points map both ways.
      for (const [x, y] of [[96, 400], [286, 520], [180, 277]]) {
        const [sx, sy] = screen(x, y);
        const [cx, cy] = canvas(sx, sy);
        expect(cx).toBeCloseTo(x, 6); expect(cy).toBeCloseTo(y, 6);
        expect(itemAt(ROOM, cx, cy)).toEqual(itemAt(ROOM, x, y));
      }
    }
    // An item pushed to the very front of the floor (or the side) stops at the room's edge, which is where the floor
    // shown above the menu bar ends, on every screen: what is placed at the bottom is shown at the bottom.
    for (const [w, h, top, bottom] of [[320, 568, 140, 26], [360, 900, 120, 26], [430, 932, 110, 26], [768, 1024, 110, 26]]) {
      const { k, view } = roomView('personal', w, h, top, bottom);
      for (const item of ['plant_flowers', 'toy_ball', 'rug_round']) {
        const [, , , low] = placedBox(settle(at(item, 200, 9999)))!;
        expect((low - view[1]) * k).toBeLessThanOrEqual(h - bottom + 0.01);
        expect((low - view[1]) * k).toBeGreaterThan(h - bottom - 6 * k); // within a few units of it
      }
    }
    // Only the screen and the reserves set it: the same numbers always give the same camera.
    expect(roomView('personal', 384, 740, 150, 26)).toEqual(roomView('personal', 384, 740, 150, 26));
  });

  it('opens rooms saved on the old 400 x 440 canvas with their furniture spread over the floor, not against the wall', () => {
    // The old floor ran from 292 to 440; today's from 440 to 770. A desk a sixth of the way in is a sixth of the way in.
    expect(legacyPoint('floor', 96, 318).y).toBeCloseTo(440 + (26 / 148) * 330);
    expect(legacyPoint('floor', 200, 366)).toEqual({ x: 210, y: 605 }); // half way: half way
    expect(legacyPoint('floor', 200, 440).y).toBe(770);
    expect(legacyPoint('wall', 200, 124)).toEqual({ x: 210, y: 160 + (124 * 280) / 292 });
  });

  it('puts every item of a room received out of place back in its part of the room, with what stands on it', () => {
    // As an outdated server sent it: the wall items still at their old heights, above the room's wall.
    const sent: Layout = { wall: 'wall_cream', floor: 'floor_wood_honey', items: [
      at('window', 111, 196), at('garland', 120, 44), at('cork_board', 335, 57), at('hanging_plant', 230, 98), at('wall_shelf', 336, 122),
      at('book_stack', 360, 130), at('desk', 96, 525), at('mug', 120, 439), at('rug_stripes', 224, 603), at('toy_ball', 18, 635)] };
    const fixed = inZones(sent);
    const [, wallTop, , wallBottom] = geometry('personal').areas.wall;
    for (const p of fixed.items) {
      const [x0, y0, x1, y1] = placedBox(p)!;
      expect(x0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThanOrEqual(CANVAS.width);
      if (itemArt(p.item)!.mount === 'wall') { expect(y0).toBeGreaterThanOrEqual(wallTop); expect(y1).toBeLessThanOrEqual(wallBottom); }
    }
    const byId = (id: string) => fixed.items.find((p) => p.item === id)!;
    // The books stood on the shelf and still do; the mug on the desk, which was in place, stays where it was.
    expect(byId('book_stack').y - byId('wall_shelf').y).toBe(130 - 122);
    expect(byId('book_stack').x - byId('wall_shelf').x).toBe(360 - 336);
    expect(byId('mug')).toBe(sent.items[7]);
    expect(byId('desk')).toBe(sent.items[6]);
    // A room already in place comes back as the very same object.
    expect(inZones(ROOM)).toBe(ROOM);
    expect(inZones(fixed)).toBe(fixed);
  });

  it('draws the floor items in front of a pet over it, by where they stand, never its own bed or desk', () => {
    const room: Layout = { ...ROOM, items: [...ROOM.items, at('toy_plush', 190, 600), at('plant_flowers', 380, 760)] };
    const pet = petSpot(room, 'rug');
    const box = [pet.x - pet.size / 2, pet.feet - pet.size, pet.x + pet.size / 2, pet.feet] as [number, number, number, number];
    // The plush stands in front of the pet's feet and overlaps it; the plant is in front too, but far to the side.
    expect(itemsInFront(room, pet.feet, box).map((p) => p.item)).toEqual(['toy_plush']);
    // On its bed the bed is never drawn over it; something in front of the bed still is.
    const bed = petSpot(room, 'rest');
    const bedBox = [bed.x - bed.size / 2, bed.feet - bed.size, bed.x + bed.size / 2, bed.feet] as [number, number, number, number];
    expect(itemsInFront(room, bed.feet, bedBox, 'pet_cushion').map((p) => p.item)).not.toContain('pet_cushion');
    expect(itemsInFront(room, bed.feet, bedBox).map((p) => p.item)).toContain('pet_cushion');
  });
});
