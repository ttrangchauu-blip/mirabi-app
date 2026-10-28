import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOUND_PREVIEW_MS, usePomodoroTimer } from '../src/screens/main/usePomodoroTimer';
import { request } from '../src/screens/main/shared';

jest.mock('../src/screens/main/shared', () => ({ request: jest.fn() }));
const mockedRequest = request as jest.Mock;
const prefs = { timezone: 'Asia/Bangkok', daily_goal_minutes: 90, focus_minutes: 1,
  short_break_minutes: 5, long_break_minutes: 15, long_break_every: 4 };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  await AsyncStorage.clear();
  mockedRequest.mockReset().mockImplementation(async (path: string, options?: any) => {
    if (path.endsWith('pomodoro-settings')) return prefs;
    return { status: options?.body?.event, statistics: { today_seconds: 60, today_sessions: 1, current_streak: 1, goal_progress: 1 / 90 } };
  });
});
afterEach(() => { jest.useRealTimers(); });

test('completion excludes pause time, stops before rest, and syncs each cycle once', async () => {
  const completed = jest.fn();
  const { result } = renderHook(() => usePomodoroTimer(completed, 101));
  await flush();
  expect(result.current.ready).toBe(true);
  expect(result.current.dailyGoalMinutes).toBe(90);
  act(() => result.current.toggle());
  await flush();
  act(() => jest.advanceTimersByTime(20000));
  act(() => result.current.toggle());
  act(() => jest.advanceTimersByTime(100000));
  expect(result.current.seconds).toBe(40);
  act(() => result.current.toggle());
  act(() => jest.advanceTimersByTime(40000));
  await flush();
  expect(result.current.running).toBe(false);
  expect(result.current.phase).toBe('short_break');
  expect(result.current.completion.focus_seconds).toBe(60);
  expect(completed).toHaveBeenCalledTimes(1);
  const events = mockedRequest.mock.calls.filter(([, opts]) => opts?.method === 'PUT' && opts?.body?.event);
  expect(events.map(([, opts]) => opts.body.event)).toEqual(['started', 'completed']);
  expect(events[0][0]).toBe(events[1][0]);
});

test('cancelled focus and breaks never submit a completed study session', async () => {
  const { result } = renderHook(() => usePomodoroTimer(undefined, 102));
  await flush(); act(() => result.current.toggle()); await flush();
  act(() => jest.advanceTimersByTime(20000)); act(() => result.current.skip()); await flush();
  act(() => result.current.toggle()); act(() => jest.advanceTimersByTime(300000)); await flush();
  const events = mockedRequest.mock.calls.filter(([, opts]) => opts?.body?.event);
  expect(events.map(([, opts]) => opts.body.event)).toEqual(['started', 'cancelled']);
  expect(events[1][1].body.duration_seconds).toBe(20);
});

test('offline events survive refresh and retry in original order', async () => {
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.endsWith('pomodoro-settings')) return prefs;
    throw new Error('offline');
  });
  const first = renderHook(() => usePomodoroTimer(undefined, 103));
  await flush(); act(() => first.result.current.toggle()); await flush();
  act(() => jest.advanceTimersByTime(60000)); await flush();
  expect(first.result.current.pending.map(e => e.event)).toEqual(['started', 'completed']);
  first.unmount();
  mockedRequest.mockImplementation(async (path: string, options?: any) => path.endsWith('pomodoro-settings') ? prefs : { status: options?.body?.event, statistics: { today_sessions: 1 } });
  const second = renderHook(() => usePomodoroTimer(undefined, 103));
  await flush(); await flush();
  expect(second.result.current.pending).toHaveLength(0);
  expect(second.result.current.completion.focus_seconds).toBe(60);
});

test('changing account never writes the previous account timer into the new account', async () => {
  const { result, rerender } = renderHook(({ id }: { id: number }) => usePomodoroTimer(undefined, id), { initialProps: { id: 104 } });
  await flush(); act(() => result.current.toggle()); await flush();
  rerender({ id: 105 }); await flush();
  expect(result.current.activeCycle).toBeNull();
  expect(result.current.pending).toHaveLength(0);
  const saved = JSON.parse((await AsyncStorage.getItem('mirabi.pomodoro.v1:105'))!);
  expect(saved.activeCycle).toBeNull();
});

