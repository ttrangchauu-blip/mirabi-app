import ART from '../assets/room/room-art.json';
import { defaultLayout, itemArt } from '../src/room/art';
import { isPlatedHomeWindow, plateOf } from '../src/screens/room/HomeRoomArt';
import { HOME_FLOORS, HOME_ITEMS, HOME_WALLS } from '../src/screens/room/homePlates';

// Nhà của Pet is drawn from rendered 3D pictures (scripts/render-scenes, scene-home.js) on the room's own canvas, so a saved room needs no
// conversion. These check the pictures and the catalog agree; how the room looks is checked by looking at it.
describe('Nhà của Pet in 3D', () => {
  it('has a picture of every item of the starting room, in its colour', () => {
    for (const p of defaultLayout('personal').items) expect(plateOf(p)).not.toBeNull();
  });

  it('has a picture of every item of the catalog, in every colour', () => {
    for (const [id, art] of Object.entries((ART as any).items as Record<string, { variants: { id: string }[] }>)) {
      for (const v of art.variants) expect(plateOf({ item: id, variant: v.id, x: 200, y: 600, flip: false, rotate: 0 })).not.toBeNull();
    }
  });

  it('has every wall and floor of the catalog', () => {
    const surfaces = (ART as any).surfaces as Record<string, { kind: 'wall' | 'floor' }>;
    for (const [id, s] of Object.entries(surfaces)) expect(s.kind === 'wall' ? HOME_WALLS[id] : HOME_FLOORS[id]).toBeTruthy();
  });

  it('only pictures items and colours the catalog has, and every colour of those it pictures', () => {
    for (const [id, plate] of Object.entries(HOME_ITEMS)) {
      const art = itemArt(id);
      expect(art).toBeTruthy();
      expect(Object.keys(plate.variants).sort()).toEqual(art!.variants.map((v) => v.id).sort());
    }
  });

  it('puts each picture where the item was rendered, at its anchor of the starting room when it has one', () => {
    for (const p of defaultLayout('personal').items) expect(HOME_ITEMS[p.item].anchor).toEqual([p.x, p.y]);
  });

  it('keeps the catalog drawing for what has no picture, and a window shown with the sky of the hour keeps its own', () => {
    // An item a newer server may send before this app has its picture.
    expect(plateOf({ item: 'not_in_this_app', variant: 'any', x: 200, y: 600, flip: false, rotate: 0 })).toBeNull();
    const window = { item: 'window', variant: 'morning~starry', x: 210, y: 262, flip: false, rotate: 0 };
    expect(plateOf(window)?.v).toBe(HOME_ITEMS.window.variants.morning);
    expect(isPlatedHomeWindow(window)).toBe(true);
  });

  it('lets the sky show through the window exactly where the room draws its weather', () => {
    // RoomAmbience's GLASS for `window`: x -46..46, y -64..62 around the anchor.
    const [ax, ay] = HOME_ITEMS.window.anchor;
    expect(HOME_ITEMS.window.glass).toEqual([ax - 46, ay - 64, 92, 126]);
    const [rx, ry] = HOME_ITEMS.window_round.anchor;
    expect(HOME_ITEMS.window_round.glass).toEqual([rx - 40, ry - 40, 80, 80]);
    expect(HOME_ITEMS.window_round.glassRound).toBe(true);
  });
});
