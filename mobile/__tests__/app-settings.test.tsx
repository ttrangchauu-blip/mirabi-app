import React from 'react';
import { Linking, Text } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { LANGUAGE_KEY, LanguageProvider, resolveLanguage, translate, useLanguage } from '../src/i18n';
import { wants } from '../src/notifications/permission';
import { usePetReturnNotice } from '../src/notifications/usePetReturnNotice';
import { LanguageScreen, NotificationSettingsScreen, notificationSummary } from '../src/screens/main/AppSettingsScreens';
import { usePomodoroTimer } from '../src/screens/main/usePomodoroTimer';
import { DEFAULT_NOTIFICATIONS } from '../src/settings/accountSettings';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { mockServer, networkDown } from '../test/mockServer';

const N = Notifications as jest.Mocked<typeof Notifications>;
const wrap = (node: React.ReactNode) => render(<LanguageProvider><ToastProvider><ConfirmProvider>{node}</ConfirmProvider></ToastProvider></LanguageProvider>);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const prefsServer = (notifications = DEFAULT_NOTIFICATIONS, extra: object = {}) => mockServer({
  'GET /api/world/preferences': { status: 200, body: { version: 1, settings: { notifications, ...extra } } },
  'PUT /api/world/preferences': (req) => ({ status: 200, body: { version: req.body.version + 1, settings: req.body.settings } }),
});
const permission = (p: object) => { N.getPermissionsAsync.mockResolvedValue(p as any); };
const lastPut = (server: ReturnType<typeof mockServer>) => server.callsTo('PUT /api/world/preferences').slice(-1)[0]?.body;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  permission({ granted: true, status: 'granted', canAskAgain: true });
  N.requestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true } as any);
});