test('sound follows the focus session and ending it early turns the sound off', async () => {
  const { result } = renderHook(() => usePomodoroTimer(undefined, 103));
  await flush();
  act(() => result.current.toggleSound());
  expect(result.current.soundOn).toBe(true);
  expect(result.current.soundPlaying).toBe(false);
  act(() => result.current.toggle()); await flush();
  expect(result.current.soundPlaying).toBe(true);
  act(() => result.current.toggle());
  expect(result.current.soundPlaying).toBe(false);
  expect(result.current.soundOn).toBe(true);
  act(() => result.current.toggle());
  act(() => result.current.reset()); await flush();
  expect(result.current.soundOn).toBe(false);
  expect(result.current.soundPlaying).toBe(false);
});

test('changing track while it plays stops the old track before loading the new one', async () => {
  const { useAudioPlayer } = jest.requireMock('expo-audio');
  const player = useAudioPlayer();
  player.play.mockClear(); player.pause.mockClear(); player.replace.mockClear();
  const order: string[] = [];
  player.pause.mockImplementation(() => order.push('pause'));
  player.replace.mockImplementation(() => order.push('replace'));
  const { result } = renderHook(() => usePomodoroTimer(undefined, 106));
  await flush();
  expect(result.current.soundOn).toBe(false);  // default: no background sound
  act(() => result.current.toggle()); await flush();
  expect(player.replace).not.toHaveBeenCalled();  // nothing is loaded while sound is off
  act(() => result.current.selectSound('rain')); await flush();
  expect(player.replace).toHaveBeenCalledTimes(1);
  expect(player.play).toHaveBeenCalled();
  order.length = 0;
  act(() => result.current.selectSound('forest')); await flush();
  expect(order).toEqual(['pause', 'replace']);
  expect(player.replace).toHaveBeenCalledTimes(2);
  act(() => result.current.configure({ volume: 0.5 })); await flush();
  expect(player.replace).toHaveBeenCalledTimes(2);  // volume changes keep the same track
  player.pause.mockReset(); player.replace.mockReset();
});

test('picking a track outside a session plays a short preview, and "Không có" stops it', async () => {
  const { useAudioPlayer } = jest.requireMock('expo-audio');
  const player = useAudioPlayer();
  const { result } = renderHook(() => usePomodoroTimer(undefined, 107));
  await flush();
  player.play.mockClear(); player.pause.mockClear();
  act(() => result.current.selectSound('lofi')); await flush();
  expect(result.current.previewing).toBe(true);
  expect(result.current.soundPlaying).toBe(false);  // not a session: only a preview
  expect(player.play).toHaveBeenCalled();           // heard right away, no need to press Bắt đầu
  player.pause.mockClear();
  act(() => jest.advanceTimersByTime(SOUND_PREVIEW_MS)); await flush();
  expect(result.current.previewing).toBe(false);
  expect(player.pause).toHaveBeenCalled();
  expect(result.current.soundOn).toBe(true);        // still chosen for the next session
  act(() => result.current.selectSound('rain')); await flush();
  player.pause.mockClear();
  act(() => result.current.selectSound(null)); await flush();
  expect(result.current.soundOn).toBe(false);
  expect(result.current.previewing).toBe(false);
  expect(player.pause).toHaveBeenCalled();
});

test('focus mode is quiet only while a focus session runs', async () => {
  const { result } = renderHook(() => usePomodoroTimer(undefined, 104));
  await flush();
  act(() => result.current.toggleFocusMode());
  expect(result.current.focusMode).toBe(true);
  expect(result.current.quiet).toBe(false);
  act(() => result.current.toggle()); await flush();
  expect(result.current.quiet).toBe(true);
  act(() => result.current.toggle());
  expect(result.current.quiet).toBe(false);
  act(() => result.current.toggleFocusMode()); act(() => result.current.toggle()); await flush();
  expect(result.current.quiet).toBe(false);
});

test('completion carries the EXP awarded by the server', async () => {
  mockedRequest.mockImplementation(async (path: string, options?: any) => {
    if (path.endsWith('pomodoro-settings')) return prefs;
    return { status: options?.body?.event, xp_awarded: options?.body?.event === 'completed' ? 2 : 0,
      statistics: { today_seconds: 60, today_sessions: 1, current_streak: 1, goal_progress: 1 / 90 } };
  });
  const { result } = renderHook(() => usePomodoroTimer(undefined, 105));
  await flush(); act(() => result.current.toggle()); await flush();
  act(() => jest.advanceTimersByTime(60000)); await flush(); await flush();
  expect(result.current.completion.xp_awarded).toBe(2);
});
