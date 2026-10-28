import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSession } from '../src/api/client';
import type { ConnectionStatus } from '../src/studyTogether/realtime';
import type { RealtimeMessage, RoomMember, RoomSnapshot, TogetherHome } from '../src/studyTogether/types';
import { FriendsScreen } from '../src/screens/together/FriendsScreen';
import { StudyTogetherScreen } from '../src/screens/together/StudyTogetherScreen';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, USER } from '../test/mockServer';

class FakeRealtime {
  status: ConnectionStatus = 'online';
  rooms = new Set<number>();
  private messageListeners = new Set<(m: RealtimeMessage) => void>();
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  start = jest.fn();
  stop = jest.fn();
  wake = jest.fn();
  typing = jest.fn();
  subscribe(id: number) { this.rooms.add(id); }
  unsubscribe(id: number) { this.rooms.delete(id); }
  onMessage(l: (m: RealtimeMessage) => void) { this.messageListeners.add(l); return () => { this.messageListeners.delete(l); }; }
  onStatus(l: (s: ConnectionStatus) => void) { this.statusListeners.add(l); return () => { this.statusListeners.delete(l); }; }
  emit(m: RealtimeMessage) { act(() => { this.messageListeners.forEach((l) => l(m)); }); }
  setStatus(s: ConnectionStatus) { act(() => { this.status = s; this.statusListeners.forEach((l) => l(s)); }); }
}

const ME = { ...USER, id: 1, display_name: 'Aqua', pet: 'fox', pet_name: 'Lửa', level: 1 };
const pub = (id: number, name: string) => ({ id, display_name: name, avatar_theme: 'aqua', pet: 'cat', pet_name: `${name} pet`, pet_level: 1, public_code: `CODE000${id}` });
const member = (id: number, name: string, role: 'host' | 'member' = 'member', extra: Partial<RoomMember> = {}): RoomMember => ({
  ...pub(id, name), user_id: id, role, presence: 'online', joined_at: '2026-10-23T10:00:00Z', in_session: false,
  focus_seconds: 0, cycles_completed: 0, ...extra,
});
const room = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  id: 7, code: 'K7P2QX9M', name: 'Ôn Hóa', goal: 'Xong đề 2', subject: 'science', visibility: 'private', status: 'open',
  state: 'waiting', host_id: 2, focus_minutes: 25, break_minutes: 5, cycles: 2, max_members: 4, member_count: 2, version: 1,
  members: [member(2, 'Linh', 'host'), member(1, 'Aqua')], session: null, last_session_id: null, team_quests: [],
  server_time: '2026-10-23T10:00:00Z', ...over,
});
const activeSession = { id: 9, status: 'active' as const, phase: 'focus' as const, cycle: 1, total_cycles: 2, completed_cycles: 0,
  focus_seconds: 1500, break_seconds: 300, phase_seconds: 1500, remaining_ms: 25 * 60 * 1000, started_at: '2026-10-23T10:00:00Z',
  phase_ends_at: '2026-10-23T10:25:00Z' };
const home = (over: Partial<TogetherHome> = {}): TogetherHome => ({
  me: pub(1, 'Aqua'), current_room: null, friends: [{ ...pub(2, 'Linh'), presence: 'studying', room: null, can_visit: true, accepts_study_invites: true }],
  incoming_requests: [], outgoing_request_count: 0,
  invitations: [{ id: 31, status: 'pending', state: 'pending', expires_at: '', created_at: '', inviter: pub(2, 'Linh'),
    room: { id: 7, name: 'Ôn Hóa', goal: null, subject: 'science', visibility: 'private', status: 'open', state: 'waiting', focus_minutes: 25,
      break_minutes: 5, cycles: 2, member_count: 1, max_members: 4, host: pub(2, 'Linh'), can_join: true, reason: null } }],
  rooms: [], team_quests: [], recent_sessions: [], unread_notifications: 2, ...over,
});

let realtime: FakeRealtime;
const onExit = jest.fn();
const onRewards = jest.fn();

