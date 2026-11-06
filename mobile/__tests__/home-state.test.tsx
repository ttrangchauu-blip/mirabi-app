import React from 'react';
import { Alert, Animated, AppState, BackHandler, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import App from '../App';
import { setSession } from '../src/api/client';
import { SpriteCycle } from '../src/components/PetArt';
import { localDay } from '../src/life/worlds';
import { AdventureMapScreen } from '../src/screens/adventure/AdventureMapScreen';
import { ExploreSpace } from '../src/screens/life/ExploreSpace';
import { DailyQuestsScreen } from '../src/screens/main/DailyQuestsScreen';
import { TaskCreateModal } from '../src/screens/main/TaskCreateModal';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { deferred, mockServer, networkDown, tokens, USER } from '../test/mockServer';

// The garden's own screen has its own tests: here only what the app tells it matters.
jest.mock('../src/screens/garden/GardenScreen', () => {
  const { Text } = require('react-native');
  return { GardenScreen: ({ petAway }: { petAway?: boolean }) => <Text>{`garden pet away: ${String(!!petAway)}`}</Text> };
});

const store: Map<string, string> = (SecureStore as any).__store;
const HOME = `Chào bạn, ${USER.display_name}!`;
const GIFT_TITLE = `${USER.pet_name} đã trở về!`;
const space = (status: string, over: Record<string, unknown> = {}) => ({ status, seconds_left: 0, walk_minutes: 480, quests: [], last_find: null,
  collection: [], total_finds: 8, inventory: [], pending_reward: null, server_now: new Date().toISOString(), ...over });
const walking = (seconds: number) => space('walking', { seconds_left: seconds, return_at: new Date(Date.now() + seconds * 1000).toISOString() });
const quest = (over: Record<string, unknown> = {}) => ({ id: 'health', title: 'Vận động', description: 'Đi bộ hoặc giãn cơ', group: 'Sức khỏe', exp: 10, progress: 0, target: 1, ...over });
const occurrence = (over: Record<string, unknown> = {}) => ({ id: 5, occurrence_id: '5:2031-01-02', title: 'Đọc sách', category: 'study', scheduled_date: '2031-01-02', repeat: 'none',
  completed: false, kind: 'scheduled', exp: 5, ...over });
const dashboard = (over: Record<string, unknown> = {}) => ({ user: USER, study: { total_minutes: 0, today_sessions: 0 }, daily_quests: [], scheduled_tasks: [], ...over });
const ok = (body: unknown) => ({ status: 200, body });
const wrap = (node: React.ReactElement) => render(<ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider>);
const foreground = () => {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === 'change').map(([, fn]) => fn);
  act(() => listeners.forEach((fn) => fn('active')));
};
const openApp = async () => { render(<App />); await screen.findByText(HOME, { includeHiddenElements: true } as any, { timeout: 5000 }); };
const completeRow = async (title: string) => {
  fireEvent.press(await screen.findByText(title));
  fireEvent.press(await screen.findByRole('button', { name: 'Hoàn thành' }));
};

beforeEach(async () => {
  store.clear();
  setSession(null);
  await AsyncStorage.clear();
  store.set('refmi.session.v1', JSON.stringify({ accessToken: 'access-1', refreshToken: tokens(1).refresh_token }));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (AppState.addEventListener as jest.Mock).mockClear(); // only this test's screens are listening
});
afterEach(() => { jest.useRealTimers(); (Alert.alert as jest.Mock).mockRestore(); });

describe('the Home frame while the network is down', () => {
  const walkAlerts = () => (Alert.alert as jest.Mock).mock.calls.filter(([title]) => title === 'Không tải được trạng thái đi dạo');

  it('stays quiet when a background poll fails', async () => {
    jest.useFakeTimers();
    let down = false;
    const server = mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/pet/space': () => (down ? networkDown() : ok(space('locked'))) });
    await openApp();
    down = true;
    const before = server.callsTo('GET /api/pet/space').length;
    await act(async () => { await jest.advanceTimersByTimeAsync(21000); });
    expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(before);
    expect(walkAlerts()).toHaveLength(0);
  });

  it('tells the user once when the first load fails, then offers a retry', async () => {
    jest.useFakeTimers();
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/pet/space': networkDown() });
    await openApp();
    await act(async () => { await jest.advanceTimersByTimeAsync(21000); });
    expect(walkAlerts()).toHaveLength(1);
    expect(screen.getByText('Tải lại khung Pet')).toBeTruthy();
  });
});

