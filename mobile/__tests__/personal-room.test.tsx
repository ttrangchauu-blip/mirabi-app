import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { mockServer, networkDown, tokens, USER } from '../test/mockServer';

const store: Map<string, string> = (SecureStore as any).__store;
const HOME_GREETING = `Chào bạn, ${USER.display_name}!`;
const at = (item: string, variant: string, x: number, y: number) => ({ item, variant, x, y, flip: false, rotate: 0 });
const LAYOUT = { wall: 'wall_cream', floor: 'floor_wood_light', items: [
  at('window', 'morning', 200, 124), at('rug_oval', 'sage', 200, 372), at('desk', 'oak', 96, 318), at('pet_cushion', 'blue', 318, 356)] };
const ITEMS = [
  ['wall_cream', 'wall', 'surface', 'Tường kem chấm bi'], ['wall_mint', 'wall', 'surface', 'Tường sọc bạc hà'],
  ['floor_wood_light', 'floor', 'surface', 'Sàn gỗ sáng'], ['desk', 'item', 'furniture', 'Bàn học'], ['pet_cushion', 'item', 'bed', 'Đệm tròn'],
  ['rug_oval', 'item', 'rug', 'Thảm bầu dục'], ['window', 'item', 'wall_decor', 'Cửa sổ vòm'], ['toy_plush', 'item', 'toy', 'Gấu bông nhỏ'],
].map(([id, kind, group, name]) => ({ id, kind, group, name, source: 'starter', owned: true }))
  .concat({ id: 'small_pot', kind: 'item', group: 'plant', name: 'Chậu cây nhỏ', source: 'walk', owned: false });
const GROUPS = [{ id: 'surface', label: 'Tường và sàn' }, { id: 'furniture', label: 'Bàn ghế' }, { id: 'bed', label: 'Giường pet' },
  { id: 'rug', label: 'Thảm' }, { id: 'plant', label: 'Cây xanh' }, { id: 'wall_decor', label: 'Cửa sổ và tranh' }, { id: 'toy', label: 'Đồ chơi' }];
const CATALOG = { groups: GROUPS, surfaces: [{ id: 'wall', label: 'Giấy dán tường' }, { id: 'floor', label: 'Sàn nhà' }], items: ITEMS, max_items: 24 };

const room = (overrides: Record<string, any> = {}, roomOverrides: Record<string, any> = {}) => ({
  room: { name: 'Phòng của Aqua', layout: LAYOUT, version: 1, updated_at: '2030-01-01T00:00:00+00:00', ...roomOverrides },
  catalog: CATALOG,
  pet: { id: USER.pet, name: USER.pet_name, level: USER.level, xp: USER.xp }, activity: 'idle', walk: { away: false, return_at: null },
  ...overrides,
});