function renderTogether(props: Partial<React.ComponentProps<typeof StudyTogetherScreen>> = {}) {
  realtime = new FakeRealtime();
  return render(
    <ToastProvider><ConfirmProvider>
      <StudyTogetherScreen user={ME as any} onExit={onExit} onRewards={onRewards} createClient={() => realtime as any} {...props} />
    </ConfirmProvider></ToastProvider>,
  );
}

/** Community → Bạn bè, as the Community tab shows it. */
function renderFriends(props: Partial<React.ComponentProps<typeof FriendsScreen>> = {}) {
  return render(
    <ToastProvider><ConfirmProvider>
      <FriendsScreen onVisit={jest.fn()} {...props} />
    </ConfirmProvider></ToastProvider>,
  );
}

beforeEach(() => {
  setSession({ accessToken: 'access-1', refreshToken: 'refresh-token-1-0123456789abcdef' });
  onExit.mockReset(); onRewards.mockReset();
});

test('home shows friends, invitations and unread count, and switches back to personal study', async () => {
  mockServer({ 'GET /api/study-together/home': { status: 200, body: home() } });
  renderTogether();
  expect(await screen.findByText('Chào Aqua!')).toBeTruthy();
  expect(screen.getByText('Đang học')).toBeTruthy();
  expect(screen.getByText('mời bạn vào “Ôn Hóa”')).toBeTruthy();
  expect(screen.getByLabelText('Thông báo, 2 chưa đọc')).toBeTruthy();
  expect(realtime.start).toHaveBeenCalled();
  fireEvent.press(screen.getByRole('tab', { name: 'Học cá nhân' }));
  expect(onExit).toHaveBeenCalled();
});

test('home shows a readable error and recovers on retry', async () => {
  let calls = 0;
  mockServer({ 'GET /api/study-together/home': () => (++calls === 1 ? { status: 500, body: { detail: 'boom', code: 'internal_error' } } : { status: 200, body: home({ invitations: [] }) }) });
  renderTogether();
  expect(await screen.findByText('Máy chủ đang gặp sự cố. Vui lòng thử lại sau.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Chào Aqua!')).toBeTruthy();
  expect(screen.queryByText('boom')).toBeNull();  // raw server text never reaches the user
});

test('creating a room validates locally, sends an idempotency key and opens the waiting room', async () => {
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) },
    'GET /api/friends': { status: 200, body: { items: [{ ...pub(2, 'Linh'), presence: 'online', room: null }] } },
    'POST /api/study-rooms': (req) => ({ status: 201, body: { room: room({ host_id: 1, name: req.body.name, members: [member(1, 'Aqua', 'host')], member_count: 1 }) } }),
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room({ host_id: 1, members: [member(1, 'Aqua', 'host')], member_count: 1 }) },
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Tạo phòng học' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Tạo phòng' }));
  expect(await screen.findByText('Hãy đặt tên cho phòng học.')).toBeTruthy();
  expect(server.callsTo('POST /api/study-rooms')).toHaveLength(0);
  fireEvent.changeText(screen.getByLabelText('Tên phòng'), '  Ôn Hóa  ');
  fireEvent.press(screen.getByRole('button', { name: 'Tăng Tập trung' }));
  fireEvent.press(await screen.findByRole('checkbox', { name: 'Linh' }));
  fireEvent.press(screen.getByRole('button', { name: 'Tạo phòng' }));
  expect(await screen.findByText('K7P2QX9M')).toBeTruthy();
  const [created] = server.callsTo('POST /api/study-rooms');
  expect(created.body).toMatchObject({ name: 'Ôn Hóa', focus_minutes: 30, break_minutes: 5, cycles: 4, visibility: 'private', invitee_ids: [2] });
  expect(created.headers['Idempotency-Key']).toEqual(expect.any(String));
  expect(screen.getByRole('button', { name: 'Bắt đầu phiên học' })).toBeTruthy();
  expect(realtime.rooms.has(7)).toBe(true);
});

