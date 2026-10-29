import { applyPalette, blockingItems, defaultLayout, drawOrder, geometry, itemArt, PALETTES, petSpot, placedBox, roomSvg, seatCover, supportOf, topLines } from '../src/room/art';
import { addItem, flipItem, moveItem, storeItem } from '../src/room/rules';
import type { Layout } from '../src/room/types';

const at = (item: string, x: number, y: number, more = {}) => ({ item, variant: itemArt(item)!.variants[0].id, x, y, flip: false, rotate: 0, ...more });
const deskTop = (x = 96, y = 467) => topLines(at('desk', x, y))[0];
const ROOM: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('window', 180, 277), at('rug_oval', 180, 567), at('desk', 96, 467), at('pet_cushion', 286, 533),
  at('book_stack', 30, deskTop().y), at('desk_lamp', 160, deskTop().y),
] };

describe('decorating rules', () => {
  it('both rooms start complete, with every top item on a support and room left for the pet', () => {
    for (const kind of ['personal', 'focus'] as const) {
      const start = defaultLayout(kind);
      expect(start.items.length).toBeGreaterThanOrEqual(8);
      for (const p of start.items) if (itemArt(p.item)!.mount === 'top') expect(supportOf(p, start.items)).not.toBeNull();
      expect(blockingItems(start, kind).size).toBe(0);
      const { width, height } = geometry(kind).canvas;
      expect(roomSvg(start, kind)).toContain(`viewBox="0 0 ${width} ${height}"`);
    }
    const focus = defaultLayout('focus');
    expect(focus.items.map((p) => p.item)).toEqual(expect.arrayContaining(['desk', 'desk_lamp', 'book_stack', 'memo_board', 'plant_monstera']));
    // A study corner (desk with its chair, an open book, a pencil cup, a cup of water), a clock and a painting, the bed,
    // toys by the plush, plants on both sides, and the rug in the middle.
    const personal = defaultLayout('personal');
    expect(personal.items.map((p) => p.item)).toEqual(expect.arrayContaining(['desk', 'notebook', 'pencil_cup', 'mug', 'wall_clock',
      'painting_tulips', 'pet_bed_basket', 'toy_plush', 'toy_basket', 'hanging_plant', 'plant_flowers', 'rug_round']));
    // Nothing hangs in the part of the wall behind the header drawn over the room.
    for (const p of personal.items) expect(placedBox(p)![1]).toBeGreaterThanOrEqual(geometry('personal').top);
  });

  it('draws what stands on a desk right after it, and in front of the pet sitting at it', () => {
    const order = drawOrder(ROOM).map((p) => p.item);
    expect(order.slice(order.indexOf('desk'), order.indexOf('desk') + 3)).toEqual(['desk', 'book_stack', 'desk_lamp']);
    const cover = seatCover(ROOM, 'study')!;
    expect(cover.svg).toContain(`translate(30 ${deskTop().y})`);
  });

  it('carries, mirrors and stores what stands on a desk with it', () => {
    const moved = moveItem(ROOM, 'desk', 140, 479, 'personal');
    expect(moved.problem).toBeNull();
    const book = moved.layout.items.find((p) => p.item === 'book_stack')!;
    expect([book.x, book.y]).toEqual([74, deskTop().y + 12]);
    expect(supportOf(book, moved.layout.items)?.item).toBe('desk');
    const flipped = flipItem(ROOM, 'desk', 'personal').layout;
    expect(flipped.items.find((p) => p.item === 'book_stack')!.x).toBe(96 + 66);
    const stored = storeItem(ROOM, 'desk', 'personal');
    expect(stored.stored).toEqual(['desk', 'book_stack', 'desk_lamp']);
    expect(stored.layout.items.map((p) => p.item)).toEqual(['window', 'rug_oval', 'pet_cushion']);
  });

  it('a top item snaps onto a top near it, and may not stand on nothing', () => {
    const near = moveItem(ROOM, 'book_stack', 60, deskTop().y - 20, 'personal');
    expect(near.problem).toBeNull();
    expect(near.layout.items.find((p) => p.item === 'book_stack')!.y).toBe(deskTop().y);
    const floating = moveItem(ROOM, 'book_stack', 250, 150, 'personal');
    expect(floating.problem).toBe('unsupported');
    const added = addItem(ROOM, 'laptop', 'personal');
    expect(added.problem).toBeNull();
    const laptop = added.layout.items.find((p) => p.item === 'laptop')!;
    expect(supportOf(laptop, added.layout.items)?.item).toBe('desk');
    // On a free part of the desk, not on the books or the lamp already there.
    const span = (p: typeof laptop) => { const [x0, , x1] = itemArt(p.item)!.box; return [p.x + x0, p.x + x1]; };
    for (const other of ROOM.items.filter((p) => p.item === 'book_stack' || p.item === 'desk_lamp')) {
      const [a, b] = span(other), [c, d] = span(laptop);
      expect(c >= b - 1 || d <= a + 1).toBe(true);
    }
    const bare: Layout = { ...ROOM, items: [at('rug_oval', 180, 567)] };
    expect(addItem(bare, 'laptop', 'personal').problem).toBe('unsupported');
  });

  it('nothing may stand where the pet stands, and a new item finds a free place', () => {
    const spot = petSpot(ROOM, 'rug');
    const added = addItem(ROOM, 'bean_bag', 'personal');
    expect(added.problem).toBeNull();
    const withBag = { ...ROOM, items: [...ROOM.items, at('bean_bag', 40, 700)] };
    expect(moveItem(withBag, 'bean_bag', spot.x, spot.feet + 4, 'personal').problem).toBe('blocks_pet');
    expect(moveItem(withBag, 'bean_bag', 60, 710, 'personal').problem).toBeNull();
  });

  it('a palette sets the wall, the floor and matching colours', () => {
    const night = PALETTES.find((p) => p.id === 'night')!;
    expect(PALETTES.map((p) => p.id)).toEqual(['cream_wood', 'green_wood', 'blue_white', 'peach', 'lavender', 'night']);
    const dark = applyPalette(ROOM, night);
    expect([dark.wall, dark.floor]).toEqual([night.wall, night.floor]);
    expect(dark.items.find((p) => p.item === 'window')!.variant).toBe('starry');
    expect(dark.items.map((p) => [p.item, p.x, p.y])).toEqual(ROOM.items.map((p) => [p.item, p.x, p.y])); // colours only
  });
});
