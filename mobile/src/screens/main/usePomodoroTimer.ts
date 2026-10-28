import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { request } from './shared';

type PendingEvent = { cycle: string; event: 'started' | 'completed' | 'cancelled'; duration_seconds: number; timezone: string; occurred_at: string };
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const cycleKey = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
const eventFor = (cycle: string, event: PendingEvent['event'], seconds = 0, at = Date.now()): PendingEvent => ({ cycle, event, duration_seconds: seconds, timezone: localZone(), occurred_at: new Date(at).toISOString() });
export type PomodoroState = {
  phase: 'focus' | 'short_break' | 'long_break'; focusMinutes: number; shortBreakMinutes: number; longBreakMinutes: number;
  longBreakEvery: number; completedCycles: number; running: boolean; remainingSeconds: number; endsAt: number | null;
  activeCycle: string | null; pending: PendingEvent[]; dailyGoalMinutes: number; sound: string; volume: number; soundOn: boolean; completionKey: string | null;
  /** Focus mode hides in-app notices while a focus session is running. */ focusMode: boolean;
};
const KEY = 'mirabi.pomodoro.v1';
export const SOUND_PREVIEW_MS = 10000;
const soundSources: Record<string, number> = {
  rain: require('../../../assets/audio/rain.wav'), forest: require('../../../assets/audio/forest.wav'),
  stream: require('../../../assets/audio/stream.wav'), cafe: require('../../../assets/audio/cafe.wav'),
  lofi: require('../../../assets/audio/lofi.wav'), white: require('../../../assets/audio/white-noise.wav'),
};
const initial: PomodoroState = { phase: 'focus', focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4,
  activeCycle: null, pending: [], dailyGoalMinutes: 120, completedCycles: 0, running: false, remainingSeconds: 1500, endsAt: null, sound: 'rain', volume: 0.35, soundOn: false, completionKey: null, focusMode: false };

// Updated by the hook; while focus mode is quiet, notifications go to the list without a banner or sound.
let quietNotifications = false;
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: !quietNotifications, shouldShowList: true, shouldPlaySound: !quietNotifications, shouldSetBadge: false }) });