test('joining by code explains why a room cannot be joined', async () => {
  let lookups = 0;
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) },
    'POST /api/study-rooms/lookup': () => (++lookups === 1
      ? { status: 404, body: { detail: 'No room has this code', code: 'room_not_found' } }
      : lookups === 2 ? { status: 200, body: { ...home().invitations[0].room, can_join: false, reason: 'room_full', member_count: 4 } }
        : { status: 200, body: home().invitations[0].room }),
    'POST /api/study-rooms/join': { status: 200, body: { room: room(), already_member: false } },
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room() },
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Nhập mã phòng' }));
  fireEvent.changeText(await screen.findByLabelText('Mã phòng'), 'k7p');
  fireEvent.press(screen.getByRole('button', { name: 'Xem phòng' }));
  expect(await screen.findByText('Mã phòng gồm 8 ký tự.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Mã phòng'), 'k7p2-qx9m');
  fireEvent.press(screen.getByRole('button', { name: 'Xem phòng' }));
  expect(await screen.findByText('Không tìm thấy phòng học. Hãy kiểm tra lại mã phòng.')).toBeTruthy();
  expect(server.callsTo('POST /api/study-rooms/lookup')[0].body).toEqual({ code: 'K7P2QX9M' });
  fireEvent.press(screen.getByRole('button', { name: 'Xem phòng' }));
  expect(await screen.findByText('Phòng học đã đủ thành viên.')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Xem phòng' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Tham gia' }));
  expect(await screen.findByText('Đang chờ chủ phòng bắt đầu phiên học…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Bắt đầu phiên học' })).toBeNull();  // only the host starts
});

test('the room follows realtime snapshots in version order and opens the server summary at the end', async () => {
  mockServer({
    'GET /api/study-together/home': { status: 200, body: home() },
    'POST /api/room-invitations/31/accept': { status: 200, body: { room: room(), already_member: false } },
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room() },
    'GET /api/group-sessions/9/summary': { status: 200, body: {
      id: 9, status: 'completed', end_reason: 'completed', finalized: true, started_at: '', ended_at: '', total_cycles: 2,
      completed_cycles: 2, focus_minutes: 25, break_minutes: 5, room: { id: 7, name: 'Ôn Hóa', goal: null, status: 'open' },
      me: { focus_seconds: 3000, cycles_completed: 2, study_exp: 20, bonus_exp: 4, exp_awarded: 24, rewarded: true },
      participants: [{ ...pub(2, 'Linh'), user_id: 2, focus_seconds: null, cycles_completed: null }, { ...pub(1, 'Aqua'), user_id: 1, focus_seconds: 3000, cycles_completed: 2 }],
      team_quests: [] } },
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Tham gia' }));
  expect(await screen.findByText('Đang chờ chủ phòng bắt đầu phiên học…')).toBeTruthy();
  const focused = room({ version: 3, state: 'focus', session: activeSession,
    members: [member(2, 'Linh', 'host', { in_session: true }), member(1, 'Aqua', 'member', { in_session: true, focus_seconds: 60 })] });
  realtime.emit({ type: 'room.updated', room_id: 7, version: 3, event: 'session_started', room: focused });
  expect(await screen.findByText('Tập trung')).toBeTruthy();
  expect(screen.getByRole('timer').props.accessibilityLabel).toMatch(/còn 2[45]:\d\d/);
  expect(screen.getByTestId('study-room-scene')).toBeTruthy();
  // A late event (older version) must not roll the room back to waiting.
  realtime.emit({ type: 'room.updated', room_id: 7, version: 2, event: 'member_joined', room: room({ version: 2 }) });
  expect(screen.getByText('Tập trung')).toBeTruthy();
  expect(screen.getAllByText('👏')).toHaveLength(1);  // the toolbar button
  realtime.emit({ type: 'room.reaction', room_id: 7, user_id: 2, reaction: 'clap', at: '' });
  await waitFor(() => expect(screen.getAllByText('👏')).toHaveLength(2));  // plus the bubble over Linh's pet
  // The session ends: EXP comes from the server summary, never from the device.
  realtime.emit({ type: 'room.updated', room_id: 7, version: 4, event: 'session_completed', room: room({ version: 4, last_session_id: 9 }) });
  expect(await screen.findByText('Hoàn thành phiên học!')).toBeTruthy();
  expect(screen.getByText('+24')).toBeTruthy();
  expect(screen.getByLabelText('Tập trung hợp lệ: 50 phút')).toBeTruthy();
  expect(screen.getByText('Ẩn')).toBeTruthy();  // Linh keeps her minutes private
  expect(onRewards).toHaveBeenCalled();
});

test('without the socket the room says so and keeps itself up to date by polling', async () => {
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], current_room: room() }) },
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room() },
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Vào phòng' }));
  expect(await screen.findByText('Đang chờ chủ phòng bắt đầu phiên học…')).toBeTruthy();
  await waitFor(() => expect(server.callsTo('POST /api/study-rooms/7/heartbeat')).toHaveLength(1));
  jest.useFakeTimers();
  try {
    realtime.setStatus('offline');
    expect(screen.getByLabelText('Kết nối: Mất kết nối · tự cập nhật mỗi 15 giây')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(15000); });
    expect(server.callsTo('POST /api/study-rooms/7/heartbeat')).toHaveLength(2);
    realtime.setStatus('online');  // the socket is back: no more polling
    await act(async () => { jest.advanceTimersByTime(45000); });
    expect(server.callsTo('POST /api/study-rooms/7/heartbeat')).toHaveLength(2);
  } finally {
    jest.useRealTimers();
  }
});

