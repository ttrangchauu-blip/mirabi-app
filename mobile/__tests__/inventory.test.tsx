import React from 'react';
import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ITEM_ICONS } from '../src/itemArt';
import { GARDEN_PLANTS } from '../src/gardenArt';
import { inventoryCache, requestPlace, takePlace } from '../src/inventory/api';
import type { InventoryItem } from '../src/inventory/types';
import { applyPalette, itemArt, PALETTES, roomSvg } from '../src/room/art';
import { countsLabel, freeCopies } from '../src/room/found';
import { addItem, moveItem, storeItem } from '../src/room/rules';
import type { FoundStack, Layout } from '../src/room/types';
import { filterItems, InventoryScreen, searchKey } from '../src/screens/inventory/InventoryScreen';
import { GardenScreen } from '../src/screens/garden/GardenScreen';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

// The backend's catalog (backend/app/items_catalog.py): ids, groups and the variants it keeps itself.
const CATALOG = fs.readFileSync(path.join(__dirname, '../../backend/app/items_catalog.py'), 'utf8');
const ENTRIES = [...CATALOG.matchAll(/_i\("(\w+)", "(\w+)"/g)].map(([, id, group]) => ({ id, group }));
const ROOM_GROUPS = ['plant', 'study', 'toy', 'furniture', 'decor', 'fabric', 'element'];
const BADGES = ['flower_hills', 'seaside', 'pine_forest', 'little_town', 'snowy_peak'];

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 'small_pot', variant: 'default', name: 'Chậu cây nhỏ', description: 'Một chậu cây.', group: 'plant', group_label: 'Cây trang trí',
  tab: 'decor', rarity: 'rare', rarity_label: 'Hiếm', use: 'room', use_label: 'Phòng', rooms: ['personal', 'focus'], art: 'small_pot',
  owned: 3, placed: 2, available: 1, is_new: false, first_obtained_at: '2026-10-01T08:00:00+00:00', last_obtained_at: '2026-10-01T08:00:00+00:00',
  ...over,
});
const INVENTORY = { tabs: [], rarities: [], uses: [], server_now: '2026-10-29T08:00:00+00:00', items: [
  item({}),
  item({ id: 'seed_daisy', name: 'Hạt hoa cúc', group: 'seed', group_label: 'Hạt giống', tab: 'seed', rarity: 'common', rarity_label: 'Thường',
    use: 'garden', use_label: 'Vườn nhà', rooms: [], art: null, owned: 2, placed: 0, available: 2, is_new: true, last_obtained_at: '2026-10-28T08:00:00+00:00' }),
  item({ id: 'crystal', name: 'Mảnh pha lê', group: 'material', group_label: 'Nguyên liệu', tab: 'material', rarity: 'special', rarity_label: 'Đặc biệt',
    use: 'craft', use_label: 'Chế tạo', rooms: [], art: null, owned: 1, placed: 0, available: 1 }),
  item({ id: 'shell', name: 'Vỏ sò', group: 'keepsake', group_label: 'Kỷ vật', tab: 'keepsake', rarity: 'common', rarity_label: 'Thường',
    use: 'album', use_label: 'Album kỷ niệm', rooms: [], art: null, owned: 1, placed: 0, available: 1 }),
] };

beforeEach(async () => { await AsyncStorage.clear(); });

describe('item pictures', () => {
  it('every catalog item has a picture: decorations their room artwork, the rest an icon (each badge per place)', () => {
    expect(ENTRIES.length).toBeGreaterThan(50);
    for (const { id, group } of ENTRIES) {
      if (ROOM_GROUPS.includes(group)) expect(itemArt(id === 'moon_lantern' ? 'lantern_shelf' : id)).toBeTruthy();
      else if (id === 'place_badge') BADGES.forEach((b) => expect(ITEM_ICONS[`place_badge.${b}`]).toBeTruthy());
      else expect([id, ITEM_ICONS[id] ? 'ok' : 'missing']).toEqual([id, 'ok']);
      if (group === 'seed') expect(GARDEN_PLANTS[id]).toHaveLength(3);
    }
  });
});

