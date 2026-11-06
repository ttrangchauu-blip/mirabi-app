import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FriendGardenScreen } from '../src/screens/garden/FriendGardenScreen';
import { GardenScreen } from '../src/screens/garden/GardenScreen';
import { MoreTab } from '../src/screens/main/MoreTab';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

// MoreTab's "Đăng xuất" needs the signed-in session; only its "Vườn nhà" tile is under test here.
jest.mock('../src/auth/useConfirmLogout', () => ({ useConfirmLogout: () => jest.fn() }));

const NOT_YET = { done: false, by: null, at: null };
const daisy = (plot: number, care: Record<string, unknown> = {}) => ({
  plot, empty: false, item_id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', planted_at: '2026-10-29T08:00:00+00:00',
  stage: 1, stage_label: 'Đang lớn', grown: false, next_stage_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
  care: { water: NOT_YET, tend: NOT_YET, ...care },
});
const plots = (...planted: ReturnType<typeof daisy>[]) => Array.from({ length: 6 }, (_, plot) => planted.find((p) => p.plot === plot) ?? { plot, empty: true });
const garden = (...planted: ReturnType<typeof daisy>[]) => ({ size: 6, plots: plots(...planted), seeds: [], server_now: '', care_day: '2026-10-29' });
const WATERED = { done: true, by: { id: 1, display_name: 'Aqua', me: true }, at: '2026-10-29T09:00:00+00:00' };
const OWNER = { id: 7, display_name: 'May', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Mochi', pet_level: 1 };
const visit = (planted: ReturnType<typeof daisy>[], left = 20) => ({
  owner: OWNER, garden: { size: 6, plots: plots(...planted), server_now: '', care_day: '2026-10-29' }, care: { daily_limit: 20, used: 20 - left, left },
});
const FRIEND = { id: 7, display_name: 'May', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Mochi', pet_level: 1, presence: 'online', room: null,
  can_visit: true, accepts_study_invites: true };

const SHOP_ITEM = (item: string, name: string, tier: string, tier_label: string, price: number, extra: Record<string, unknown> = {}) => ({
  plant_id: item.replace('seed_', ''), item_id: item, name, seed_name: `Hạt ${name.toLowerCase()}`, description: '', tier, tier_label, art: item.replace('seed_', ''),
  grow_seconds: 600, harvest_exp: 2, harvest_coins: price + 1, seed_price: price, profit: 1, unlock_level: 0, unlocked: true, owned: 0, ...extra });
const SHOP = (coins = 100) => ({ coins, pet_level: 1, max_quantity: 20, garden_exp: { daily_cap: 20, earned_today: 7, left: 13 },
  tiers: [{ id: 'common', label: 'Thường', unlock_level: 0 }, { id: 'uncommon', label: 'Không phổ biến', unlock_level: 1 }, { id: 'rare', label: 'Hiếm', unlock_level: 2 }],
  items: [SHOP_ITEM('seed_carrot', 'Cà rốt', 'common', 'Thường', 5), SHOP_ITEM('seed_tulip', 'Hoa tulip', 'uncommon', 'Không phổ biến', 11),
    SHOP_ITEM('seed_crystal_tree', 'Cây pha lê', 'rare', 'Hiếm', 24, { unlocked: false, unlock_level: 2, grow_seconds: 7200, harvest_exp: 7, harvest_coins: 40 })] });
const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);

beforeEach(async () => { await AsyncStorage.clear(); });

