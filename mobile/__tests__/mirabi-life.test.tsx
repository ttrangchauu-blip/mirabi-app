import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import { WorkQuestScreen } from '../src/screens/work/WorkQuestScreen';
import { dueFromPreset, localDate } from '../src/screens/work/WorkTaskSheet';
import { HealingDock } from '../src/screens/healing/HealingDock';
import { HealingLayer } from '../src/screens/healing/HealingLayer';
import { RoomAmbience, skyOf, withLiveSky } from '../src/screens/healing/RoomAmbience';
import { itemArt, variantOf } from '../src/room/art';
import { MoreTab } from '../src/screens/main/MoreTab';
import { USER, mockServer, networkDown } from '../test/mockServer';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';

jest.mock('../src/auth/useConfirmLogout', () => ({ useConfirmLogout: () => jest.fn() }));

const TZ = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
const DASHBOARD = `GET /api/work/dashboard?tz=${TZ}`;
const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
const timer = { running: false, phase: 'focus', seconds: 1500, activeCycle: null, toggle: jest.fn(), reset: jest.fn() } as any;

const task = (over: Record<string, unknown> = {}) => ({
  id: 11, occurrence_id: '11:2026-11-01', title: 'Viết báo cáo', category: 'work', scheduled_date: '2026-11-01', repeat: 'none',
  project_id: 3, priority: 'high', due_at: null, estimated_minutes: 45, exp: 8, completed: false,
  steps: [{ id: 1, title: 'Thu thập số liệu', done: true }, { id: 2, title: 'Viết nháp', done: false }], ...over,
});
const dashboard = (over: Record<string, unknown> = {}) => ({
  today: '2026-11-01', tasks_today: [task()], overdue: [], upcoming: [],
  projects: [{ id: 3, name: 'Ra mắt app', description: null, theme: 'beach', status: 'active', tasks_total: 2, tasks_done: 1, recurring_tasks: 0,
    completions: 1, progress: 0.5, build_stage: 2, ready_to_complete: false, completed_at: null, created_at: '2026-10-01T00:00:00+00:00' }],
  chests: [{ code: 'first_quest', name: 'Rương khởi đầu', required: 1, progress: 1, status: 'ready', opened_at: null,
    rewards: [{ id: 'pocket_notebook', name: 'Sổ tay', art: null, rarity: 'common', quantity: 1 }] }],
  summary: { today_total: 1, today_done: 0, focus_minutes_today: 25, exp_remaining_today: 52 },
  walk: { status: 'locked', goals_total: 4, goals_done: 3 }, pet_line: 'Bắt đầu với việc nhỏ nhất trước nhé!', ...over,
});

beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

