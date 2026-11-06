import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../api/client';
import { request } from '../screens/main/shared';

/**
 * The settings that follow the account (backend: /api/world/preferences, one versioned record per user): the living
 * world's sound, effects, motion and lamps, and the app's notifications, language and theme. One store per signed-in
 * user, shared by every screen that reads them, so two screens can never send two different copies.
 *
 * A change is kept on this device at once and marked unsent, then sent with the version it was based on. A save from
 * an outdated copy gets a conflict: this device's changed fields are put on top of the newest settings and sent once
 * more. Without a connection the change stays marked and goes with the next open or the next return to the app.
 */
export type MotionChoice = 'auto' | 'reduced';
export type ThemeMode = 'system' | 'light' | 'dark';
export type NotificationSettings = { enabled: boolean; focus: boolean; pet: boolean; achievements: boolean; friends: boolean };
export type AccountSettings = {
  sound: boolean | null; effects: boolean | null; motion: MotionChoice; lamps: Record<string, boolean>;
  notifications: NotificationSettings; language: 'vi' | null; theme: ThemeMode;
};
type Field = keyof AccountSettings;
/** On this device: the settings, the last version the server confirmed, and which fields it hasn't seen yet. */
type Stored = Partial<AccountSettings> & { version?: number; dirty?: boolean; changed?: Field[] };

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: true, focus: true, pet: true, achievements: true, friends: true };
const FIELDS: Field[] = ['sound', 'effects', 'motion', 'lamps', 'notifications', 'language', 'theme'];

export function settingsOf(s: Partial<AccountSettings>): AccountSettings {
  return {
    sound: s.sound ?? null, effects: s.effects ?? null, motion: s.motion ?? 'auto', lamps: s.lamps ?? {},
    notifications: { ...DEFAULT_NOTIFICATIONS, ...s.notifications }, language: s.language ?? null, theme: s.theme ?? 'system',
  };
}
const pick = (s: Stored, fields: Field[]): Partial<AccountSettings> => Object.fromEntries(fields.filter((f) => f in s).map((f) => [f, s[f]]));
const validAnswer = (value: any): value is { version: number; settings: Partial<AccountSettings> } =>
  !!value && Number.isInteger(value.version) && !!value.settings && typeof value.settings === 'object';
/** The local copy kept the name it had when it only held the room's settings, so nothing saved before is lost. */
const storageKey = (userId: number) => `mirabi.room.prefs:${userId}`;

type Listener = () => void;
class Store {
  state: Stored = {};
  /** True once this device's copy is read (the server may still be on its way). */
  loaded = false;
  /** True once the server answered at least once since the store opened. */
  synced = false;
  private listeners = new Set<Listener>();
  private sending = false;
  private loading: Promise<void> | null = null;
  private onChange: ((s: Stored) => void) | null;
  constructor(private userId: number, onChange: ((s: Stored) => void) | null) { this.onChange = onChange; }

  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get subscribers() { return this.listeners.size; }

  private keep(next: Stored) {
    this.state = next;
    this.onChange?.(next);
    this.listeners.forEach((l) => l());
    void AsyncStorage.setItem(storageKey(this.userId), JSON.stringify(next)).catch(() => {});
  }

  /** Reads this device's copy, then the server's. Changes made offline (or before settings followed the account) are sent. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!this.loaded) {
        try {
          const raw = await AsyncStorage.getItem(storageKey(this.userId));
          if (raw) this.state = JSON.parse(raw);
        } catch { /* ignore a corrupt value */ }
        this.loaded = true;
        this.onChange?.(this.state);
        this.listeners.forEach((l) => l());
      }
      const local = this.state;
      try {
        const answer = await request('/api/world/preferences');
        if (!validAnswer(answer)) return;
        this.synced = true;
        if (local.dirty || (answer.version === 0 && Object.keys(local).length)) {
          const changed = local.dirty ? local.changed ?? FIELDS.filter((f) => f in local) : FIELDS.filter((f) => f in local);
          this.keep({ ...answer.settings, ...pick(this.state, changed), version: answer.version, dirty: true, changed });
          void this.push();
        } else this.keep({ ...answer.settings, version: answer.version, dirty: false, changed: [] });
      } catch { /* offline: keeps this device's copy */ }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** A patch, or a function of the latest settings (so two quick changes never start from the same copy). */
  save(change: Partial<AccountSettings> | ((current: AccountSettings) => Partial<AccountSettings>)) {
    const patch = typeof change === 'function' ? change(settingsOf(this.state)) : change;
    const changed = Array.from(new Set([...(this.state.changed ?? []), ...(Object.keys(patch) as Field[])]));
    this.keep({ ...this.state, ...patch, dirty: true, changed });
    void this.push();
  }

  /** Sends what this device has until the server has seen it. One at a time, so answers can't come back out of order. */
  async push() {
    if (this.sending) return;
    this.sending = true;
    try {
      for (let tries = 0; this.state.dirty && tries < 3; tries++) {
        const sent = this.state;
        try {
          const answer = await request('/api/world/preferences', { method: 'PUT', body: { version: sent.version ?? 0, settings: settingsOf(sent) } });
          if (!validAnswer(answer)) return;
          this.synced = true;
          // Changed again while this was on its way: stays unsent, and the loop sends the newer one on this version.
          this.keep(this.state === sent ? { ...answer.settings, version: answer.version, dirty: false, changed: [] } : { ...this.state, version: answer.version });
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'preferences_version_conflict') return;
          const fresh = await request('/api/world/preferences');
          if (!validAnswer(fresh)) return;
          const changed = this.state.changed ?? FIELDS;
          this.keep({ ...fresh.settings, ...pick(this.state, changed), version: fresh.version, dirty: true, changed });
        }
      }
    } catch { /* offline: stays unsent until the next open */ } finally { this.sending = false; }
  }
}

const stores = new Map<number, Store>();
const observers = new Set<(userId: number, s: Stored) => void>();
/** Something outside React that follows the settings (the motion budget of the world does). */
export function observeAccountSettings(observer: (userId: number, settings: AccountSettings) => void) {
  const wrapped = (userId: number, s: Stored) => observer(userId, settingsOf(s));
  observers.add(wrapped);
  return () => { observers.delete(wrapped); };
}

function storeFor(userId: number) {
  let store = stores.get(userId);
  if (!store) {
    store = new Store(userId, (s) => observers.forEach((o) => o(userId, s)));
    stores.set(userId, store);
  }
  return store;
}

/** The account's settings, at once from this device; `save` changes some of them everywhere. */
export function useAccountSettings(userId: number) {
  const store = storeFor(userId);
  const subscribe = useCallback((l: Listener) => {
    const off = store.subscribe(l);
    return () => {
      off();
      // Nobody reads them any more: the next reader starts from this device's saved copy and asks the server again.
      if (!store.subscribers && stores.get(userId) === store) stores.delete(userId);
    };
  }, [store, userId]);
  const state = useSyncExternalStore(subscribe, () => store.state, () => store.state);
  useEffect(() => {
    void store.load();
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void store.load(); });
    return () => sub.remove();
  }, [store]);
  const save = useCallback((change: Parameters<Store['save']>[0]) => store.save(change), [store]);
  return { stored: state, settings: settingsOf(state), loaded: store.loaded, unsent: !!state.dirty, save };
}