describe('Vườn của tôi', () => {
  it('says the pet is out on its walk, and shows no pet until it is back', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: garden() } });
    wrap(<GardenScreen user={{ ...USER, level: 2 } as any} onOpenInventory={() => {}} petAway petWalking />);
    expect(await screen.findByText('Pet đang đi dạo, về nhà sẽ ra vườn chơi.', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId(/^living-pet-/)).toBeNull();
  });

  it('has the pet out in the garden when it is home', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: garden() } });
    wrap(<GardenScreen user={{ ...USER, level: 2 } as any} onOpenInventory={() => {}} />);
    expect(await screen.findByTestId(/^living-pet-/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText('Pet đang đi dạo, về nhà sẽ ra vườn chơi.')).toBeNull();
  });

  describe('the seeds on the card', () => {
    const SEED = (available = 3, id = 'seed_daisy', name = 'Hạt hoa cúc') => ({ id, variant: 'default', name, rarity: 'common', rarity_label: 'Thường', group: 'seed', available });
    const withSeeds = (seeds: unknown[], ...planted: any[]) => ({ ...garden(...planted), seeds });

    it('adds up what the inventory holds and shows no other numbers, down to 0', async () => {
      mockServer({ 'GET /api/garden': { status: 200, body: withSeeds([SEED(3), SEED(9, 'seed_tulip', 'Củ tulip')], daisy(0)) } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      expect(await screen.findByLabelText('Hạt giống: 12', {}, { timeout: 8000 })).toBeTruthy();
      expect(screen.queryByText(/\/6 ô|đã lớn|cần tưới|Đã tưới hết/)).toBeNull();
      screen.unmount();
      mockServer({ 'GET /api/garden': { status: 200, body: garden() } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      expect(await screen.findByLabelText('Hạt giống: 0', {}, { timeout: 8000 })).toBeTruthy();
    });

    it('comes down only when the backend planted, and fast taps send one request', async () => {
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      const server = mockServer({
        'GET /api/garden': { status: 200, body: withSeeds([SEED(2)]) },
        'POST /api/garden/plots/0/plant': () => new Promise((r) => { answer = r; }),
      });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
      const plot = await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc', {}, { timeout: 8000 });
      fireEvent.press(plot); fireEvent.press(plot); fireEvent.press(plot);
      fireEvent.press(screen.getByLabelText('Ô đất trống 2, chạm để trồng Hạt hoa cúc'));
      await waitFor(() => expect(server.callsTo('POST /api/garden/plots/0/plant')).toHaveLength(1));
      expect(screen.getByLabelText('Hạt giống: 2')).toBeTruthy(); // nothing is taken before the answer
      expect(server.callsTo('POST /api/garden/plots/1/plant')).toHaveLength(0);
      answer({ status: 200, body: { planted: true, replayed: false, garden: withSeeds([SEED(1)], daisy(0)) } });
      expect(await screen.findByLabelText('Hạt giống: 1')).toBeTruthy();
    });

    it('stays as it was when planting fails', async () => {
      mockServer({
        'GET /api/garden': { status: 200, body: withSeeds([SEED(2)]) },
        'POST /api/garden/plots/0/plant': { status: 409, body: { code: 'plot_taken', detail: 'taken' } },
      });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
      fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc', {}, { timeout: 8000 }));
      expect(await screen.findByText('Ô đất này đã có cây rồi.')).toBeTruthy();
      expect(screen.getByLabelText('Hạt giống: 2')).toBeTruthy();
    });

    it('reads the inventory again when a walk\'s gifts arrive', async () => {
      let seeds = 0;
      mockServer({ 'GET /api/garden': () => ({ status: 200, body: withSeeds(seeds ? [SEED(seeds)] : []) }) });
      const view = (version: number) => <ToastProvider><ConfirmProvider><GardenScreen user={USER as any} onOpenInventory={() => {}} version={version} /></ConfirmProvider></ToastProvider>;
      render(view(0));
      expect(await screen.findByLabelText('Hạt giống: 0', {}, { timeout: 8000 })).toBeTruthy();
      seeds = 2;
      screen.rerender(view(1));
      expect(await screen.findByLabelText('Hạt giống: 2')).toBeTruthy();
    });

    it('its (+) leads to where seeds come from: the shop, the walks and the inventory', async () => {
      mockServer({ 'GET /api/garden': { status: 200, body: garden() }, 'GET /api/garden/shop': { status: 200, body: SHOP() } });
      const onOpenExplore = jest.fn(), onOpenInventory = jest.fn();
      wrap(<GardenScreen user={USER as any} onOpenInventory={onOpenInventory} onOpenExplore={onOpenExplore} />);
      fireEvent.press(await screen.findByLabelText('Nhận thêm hạt giống', {}, { timeout: 8000 }));
      fireEvent.press(await screen.findByLabelText('Đến Khám phá'));
      expect(onOpenExplore).toHaveBeenCalledTimes(1);
      fireEvent.press(await screen.findByLabelText('Nhận thêm hạt giống'));
      fireEvent.press(await screen.findByLabelText('Mở Kho đồ'));
      expect(onOpenInventory).toHaveBeenCalledTimes(1);
      fireEvent.press(await screen.findByLabelText('Nhận thêm hạt giống'));
      fireEvent.press(await screen.findByLabelText('Cửa hàng hạt giống'));
      expect(await screen.findByTestId('garden-shop')).toBeTruthy();
    });
  });

  describe('the tools', () => {
    const state = (label: string) => screen.getByLabelText(label).props.accessibilityState;
    const SEED = { id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', rarity_label: 'Thường', group: 'seed', available: 3 };
    const WATERED_AND_TENDED = { water: WATERED, tend: WATERED };

    it('can only be chosen when they can do something', async () => {
      mockServer({ 'GET /api/garden': { status: 200, body: garden() } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      await screen.findByLabelText('Hạt giống: 0', {}, { timeout: 8000 });
      for (const tool of ['Trồng', 'Tưới', 'Chăm sóc']) expect(state(tool).disabled).toBe(true); // no seed, no plant
      screen.unmount();
      mockServer({ 'GET /api/garden': { status: 200, body: { ...garden(daisy(0, { water: WATERED })), seeds: [SEED] } } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      await screen.findByLabelText('Hạt giống: 3', {}, { timeout: 8000 });
      expect(state('Trồng').disabled).toBe(false);
      expect(state('Tưới').disabled).toBe(true); // watered today
      expect(state('Chăm sóc').disabled).toBe(false);
      screen.unmount();
      mockServer({ 'GET /api/garden': { status: 200, body: garden(daisy(0, WATERED_AND_TENDED)) } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      await screen.findByLabelText('Hạt giống: 0', {}, { timeout: 8000 });
      expect(state('Chăm sóc').disabled).toBe(true);
    });

    it('all wait for the connection when only the saved garden is on show', async () => {
      await AsyncStorage.setItem(`mirabi.garden.v1:${USER.id}`, JSON.stringify({ ...garden(daisy(0)), seeds: [SEED] }));
      mockServer({ 'GET /api/garden': () => networkDown() });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      expect(await screen.findByLabelText('Đang ngoại tuyến, chạm để thử lại', {}, { timeout: 8000 })).toBeTruthy();
      expect(screen.getByLabelText('Hạt giống: 3')).toBeTruthy();
      for (const tool of ['Trồng', 'Tưới', 'Chăm sóc']) expect(state(tool).disabled).toBe(true);
    });

    it('"Trồng" asks which seed when there are several kinds, and the plots stay where they were', async () => {
      const TULIP = { ...SEED, id: 'seed_tulip', name: 'Củ tulip' };
      mockServer({ 'GET /api/garden': { status: 200, body: { ...garden(), seeds: [SEED, TULIP] } } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      await screen.findByLabelText('Ô đất trống 1', {}, { timeout: 8000 });
      const before = screen.getByTestId('garden-plot-0-area').props.style;
      fireEvent.press(screen.getByLabelText('Trồng'));
      fireEvent.press(await screen.findByLabelText('Củ tulip'));
      expect(await screen.findByText('Chạm ô trống để trồng Củ tulip.')).toBeTruthy();
      expect(screen.getByLabelText('Ô đất trống 1, chạm để trồng Củ tulip')).toBeTruthy();
      expect(screen.getByTestId('garden-plot-0-area').props.style).toEqual(before);
    });

    it('an empty plot tapped with no tool opens the seeds', async () => {
      mockServer({ 'GET /api/garden': { status: 200, body: { ...garden(), seeds: [SEED] } } });
      wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
      fireEvent.press(await screen.findByLabelText('Ô đất trống 1', {}, { timeout: 8000 }));
      expect(await screen.findByText('Trồng hạt giống nào?')).toBeTruthy();
    });
  });

  it('opens a plant on tap and waters it, retrying a lost answer with the same request', async () => {
    let attempt = 0;
    const server = mockServer({
      'GET /api/garden': { status: 200, body: garden(daisy(0)) },
      'POST /api/garden/plots/0/care': () => (++attempt === 1 ? networkDown()
        : { status: 200, body: { cared: true, replayed: false, reason: null, garden: garden(daisy(0, { water: WATERED })) } }),
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn.*chưa tưới hôm nay.*chạm để xem chi tiết$/, {}, { timeout: 8000 })); // the first render of the scene is slow on a busy machine
    fireEvent.press(await screen.findByLabelText('Tưới nước'));
    await waitFor(() => expect(server.callsTo('POST /api/garden/plots/0/care')).toHaveLength(1));
    // The answer was lost: the water tool, then the plant again.
    fireEvent.press(screen.getByLabelText('Tưới'));
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn.*chạm để tưới nước$/));
    // Watered today: the plant says so, the tool is put down and the action is no longer offered.
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn, lớn tiếp sau \d+ giờ, đã tưới hôm nay · bạn.*chạm để xem chi tiết$/));
    const [first, second] = server.callsTo('POST /api/garden/plots/0/care');
    expect(first.body.kind).toBe('water');
    expect(second.body).toEqual({ kind: 'water', client_request_id: first.body.client_request_id });
    expect(screen.getByLabelText('Tưới').props.accessibilityState.disabled).toBe(true);
    expect(await screen.findByLabelText('Tưới nước, Đã tưới hôm nay')).toBeTruthy();
    expect(server.callsTo('POST /api/garden/plots/0/care')).toHaveLength(2);
  });

  it('a new planting in the same plot is a new request, even when the answer of the old one was lost', async () => {
    const SEED = { id: 'seed_daisy', variant: 'default', name: 'Hạt hoa cúc', rarity: 'common', rarity_label: 'Thường', group: 'seed', available: 3 };
    const grown = (plot: number) => ({ ...daisy(plot), stage: 2, stage_label: 'Đã lớn', grown: true, next_stage_at: null });
    const picked = { plot: 0, item_id: 'seed_daisy', plant_id: 'daisy', name: 'Hoa cúc', art: 'daisy', tier: 'common', tier_label: 'Thường', coins: 6, exp: 2,
      exp_requested: 2, exp_capped: false, harvested_at: '2026-10-29T09:00:00+00:00' };
    const withSeeds = (...planted: any[]) => ({ ...garden(...planted), seeds: [SEED] });
    let attempt = 0;
    const server = mockServer({
      'GET /api/garden': { status: 200, body: withSeeds() },
      // The first planting reaches the backend, but its answer is lost.
      'POST /api/garden/plots/0/plant': () => (++attempt === 1 ? networkDown()
        : { status: 200, body: { planted: true, replayed: false, garden: withSeeds(daisy(0)) } }),
      // The next answer shows that first plant in the ground, and grown by now.
      'POST /api/garden/plots/1/plant': { status: 200, body: { planted: true, replayed: false, garden: withSeeds(grown(0), daisy(1)) } },
      'POST /api/garden/plots/0/harvest': { status: 200, body: { harvested: true, replayed: false, harvest: picked, coins: 106, pet_level: 1, xp: 302, garden: withSeeds(daisy(1)) } },
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} initialSeed={{ id: 'seed_daisy', variant: 'default' }} />);
    fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc', {}, { timeout: 8000 }));
    await waitFor(() => expect(attempt).toBe(1));
    fireEvent.press(await screen.findByLabelText('Ô đất trống 2, chạm để trồng Hạt hoa cúc'));
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đã lớn.*chạm để thu hoạch$/));
    fireEvent.press(await screen.findByLabelText('Thu hoạch'));
    fireEvent.press(await screen.findByLabelText('Ô đất trống 1, chạm để trồng Hạt hoa cúc'));
    await waitFor(() => expect(server.callsTo('POST /api/garden/plots/0/plant')).toHaveLength(2));
    const [lost, next] = server.callsTo('POST /api/garden/plots/0/plant');
    expect(next.body.client_request_id).not.toBe(lost.body.client_request_id); // the same id would answer "replayed" and plant nothing
  });

  it('shows a plant growing on when its next stage comes, by the server clock', async () => {
    const now = '2026-10-29T08:00:00.000Z';
    const growing = { ...daisy(0), next_stage_at: '2026-10-29T08:00:00.100Z' }; // the device's clock says nothing about this
    const grown: any = { ...daisy(0), stage: 2, stage_label: 'Đã lớn', grown: true, next_stage_at: null };
    let reads = 0;
    const server = mockServer({ 'GET /api/garden': () => ({ status: 200, body: { ...garden(++reads === 1 ? growing : grown), server_now: now } }) });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    expect(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn/, {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByLabelText(/^Hạt hoa cúc, Đã lớn/, {}, { timeout: 5000 })).toBeTruthy();
    expect(server.callsTo('GET /api/garden')).toHaveLength(2); // and no timer once nothing is left to grow
  });
});

describe('Vườn bạn bè', () => {
  it("shows the owner's garden, lets a friend tend a plant, and keeps watered ones as they are", async () => {
    const server = mockServer({
      'GET /api/garden/visit/7': { status: 200, body: visit([daisy(1, { water: { ...WATERED, by: { id: 9, display_name: 'Kai', me: false } } })]) },
      'POST /api/garden/visit/7/plots/1/care': (req) => ({ status: 200, body: { cared: true, replayed: false, reason: null,
        ...visit([daisy(1, { water: { ...WATERED, by: { id: 9, display_name: 'Kai', me: false } }, tend: { ...WATERED, by: { id: 1, display_name: 'Aqua', me: true } } })], 19),
        _kind: req.body.kind } }),
    });
    const onBack = jest.fn();
    wrap(<FriendGardenScreen userId={7} onBack={onBack} />);
    expect(await screen.findByText('Vườn của May')).toBeTruthy();
    expect(screen.getByText('Còn 20/20 lượt chăm')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Hạt hoa cúc, Đang lớn.*đã tưới hôm nay · kai.*chạm để xem chi tiết$/));
    expect(await screen.findByLabelText('Tưới nước, Đã tưới hôm nay')).toBeTruthy();
    expect(screen.queryByLabelText('Dọn ô')).toBeNull(); // a guest never clears, plants or moves anything
    fireEvent.press(screen.getByRole('button', { name: 'Chăm sóc' })); // in the plant's sheet (the tool has the same name)
    expect(await screen.findByText('Còn 19/20 lượt chăm')).toBeTruthy();
    expect(server.callsTo('POST /api/garden/visit/7/plots/1/care')[0].body.kind).toBe('tend');
    fireEvent.press(screen.getByLabelText('Quay lại'));
    expect(onBack).toHaveBeenCalled();
  });

  it('says when the daily care is used up, when the garden is empty, and when visits are off', async () => {
    mockServer({ 'GET /api/garden/visit/7': { status: 200, body: visit([daisy(0)], 0) } });
    wrap(<FriendGardenScreen userId={7} onBack={() => {}} />);
    expect(await screen.findByText('Hôm nay bạn đã hết lượt chăm, vẫn xem vườn được nhé.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Hạt hoa cúc/));
    expect(await screen.findByLabelText('Tưới nước, Hết lượt hôm nay')).toBeTruthy();
    screen.unmount();

    mockServer({ 'GET /api/garden/visit/7': { status: 200, body: visit([]) } });
    wrap(<FriendGardenScreen userId={7} onBack={() => {}} />);
    expect(await screen.findByText('Vườn của May chưa có cây')).toBeTruthy();
    screen.unmount();

    mockServer({ 'GET /api/garden/visit/7': { status: 403, body: { code: 'garden_visits_disabled', detail: 'off' } } });
    wrap(<FriendGardenScreen userId={7} onBack={() => {}} />);
    expect(await screen.findByText('Bạn ấy đang tắt ghé thăm, nên chưa thể vào vườn lúc này.')).toBeTruthy();
  });
});

it('is a place of Cuộc sống Mirabi, so Tiện ích has no way into it of its own', () => {
  wrap(<MoreTab user={USER as any} onOpenProfile={() => {}} />);
  expect(screen.queryByText('Vườn nhà')).toBeNull();
});

describe('Thu hoạch và Cửa hàng hạt giống', () => {
  const ready = (plot: number): any => ({ ...daisy(plot), name: 'Cây pha lê', item_id: 'seed_crystal_tree', art: 'crystal_tree', tier: 'rare', tier_label: 'Hiếm',
    stage: 4, stage_count: 5, stage_label: 'Sẵn sàng thu hoạch', grown: true, ready: true, next_stage_at: null, harvest: { exp: 7, coins: 40 } });
  const picked = { plot: 2, item_id: 'seed_crystal_tree', plant_id: 'crystal_tree', name: 'Cây pha lê', art: 'crystal_tree', tier: 'rare', tier_label: 'Hiếm',
    coins: 40, exp: 7, exp_requested: 7, exp_capped: false, harvested_at: '2026-10-29T09:00:00+00:00' };

  it('shows the coins from the backend and a ready plant asks to be harvested', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: { ...garden(ready(2)), coins: 1234 } } });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    expect(await screen.findByLabelText('1234 xu', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('garden-plot-2-harvestable', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText(/^Cây pha lê, Hiếm, Sẵn sàng thu hoạch.*chạm để thu hoạch$/)).toBeTruthy();
  });

  it('harvests once with the backend\'s reward, retrying a lost answer with the same request', async () => {
    let attempt = 0;
    const onRewarded = jest.fn();
    const server = mockServer({
      'GET /api/garden': { status: 200, body: { ...garden(ready(2)), coins: 100 } },
      'POST /api/garden/plots/2/harvest': () => (++attempt === 1 ? networkDown()
        : { status: 200, body: { harvested: true, replayed: false, harvest: picked, coins: 140, pet_level: 2, xp: 900, garden: { ...garden(), coins: 140 } } }),
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} onRewarded={onRewarded} />);
    fireEvent.press(await screen.findByLabelText(/^Cây pha lê, Hiếm/, {}, { timeout: 8000 }));
    expect(await screen.findByText('Thu hoạch: +7 EXP · +40 xu')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Thu hoạch, +7 EXP · +40 xu'));
    expect(await screen.findByText(/Chưa kết nối được/)).toBeTruthy();
    expect(screen.queryByTestId('garden-harvest-reward')).toBeNull(); // nothing is shown as paid before the backend says so
    fireEvent.press(await screen.findByLabelText(/^Cây pha lê, Hiếm/));
    fireEvent.press(await screen.findByLabelText('Thu hoạch, +7 EXP · +40 xu'));
    const card = await screen.findByTestId('garden-harvest-reward');
    expect(card.props.accessibilityLabel).toBe('Thu hoạch Cây pha lê: cộng 7 EXP, cộng 40 xu');
    expect(await screen.findByLabelText('140 xu')).toBeTruthy();
    const [lost, retry] = server.callsTo('POST /api/garden/plots/2/harvest');
    expect(retry.body).toEqual({ client_request_id: lost.body.client_request_id });
    expect(onRewarded).toHaveBeenCalledTimes(1);
  });

  it('says when the day\'s harvest EXP is used up, and that the coins still came', async () => {
    mockServer({
      'GET /api/garden': { status: 200, body: garden(ready(2)) },
      'POST /api/garden/plots/2/harvest': { status: 200, body: { harvested: true, replayed: false, harvest: { ...picked, exp: 0, exp_capped: true }, coins: 140, pet_level: 2, xp: 900, garden: garden() } },
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    fireEvent.press(await screen.findByLabelText(/^Cây pha lê, Hiếm/, {}, { timeout: 8000 }));
    fireEvent.press(await screen.findByLabelText('Thu hoạch, +7 EXP · +40 xu'));
    expect(await screen.findByText('Đã đủ EXP thu hoạch hôm nay, xu vẫn được cộng.')).toBeTruthy();
  });

  it('a plant still growing offers no harvest', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: garden({ ...daisy(0), stage: 2, stage_count: 5, stage_label: 'Cây non', ready: false,
      ready_at: new Date(Date.now() + 12 * 60_000).toISOString(), harvest: { exp: 2, coins: 6 } } as any) } });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Cây non, thu hoạch sau 1\d phút/, {}, { timeout: 8000 }));
    expect(await screen.findByText('Thu hoạch: +2 EXP · +6 xu')).toBeTruthy();
    expect(screen.queryByLabelText(/^Thu hoạch,/)).toBeNull();
  });

  it('the shop filters by tier, shows what is locked, and buys with a request id and no price', async () => {
    let attempt = 0;
    const onRewarded = jest.fn();
    const server = mockServer({
      'GET /api/garden': { status: 200, body: garden() },
      'GET /api/garden/shop': { status: 200, body: SHOP(100) },
      'POST /api/garden/shop/buy': () => (++attempt === 1 ? networkDown()
        : { status: 200, body: { bought: true, replayed: false, spent: 15, coins: 85, shop: { ...SHOP(85), items: SHOP(85).items.map((i) => (i.item_id === 'seed_carrot' ? { ...i, owned: 3 } : i)) } } }),
    });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} onRewarded={onRewarded} />);
    fireEvent.press(await screen.findByLabelText('Mở Cửa hàng', {}, { timeout: 8000 }));
    expect(await screen.findByTestId('garden-shop-item-seed_carrot')).toBeTruthy();
    expect(screen.getByText('EXP thu hoạch hôm nay: 7/20')).toBeTruthy();
    expect(screen.getByLabelText('Hạt cây pha lê, mở khi pet đạt cấp 2')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Không phổ biến' }));
    expect(screen.queryByTestId('garden-shop-item-seed_carrot')).toBeNull();
    expect(screen.getByTestId('garden-shop-item-seed_tulip')).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Tất cả' }));
    fireEvent.press(screen.getByTestId('garden-shop-buy-seed_carrot'));
    fireEvent.press(await screen.findByLabelText('Thêm một hạt'));
    fireEvent.press(screen.getByLabelText('Thêm một hạt'));
    expect(screen.getByText('Tổng: 15 xu')).toBeTruthy();
    fireEvent.press(screen.getByTestId('garden-shop-confirm'));
    expect(await screen.findByText(/Chạm Mua lần nữa/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('garden-shop-confirm'));
    expect(await screen.findByText('Đã mua 3 hạt cà rốt!')).toBeTruthy();
    expect(screen.getByLabelText('85 xu')).toBeTruthy();
    const [lost, retry] = server.callsTo('POST /api/garden/shop/buy');
    expect(lost.body).toEqual({ item_id: 'seed_carrot', quantity: 3, client_request_id: expect.any(String) });
    expect(retry.body).toEqual(lost.body); // the same purchase: bought once
    expect(onRewarded).toHaveBeenCalledTimes(1);
  });

  it('the shop says when the coins are too few and does not buy', async () => {
    const server = mockServer({ 'GET /api/garden': { status: 200, body: garden() }, 'GET /api/garden/shop': { status: 200, body: SHOP(8) } });
    wrap(<GardenScreen user={USER as any} onOpenInventory={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Mở Cửa hàng', {}, { timeout: 8000 }));
    fireEvent.press(await screen.findByTestId('garden-shop-buy-seed_tulip'));
    expect(await screen.findByText('Chưa đủ xu (cần 11)')).toBeTruthy();
    expect(screen.getByTestId('garden-shop-confirm').props.accessibilityState.disabled).toBe(true);
    expect(server.callsTo('POST /api/garden/shop/buy')).toHaveLength(0);
  });
});
