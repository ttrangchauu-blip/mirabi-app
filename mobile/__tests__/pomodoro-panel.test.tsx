import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { PomodoroPanel } from '../src/screens/main/PomodoroPanel';
import { request } from '../src/screens/main/shared';
import type { FocusTimer } from '../src/screens/main/MainApp';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';

jest.mock('../src/screens/main/shared', () => ({ request: jest.fn(), showError: jest.fn() }));
jest.mock('../src/components/PetArt', () => ({ PetArt: () => null }));

function timer(): FocusTimer {
  return { phase: 'focus', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4,
    completedCycles: 0, running: false, remainingSeconds: 1500, seconds: 1500, endsAt: null,
    sound: 'rain', volume: .35, soundOn: false, soundPlaying: false, previewing: false, focusMode: false, quiet: false, completionKey: null, activeCycle: null, pending: [], dailyGoalMinutes: 120,
    ready: true, completion: null, settingsVersion: 0, settingsError: false, syncMessage: '', retrySettings: jest.fn(), nextFocus: jest.fn(),
    configure: jest.fn(), toggle: jest.fn(), reset: jest.fn(), skip: jest.fn(), toggleSound: jest.fn(), selectSound: jest.fn(), toggleFocusMode: jest.fn(), dismissCompletion: jest.fn() };
}
const stats = { today_seconds: 1500, today_sessions: 1, daily_goal_minutes: 120, goal_progress: 25 / 120,
  current_streak: 3, longest_streak: 5, week_seconds: 4500, month_seconds: 9000, seconds: 4500,
  started: 4, completed: 3, completion_rate: .75, rate_completed: 3, cancelled: 1, in_progress: 0,
  average_daily_seconds: 900, timezone: 'Asia/Bangkok', days: [{ date: '2026-10-23', seconds: 1500 }], hours: [{ hour: 20, started: 4, completed: 3 }] };
const Providers = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider><ConfirmProvider>{children}</ConfirmProvider></SafeAreaProvider>;
function setup(current = timer(), width = 390, userId = 1) {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width, height: 900, scale: 1, fontScale: 1 });
  return render(<PomodoroPanel timer={current} userId={userId} petId="fox" petName="Aqua" petLevel={1} />, { wrapper: Providers });
}
async function ready() { await screen.findByText('25 phút'); }
function close() { fireEvent.press(screen.getByRole('button', { name: 'Đóng công cụ' })); }

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (request as jest.Mock).mockImplementation(async (path: string) => path.includes('statistics') ? stats : {});
});
afterEach(() => { jest.restoreAllMocks(); });

test('main room shows only a compact stats strip and two tools; desktop tools open beside the visible timer', async () => {
  const current = timer(); setup(current, 1440); await ready();
  expect(screen.getByLabelText('Còn lại 25:00')).toBeTruthy();
  expect(screen.getByTestId('focus-room')).toBeTruthy();
  expect(screen.queryByText(/Tỷ lệ hoàn thành/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Nghe đọc' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'AI giải đề' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'AI tóm tắt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lưu thời gian' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Ghi chú học tập' }));
  expect(screen.getByTestId('focus-side-panel')).toBeTruthy();
  expect(screen.queryByTestId('focus-bottom-sheet')).toBeNull();
  expect(screen.getByLabelText('Còn lại 25:00')).toBeTruthy();
  close(); expect(current.toggle).not.toHaveBeenCalled();
});

test('mobile statistics open in a bottom sheet', async () => {
  setup(); await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Mở thống kê học tập' }));
  expect(screen.getByTestId('focus-bottom-sheet')).toBeTruthy();
  expect(screen.getByText(/Tỷ lệ hoàn thành: 75%/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'AI phân tích thói quen' })).toBeNull();
});