test('friend search sends a request and explains duplicates', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let sends = 0;
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], friends: [] }) },
    'GET /api/social/me': { status: 200, body: { ...pub(1, 'Aqua'), presence_visibility: 'friends', share_study_stats: true, discoverable: true } },
    'GET /api/users/search?q=Li': { status: 200, body: { results: [{ ...pub(3, 'Linh'), relationship: 'none', request_id: null }, { ...pub(4, 'Lim'), relationship: 'none', request_id: null }] } },
    'POST /api/friend-requests': () => (++sends === 1
      ? { status: 201, body: { id: 11, status: 'pending', direction: 'outgoing', user: pub(3, 'Linh'), created_at: '', auto_accepted: false } }
      : { status: 409, body: { detail: 'You already sent a friend request', code: 'friend_request_exists' } }),
  });
  renderFriends({ initialTab: 'search' });
  fireEvent.changeText(await screen.findByLabelText('Nhập mã để thêm bạn'), 'L');
  fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
  expect(await screen.findByText('Hãy nhập mã kết bạn hoặc ít nhất 2 ký tự của tên.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Nhập mã để thêm bạn'), 'Li');
  fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
  const buttons = await screen.findAllByRole('button', { name: 'Kết bạn' });
  fireEvent.press(buttons[0]);
  expect(await screen.findByRole('button', { name: 'Đã gửi' })).toBeTruthy();
  expect(server.callsTo('POST /api/friend-requests')[0].body).toEqual({ user_id: 3 });
  fireEvent.press(screen.getByRole('button', { name: 'Kết bạn' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Không gửi được lời mời', 'Bạn đã gửi lời mời kết bạn cho người này rồi.', undefined));
  alert.mockRestore();
});

test('my friend code has a QR code; a typed or scanned code shows a short profile to befriend', async () => {
  const linh = { ...pub(3, 'Linh'), public_code: 'K7P2QX9M' };
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], friends: [] }) },
    'GET /api/social/me': { status: 200, body: { ...pub(1, 'Aqua'), public_code: 'AQUA2345', presence_visibility: 'friends', share_study_stats: true,
      discoverable: true, allow_room_visits: true, allow_study_invites: true } },
    'POST /api/users/lookup': (req) => (req.body.public_code === 'K7P2QX9M'
      ? { status: 200, body: { ...linh, relationship: 'none', request_id: null } }
      : { status: 200, body: { ...pub(5, 'Bông'), relationship: 'friend', request_id: null } }),
    'POST /api/friend-requests': { status: 201, body: { id: 12, status: 'pending', direction: 'outgoing', user: linh, created_at: '', auto_accepted: false } },
  });
  renderFriends({ initialTab: 'search' });
  fireEvent.press(await screen.findByRole('button', { name: 'Mã của tôi' }));
  expect(await screen.findByTestId('friend-qr')).toBeTruthy();
  expect(screen.getByText('AQUA 2345')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Sao chép' }));
  await waitFor(() => expect(require('expo-clipboard').setStringAsync).toHaveBeenCalledWith('AQUA2345'));
  fireEvent.press(screen.getAllByRole('button', { name: 'Đóng' })[0]);

  fireEvent.changeText(screen.getByLabelText('Nhập mã để thêm bạn'), 'k7p2 qx9m');
  fireEvent.press(screen.getByRole('button', { name: 'Tìm' }));
  expect(await screen.findByText('Pet đồng hành: Linh pet · Cấp 1')).toBeTruthy();
  expect(server.callsTo('POST /api/users/lookup')[0].body).toEqual({ public_code: 'K7P2QX9M' });
  expect(server.callsTo('GET /api/users/search?q=k7p2%20qx9m')).toHaveLength(0); // a code is looked up, not searched
  expect(server.callsTo('POST /api/friend-requests')).toHaveLength(0); // the preview never asks on its own
  fireEvent.press(screen.getByRole('button', { name: 'Kết bạn' }));
  expect(await screen.findByRole('button', { name: 'Đã gửi lời mời' })).toBeTruthy();
  expect(server.callsTo('POST /api/friend-requests')[0].body).toEqual({ user_id: 3 });

  fireEvent.press(screen.getByRole('button', { name: 'Quét mã QR' }));
  const camera = await screen.findByTestId('qr-camera');
  act(() => { camera.props.onBarcodeScanned({ data: 'https://example.com/not-a-friend' }); });
  expect(await screen.findByText('Đây không phải mã QR kết bạn của Mirabi.')).toBeTruthy();
  act(() => { // the camera reports the same code several times before the sheet closes
    camera.props.onBarcodeScanned({ data: 'MIRABI-FRIEND:BONG2345' });
    camera.props.onBarcodeScanned({ data: 'MIRABI-FRIEND:BONG2345' });
  });
  expect(await screen.findByRole('button', { name: 'Đã là bạn bè' })).toBeTruthy();
  expect(server.callsTo('POST /api/users/lookup').map((c) => c.body.public_code)).toEqual(['K7P2QX9M', 'BONG2345']);
});