describe('Work Quest', () => {
  it('draws the desk, the mission board, the project islands and the chests from the server', async () => {
    mockServer({ [DASHBOARD]: { status: 200, body: dashboard() } });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    expect(await screen.findByText('Bắt đầu với việc nhỏ nhất trước nhé!', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByTestId('focus-desk')).toBeTruthy();
    expect(screen.getByLabelText('Viết báo cáo, ưu tiên Cao')).toBeTruthy();
    expect(screen.getByText('☑ 1/2')).toBeTruthy();
    expect(screen.getByLabelText(/^Dự án Ra mắt app: 1 trên 2 nhiệm vụ, Có lều nhỏ$/)).toBeTruthy();
    expect(screen.getByLabelText('Rương khởi đầu: sẵn sàng mở')).toBeTruthy();
    expect(screen.getByText('Xong 3/4 mục tiêu hôm nay để pet đi khám phá.')).toBeTruthy();
  });

  it('stamps a quest, and shows its EXP only once the server confirms it', async () => {
    const server = mockServer({
      [DASHBOARD]: (req) => ({ status: 200, body: dashboard(server.callsTo('POST /api/tasks/11/complete').length
        ? { tasks_today: [task({ completed: true })], pet_line: 'Xong hết nhiệm vụ rồi! Bạn giỏi quá!' } : {}) }),
      'POST /api/tasks/11/complete': { status: 200, body: { ...task({ completed: true }), awarded_exp: 8, already_completed: false, daily_exp_remaining: 44 } },
    });
    const onRewards = jest.fn();
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} onRewards={onRewards} />);
    fireEvent.press(await screen.findByLabelText('Hoàn thành Viết báo cáo'));
    expect(await screen.findByText('+8 EXP! Tuyệt vời!')).toBeTruthy();
    expect(server.callsTo('POST /api/tasks/11/complete')[0].body).toEqual({ occurrence_date: '2026-11-01' });
    expect(onRewards).toHaveBeenCalled();
    expect(await screen.findByText('XONG')).toBeTruthy();
    expect(screen.getByLabelText('Viết báo cáo, ưu tiên Cao, đã hoàn thành')).toBeTruthy();
  });

  it('keeps a completion made offline and sends it on the next load, without showing EXP before', async () => {
    let online = false;
    const server = mockServer({
      [DASHBOARD]: { status: 200, body: dashboard() },
      'POST /api/tasks/11/complete': () => (online
        ? { status: 200, body: { ...task({ completed: true }), awarded_exp: 8, already_completed: false, daily_exp_remaining: 44 } }
        : networkDown()),
    });
    const view = wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Hoàn thành Viết báo cáo'));
    expect(await screen.findByText('CHỜ GỬI')).toBeTruthy();
    expect(screen.queryByText(/\+8 EXP!/)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem('mirabi.work.pending.v1:1'))!)).toEqual([{ taskId: 11, occurrence: '2026-11-01' }]);
    view.unmount();
    online = true;
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    await waitFor(() => expect(server.callsTo('POST /api/tasks/11/complete')).toHaveLength(2));
    expect(await screen.findByText('Đã đồng bộ 1 nhiệm vụ · +8 EXP')).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem('mirabi.work.pending.v1:1'))!)).toEqual([]);
  });

  it('shows an empty board invitation, and a retry when the world cannot load', async () => {
    let fail = true;
    mockServer({ [DASHBOARD]: () => (fail ? { status: 500, body: { detail: 'boom' } } : { status: 200, body: dashboard({ tasks_today: [], projects: [], chests: [] }) }) });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    const retry = await screen.findByLabelText('Thử lại');
    fail = false;
    fireEvent.press(retry);
    expect(await screen.findByText('Bảng nhiệm vụ đang trống')).toBeTruthy();
    expect(screen.getByLabelText('Tạo dự án mới')).toBeTruthy();
  });

  it('opens a ready chest once and lists its rewards', async () => {
    const opened = { code: 'first_quest', name: 'Rương khởi đầu', required: 1, progress: 1, status: 'opened', opened_at: '2026-11-01T01:00:00+00:00',
      rewards: [{ id: 'pocket_notebook', name: 'Sổ tay', art: null, rarity: 'common', quantity: 1 }] };
    const server = mockServer({
      [DASHBOARD]: { status: 200, body: dashboard() },
      'POST /api/work/rewards/first_quest/claim': { status: 200, body: { chest: opened, already_opened: false, chests: [opened] } },
    });
    wrap(<WorkQuestScreen user={USER as any} timer={timer} onBack={() => {}} />);
    fireEvent.press(await screen.findByLabelText('Rương khởi đầu: sẵn sàng mở'));
    expect(await screen.findByText('Sổ tay ×1')).toBeTruthy();
    expect(server.callsTo('POST /api/work/rewards/first_quest/claim')).toHaveLength(1);
    expect(screen.getByLabelText('Rương khởi đầu: đã mở')).toBeTruthy();
  });
});

describe('Work task deadlines', () => {
  it('reads presets on the local clock and never sets a deadline in the past', () => {
    const morning = new Date(2026, 10, 2, 9, 30); // Monday
    expect(dueFromPreset('none', morning)).toBeNull();
    expect(dueFromPreset('today_17', morning)!.getHours()).toBe(17);
    expect(localDate(dueFromPreset('today_17', morning)!)).toBe('2026-11-02');
    const evening = new Date(2026, 10, 2, 18, 0);
    expect(localDate(dueFromPreset('today_17', evening)!)).toBe('2026-11-03'); // 17:00 passed: tomorrow
    expect(dueFromPreset('friday', morning)!.getDay()).toBe(5);
    expect(localDate(dueFromPreset('tomorrow_noon', morning)!)).toBe('2026-11-03');
  });
});

