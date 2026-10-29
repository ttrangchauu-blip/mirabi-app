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

const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);

beforeEach(async () => { await AsyncStorage.clear(); });

describe('Vườn của tôi', () => {
  it('opens a plant on tap and waters it, retrying a lost answer with the same request', async () => {
    let attempt = 0;
    const server = mockServer({
      'GET /api/garden': { status: 200, body: garden(daisy(0)) },
      'POST /api/garden/plots/0/care': () => (++attempt === 1 ? networkDown()
        : { status: 200, body: { cared: true, replayed: false, reason: null, garden: garden(daisy(0, { water: WATERED })) } }),
    });
    wrap(<GardenScreen user={USER as any} onBack={() => {}} onOpenInventory={() => {}} />);
    expect(await screen.findByText('1/6 ô')).toBeTruthy();
    expect(screen.getByText('1 cần tưới')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Hạt hoa cúc, Đang lớn.*chưa tưới hôm nay.*chạm để xem chi tiết$/));
    fireEvent.press(await screen.findByLabelText('Tưới nước'));
    await waitFor(() => expect(server.callsTo('POST /api/garden/plots/0/care')).toHaveLength(1));
    // The answer was lost: the water tool, then the plant again.
    fireEvent.press(screen.getByLabelText('Tưới'));
    fireEvent.press(await screen.findByLabelText(/^Hạt hoa cúc, Đang lớn.*chạm để tưới nước$/));
    expect(await screen.findByText('Đã tưới hết')).toBeTruthy();
    const [first, second] = server.callsTo('POST /api/garden/plots/0/care');
    expect(first.body.kind).toBe('water');
    expect(second.body).toEqual({ kind: 'water', client_request_id: first.body.client_request_id });
    // Watered today: the plant says so and the action is no longer offered.
    fireEvent.press(screen.getByLabelText('Tưới'));
    fireEvent.press(screen.getByLabelText(/^Hạt hoa cúc, Đang lớn, lớn tiếp sau khoảng \d giờ, đã tưới hôm nay · bạn/));
    expect(await screen.findByLabelText('Tưới nước, Đã tưới hôm nay')).toBeTruthy();
    expect(server.callsTo('POST /api/garden/plots/0/care')).toHaveLength(2);
  });

  it('lists friends in "Vườn bạn bè" with "Thăm vườn", and says when there is nobody yet', async () => {
    mockServer({ 'GET /api/garden': { status: 200, body: garden() }, 'GET /api/friends': { status: 200, body: { items: [FRIEND] } } });
    const onVisitGarden = jest.fn();
    const onTabChange = jest.fn();
    wrap(<GardenScreen user={USER as any} onBack={() => {}} onOpenInventory={() => {}} onVisitGarden={onVisitGarden} onTabChange={onTabChange} />);
    fireEvent.press(await screen.findByText('Vườn bạn bè'));
    expect(onTabChange).toHaveBeenCalledWith('friends');
    expect(await screen.findByText('May')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Thăm vườn'));
    expect(onVisitGarden).toHaveBeenCalledWith(7);

    mockServer({ 'GET /api/friends': { status: 200, body: { items: [] } } });
    screen.unmount();
    wrap(<GardenScreen user={USER as any} onBack={() => {}} onOpenInventory={() => {}} tab="friends" />);
    expect(await screen.findByText('Chưa có bạn bè')).toBeTruthy();
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

it('opens Vườn nhà from Tiện ích', () => {
  const onOpenGarden = jest.fn();
  wrap(<MoreTab user={USER as any} onOpenProfile={() => {}} onOpenGarden={onOpenGarden} />);
  fireEvent.press(screen.getByLabelText('Vườn nhà: Trồng và chăm cây'));
  expect(onOpenGarden).toHaveBeenCalled();
});