test('the friend list has loading, error and retry, searches by name and visits a friend', async () => {
  const visitRoom = jest.fn();
  let reads = 0;
  const friends = [
    { ...pub(2, 'Lĩnh'), presence: 'online', room: null, can_visit: true, accepts_study_invites: true },
    { ...pub(3, 'Mây'), presence: 'hidden', room: null, can_visit: false, accepts_study_invites: true },
    ...['Bông', 'Cúc', 'Đào', 'Sen'].map((name, i) => ({ ...pub(10 + i, name), presence: 'offline', room: null, can_visit: true, accepts_study_invites: true })),
  ];
  mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) },
    'GET /api/friends': () => (++reads === 1 ? { status: 503, body: { detail: 'down', code: 'server_error' } } : { status: 200, body: { items: friends } }),
    'GET /api/social/me': { status: 200, body: { ...pub(1, 'Aqua'), presence_visibility: 'friends', share_study_stats: true, discoverable: true,
      allow_room_visits: true, allow_study_invites: true } },
  });
  renderFriends({ onVisit: visitRoom });
  fireEvent.press(await screen.findByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText('Lĩnh')).toBeTruthy();
  expect(screen.getByText('Pet Lĩnh pet')).toBeTruthy();
  expect(screen.getByText('Pet Mây pet · Đang tắt ghé thăm')).toBeTruthy();
  expect(screen.getByText('Bạn bè (6)')).toBeTruthy();
  expect(screen.queryByText(/Lời mời kết bạn/)).toBeNull(); // no requests: the section is hidden
  expect(screen.queryByLabelText('Cho bạn bè ghé thăm phòng')).toBeNull(); // privacy now lives under Cài đặt
  fireEvent.press(screen.getByRole('button', { name: 'Cài đặt' }));
  expect((await screen.findByLabelText('Cho bạn bè ghé thăm phòng')).props.value).toBe(true);
  expect(screen.getByLabelText('Nhận lời mời học').props.value).toBe(true);
  fireEvent.press(screen.getAllByRole('button', { name: 'Đóng' })[0]);

  fireEvent.changeText(screen.getByLabelText('Tìm bạn theo tên'), 'linh'); // without accents
  expect(screen.queryByText('Mây')).toBeNull();
  fireEvent.press(await screen.findByRole('button', { name: 'Ghé thăm' }));
  expect(visitRoom).toHaveBeenCalledWith(2);
  fireEvent.changeText(screen.getByLabelText('Tìm bạn theo tên'), 'xyz');
  expect(screen.getByText('Không tìm thấy bạn nào')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Tìm bạn theo tên'), 'mây');
  expect(screen.getByRole('button', { name: 'Ghé thăm' }).props.accessibilityState.disabled).toBe(true);
});