describe('the Khám phá countdown', () => {
  const open = () => wrap(<ExploreSpace user={{ ...USER, age: 20, level: 2 } as any} top={0} bottom={0} version={0} onOpenGifts={() => {}} onOpenInventory={() => {}} onOpenQuests={() => {}} />);

  it('counts down every second and reads the walk again when it reaches zero', async () => {
    jest.useFakeTimers();
    const server = mockServer({ 'GET /api/pet/space': () => ok(walking(6)) });
    open();
    await screen.findByText('00:00:06');
    const reads = server.callsTo('GET /api/pet/space').length;
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('00:00:03')).toBeTruthy();
    await act(async () => { await jest.advanceTimersByTimeAsync(3500); });
    expect(server.callsTo('GET /api/pet/space').length).toBeGreaterThan(reads);
  });

  it('goes by the server clock on a phone whose clock is wrong', async () => {
    jest.useFakeTimers();
    const serverNow = Date.now() + 3600e3; // the phone is an hour slow
    mockServer({ 'GET /api/pet/space': () => ok(space('walking', { seconds_left: 10, server_now: new Date(serverNow).toISOString(), return_at: new Date(serverNow + 10000).toISOString() })) });
    open();
    await screen.findByText('00:00:10');
    await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText('00:00:06')).toBeTruthy();
  });
});