test('sound selection, playback and volume remain accessible inside the audio panel', async () => {
  const current = timer(); setup(current); await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Mở âm thanh nền' }));
  // No background sound by default.
  expect(screen.getByRole('radio', { name: 'Không có' }).props.accessibilityState.checked).toBe(true);
  expect(screen.getByRole('radio', { name: 'Mưa nhẹ' }).props.accessibilityState.checked).toBe(false);
  fireEvent.press(screen.getByRole('radio', { name: 'Rừng xanh' }));
  expect(current.selectSound).toHaveBeenCalledWith('forest');
  fireEvent.press(screen.getByRole('radio', { name: 'Không có' }));
  expect(current.selectSound).toHaveBeenLastCalledWith(null);
  fireEvent.press(screen.getByRole('button', { name: 'Tăng âm lượng' }));
  expect(current.configure).toHaveBeenCalledWith({ volume: .45 });
  fireEvent.press(screen.getByRole('button', { name: 'Giảm âm lượng' }));
  expect(current.configure).toHaveBeenCalledWith({ volume: .25 });
  expect(current.toggle).not.toHaveBeenCalled();
});

test('reading speaks the typed text without resetting the running timer', async () => {
  const current = { ...timer(), running: true, seconds: 1400 }; setup(current); await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Nghe đọc' }));
  fireEvent.changeText(screen.getByLabelText('Văn bản cần đọc'), 'Quang hợp chuyển ánh sáng thành năng lượng.');
  fireEvent.press(screen.getByRole('button', { name: 'Đọc nội dung' }));
  expect(Speech.speak).toHaveBeenCalledWith('Quang hợp chuyển ánh sáng thành năng lượng.', expect.objectContaining({ language: 'vi-VN' }));
  fireEvent.press(screen.getByRole('button', { name: 'Dừng đọc' }));
  expect(Speech.stop).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/api/ai'), expect.anything());
  expect(current.toggle).not.toHaveBeenCalled(); expect(current.reset).not.toHaveBeenCalled();
});

test('notes and session goals load and save under the existing user-scoped keys', async () => {
  await AsyncStorage.setItem('mirabi.study.note:22', 'Ghi chú đã lưu');
  await AsyncStorage.setItem('mirabi.study.note:23', 'Ghi chú tài khoản khác');
  setup(timer(), 390, 22); await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Ghi chú học tập' }));
  await screen.findByText('Đã lưu trên thiết bị này');
  const note = screen.getByLabelText('Nội dung ghi chú');
  expect(note.props.value).toBe('Ghi chú đã lưu');
  fireEvent.changeText(note, 'Ý chính mới');
  fireEvent.changeText(screen.getByLabelText('Mục tiêu phiên học'), 'Ôn chương 3');
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith('mirabi.study.note:22', 'Ý chính mới'));
  close(); fireEvent.press(screen.getByRole('button', { name: 'Ghi chú học tập' }));
  expect(screen.getByLabelText('Nội dung ghi chú').props.value).toBe('Ý chính mới');
  expect(await AsyncStorage.getItem('mirabi.study.goal:22')).toBe('Ôn chương 3');
  expect(await AsyncStorage.getItem('mirabi.study.note:23')).toBe('Ghi chú tài khoản khác');
});

test('time settings stay local until saved and changing a preset does not immediately reset the timer', async () => {
  const current = timer(); setup(current); await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Tùy chỉnh thời gian' }));
  fireEvent.press(screen.getByRole('checkbox', { name: '45 phút' }));
  expect(current.configure).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Cài đặt nâng cao' }));
  fireEvent.press(screen.getByRole('checkbox', { name: '6 phiên' }));
  fireEvent.press(screen.getByRole('button', { name: 'Lưu thời gian' }));
  expect(current.configure).toHaveBeenCalledWith({ focusMinutes: 45, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 6 });
  expect(screen.queryByTestId('focus-bottom-sheet')).toBeNull();
});