test('a study invitation from a notification shows its room and rhythm, and says clearly when it can no longer be joined', async () => {
  const inviteRoom = { id: 7, name: 'Học cùng Linh', goal: null, subject: 'math', visibility: 'private', status: 'open', state: 'waiting', focus_minutes: 50,
    break_minutes: 10, cycles: 2, member_count: 1, max_members: 4, host: pub(2, 'Linh'), can_join: true, reason: null };
  let state = 'pending';
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) },
    'GET /api/notifications': { status: 200, body: { unread_count: 1, items: [{ id: 5, kind: 'room_invitation', title: 'Lời mời vào phòng học',
      body: 'Linh ghé phòng và rủ bạn cùng học: Toán · 50 phút × 2 lượt.', data: { invitation_id: 31, room_id: 7, source: 'visit' }, read: false, created_at: new Date().toISOString() }] } },
    'GET /api/room-invitations/31': () => ({ status: 200, body: { id: 31, status: state === 'pending' ? 'pending' : 'cancelled', state,
      expires_at: new Date(Date.now() + 3 * 3600_000).toISOString(), created_at: '', inviter: pub(2, 'Linh'),
      room: state === 'pending' ? inviteRoom : { ...inviteRoom, status: 'closed', state: 'closed', can_join: false, reason: 'room_closed' } } }),
    'POST /api/room-invitations/31/accept': () => { state = 'room_closed'; return { status: 409, body: { detail: 'closed', code: 'room_closed' } }; },
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderTogether({ initialRoute: { name: 'notifications' } });
  fireEvent.press(await screen.findByText('Lời mời vào phòng học'));
  expect(await screen.findByText('Học cùng Linh')).toBeTruthy();
  expect(screen.getByText('Toán')).toBeTruthy();
  expect(screen.getByText('50 phút tập trung · nghỉ 10 phút')).toBeTruthy();
  expect(screen.getByText('Lời mời còn 3 giờ')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Tham gia' }));
  // The room closed meanwhile: the backend refuses and the screen says why.
  expect(await screen.findByText('Phòng học này đã đóng.')).toBeTruthy();
  expect(alert).toHaveBeenCalledWith('Không thể tham gia phòng', 'Phòng học này đã đóng.', undefined);
  expect(screen.queryByRole('button', { name: 'Tham gia' })).toBeNull();
  expect(server.callsTo('POST /api/notifications/5/read')).toHaveLength(1);
  alert.mockRestore();
});