export function usePomodoroTimer(onCompleted?: () => void, userId?: number) {
  const [state, setState] = useState<PomodoroState>(initial);
  // One player for the whole session; tracks are swapped with replace(). Giving useAudioPlayer a new source per track
  // creates a second player, and on web the old one keeps playing underneath the new track.
  const player = useAudioPlayer(null);
  const loadedSound = useRef<string | null>(null);
  const [completion, setCompletion] = useState<any>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const callback = useRef(onCompleted); callback.current = onCompleted;
  const syncing = useRef(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const storageKey = `${KEY}:${userId ?? 'anonymous'}`;
  const owner = useRef(storageKey); owner.current = storageKey;
  const ready = loadedKey === storageKey;
  useEffect(() => {
    let disposed = false;
    setLoadedKey(null); setCompletion(null); setSyncMessage(''); setState(initial);
    void Promise.all([AsyncStorage.getItem(storageKey), request('/api/study/pomodoro-settings').catch(() => null)]).then(([raw, prefs]) => {
      if (disposed) return;
      let restored = { ...initial };
      if (raw) try { restored = { ...initial, ...JSON.parse(raw) }; } catch { /* reset corrupt storage */ }
      if (prefs) restored = { ...restored, dailyGoalMinutes: prefs.daily_goal_minutes,
        ...(!restored.activeCycle ? { focusMinutes: prefs.focus_minutes, shortBreakMinutes: prefs.short_break_minutes,
          longBreakMinutes: prefs.long_break_minutes, longBreakEvery: prefs.long_break_every } : {}) };
      if (!restored.activeCycle && restored.phase === 'focus' && !restored.running) restored.remainingSeconds = restored.focusMinutes * 60;
      if (restored.running && restored.endsAt) restored.remainingSeconds = Math.max(0, Math.ceil((restored.endsAt - Date.now()) / 1000));
      setState(restored); setLoadedKey(storageKey);
    });
    return () => { disposed = true; };
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    void request('/api/study/pomodoro-settings', { method: 'PUT', body: { timezone: localZone(),
      daily_goal_minutes: state.dailyGoalMinutes, focus_minutes: state.focusMinutes,
      short_break_minutes: state.shortBreakMinutes, long_break_minutes: state.longBreakMinutes,
      long_break_every: state.longBreakEvery } }).then(() => { if (!disposed) { setSettingsError(false); setSettingsVersion(v => v + 1); } }).catch(() => { if (!disposed) setSettingsError(true); });
    return () => { disposed = true; };
  }, [ready, storageKey, settingsRetry, state.dailyGoalMinutes, state.focusMinutes, state.shortBreakMinutes, state.longBreakMinutes, state.longBreakEvery]);
  useEffect(() => { if (ready) void AsyncStorage.setItem(storageKey, JSON.stringify(state)); }, [state, ready, storageKey]);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }); }, []);
  // Background sound follows the session: it plays only while a focus session runs and pauses with it.
  const soundPlaying = state.soundOn && state.running && state.phase === 'focus';
  // Picking a track outside a session plays a short preview, so the choice is heard right away.
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPreview = () => { if (previewTimer.current) clearTimeout(previewTimer.current); previewTimer.current = null; setPreviewing(false); };
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current); }, []);
  const audible = state.soundOn && (soundPlaying || previewing);
  useEffect(() => {
    if (!audible) { player.pause(); return; }
    if (loadedSound.current !== state.sound) {
      player.pause(); // stop the current track first: replace() alone leaves it playing on web
      player.replace(soundSources[state.sound] ?? soundSources.rain);
      loadedSound.current = state.sound;
    }
    player.loop = true; player.volume = state.volume;
    player.play();
  }, [player, state.sound, audible, state.volume]);
  const quiet = ready && state.focusMode && state.running && state.phase === 'focus';
  useEffect(() => { quietNotifications = quiet; return () => { quietNotifications = false; }; }, [quiet]);
  useEffect(() => {
    if (Platform.OS === 'web' || !ready) return;
    let cancelled = false;
    const syncNotification = async () => {
      const notificationKey = `${storageKey}:notification`;
      const existing = await AsyncStorage.getItem(notificationKey);
      if (existing) await Notifications.cancelScheduledNotificationAsync(existing).catch(() => {});
      await AsyncStorage.removeItem(notificationKey);
      if (!state.running || !state.endsAt || state.endsAt <= Date.now()) return;
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted || cancelled) return;
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('pomodoro', { name: 'Pomodoro', importance: Notifications.AndroidImportance.DEFAULT, sound: 'default' });
      const identifier = await Notifications.scheduleNotificationAsync({
        content: { title: state.phase === 'focus' ? 'Hoàn thành phiên học!' : 'Hết giờ nghỉ!', body: state.phase === 'focus' ? 'Bạn đã hoàn thành một phiên tập trung.' : 'Sẵn sàng cho phiên học tiếp theo?', sound: 'default' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(state.endsAt), ...(Platform.OS === 'android' ? { channelId: 'pomodoro' } : {}) },
      });
      if (cancelled) await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      else await AsyncStorage.setItem(notificationKey, identifier);
    };
    void syncNotification().catch(() => {});
    return () => { cancelled = true; };
  }, [ready, state.running, state.endsAt, state.phase, storageKey]);
  useEffect(() => { const id = setInterval(() => setSyncVersion(v => v + 1), 15000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (!ready || !state.pending.length || syncing.current) return;
    const requestOwner = storageKey;
    const pending = state.pending[0];
    syncing.current = true;
    void request(`/api/study/pomodoro/${pending.cycle}`, { method: 'PUT', body: pending }).then(result => {
      if (owner.current !== requestOwner) return;
      setState(s => ({ ...s, pending: s.pending.filter(e => !(e.cycle === pending.cycle && e.event === pending.event)) }));
      if (pending.event === 'completed') {
        if (result.status === 'completed') setCompletion({ ...result.statistics, focus_seconds: pending.duration_seconds, xp_awarded: result.xp_awarded ?? 0 });
        else setSyncMessage('Phiên này đã bị hủy trước đó và không được tính vào thống kê.');
        callback.current?.();
      }
    }).catch(() => { /* Persist the event and retry without interrupting focus. */ }).finally(() => { syncing.current = false; });
  }, [ready, state.pending, syncVersion, storageKey]);
  useEffect(() => {
    if (!ready || !state.running || !state.endsAt) return;
    const tick = () => setState((current) => {
      if (!current.running || !current.endsAt) return current;
      const remainingSeconds = Math.max(0, Math.ceil(((current.endsAt ?? Date.now()) - Date.now()) / 1000));
      if (remainingSeconds > 0) return { ...current, remainingSeconds };
      if (current.phase === 'focus') {
        const completedCycles = current.completedCycles + 1;
        const phase = completedCycles % current.longBreakEvery === 0 ? 'long_break' : 'short_break';
        const duration = phase === 'long_break' ? current.longBreakMinutes : current.shortBreakMinutes;
        const pending = current.activeCycle ? [...current.pending, eventFor(current.activeCycle, 'completed', current.focusMinutes * 60, current.endsAt ?? Date.now())] : current.pending;
        return { ...current, phase, completedCycles, activeCycle: null, pending, running: false,
          remainingSeconds: duration * 60, endsAt: null };
      }
      const duration = current.focusMinutes;
      return { ...current, phase: 'focus', running: false, remainingSeconds: duration * 60, endsAt: null };
    });
    tick(); const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [ready, state.running]);
  return {
    ...state, seconds: state.remainingSeconds, completion, ready, settingsError, settingsVersion, syncMessage, soundPlaying, previewing, quiet,
    /** Choose a background track (or `null` for none). Outside a focus session the track plays as a short preview. */
    selectSound: (sound: string | null) => {
      stopPreview();
      setState((s) => (sound ? { ...s, sound, soundOn: true } : { ...s, soundOn: false }));
      if (sound && !soundPlaying) {
        setPreviewing(true);
        previewTimer.current = setTimeout(() => { previewTimer.current = null; setPreviewing(false); }, SOUND_PREVIEW_MS);
      }
    },
    retrySettings: () => setSettingsRetry(v => v + 1),
    dismissCompletion: () => setCompletion(null),
    nextFocus: () => { if (!ready) return; setCompletion(null); setState(s => {
      const activeCycle = cycleKey();
      return { ...cancelFocus(s), phase: 'focus', running: true, activeCycle,
        pending: [...cancelFocus(s).pending, eventFor(activeCycle, 'started')],
        remainingSeconds: s.focusMinutes * 60, endsAt: Date.now() + s.focusMinutes * 60000 };
    }); },
    toggle: () => { if (!ready) return; setState((s) => { const running = !s.running;
      const remainingSeconds = s.running && s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : s.remainingSeconds;
      const activeCycle = s.phase === 'focus' && running ? s.activeCycle ?? cycleKey() : s.activeCycle;
      const pending = activeCycle && !s.activeCycle ? [...s.pending, eventFor(activeCycle, 'started')] : s.pending;
      return { ...s, activeCycle, pending, running, remainingSeconds, endsAt: running ? Date.now() + remainingSeconds * 1000 : null }; }); },
    // Ending a session early also turns its background sound off.
    reset: () => setState((s) => ({ ...cancelFocus(s), phase: 'focus', running: false, endsAt: null, remainingSeconds: s.focusMinutes * 60, soundOn: false })),
    toggleFocusMode: () => setState((s) => ({ ...s, focusMode: !s.focusMode })),
    configure: (values: Partial<PomodoroState>) => setState((s) => ({ ...(values.focusMinutes ? cancelFocus(s) : s), ...values,
      ...(values.focusMinutes ? { remainingSeconds: values.focusMinutes * 60, endsAt: null, running: false, phase: 'focus' as const } : {}) })),
    skip: () => setState((s) => { const phase = s.phase === 'focus' ? 'short_break' : 'focus';
      const duration = phase === 'focus' ? s.focusMinutes : s.shortBreakMinutes;
      return { ...cancelFocus(s), phase, running: false, endsAt: null, remainingSeconds: duration * 60 }; }),
    toggleSound: () => setState((s) => ({ ...s, soundOn: !s.soundOn })),
  };
}

function cancelFocus(s: PomodoroState): PomodoroState {
  const remaining = s.running && s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000)) : s.remainingSeconds;
  return { ...s, activeCycle: null, pending: s.activeCycle ? [...s.pending, eventFor(s.activeCycle, 'cancelled', Math.max(0, s.focusMinutes * 60 - remaining))] : s.pending };
}