beforeEach(async () => {
  store.clear();
  await AsyncStorage.clear();
  setSession(null);
  store.set('refmi.session.v1', JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
});

async function openRoom() {
  render(<App />);
  await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
  fireEvent.press(screen.getByRole('tab', { name: 'Phòng cá nhân' }));
}

// Each test drives the whole app (sign-in, home, the room); give them room on a busy parallel run.
jest.setTimeout(20000);

describe('personal room', () => {
  it('takes the place of "Nghề nghiệp" in the menu and opens the pet\'s room', async () => {
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() } });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    const tabs = screen.getAllByRole('tab', { name: /^(Trang chủ|Học tập|Phòng cá nhân|Bạn bè|Tiện ích)$/ });
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual(['Trang chủ', 'Học tập', 'Phòng cá nhân', 'Bạn bè', 'Tiện ích']);
    expect(screen.queryByRole('tab', { name: 'Nghề nghiệp' })).toBeNull();

    fireEvent.press(screen.getByRole('tab', { name: 'Phòng cá nhân' }));
    expect(await screen.findByText('Phòng của Aqua')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Phòng cá nhân' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText(/0\/800 EXP/)).toBeTruthy();
    for (const action of ['Tương tác', 'Trang trí', 'Chụp ảnh']) expect(screen.getByRole('button', { name: action })).toBeTruthy();
    expect(screen.getByTestId('room-pet')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: 'Trang chủ' }));
    expect(await screen.findByText(HOME_GREETING)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Phòng cá nhân: Góc nhỏ của pet' }));  // the home shortcut leads there too
    expect(await screen.findByText('Phòng của Aqua')).toBeTruthy();
  });

  it('"Tương tác" plays a short reaction without asking the backend for anything', async () => {
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() } });
    await openRoom();
    await screen.findByText('Phòng của Aqua');
    const before = server.calls.length;
    fireEvent.press(screen.getByRole('button', { name: 'Tương tác' }));
    expect(screen.getByText('Chào bạn! Hôm nay mình vui lắm.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('room-pet'));
    expect(screen.getByText('Mình thích góc nhỏ này ghê!')).toBeTruthy();
    expect(server.calls.slice(before).filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('decorating moves, turns, recolours and stores items; "Hủy" restores the saved room and "Lưu" stores it', async () => {
    let saved = room();
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/personal-room': () => ({ status: 200, body: saved }),
      'PUT /api/personal-room': (req) => {
        saved = room({}, { version: 2, layout: { wall: req.body.wall_id, floor: req.body.floor_id, items: req.body.items } });
        return { status: 200, body: { room: saved.room } };
      },
    });
    await openRoom();
    await screen.findByText('Phòng của Aqua');
    fireEvent.press(screen.getByRole('button', { name: 'Trang trí' }));
    expect(await screen.findByTestId('decorate-panel')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Phòng cá nhân' })).toBeNull(); // the menu steps aside while decorating
    expect(screen.getByTestId('room-edit-layer')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Tường kem chấm bi, đang dùng/ })).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: /Tường sọc bạc hà/ }));
    expect(screen.getByRole('radio', { name: /Tường sọc bạc hà, đang dùng/ })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Hủy' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Bỏ thay đổi' }));  // a change is never dropped silently
    expect(await screen.findByRole('button', { name: 'Trang trí' })).toBeTruthy();
    expect(server.callsTo('PUT /api/personal-room')).toHaveLength(0);

    fireEvent.press(screen.getByRole('button', { name: 'Trang trí' }));
    expect(screen.getByRole('radio', { name: /Tường kem chấm bi, đang dùng/ })).toBeTruthy();  // the cancelled pick is gone
    fireEvent.press(screen.getByRole('radio', { name: /Tường sọc bạc hà/ }));

    // Furniture already in the room is selected; its tools turn and recolour it.
    fireEvent.press(screen.getByRole('tab', { name: 'Bàn ghế' }));
    fireEvent.press(screen.getByRole('button', { name: 'Bàn học, đang dùng' }));
    expect(screen.getByTestId('room-selection')).toBeTruthy();
    expect(screen.getByLabelText(/Đang chọn Bàn học, Gỗ sồi/)).toBeTruthy();
    fireEvent.press(screen.getByRole('radio', { name: 'Màu Trắng kem' }));
    fireEvent.press(screen.getByRole('button', { name: 'Lật' }));
    fireEvent(screen.getByLabelText(/Đang chọn Bàn học/), 'accessibilityAction', { nativeEvent: { actionName: 'moveRight' } });
    expect(screen.queryByRole('button', { name: 'Xoay' })).toBeNull();  // a desk cannot tilt

    // From the storage into the room, and back.
    fireEvent.press(screen.getByRole('tab', { name: 'Đồ chơi' }));
    fireEvent.press(screen.getByRole('button', { name: 'Gấu bông nhỏ, Trong kho' }));
    expect(screen.getByRole('button', { name: 'Gấu bông nhỏ, đang dùng' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Cất vào kho' }));
    expect(await screen.findByText('Đã cất Gấu bông nhỏ vào kho.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gấu bông nhỏ, Trong kho' })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Thảm' }));
    fireEvent.press(screen.getByRole('button', { name: 'Thảm bầu dục, đang dùng' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cất vào kho' }));
    fireEvent.press(screen.getByRole('tab', { name: 'Cây xanh' }));
    expect(screen.getByRole('button', { name: /Chậu cây nhỏ, Pet mang về khi đi dạo/ }).props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.press(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Đã lưu phòng!')).toBeTruthy();
    const body = server.callsTo('PUT /api/personal-room')[0].body;
    expect(body).toMatchObject({ version: 1, wall_id: 'wall_mint', floor_id: 'floor_wood_light' });
    expect(body.items).toEqual([at('window', 'morning', 200, 124), { item: 'desk', variant: 'white', x: 104, y: 318, flip: true, rotate: 0 },
      at('pet_cushion', 'blue', 318, 356)]);

    // Reopening the app shows the saved room.
    screen.unmount();
    await openRoom();
    fireEvent.press(await screen.findByRole('button', { name: 'Trang trí' }));
    expect(screen.getByRole('radio', { name: /Tường sọc bạc hà, đang dùng, Đã lưu/ })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Thảm' }));
    expect(screen.getByRole('button', { name: 'Thảm bầu dục, Trong kho' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Hủy' }));  // nothing changed: no question
    expect(await screen.findByRole('button', { name: 'Trang trí' })).toBeTruthy();
  });

  it('shows the pet away on its walk with its return time, and never touches the walk', async () => {
    const server = mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/personal-room': { status: 200, body: room({ walk: { away: true, return_at: '2099-01-01T11:30:00+00:00' } }) } });
    await openRoom();
    expect(await screen.findByText(/Aqua đang đi dạo · về lúc/)).toBeTruthy();
    expect(screen.queryByTestId('room-pet')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Chụp ảnh' }));
    expect(await screen.findByText('Aqua đang đi dạo. Chờ Aqua về rồi chụp ảnh nhé!')).toBeTruthy();
    expect(server.calls.filter((c) => c.path.startsWith('/api/pet/walk') || c.method === 'POST' && c.path.startsWith('/api/pet'))).toHaveLength(0);
  });

  it('puts a studying pet at its desk', async () => {
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room({ activity: 'studying' }) } });
    await openRoom();
    expect(await screen.findByText('Aqua đang học cùng bạn')).toBeTruthy();
  });

  it('saves a photo to the album, keeping the text and the request id when the first try fails', async () => {
    let attempts = 0;
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() },
      'POST /api/personal-room/photo/preview': (req) => ({ status: 200, body: {
        pose: 'rug', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"><text>${req.body.title ?? ''}</text></svg>` } }),
      'POST /api/personal-room/photo': () => (++attempts === 1 ? { status: 503, body: { detail: 'down', code: 'server_error' } }
        : { status: 201, body: { id: 9, event_type: 'room_photo', title: 'Chiều yên tĩnh' } }),
    });
    await openRoom();
    await screen.findByText('Phòng của Aqua');
    fireEvent.press(screen.getByRole('button', { name: 'Chụp ảnh' }));
    const sheet = await screen.findByTestId('room-photo-sheet');
    fireEvent.changeText(within(sheet).getByLabelText('Tiêu đề ảnh'), 'Chiều yên tĩnh');
    await waitFor(() => expect(server.callsTo('POST /api/personal-room/photo/preview').some((c) => c.body.title === 'Chiều yên tĩnh')).toBe(true), { timeout: 3000 });
    const save = await within(sheet).findByRole('button', { name: 'Lưu vào Album kỷ niệm' });
    await waitFor(() => expect(save.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(save);
    expect(await within(sheet).findByText(/Chưa lưu được ảnh/)).toBeTruthy();
    expect(within(sheet).getByLabelText('Tiêu đề ảnh').props.value).toBe('Chiều yên tĩnh');
    expect(screen.queryByText('Đã lưu ảnh vào Album kỷ niệm!')).toBeNull();
    fireEvent.press(within(sheet).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Đã lưu ảnh vào Album kỷ niệm!')).toBeTruthy();
    const [first, second] = server.callsTo('POST /api/personal-room/photo');
    expect(second.body.client_request_id).toBe(first.body.client_request_id);
    expect(second.body).toMatchObject({ pose: 'rug', title: 'Chiều yên tĩnh', message: null });
  });

  it('keeps showing the last saved room without a connection', async () => {
    let online = true;
    mockServer({ 'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/personal-room': () => (online ? { status: 200, body: room({}, { name: 'Góc của Aqua' }) } : networkDown()) });
    await openRoom();
    expect(await screen.findByText('Góc của Aqua')).toBeTruthy();
    screen.unmount();
    online = false;
    await openRoom();
    expect(await screen.findByText('Góc của Aqua')).toBeTruthy();
    expect(screen.getByText(/Đang ngoại tuyến · hiển thị phòng đã lưu/)).toBeTruthy();
  });

  const friend = { id: 2, display_name: 'Mây', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Bông', pet_level: 2, public_code: 'ABCD2345', presence: 'online', room: null,
    can_visit: true, accepts_study_invites: true };
  const visited = (over: Record<string, any> = {}) => ({
    owner: { id: 2, display_name: 'Mây', avatar_theme: 'aqua', pet: 'cat', pet_name: 'Bông', pet_level: 2 }, room: { name: 'Phòng của Bông', layout: LAYOUT },
    pet: { id: 'cat', name: 'Bông', level: 2 }, activity: 'idle', walk: { away: false }, guest_pet: { id: USER.pet, name: USER.pet_name, level: USER.level },
    can_invite_study: true, available_at: { hello: null, cheer: null, study_invite: null }, ...over,
  });
  const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();
  async function openFriendRoom() {
    await openRoom();
    fireEvent.press(await screen.findByRole('button', { name: 'Ghé phòng bạn bè' }));
    expect(await screen.findByText('Pet Bông')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Ghé thăm' }));
    expect(await screen.findByText('Phòng của Bông')).toBeTruthy();
  }

  it('the "Bạn bè" tab (was "Cộng đồng") holds friends, its badge follows pending requests, and the feed lives in Tiện ích', async () => {
    let pending = 1;
    const request = { id: 4, status: 'pending', direction: 'incoming', created_at: '', user: { ...friend, id: 3, display_name: 'Lim', pet_name: 'Mít' } };
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/dashboard': () => ({ status: 200, body: { user: USER, study: { total_minutes: 0, today_sessions: 0 }, pending_friend_requests: pending } }),
      'GET /api/community/posts': { status: 200, body: [{ id: 1, author: 'Linh', body: 'Hôm nay học xong chương 3!', likes: 2 }] },
      'GET /api/friend-requests?direction=incoming': () => ({ status: 200, body: { items: pending ? [request] : [] } }),
      'GET /api/friend-requests?direction=outgoing': { status: 200, body: { items: [] } },
      'POST /api/friend-requests/4/accept': () => { pending = 0; return { status: 200, body: { ...request, status: 'accepted' } }; },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
    });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    expect(screen.queryByText('Cộng đồng')).toBeNull();
    expect(await screen.findByTestId('tab-badge-Community')).toBeTruthy();
    const menuTab = screen.getByRole('tab', { name: 'Bạn bè' });
    expect(menuTab.props.accessibilityValue).toEqual({ text: '1 lời mời kết bạn đang chờ' });

    fireEvent.press(menuTab);
    expect(await screen.findByText('Pet Bông')).toBeTruthy(); // opens on the friend list
    expect(await screen.findByText('Lời mời kết bạn (1)')).toBeTruthy(); // requests sit above the friend list, no tabs
    fireEvent.press(screen.getByRole('button', { name: 'Chấp nhận' }));
    await waitFor(() => expect(screen.queryByText('Lời mời kết bạn (1)')).toBeNull(), { timeout: 5000 }); // and hide once answered
    expect(server.callsTo('POST /api/friend-requests/4/accept')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('tab-badge-Community')).toBeNull());

    // The feed is not on "Bạn bè" any more: it opens from Tiện ích, and back returns there.
    expect(screen.queryByText('Hôm nay học xong chương 3!')).toBeNull();
    fireEvent.press(screen.getByRole('tab', { name: 'Tiện ích' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Bảng tin: Lan tỏa điều tích cực' }));
    expect(await screen.findByText('Hôm nay học xong chương 3!')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Tính năng khác')).toBeTruthy();
    await act(async () => {});
  });

  it('visits a friend from the "Bạn bè" tab and comes back to the friend list', async () => {
    mockServer({
      'GET /api/auth/me': { status: 200, body: USER },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
      'GET /api/personal-room/visit/2': { status: 200, body: visited() },
    });
    render(<App />);
    await screen.findByText(HOME_GREETING, {}, { timeout: 5000 });
    fireEvent.press(screen.getByRole('tab', { name: 'Bạn bè' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Ghé thăm' }));
    expect(await screen.findByText('Phòng của Bông')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Pet Bông')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Bạn bè', selected: true })).toBeTruthy();
    await act(async () => {});
  });

  it('visits a friend\'s room read only and leaves a greeting while their pet is out', async () => {
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
      'GET /api/personal-room/visit/2': { status: 200, body: visited({ walk: { away: true } }) },
      'POST /api/personal-room/visit/2/greetings': { status: 201, body: { sent: true, id: 1, kind: 'hello', message: null, host_away: true, available_at: soon(), replayed: false } },
    });
    await openFriendRoom();
    expect(screen.getByText('Bạn đang ghé thăm Mây · chỉ xem')).toBeTruthy();
    expect(screen.getByTestId('room-guest-pet')).toBeTruthy();
    expect(screen.queryByTestId('room-pet')).toBeNull(); // Bông is out walking
    expect(screen.getByText('Bông đang đi dạo, chưa có ở nhà')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Trang trí' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Để lại lời chào' }));
    expect(await screen.findByText('Đã để lại lời chào. Mây sẽ thấy khi Bông về.')).toBeTruthy();
    const [sent] = server.callsTo('POST /api/personal-room/visit/2/greetings');
    expect(sent.body).toEqual({ kind: 'hello', client_request_id: expect.any(String) });
    // Sent: the button waits for the cooldown the backend returned.
    expect(screen.getByRole('button', { name: 'Để lại lời chào, đã gửi, chờ một lát' }).props.accessibilityState.disabled).toBe(true);
    expect(server.callsTo('PUT /api/personal-room')).toHaveLength(0);
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByRole('button', { name: 'Ghé thăm' })).toBeTruthy(); // back on the "Bạn bè" tab the room button opened
    expect(screen.getByRole('tab', { name: 'Bạn bè', selected: true })).toBeTruthy();
    await act(async () => {});
  });

  it('greets a pet at home, cheers with a preset message and retries a failed send without sending twice', async () => {
    let cheers = 0;
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
      'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/greetings': (req) => {
        if (req.body.kind === 'cheer' && ++cheers === 1) return networkDown();
        return { status: 201, body: { sent: true, id: cheers + 1, kind: req.body.kind, message: req.body.message ?? null, host_away: false, available_at: soon(), replayed: false } };
      },
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openFriendRoom();
    expect(screen.getByTestId('room-pet')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Chào pet' }));
    expect(await screen.findByText('Chào bạn! Cảm ơn đã ghé chơi nha!')).toBeTruthy(); // the pet hops and answers

    fireEvent.press(screen.getByRole('button', { name: 'Động viên' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Nhớ nghỉ ngơi nhé!' }));
    await waitFor(() => expect(alert).toHaveBeenCalled()); // offline: nothing was delivered
    fireEvent.press(screen.getByRole('button', { name: 'Động viên' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Nhớ nghỉ ngơi nhé!' }));
    expect(await screen.findByText('Đã gửi “Nhớ nghỉ ngơi nhé!” tới Mây.')).toBeTruthy();
    const tries = server.callsTo('POST /api/personal-room/visit/2/greetings').filter((c) => c.body.kind === 'cheer');
    expect(tries.map((c) => c.body.message)).toEqual(['take_break', 'take_break']);
    expect(tries[0].body.client_request_id).toBe(tries[1].body.client_request_id); // the retry is the same request
    alert.mockRestore();
  });

  it('"Rủ học" sends a study invitation with the chosen subject and rhythm, then opens the room', async () => {
    const snapshot = { id: 7, code: 'K7P2QX9M', name: 'Học cùng Aqua', goal: null, subject: 'math', visibility: 'private', status: 'open', state: 'waiting',
      host_id: 1, focus_minutes: 50, break_minutes: 10, cycles: 2, max_members: 4, member_count: 1, version: 1, members: [], session: null,
      last_session_id: null, team_quests: [], server_time: new Date().toISOString() };
    const server = mockServer({
      'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
      'GET /api/personal-room/visit/2': { status: 200, body: visited() },
      'POST /api/personal-room/visit/2/study-invite': { status: 201, body: { sent: true, id: 3, replayed: false, created_room: true, room: snapshot,
        invitation: { id: 31, status: 'pending', expires_at: soon() }, available_at: soon() } },
    });
    await openFriendRoom();
    fireEvent.press(screen.getByRole('button', { name: 'Rủ học' }));
    fireEvent.press(await screen.findByText('Toán'));
    fireEvent.press(screen.getByRole('checkbox', { name: 'Tập trung sâu' }));
    fireEvent.press(screen.getByRole('button', { name: 'Gửi lời mời học' }));
    expect(await screen.findByText('Đã tạo phòng học và rủ Mây cùng học!')).toBeTruthy();
    expect(server.callsTo('POST /api/personal-room/visit/2/study-invite')[0].body).toEqual({
      subject: 'math', focus_minutes: 50, break_minutes: 10, cycles: 2, client_request_id: expect.any(String) });
    expect(screen.getByRole('button', { name: 'Rủ học, đã gửi, chờ một lát' })).toBeTruthy();
    await act(async () => {});
  });

  it('explains when a friend turned visits off and keeps "Rủ học" off when they take no invitations', async () => {
    let allowed = false;
    mockServer({
      'GET /api/auth/me': { status: 200, body: USER }, 'GET /api/personal-room': { status: 200, body: room() },
      'GET /api/friends': { status: 200, body: { items: [friend] } },
      'GET /api/personal-room/visit/2': () => (allowed ? { status: 200, body: visited({ can_invite_study: false }) }
        : { status: 403, body: { detail: 'off', code: 'room_visits_disabled' } }),
    });
    await openRoom();
    fireEvent.press(await screen.findByRole('button', { name: 'Ghé phòng bạn bè' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Ghé thăm' }));
    expect(await screen.findByText('Bạn ấy đang tắt chế độ cho ghé thăm phòng.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    allowed = true;
    fireEvent.press(await screen.findByRole('button', { name: 'Ghé thăm' }));
    expect(await screen.findByText('Mây đang tắt nhận lời mời học.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rủ học' }).props.accessibilityState.disabled).toBe(true);
    await act(async () => {});
  });
});