test('a merged greeting arriving live replaces the unread one in the inbox', async () => {
  const visitRoom = jest.fn();
  const note = (id: number, title: string, actor: number) => ({ id, kind: 'room_visit' as const, title, body: '', read: false, created_at: new Date().toISOString(),
    data: { action: 'hello' as const, user_id: actor, actor_ids: [actor], count: 1 } });
  mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) },
    'GET /api/notifications': { status: 200, body: { unread_count: 1, items: [note(5, 'Linh ghé thăm phòng', 2)] } },
  });
  renderTogether({ initialRoute: { name: 'notifications' }, onVisitRoom: visitRoom });
  expect(await screen.findByText('Linh ghé thăm phòng')).toBeTruthy();
  realtime.emit({ type: 'notification', notification: note(6, 'Mây và 1 bạn khác ghé thăm phòng', 3), replaces: 5 });
  const merged = await screen.findByLabelText('Chưa đọc. Mây và 1 bạn khác ghé thăm phòng. '); // (a toast shows the title too)
  expect(screen.queryByText('Linh ghé thăm phòng')).toBeNull();
  fireEvent.press(merged);
  expect(visitRoom).toHaveBeenCalledWith(3); // visit back the friend who greeted last
});

test('Study Together sends friends, requests and friend search to Community', async () => {
  const openFriends = jest.fn();
  mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], incoming_requests: [{ id: 4, status: 'pending', direction: 'incoming', user: pub(3, 'Lim'), created_at: '' }] }) },
    'GET /api/notifications': { status: 200, body: { unread_count: 1, items: [{ id: 9, kind: 'friend_request', title: 'Lời mời kết bạn', body: 'Lim muốn kết bạn để cùng học.',
      data: { request_id: 4, user_id: 3 }, read: false, created_at: new Date().toISOString() }] } },
  });
  renderTogether({ onOpenFriends: openFriends });
  fireEvent.press(await screen.findByText('Xem tất cả'));
  expect(openFriends).toHaveBeenLastCalledWith('friends');
  fireEvent.press(screen.getByText('1 lời mời kết bạn đang chờ bạn'));
  expect(openFriends).toHaveBeenLastCalledWith('requests');
  fireEvent.press(screen.getByRole('button', { name: /Thông báo/ }));
  fireEvent.press(await screen.findByText('Lời mời kết bạn'));
  expect(openFriends).toHaveBeenLastCalledWith('requests');
});