describe('coming back to the app', () => {
  it('reads today\'s quests and the walk again', async () => {
    let nextDay = false;
    const server = mockServer({
      'GET /api/auth/me': ok(USER),
      'GET /api/dashboard': () => ok(dashboard({ daily_quests: [quest({ progress: nextDay ? 0 : 1 })] })),
      'GET /api/pet/space': () => ok(nextDay ? walking(3600) : space('rested')),
    });
    await openApp();
    await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 1/1 nhiệm vụ hoàn thành' });
    nextDay = true;
    const loads = server.callsTo('GET /api/dashboard').length;
    foreground();
    await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 0/1 nhiệm vụ hoàn thành' });
    expect(server.callsTo('GET /api/dashboard').length).toBe(loads + 1);
    expect(await screen.findAllByText(/Pet đang đi dạo|Bé đang khám phá/)).toBeTruthy();
  });

  it('says nothing when the phone is still offline', async () => {
    let down = false;
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': () => (down ? networkDown() : ok(dashboard())), 'GET /api/pet/space': () => (down ? networkDown() : ok(space('locked'))) });
    await openApp();
    await screen.findByRole('button', { name: /Nhiệm vụ hằng ngày: 0\/0/ });
    down = true;
    foreground();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('Home without its data', () => {
  it('still shows the dashboard when only the community posts failed', async () => {
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/community/posts': { status: 500, body: {} }, 'GET /api/dashboard': ok(dashboard({ daily_quests: [quest()] })) });
    await openApp();
    expect(await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 0/1 nhiệm vụ hoàn thành' })).toBeTruthy();
  });

  it('never claims everything is done when the tasks could not be read, and offers a retry', async () => {
    let down = true;
    const server = mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': () => (down ? networkDown() : ok(dashboard({ daily_quests: [quest()] }))) });
    await openApp();
    await waitFor(() => expect(server.callsTo('GET /api/dashboard').length).toBeGreaterThan(0));
    fireEvent.press(await screen.findByRole('button', { name: /Nhiệm vụ hằng ngày/ }));
    await screen.findByRole('button', { name: 'Tải lại nhiệm vụ' });
    expect(screen.queryByText('Bạn đã hoàn thành tất cả nhiệm vụ hôm nay!')).toBeNull();
    expect(screen.getAllByText('–')).toHaveLength(2); // not "0 sessions": nothing is known yet
    down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tải lại nhiệm vụ' }));
    expect(await screen.findByText('Vận động')).toBeTruthy();
  });

  it('does not say everything is done on a day with nothing to do', async () => {
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': ok(dashboard()) });
    await openApp();
    fireEvent.press(await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 0/0 nhiệm vụ hoàn thành' }));
    expect(screen.queryByText('Bạn đã hoàn thành tất cả nhiệm vụ hôm nay!')).toBeNull();
  });
});

describe('answers arriving out of order', () => {
  it('an older dashboard never overwrites a newer one', async () => {
    const slow = deferred<any>();
    let call = 0;
    let done = false;
    const server = mockServer({
      'GET /api/auth/me': ok(USER),
      'GET /api/dashboard': () => {
        call += 1;
        if (call === 2) return slow.promise; // the load from coming back to the Home tab, still on its way
        return ok(dashboard({ user: { ...USER, xp: done ? 10 : 0 }, daily_quests: [quest({ progress: done ? 1 : 0 })] }));
      },
      'POST /api/pet/quests/health/complete': () => { done = true; return ok({ quests: [quest({ progress: 1 })], awarded_exp: 10, daily_exp_remaining: 50 }); },
    });
    await openApp();
    fireEvent.press(await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 0/1 nhiệm vụ hoàn thành' }));
    fireEvent.press(screen.getByText('Tiện ích'));
    fireEvent.press(await screen.findByText('Trang chủ'));
    fireEvent.press(await screen.findByRole('button', { name: /Nhiệm vụ hằng ngày: 0\/1/ }));
    await completeRow('Vận động');
    await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 1/1 nhiệm vụ hoàn thành' });
    await waitFor(() => expect(server.callsTo('GET /api/dashboard').length).toBe(3));
    await act(async () => { slow.resolve(ok(dashboard({ user: { ...USER, xp: 0 }, daily_quests: [quest()] }))); await slow.promise; await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByRole('button', { name: 'Nhiệm vụ hằng ngày: 1/1 nhiệm vụ hoàn thành' })).toBeTruthy();
  });
});

describe('the EXP of the day\'s check-in', () => {
  it('shows on Home once the backend has given it', async () => {
    const checkIn = deferred<any>();
    let given = false;
    mockServer({
      'GET /api/auth/me': ok({ ...USER, xp: 240 }),
      'POST /api/streak/check-in': () => checkIn.promise,
      'GET /api/dashboard': () => ok(dashboard({ user: { ...USER, xp: given ? 245 : 240 } })),
    });
    await openApp();
    await screen.findByText('240');
    given = true;
    await act(async () => {
      checkIn.resolve(ok({ current_streak: 4, longest_streak: 9, last_login_date: '2031-01-02', should_show_popup: true, daily_exp_awarded: 5, milestone_exp_awarded: 0, already_claimed: false }));
      await checkIn.promise;
    });
    expect(await screen.findByText('245', { includeHiddenElements: true } as any)).toBeTruthy();
  });
});

describe('a welcome tour finished without a connection', () => {
  it('does not come back while the app is in use, and is saved once the server can be reached', async () => {
    const fresh = { ...USER, onboarded: false };
    let down = true;
    let saved = false;
    const server = mockServer({
      'GET /api/auth/me': ok(fresh),
      'POST /api/onboarding/complete': () => { if (down) return networkDown(); saved = true; return ok(USER); },
      'GET /api/dashboard': () => ok(dashboard({ user: saved ? USER : fresh })),
    });
    render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: 'Bỏ qua hướng dẫn' }, { timeout: 5000 }));
    await screen.findByText(HOME);
    down = false;
    await waitFor(() => expect(server.callsTo('GET /api/dashboard').length).toBeGreaterThan(0));
    await waitFor(() => expect(server.callsTo('POST /api/onboarding/complete')).toHaveLength(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole('button', { name: 'Bỏ qua hướng dẫn' })).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
  });
});

describe('the garden during a walk', () => {
  const openGarden = async () => {
    fireEvent.press(await screen.findByText('Cuộc sống'));
    fireEvent.press(await screen.findByTestId('space-garden'));
  };

  it.each([['walking', true], ['returned', false], ['rested', false], ['locked', false]])('with the walk %s, pet away is %s', async (status, away) => {
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': ok(dashboard({ pet_walk: status })), 'GET /api/pet/space': ok(space('locked')) });
    await openApp();
    await openGarden();
    expect(await screen.findByText(`garden pet away: ${away}`)).toBeTruthy();
  });
});

describe('what a quest or task is worth', () => {
  it('Home shows the server\'s description and EXP', async () => {
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': ok(dashboard({
      daily_quests: [quest({ id: 'work', title: 'Việc quan trọng', description: 'Một việc ưu tiên', exp: 15 })],
      scheduled_tasks: [occurrence({ title: 'Báo cáo', category: 'work', exp: 10 })] })) });
    await openApp();
    fireEvent.press(await screen.findByRole('button', { name: /Nhiệm vụ hằng ngày/ }));
    expect(await screen.findByText('Một việc ưu tiên · +15 EXP')).toBeTruthy();
    expect(screen.getByText(/^Công việc · .*\+10 EXP$/)).toBeTruthy();
  });

  it('the calendar shows them too', async () => {
    mockServer({ [`GET /api/tasks?start_date=2030-12-30&end_date=2031-01-05&quest_date=2031-01-02`]: ok([
      { id: 'work', occurrence_id: 'quest:work:2031-01-02', title: 'Việc quan trọng', category: 'daily', scheduled_date: '2031-01-02', repeat: 'daily', completed: false, kind: 'daily_quest' },
      occurrence({ title: 'Báo cáo', category: 'work', exp: 8 }),
    ]) });
    wrap(<DailyQuestsScreen today="2031-01-02" quests={[quest({ id: 'work', exp: 15 })]} onBack={() => {}} onChanged={() => {}} onOpenTaskCreate={() => {}} />);
    expect(await screen.findByText(/Nhiệm vụ hằng ngày · .*\+15 EXP$/)).toBeTruthy();
    expect(screen.getByText(/^Công việc · .*\+8 EXP$/)).toBeTruthy();
  });
});

describe('the server decides which day it is', () => {
  it('Home is labelled with the server\'s day and adds tasks to it', async () => {
    const server = mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': ok(dashboard({ today: '2031-01-02' })), 'POST /api/tasks': ok({ id: 9 }) });
    await openApp();
    expect(await screen.findByText('Thứ Năm, 2 tháng 1')).toBeTruthy();
    fireEvent.press(await screen.findByRole('button', { name: /Nhiệm vụ hằng ngày/ }));
    fireEvent.press(await screen.findByRole('button', { name: 'Thêm nhiệm vụ mới' }));
    fireEvent.changeText(await screen.findByLabelText('Tên nhiệm vụ'), 'Chạy bộ');
    fireEvent.press(screen.getByText('Lưu nhiệm vụ'));
    await waitFor(() => expect(server.callsTo('POST /api/tasks')[0]?.body.scheduled_date).toBe('2031-01-02'));
  });

  it('Home falls back to the phone\'s day without one', async () => {
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/dashboard': ok(dashboard()) });
    await openApp();
    const d = new Date();
    expect(screen.getByText(new RegExp(`, ${d.getDate()} tháng ${d.getMonth() + 1}$`))).toBeTruthy();
  });

  it('the calendar opens on the server\'s day and follows it when the day turns', async () => {
    const server = mockServer({});
    const tree = (today?: string) => <ToastProvider><ConfirmProvider><DailyQuestsScreen today={today} onBack={() => {}} onChanged={() => {}} onOpenTaskCreate={() => {}} /></ConfirmProvider></ToastProvider>;
    const view = render(tree('2031-01-02'));
    await waitFor(() => expect(server.calls.map((c) => c.path)).toContain('/api/tasks?start_date=2030-12-30&end_date=2031-01-05&quest_date=2031-01-02'));
    view.rerender(tree('2031-01-06'));
    await waitFor(() => expect(server.calls.map((c) => c.path)).toContain('/api/tasks?start_date=2031-01-06&end_date=2031-01-12&quest_date=2031-01-06'));
  });

  it('the calendar falls back to the phone\'s day without one', async () => {
    const server = mockServer({});
    wrap(<DailyQuestsScreen onBack={() => {}} onChanged={() => {}} onOpenTaskCreate={() => {}} />);
    await waitFor(() => expect(server.calls[0]?.path).toContain(`quest_date=${localDay()}`));
  });
});

describe('an Adventure activity ticked when the map can\'t be read again', () => {
  const region = (code: string, over: Record<string, unknown> = {}) => ({ code, name: code, theme: 't', emoji: '🌿', description: 'd', progress: 0, unlocked: code === 'green_valley', unlock_hint: null,
    next_milestone: 3, milestones: [], activities: [], tasks_today: [], ...over });
  const task = { id: 7, occurrence_id: `7:${localDay()}`, title: 'Đi bộ', scheduled_date: localDay(), completed: false, adventure_activity: 'walk_20' };
  const map = () => ({ day: localDay(), pet_region: 'green_valley', total_progress: 0, daily_count_limit: 3,
    regions: [region('green_valley', { tasks_today: [task] }), ...['cozy_village', 'knowledge_forest', 'dream_lake', 'adventure_mountain'].map((c) => region(c))] });

  it('still counts as done', async () => {
    let down = false;
    mockServer({
      [`GET /api/adventure/map?day=${localDay()}`]: () => (down ? networkDown() : ok(map())),
      'POST /api/tasks/7/complete': () => { down = true; return ok({ awarded_exp: 5, already_completed: false }); },
    });
    const onRewards = jest.fn();
    wrap(<AdventureMapScreen user={{ ...USER, age: 28 } as any} onBack={() => {}} onRewards={onRewards} />);
    fireEvent.press(await screen.findByLabelText('Đã làm xong Đi bộ', {}, { timeout: 5000 }));
    await waitFor(() => expect(onRewards).toHaveBeenCalled());
    expect(await screen.findByLabelText('Đã hoàn thành')).toBeTruthy();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('the calendar\'s hours', () => {
  const HOUR = 46;
  const openWith = async (start_time: string) => {
    mockServer({ [`GET /api/tasks?start_date=2030-12-30&end_date=2031-01-05&quest_date=2031-01-02`]: ok([occurrence({ title: 'Việc', start_time })]) });
    wrap(<DailyQuestsScreen today="2031-01-02" onBack={() => {}} onChanged={() => {}} onOpenTaskCreate={() => {}} />);
    return screen.findByRole('checkbox', { name: new RegExp(`${start_time} Việc`) });
  };
  const box = (node: any) => { const { top, height } = StyleSheet.flatten(node.props.style); return { top, height }; };

  it.each([['23:30', 23.5], ['05:00', 5]])('places a task at %s at its own hour, inside the grid', async (start, hours) => {
    const row = await openWith(start);
    const { top, height } = box(row);
    expect(screen.getByText('23:00')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(top + height).toBeLessThanOrEqual(24 * HOUR);
    expect(top).toBeLessThanOrEqual(hours * HOUR);
    expect(top).toBeGreaterThanOrEqual(hours * HOUR - height);
  });
});

describe('the pet coming back while the user is elsewhere', () => {
  const REWARD = { walk_id: 7, returned_at: '2031-01-02T08:00:00+00:00', exp: 0, items: [{ id: 'small_pot', name: 'Chậu cây nhỏ', emoji: '🪴', rarity: 'rare', kind: 'decoration', quantity: 1 }] };

  it('opens the gift popup when a walk started in this session is due back, on any tab', async () => {
    let state: 'locked' | 'walking' | 'returned' = 'locked';
    mockServer({
      'GET /api/auth/me': ok(USER),
      'GET /api/dashboard': () => ok(dashboard({ daily_quests: [quest({ progress: state === 'locked' ? 0 : 1 })] })),
      'GET /api/pet/space': () => ok(state === 'returned' ? space('returned', { pending_reward: REWARD }) : state === 'walking' ? walking(2) : space('locked')),
      'POST /api/pet/quests/health/complete': () => { state = 'walking'; return ok({ quests: [quest({ progress: 1 })], awarded_exp: 10, daily_exp_remaining: 50 }); },
    });
    await openApp();
    fireEvent.press(await screen.findByRole('button', { name: 'Nhiệm vụ hằng ngày: 0/1 nhiệm vụ hoàn thành' }));
    await completeRow('Vận động');
    await screen.findAllByText(/Pet đang đi dạo|Bé đang khám phá/);
    fireEvent.press(screen.getByText('Tiện ích'));
    state = 'returned';
    expect(await screen.findByText(GIFT_TITLE, {}, { timeout: 8000 })).toBeTruthy();
  });

  it('opens it when Home finds the pet already back', async () => {
    let state: 'locked' | 'returned' = 'locked';
    mockServer({ 'GET /api/auth/me': ok(USER), 'GET /api/pet/space': () => ok(state === 'returned' ? space('returned', { pending_reward: REWARD }) : space('locked')) });
    await openApp();
    fireEvent.press(screen.getByText('Tiện ích'));
    state = 'returned';
    fireEvent.press(await screen.findByText('Trang chủ'));
    // The frame behind says the same words as the popup: only the popup has this button.
    expect(await screen.findByRole('button', { name: 'Xem kho đồ' }, { timeout: 5000 })).toBeTruthy();
  });
});

describe('Android\'s back button over the new-task form', () => {
  const pressBack = (spy: jest.SpyInstance) => {
    const handlers = spy.mock.calls.map(([, handler]) => handler).reverse();
    return handlers.find((handler) => handler());
  };

  it('closes the form, ahead of the screen behind it', () => {
    const spy = jest.spyOn(BackHandler, 'addEventListener');
    const onClose = jest.fn();
    const behind = jest.fn(() => true);
    const sub = BackHandler.addEventListener('hardwareBackPress', behind);
    render(<TaskCreateModal visible initialDate="2031-01-02" onClose={onClose} onCreated={() => {}} />);
    pressBack(spy);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
    sub.remove();
    spy.mockRestore();
  });

  it('leaves the button alone while the form is closed', () => {
    const spy = jest.spyOn(BackHandler, 'addEventListener');
    render(<TaskCreateModal visible={false} initialDate="2031-01-02" onClose={() => {}} onCreated={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('a hatch sheet that fails to load', () => {
  it('still ends the animation, so the hatch can go on', () => {
    const onDone = jest.fn();
    const view = render(<SpriteCycle source={1} size={100} layout={{ cols: 8, rows: 1, cycleMs: 800 }} paused={false} once onDone={onDone} />);
    fireEvent(view.UNSAFE_getByType(Animated.Image as any), 'error');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