describe('Góc thư giãn', () => {
  const summary = { today: '2026-11-01', ambience: { ambience_type: 'rainy_day', sound_enabled: true, volume: 0.3 }, mood_today: null, pet: null,
    relaxation: { today_seconds: 0, today_sessions: 0, week_seconds: 0, calm_days: 0 }, journal_count: 0 };

  it('opens with the saved scene, stays silent until sound is turned on, and the pet answers a mood', async () => {
    const pet = { animation: 'comfort', line: 'Mình ngồi cạnh bạn đây.', suggest: 'breathing', support_hint: 'Hãy chia sẻ với người bạn tin tưởng nhé.' };
    const server = mockServer({
      [`GET /api/life/healing?tz=${TZ}`]: { status: 200, body: summary },
      'POST /api/life/moods': { status: 201, body: { entry: { id: 1, mood: 'stressed', note: null, local_date: '2026-11-01', created_at: '' }, pet } },
      'PUT /api/life/room-ambience': (req) => ({ status: 200, body: req.body }),
    });
    const onAmbience = jest.fn();
    const onPetResponse = jest.fn();
    wrap(<HealingDock userId={1} ambience="rainy_day" onAmbience={onAmbience} onPetResponse={onPetResponse} onPet={() => {}} onResting={() => {}} bottom={0} />);
    await waitFor(() => expect(onAmbience).toHaveBeenCalledWith('rainy_day'));
    const player = useAudioPlayer(null) as any;
    // Saved as "on", but a visit never starts sound by itself.
    expect(player.play).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Bật âm thanh'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(server.callsTo('PUT /api/life/room-ambience')[0].body).toEqual({ ambience_type: 'rainy_day', sound_enabled: true, volume: 0.3 });

    fireEvent.press(screen.getByTestId('mood-stressed'));
    await waitFor(() => expect(onPetResponse).toHaveBeenCalledWith(pet));
    expect(server.callsTo('POST /api/life/moods')[0].body).toMatchObject({ mood: 'stressed' });
    expect(await screen.findByText('💛 Hãy chia sẻ với người bạn tin tưởng nhé.')).toBeTruthy();
  });

  it('opens from the cache when offline', async () => {
    await AsyncStorage.setItem('mirabi.healing.v1:1', JSON.stringify({ ...summary, ambience: { ...summary.ambience, ambience_type: 'starry_night' } }));
    mockServer({ [`GET /api/life/healing?tz=${TZ}`]: () => networkDown() });
    const onAmbience = jest.fn();
    wrap(<HealingDock userId={1} ambience="cozy_night" onAmbience={onAmbience} onPetResponse={() => {}} onPet={() => {}} onResting={() => {}} bottom={0} />);
    await waitFor(() => expect(onAmbience).toHaveBeenCalledWith('starry_night'));
    expect(await screen.findByLabelText('Ngoại tuyến')).toBeTruthy();
  });

  it('writes a private journal page and can keep its title in the album', async () => {
    const server = mockServer({
      [`GET /api/life/healing?tz=${TZ}`]: { status: 200, body: summary },
      'GET /api/life/journal?limit=20': { status: 200, body: { items: [], next_before: null } },
      'POST /api/life/relaxation-sessions': { status: 201, body: { already_recorded: false,
        summary: { today_seconds: 40, today_sessions: 1, week_seconds: 40, calm_days: 1 } } },
      'POST /api/life/journal': (req) => ({ status: 201, body: { id: 5, visibility: 'private', memory_id: req.body.save_to_album ? 9 : null,
        created_at: '2026-11-01T10:00:00+00:00', updated_at: '2026-11-01T10:00:00+00:00', mood: null, ...req.body } }),
    });
    wrap(<HealingDock userId={1} ambience="cozy_night" onAmbience={() => {}} onPetResponse={() => {}} onPet={() => {}} onResting={() => {}} bottom={0} />);
    fireEvent.press(await screen.findByLabelText('3 điều tốt'));
    expect(await screen.findByText(/Chỉ mình bạn đọc được nhật ký này/)).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Điều tốt thứ 1'), 'Cà phê ngon');
    fireEvent.changeText(screen.getByLabelText('Điều tốt thứ 2'), 'Gặp bạn cũ');
    fireEvent(screen.getByLabelText('Lưu vào Album kỷ niệm'), 'valueChange', true);
    fireEvent.press(screen.getByLabelText('Lưu nhật ký'));
    await waitFor(() => expect(server.callsTo('POST /api/life/journal')).toHaveLength(1));
    expect(server.callsTo('POST /api/life/journal')[0].body).toMatchObject({
      kind: 'gratitude', title: 'Ba điều tích cực hôm nay', content: '1. Cà phê ngon\n2. Gặp bạn cũ', save_to_album: true });
    // The saved page is listed first, marked as kept in the album.
    expect(await screen.findByText(/Trong Album/)).toBeTruthy();
    await waitFor(() => expect(server.callsTo('POST /api/life/relaxation-sessions')[0]?.body).toMatchObject({ activity_type: 'gratitude' }));
  });

  it('draws each scene into the room windows and lamps, without saving them', () => {
    const room = { wall: 'wall_cream', floor: 'floor_wood', items: [
      { item: 'window', variant: 'sunset', x: 200, y: 124, flip: false, rotate: 0 },
      { item: 'floor_lamp', variant: 'default', x: 378, y: 316, flip: false, rotate: 0 },
      { item: 'bed', variant: 'default', x: 100, y: 300, flip: false, rotate: 0 }] };
    // The window follows the clock: sáng/trưa → morning, chiều → sunset, tối → starry.
    expect([skyOf('morning'), skyOf('noon'), skyOf('afternoon'), skyOf('night')]).toEqual(['morning', 'morning', 'sunset', 'starry']);
    const night = withLiveSky(room, 'starry');
    expect(night.items.map((p) => p.variant)).toEqual(['sunset~starry', 'default', 'default']);
    expect(withLiveSky(night, 'morning').items[0].variant).toBe('sunset~morning');
    expect(room.items[0].variant).toBe('sunset'); // the saved room is untouched
    // The night sky, with the owner's (sunset) curtains.
    const art = itemArt('window')!;
    expect(variantOf(art, 'sunset~starry').colors.sky1).toBe(variantOf(art, 'starry').colors.sky1);
    expect(variantOf(art, 'sunset~starry').colors.curtain).toBe(variantOf(art, 'sunset').colors.curtain);
    for (const ambience of ['cozy_night', 'rainy_day', 'morning_calm', 'forest_retreat', 'starry_night'] as const) {
      const { unmount } = render(<><HealingLayer ambience={ambience} /><RoomAmbience layout={night} ambience={ambience} sky="starry" k={1} /></>);
      expect(screen.getByTestId(`healing-layer-${ambience}`, { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId(`room-ambience-${ambience}`, { includeHiddenElements: true })).toBeTruthy();
      unmount();
    }
  });
});

describe('Tiện ích → Cuộc sống Mirabi', () => {
  const worlds = ['work', 'healing', 'adventure', 'money', 'town', 'career'] as const;
  const handlers = () => Object.fromEntries(worlds.map((w) => [w, jest.fn()])) as Record<(typeof worlds)[number], jest.Mock>;

  it('shows the six worlds in Vietnamese to users aged 16 and over, and opens each', () => {
    const life = handlers();
    wrap(<MoreTab user={{ ...USER, age: 16 } as any} onOpenProfile={() => {}} life={life} />);
    expect(screen.getByText('Cuộc sống Mirabi')).toBeTruthy();
    for (const title of ['Nhiệm vụ công việc', 'Góc thư giãn', 'Phiêu lưu cuộc sống', 'Vườn tài chính', 'Thị trấn Mirabi', 'Hành trình sự nghiệp']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    for (const w of worlds) fireEvent.press(screen.getByTestId(`open-${w}`));
    for (const w of worlds) expect(life[w]).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Work Quest|Life Adventure|Money Garden|Mirabi Town|Career Journey/)).toBeNull();
  });

  it('hides them under 16, and asks for the age when it is unknown', () => {
    const { unmount } = wrap(<MoreTab user={{ ...USER, age: 15 } as any} onOpenProfile={() => {}} life={handlers()} onOpenStudyProfile={() => {}} />);
    expect(screen.queryByText('Cuộc sống Mirabi')).toBeNull();
    expect(screen.queryByTestId('open-work')).toBeNull();
    expect(screen.queryByText(/Cập nhật "Độ tuổi & lớp học"/)).toBeNull();
    unmount();
    const openProfile = jest.fn();
    wrap(<MoreTab user={{ ...USER, age: null } as any} onOpenProfile={() => {}} life={handlers()} onOpenStudyProfile={openProfile} />);
    expect(screen.queryByTestId('open-work')).toBeNull();
    fireEvent.press(screen.getByText(/Cập nhật "Độ tuổi & lớp học"/));
    expect(openProfile).toHaveBeenCalled();
  });
});