test('focus mode reduces secondary UI while still allowing tools and pausing', async () => {
  const current = { ...timer(), running: true, seconds: 1490 }; setup(current, 1440); await ready();
  expect(screen.getByTestId('active-focus-mode')).toBeTruthy();
  expect(screen.getByText('MỘT CHÚT TRỢ GIÚP, KHI BẠN CẦN')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Nghe đọc' }));
  expect(screen.getByTestId('focus-side-panel')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
  expect(current.toggle).toHaveBeenCalledTimes(1);
});

test('completion offers next focus or rest and stays hidden during active focus', async () => {
  const current = { ...timer(), phase: 'short_break' as const, completion: { ...stats, focus_seconds: 1500 } };
  const view = setup(current); await ready();
  expect(screen.getByText('Hoàn thành phiên học!')).toBeTruthy();
  expect(screen.getByText('Đã tập trung: 25 phút')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Phiên tiếp theo' }));
  expect(current.nextFocus).toHaveBeenCalledTimes(1);
  view.rerender(<PomodoroPanel timer={{ ...current, running: true, phase: 'focus' }} userId={1} petId="fox" petName="Aqua" petLevel={1} />);
  expect(screen.queryByText('Hoàn thành phiên học!')).toBeNull();
});

test('the pet studies at the desk (walks do not take it away) and break pets use their relaxed state', async () => {
  const view = setup(); await ready();
  expect(screen.getByRole('button', { name: 'Aqua đang đọc sách cùng bạn' })).toBeTruthy();
  expect(screen.queryByText('Đang đi dạo')).toBeNull();
  view.rerender(<PomodoroPanel timer={{ ...timer(), phase: 'short_break' }} userId={1} petId="fox" petName="Aqua" petLevel={1} />);
  expect(screen.getByRole('button', { name: 'Aqua đang thư giãn' })).toBeTruthy();
});

test('a running or paused session can be ended early after confirming', async () => {
  const current = { ...timer(), running: true, seconds: 1200 }; setup(current); await ready();
  expect(screen.queryByRole('button', { name: 'Tùy chỉnh thời gian' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Kết thúc phiên' }));
  fireEvent.press((await screen.findAllByRole('button', { name: 'Hủy' })).at(-1)!);
  expect(current.reset).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Kết thúc phiên' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Xác nhận kết thúc' }));
  await waitFor(() => expect(current.reset).toHaveBeenCalledTimes(1));
});

test('an idle session shows time settings instead of the stop button', async () => {
  setup(); await ready();
  expect(screen.getByRole('button', { name: 'Tùy chỉnh thời gian' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Kết thúc phiên' })).toBeNull();
});

test('focus mode is a switch in the room header', async () => {
  const current = timer(); setup(current); await ready();
  const toggle = screen.getByRole('switch', { name: 'Chế độ tập trung' });
  expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
  fireEvent.press(toggle);
  expect(current.toggleFocusMode).toHaveBeenCalledTimes(1);
});

test('completion shows the pet EXP earned for the session', async () => {
  const current = { ...timer(), phase: 'short_break' as const, completion: { focus_seconds: 1500, today_seconds: 1500, today_sessions: 1, current_streak: 1, goal_progress: .2, xp_awarded: 10 } };
  setup(current); await ready();
  expect(screen.getByText('Đã tập trung: 25 phút · +10 EXP cho thú cưng')).toBeTruthy();
});

test('in Học tự chọn "Bắt đầu" starts the focus timer at once (the subject was chosen before)', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 390, height: 900, scale: 1, fontScale: 1 });
  const idle = timer();
  const view = render(<PomodoroPanel timer={idle} userId={1} petId="fox" petName="Aqua" petLevel={1} />, { wrapper: Providers });
  await ready();
  fireEvent.press(screen.getByRole('button', { name: 'Bắt đầu' }));
  expect(idle.toggle).toHaveBeenCalledTimes(1);
  const running = { ...timer(), running: true, seconds: 1200 };
  view.rerender(<PomodoroPanel timer={running} userId={1} petId="fox" petName="Aqua" petLevel={1} />);
  fireEvent.press(screen.getByRole('button', { name: 'Tạm dừng' }));
  expect(running.toggle).toHaveBeenCalledTimes(1);
});