test('back returns through the screen stack', async () => {
  mockServer({ 'GET /api/study-together/home': { status: 200, body: home({ invitations: [] }) } });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Nhập mã phòng' }));
  expect(await screen.findByText('Tham gia phòng')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  expect(await screen.findByText('Chào Aqua!')).toBeTruthy();
});

test('room chat: history, optimistic send, live messages, typing and unsend', async () => {
  const chatMessage = (id: number, from: ReturnType<typeof pub>, body: string, extra = {}) => ({
    id, room_id: 7, client_id: null, sender: from, body, deleted: false, removed_by: null, created_at: '2026-10-23T10:01:00Z', ...extra,
  });
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], current_room: room() }) },
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room() },
    'GET /api/study-rooms/7/messages': { status: 200, body: { items: [chatMessage(40, pub(2, 'Linh'), 'Chào Aqua!!')], next_before_id: null } },
    'POST /api/study-rooms/7/messages': (req) => ({ status: 201, body: {
      message: chatMessage(41, pub(1, 'Aqua'), req.body.body, { client_id: req.body.client_id }), replayed: false } }),
    'DELETE /api/study-rooms/7/messages/41': { status: 200, body: { deleted: true } },
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Vào phòng' }));
  // The header chat icon counts the latest message as unread.
  const entry = await screen.findByRole('button', { name: 'Trò chuyện trong phòng, 1 tin nhắn chưa đọc' });
  expect(screen.getByText('1')).toBeTruthy();
  fireEvent.press(entry);
  expect(await screen.findByText('Chào Aqua!!')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('Tin nhắn'), '  Chào Linh, học thôi!  ');
  expect(realtime.typing).toHaveBeenCalledWith(7);
  fireEvent.press(screen.getByRole('button', { name: 'Gửi' }));
  expect(await screen.findByText('Chào Linh, học thôi!')).toBeTruthy();
  const [sent] = server.callsTo('POST /api/study-rooms/7/messages');
  expect(sent.body).toEqual({ body: 'Chào Linh, học thôi!', client_id: expect.any(String) });
  // The same message echoed by the socket (matched on its id) is not shown twice.
  realtime.emit({ type: 'room.message', room_id: 7, message: chatMessage(41, pub(1, 'Aqua'), 'Chào Linh, học thôi!', { client_id: sent.body.client_id }) });
  expect(screen.getAllByText('Chào Linh, học thôi!')).toHaveLength(1);

  realtime.emit({ type: 'room.typing', room_id: 7, user_id: 2 });
  expect(await screen.findByText('Linh đang soạn tin…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Trò chuyện trong phòng, có bạn đang soạn tin' })).toBeTruthy();  // the header icon
  realtime.emit({ type: 'room.message', room_id: 7, message: chatMessage(42, pub(2, 'Linh'), 'Ok 👍') });
  expect(await screen.findAllByText('Ok 👍')).toHaveLength(2);  // in the chat and as a speech bubble over Linh's pet
  expect(screen.getByLabelText('Linh nhắn: Ok 👍')).toBeTruthy();
  expect(screen.queryAllByText('Linh đang soạn tin…')).toHaveLength(0);  // the message replaces the typing hint
  realtime.emit({ type: 'room.message_deleted', room_id: 7, message_id: 40, removed_by: 'sender' });
  expect(await screen.findByText('Tin nhắn đã được thu hồi')).toBeTruthy();
  expect(screen.queryByText('Chào Aqua!!')).toBeNull();

  // Long-press my own message to unsend it.
  fireEvent(screen.getByLabelText('Bạn: Chào Linh, học thôi!'), 'longPress');
  fireEvent.press(await screen.findByRole('button', { name: 'Thu hồi tin nhắn' }));
  expect(await screen.findByText('Bạn đã thu hồi một tin nhắn')).toBeTruthy();
  expect(server.callsTo('DELETE /api/study-rooms/7/messages/41')).toHaveLength(1);

  fireEvent.press(screen.getByRole('button', { name: 'Đóng trò chuyện' }));
  expect(await screen.findByRole('button', { name: 'Trò chuyện trong phòng' })).toBeTruthy();  // everything read
});

test('a failed chat message can be retried with the same client id', async () => {
  let attempts = 0;
  const server = mockServer({
    'GET /api/study-together/home': { status: 200, body: home({ invitations: [], current_room: room() }) },
    'POST /api/study-rooms/7/heartbeat': { status: 200, body: room() },
    'GET /api/study-rooms/7/messages': { status: 200, body: { items: [], next_before_id: null } },
    'POST /api/study-rooms/7/messages': (req) => (++attempts === 1 ? new TypeError('Network request failed') : { status: 201, body: {
      message: { id: 5, room_id: 7, client_id: req.body.client_id, sender: pub(1, 'Aqua'), body: req.body.body, deleted: false,
        removed_by: null, created_at: '2026-10-23T10:01:00Z' }, replayed: false } }),
  });
  renderTogether();
  fireEvent.press(await screen.findByRole('button', { name: 'Vào phòng' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Trò chuyện trong phòng' }));
  expect(await screen.findByText('Chưa có tin nhắn nào')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Cố lên nào 💪' }));
  fireEvent.press(await screen.findByText('Chưa gửi được · Thử lại'));
  await waitFor(() => expect(screen.queryByText('Chưa gửi được · Thử lại')).toBeNull());
  const [first, second] = server.callsTo('POST /api/study-rooms/7/messages');
  expect(second.body.client_id).toBe(first.body.client_id);
  expect(screen.getAllByText('Cố lên nào 💪')).toHaveLength(1);
});