describe('copies of found decorations', () => {
  const at = (it: string, x: number, y: number, more = {}) => ({ item: it, variant: itemArt(it)!.variants[0].id, x, y, flip: false, rotate: 0, ...more });
  const ROOM: Layout = { wall: 'wall_cream', floor: 'floor_wood_light', items: [at('rug_oval', 210, 640)] };
  const stack: FoundStack = { item: 'small_pot', item_id: 'small_pot', variant: 'default', name: 'Chậu cây nhỏ', rarity: 'rare', rarity_label: 'Hiếm', owned: 3, placed: 1, available: 2 };

  it('a room holds several copies, each moved and stored on its own, and counts what is free', () => {
    const saved: Layout = { ...ROOM, items: [...ROOM.items, at('small_pot', 60, 735, { uid: 'p1' })] };
    let draft = addItem(saved, 'small_pot', 'personal', { variant: 'default', uid: 'new-1' }).layout;
    draft = addItem(draft, 'small_pot', 'personal', { variant: 'default', uid: 'new-2' }).layout;
    expect(draft.items.filter((p) => p.item === 'small_pot').map((p) => p.uid)).toEqual(['p1', 'new-1', 'new-2']);
    expect(freeCopies(stack, saved, draft)).toBe(0);
    const moved = moveItem(draft, 'new-1', 300, 740, 'personal').layout;
    expect(moved.items.find((p) => p.uid === 'new-1')!.x).not.toBe(draft.items.find((p) => p.uid === 'new-1')!.x);
    expect(moved.items.find((p) => p.uid === 'p1')).toEqual(draft.items.find((p) => p.uid === 'p1'));
    const stored = storeItem(moved, 'p1', 'personal');
    expect(stored.stored).toEqual(['small_pot']);
    expect(stored.layout.items.filter((p) => p.item === 'small_pot')).toHaveLength(2);
    expect(freeCopies(stack, saved, stored.layout)).toBe(1); // stored without saving: free again in this draft
    expect(countsLabel(1, 2)).toBe('Còn 1 · Đang đặt 2');
    expect(countsLabel(4, 0)).toBe('Còn 4');
  });

  it('a copy keeps its colour under a palette and its drawing ids are its own', () => {
    const room: Layout = { ...ROOM, items: [...ROOM.items, at('flower_pot_mini', 60, 735, { uid: 'p7', variant: 'violet' })] };
    for (const palette of PALETTES) expect(applyPalette(room, palette).items[1].variant).toBe('violet');
    const svg = roomSvg(room);
    for (const id of svg.match(/id='flower_pot_mini-[^']*'/g) ?? []) expect(id).toMatch(/-p7'$/);
  });

  it('"Đặt vào phòng" waits for the room it was meant for, once', () => {
    requestPlace({ room: 'focus', item: 'small_pot', variant: 'default', name: 'Chậu cây nhỏ' });
    expect(takePlace('personal')).toBeNull();
    expect(takePlace('focus')?.item).toBe('small_pot');
    expect(takePlace('focus')).toBeNull();
  });
});