describe('Cài đặt > Thông báo', () => {
  it('the master switch greys every kind out, keeps each choice, and brings them back as they were', async () => {
    const server = prefsServer({ ...DEFAULT_NOTIFICATIONS, pet: false });
    wrap(<NotificationSettingsScreen userId={41} onBack={() => {}} />);
    await flush();
    expect(screen.getByTestId('notifications-pet').props.value).toBe(false);
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', false);
    await flush();
    expect(lastPut(server).settings.notifications).toEqual({ ...DEFAULT_NOTIFICATIONS, enabled: false, pet: false });
    for (const kind of ['focus', 'pet', 'achievements', 'friends']) expect(screen.getByTestId(`notifications-${kind}`).props.disabled).toBe(true);
    expect(screen.getByTestId('notifications-focus').props.value).toBe(true); // kept, only greyed out
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', true);
    await flush();
    expect(lastPut(server).settings.notifications).toEqual({ ...DEFAULT_NOTIFICATIONS, pet: false });
    expect(screen.getByTestId('notifications-focus').props.disabled).toBe(false);
  });

  it('each kind is saved on its own', async () => {
    const server = prefsServer();
    wrap(<NotificationSettingsScreen userId={42} onBack={() => {}} />);
    await flush();
    fireEvent(screen.getByTestId('notifications-friends'), 'valueChange', false);
    await flush();
    expect(lastPut(server).settings.notifications).toEqual({ ...DEFAULT_NOTIFICATIONS, friends: false });
  });

  it('turning on asks the device the first time; allowed, it is on', async () => {
    permission({ granted: false, status: 'undetermined', canAskAgain: true });
    const server = prefsServer({ ...DEFAULT_NOTIFICATIONS, enabled: false });
    wrap(<NotificationSettingsScreen userId={43} onBack={() => {}} />);
    await flush();
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', true);
    await flush();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(lastPut(server).settings.notifications.enabled).toBe(true);
    expect(screen.getByTestId('notifications-master').props.value).toBe(true);
  });

  it('refused by the device, it stays off instead of looking on, and says so', async () => {
    permission({ granted: false, status: 'undetermined', canAskAgain: true });
    N.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false } as any);
    const server = prefsServer({ ...DEFAULT_NOTIFICATIONS, enabled: false });
    wrap(<NotificationSettingsScreen userId={44} onBack={() => {}} />);
    await flush();
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', true);
    await flush();
    expect(screen.getByTestId('notifications-master').props.value).toBe(false);
    expect(server.callsTo('PUT /api/world/preferences')).toHaveLength(0);
    expect(screen.getByText(/Máy chưa cho phép thông báo/)).toBeTruthy();
  });

  it('blocked in the device: no question again, the way to the device settings, and the kinds say they cannot be sent', async () => {
    permission({ granted: false, status: 'denied', canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as any);
    prefsServer();
    wrap(<NotificationSettingsScreen userId={45} onBack={() => {}} />);
    await flush();
    expect(screen.getByTestId('notifications-blocked')).toHaveTextContent('Thông báo đang bị tắt trong cài đặt thiết bị.');
    fireEvent.press(screen.getByRole('button', { name: 'Mở cài đặt' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Không gửi được: máy đang chặn thông báo')).toHaveLength(2); // focus and pet; the in-app ones still work
    // Trying the switch again never shows the system question.
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', false);
    fireEvent(screen.getByTestId('notifications-master'), 'valueChange', true);
    await flush();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('a change made offline stays on screen, says it is not saved yet, and goes with the next open', async () => {
    mockServer({ 'GET /api/world/preferences': networkDown(), 'PUT /api/world/preferences': networkDown() });
    const view = wrap(<NotificationSettingsScreen userId={46} onBack={() => {}} />);
    await flush();
    fireEvent(screen.getByTestId('notifications-pet'), 'valueChange', false);
    await flush();
    expect(screen.getByTestId('notifications-pet').props.value).toBe(false);
    expect(screen.getByTestId('settings-unsent')).toBeTruthy();
    view.unmount();
    const server = prefsServer();
    wrap(<NotificationSettingsScreen userId={46} onBack={() => {}} />);
    await flush();
    expect(lastPut(server).settings.notifications.pet).toBe(false);
    expect(screen.queryByTestId('settings-unsent')).toBeNull();
  });

  it('the line in Cài đặt tells the real state, the choice and the device together', () => {
    const tr = (k: any) => translate('vi', k);
    expect(notificationSummary(DEFAULT_NOTIFICATIONS, { status: 'granted', canAskAgain: true }, tr)).toBe('Đang bật');
    expect(notificationSummary({ ...DEFAULT_NOTIFICATIONS, enabled: false }, { status: 'granted', canAskAgain: true }, tr)).toBe('Đang tắt');
    expect(notificationSummary(DEFAULT_NOTIFICATIONS, { status: 'denied', canAskAgain: false }, tr)).toBe('Bật · máy đang chặn thông báo');
    expect(notificationSummary(DEFAULT_NOTIFICATIONS, { status: 'undetermined', canAskAgain: true }, tr)).toBe('Bật · máy chưa cho phép');
    expect(wants({ ...DEFAULT_NOTIFICATIONS, enabled: false }, 'achievements')).toBe(false);
    expect(wants({ ...DEFAULT_NOTIFICATIONS, achievements: false }, 'achievements')).toBe(false);
    expect(wants(DEFAULT_NOTIFICATIONS, 'achievements')).toBe(true);
  });
});

describe('the pet is back: a notification for the end of the walk', () => {
  const inAnHour = () => Date.now() + 3600e3;
  it('is scheduled for the return time, with the pet name', async () => {
    const at = inAnHour();
    renderHook(() => usePetReturnNotice(at, 'Mây', true));
    await flush();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const { content, trigger } = N.scheduleNotificationAsync.mock.calls[0][0] as any;
    expect(content.title).toBe('Mây đã trở về!');
    expect(content.body).toBe('Hãy xem hôm nay bạn ấy mang gì về nhé.');
    expect(trigger.date.getTime()).toBeGreaterThanOrEqual(at);
    expect(trigger.date.getTime() - at).toBeLessThan(1000);
  });
  it('nothing without a walk under way, when turned off, or without the device permission (and it never asks)', async () => {
    renderHook(() => usePetReturnNotice(null, 'Mây', true));
    renderHook(() => usePetReturnNotice(inAnHour(), 'Mây', false));
    renderHook(() => usePetReturnNotice(Date.now() - 1000, 'Mây', true));
    await flush();
    permission({ granted: false, status: 'undetermined', canAskAgain: true });
    renderHook(() => usePetReturnNotice(inAnHour(), 'Mây', true));
    await flush();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });
  it('the walk is over early, the choice is turned off, or the user signs out: what was scheduled is cancelled', async () => {
    const at = inAnHour();
    const hook = renderHook(({ when, on }: { when: number | null; on: boolean }) => usePetReturnNotice(when, 'Mây', on), { initialProps: { when: at, on: true } });
    await flush();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    hook.rerender({ when: null, on: true });
    await flush();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('test-notification');
    hook.rerender({ when: at, on: true });
    await flush();
    hook.rerender({ when: at, on: false });
    await flush();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
    hook.rerender({ when: at, on: true });
    await flush();
    hook.unmount();
    await flush();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    expect(await AsyncStorage.getItem('mirabi.pet.return:notification')).toBeNull();
  });
});

describe('Phiên tập trung hoàn thành follows the setting', () => {
  it('turned off, a running session schedules nothing; on, it is scheduled; cancelled, it is taken back', async () => {
    mockServer({});
    const hook = renderHook(({ on }: { on: boolean }) => usePomodoroTimer(undefined, 301, on), { initialProps: { on: false } });
    await flush();
    act(() => hook.result.current.toggle());
    await flush();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    hook.rerender({ on: true });
    await flush();
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect((N.scheduleNotificationAsync.mock.calls[0][0] as any).content.title).toBe('Phiên tập trung đã hoàn thành 🎉');
    act(() => hook.result.current.reset());
    await flush();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('test-notification');
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it('starting a session asks the device only while it was never asked', async () => {
    mockServer({});
    permission({ granted: false, status: 'denied', canAskAgain: true });
    const hook = renderHook(() => usePomodoroTimer(undefined, 302, true));
    await flush();
    act(() => hook.result.current.toggle());
    await flush();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe('Cài đặt > Ngôn ngữ', () => {
  it('only a language Mirabi is fully written in can be chosen; one still being translated says so', async () => {
    const server = prefsServer();
    wrap(<LanguageScreen userId={51} onBack={() => {}} />);
    await flush();
    const english = screen.getByTestId('language-en');
    expect(english.props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    expect(screen.getByLabelText('English. Chưa dịch xong, chưa dùng được. Sắp có')).toBeTruthy();
    fireEvent.press(english);
    expect(screen.getByTestId('language-device').props.accessibilityState.checked).toBe(true);
    fireEvent.press(screen.getByTestId('language-vi'));
    await flush();
    expect(screen.getByTestId('language-vi').props.accessibilityState.checked).toBe(true);
    expect(await AsyncStorage.getItem(LANGUAGE_KEY)).toBe('vi');
    expect(lastPut(server).settings.language).toBe('vi');
  });

  it('the choice is back after a restart, before any connection', async () => {
    await AsyncStorage.setItem(LANGUAGE_KEY, 'vi');
    let seen: ReturnType<typeof useLanguage> | null = null;
    const Probe = () => { seen = useLanguage(); return <Text>{seen.t('settings.language.title')}</Text>; };
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await flush();
    expect(seen!.choice).toBe('vi');
    expect(screen.getByText('Ngôn ngữ')).toBeTruthy();
    // A value Mirabi can't speak (an older or broken copy) is ignored.
    await AsyncStorage.setItem(LANGUAGE_KEY, 'en');
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await flush();
    expect(seen!.choice).toBeNull();
  });

  it('the choice, else the device, else Vietnamese; a device language not ready yet falls back', () => {
    expect(resolveLanguage('vi', 'en')).toBe('vi');
    expect(resolveLanguage(null, 'vi')).toBe('vi');
    expect(resolveLanguage(null, 'en')).toBe('vi');
    expect(resolveLanguage(null, 'ja')).toBe('vi');
    expect(resolveLanguage(null, null)).toBe('vi');
  });

  it('texts fill in their names, and a missing key falls back instead of breaking the screen', () => {
    expect(translate('vi', 'notification.petBackTitle', { pet: 'Mây' })).toBe('Mây đã trở về!');
    expect(translate('en', 'settings.language.title')).toBe('Ngôn ngữ');
    expect(translate('vi', 'nothing.here' as any)).toBe('nothing.here');
  });
});

describe('an achievement notice only when one is really unlocked, and only when allowed', () => {
  it('turned off, the app does not even ask for new unlocks', async () => {
    const { useAchievementNotices } = require('../src/achievements/useAchievementNotices');
    const server = mockServer({ 'GET /api/achievements/unseen': { status: 200, body: { count: 0, unlocks: [] } } });
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    try {
      const Host = ({ on }: { on: boolean }) => { useAchievementNotices(on, () => {}); return null; };
      const view = render(<ToastProvider><Host on={wants({ ...DEFAULT_NOTIFICATIONS, achievements: false }, 'achievements')} /></ToastProvider>);
      await act(async () => { jest.advanceTimersByTime(60000); });
      expect(server.callsTo('GET /api/achievements/unseen')).toHaveLength(0);
      view.rerender(<ToastProvider><Host on={wants(DEFAULT_NOTIFICATIONS, 'achievements')} /></ToastProvider>);
      await act(async () => { jest.advanceTimersByTime(5000); });
      await waitFor(() => expect(server.callsTo('GET /api/achievements/unseen').length).toBeGreaterThan(0));
      // Progress without an unlock: nothing is shown.
      expect(screen.queryByText(/Mở khóa thành tựu|thành tựu mới/)).toBeNull();
    } finally { jest.useRealTimers(); }
  });
});