describe('Kho đồ', () => {
  it('filters by tab, rarity, use and a name without marks, newest first or by name', () => {
    const all = INVENTORY.items;
    expect(searchKey('Hạt hoa Cúc')).toBe('hat hoa cuc');
    const base = { tab: 'all' as const, rarity: 'all', use: 'all' as const, query: '', sort: 'newest' as const };
    expect(filterItems(all, base)[0].id).toBe('seed_daisy');
    expect(filterItems(all, { ...base, sort: 'name' }).map((i) => i.name)).toEqual(['Chậu cây nhỏ', 'Hạt hoa cúc', 'Mảnh pha lê', 'Vỏ sò']);
    expect(filterItems(all, { ...base, tab: 'decor' }).map((i) => i.id)).toEqual(['small_pot']);
    expect(filterItems(all, { ...base, rarity: 'special' }).map((i) => i.id)).toEqual(['crystal']);
    expect(filterItems(all, { ...base, use: 'album' }).map((i) => i.id)).toEqual(['shell']);
    expect(filterItems(all, { ...base, query: 'hoa cuc' }).map((i) => i.id)).toEqual(['seed_daisy']);
  });

  it('shows the grid with what is free and new, the detail with history, and the right action for each item', async () => {
    const server = mockServer({
      'GET /api/inventory': { status: 200, body: INVENTORY },
      'GET /api/inventory/items/small_pot?variant=default': { status: 200, body: { item: INVENTORY.items[0], memory_id: null, walk_id: 3,
        placements: [{ uid: 'p1', room: 'personal', x: 1, y: 1, placed_at: '2026-10-02T08:00:00+00:00' }, { uid: 'p2', room: 'focus', x: 1, y: 1, placed_at: '2026-10-02T08:00:00+00:00' }],
        history: [{ kind: 'walk_reward', delta: 3, placed_delta: 0, ref: 'walk:3', at: '2026-10-01T08:00:00+00:00', walk_id: 3, location: { id: 'seaside', name: 'Bờ biển' }, memory_id: null }] } },
      'GET /api/inventory/items/seed_daisy?variant=default': { status: 200, body: { item: INVENTORY.items[1], placements: [], history: [], memory_id: null, walk_id: null } },
      'POST /api/inventory/items/seed_daisy/seen': { status: 200, body: { ok: true } },
    });
    const onPlace = jest.fn(); const onPlant = jest.fn();
    render(<InventoryScreen userId={USER.id} onBack={() => {}} onPlace={onPlace} onPlant={onPlant} />);
    const pot = await screen.findByLabelText('Chậu cây nhỏ, Hiếm, Còn 1 · Đang đặt 2');
    expect(screen.getByLabelText('Hạt hoa cúc, Thường, Còn 2, Mới')).toBeTruthy();

    fireEvent.press(pot);
    expect(await screen.findByText('Nhận 3 từ chuyến khám phá Bờ biển')).toBeTruthy();
    expect(screen.getByText('Đang đặt: Phòng cá nhân ×1 · Phòng tập trung ×1')).toBeTruthy();
    expect(screen.getByLabelText('Tổng sở hữu: 3')).toBeTruthy();
    expect(screen.getByLabelText('Còn lại: 1')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Đặt vào phòng' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Phòng tập trung' }));
    expect(onPlace).toHaveBeenCalledWith(expect.objectContaining({ id: 'small_pot' }), 'focus');

    fireEvent.press(screen.getByRole('tab', { name: 'Hạt giống, 1 món' }));
    fireEvent.press(await screen.findByLabelText('Hạt hoa cúc, Thường, Còn 2, Mới'));
    await waitFor(() => expect(server.callsTo('POST /api/inventory/items/seed_daisy/seen')).toHaveLength(1));
    fireEvent.press(await screen.findByRole('button', { name: 'Trồng' }));
    expect(onPlant).toHaveBeenCalledWith(expect.objectContaining({ id: 'seed_daisy' }));
  });

  it('materials are only described, for crafting later', async () => {
    mockServer({ 'GET /api/inventory': { status: 200, body: INVENTORY },
      'GET /api/inventory/items/crystal?variant=default': { status: 200, body: { item: INVENTORY.items[2], placements: [], history: [], memory_id: null, walk_id: null } } });
    render(<InventoryScreen userId={USER.id} onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Mảnh pha lê, Đặc biệt, Còn 1'));
    expect(await screen.findByText('Dùng để chế tạo trong tương lai.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Đặt vào phòng' })).toBeNull();
  });

  it('is empty, fails with a retry, and offline shows the saved inventory read only', async () => {
    let reply: any = networkDown();
    mockServer({ 'GET /api/inventory': () => reply });
    const view = render(<InventoryScreen userId={USER.id} onBack={() => {}} />);
    fireEvent.press(await screen.findByRole('button', { name: 'Thử lại' }));
    reply = { status: 200, body: { ...INVENTORY, items: [] } };
    fireEvent.press(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Kho đồ còn trống')).toBeTruthy();
    view.unmount();

    await inventoryCache.store(USER.id, INVENTORY as any);
    reply = networkDown();
    render(<InventoryScreen userId={USER.id} onBack={() => {}} />);
    expect(await screen.findByLabelText('Đang ngoại tuyến, chạm để thử lại')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Chậu cây nhỏ, Hiếm, Còn 1 · Đang đặt 2'));
    expect(await screen.findByText('Cần kết nối mạng để dùng món này.')).toBeTruthy();
  });
});

describe('Vườn nhà', () => {
  const plots = (planted = false) => Array.from({ length: 6 }, (_, plot) => (plot === 0 && planted
    ? { plot, empty: false, item_id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', planted_at: '2026-10-29T08:00:00+00:00',
      stage: 0, stage_label: 'Mới nảy mầm', grown: false, next_stage_at: new Date(Date.now() + 3 * 3600_000).toISOString() }
    : { plot, empty: true }));
  const garden = (planted = false) => ({ size: 6, plots: plots(planted), seeds: planted ? [] : [INVENTORY.items[1]], server_now: '' });

  it('plants the chosen seed in the empty plot tapped, and a retry after a lost answer reuses the same request', async () => {
    let attempt = 0;
    const server = mockServer({
      'GET /api/garden': { status: 200, body: garden() },
      'POST /api/garden/plots/0/plant': () => (++attempt === 1 ? networkDown() : { status: 200, body: { planted: true, replayed: false, garden: garden(true) } }),
    });
    render(<ToastProvider><ConfirmProvider>
      <GardenScreen user={USER as any} onBack={() => {}} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />
    </ConfirmProvider></ToastProvider>);
    fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc'));
    await waitFor(() => expect(server.callsTo('POST /api/garden/plots/0/plant')).toHaveLength(1));
    fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc'));
    expect(await screen.findByLabelText(/^Hạt hoa cúc, Mới nảy mầm/)).toBeTruthy();
    const [first, second] = server.callsTo('POST /api/garden/plots/0/plant');
    expect(second.body.client_request_id).toBe(first.body.client_request_id);
    expect(second.body).toEqual({ item_id: 'seed_daisy', variant: 'default', client_request_id: first.body.client_request_id });
  });
});
