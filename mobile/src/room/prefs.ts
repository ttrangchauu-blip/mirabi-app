import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import { useReduceMotion } from '../components/useReduceMotion';
import { ApiError } from '../api/client';
import { request } from '../screens/main/shared';
import { setMotionPreference } from '../world/budget';

export type MotionChoice = 'auto' | 'reduced';
type Settings = { sound?: boolean | null; effects?: boolean | null; motion?: MotionChoice; lamps?: Record<string, boolean> };
/** On this device: the settings, the last version the server confirmed, and whether there are changes it hasn't seen. */
type Stored = Settings & { version?: number; dirty?: boolean };

const settingsOf = ({ sound = null, effects = null, motion = 'auto', lamps = {} }: Settings) => ({ sound, effects, motion, lamps });
const validAnswer = (value: any): value is { version: number; settings: Settings } => !!value && Number.isInteger(value.version) && !!value.settings && typeof value.settings === 'object';

/**
 * "Âm thanh", "Hiệu ứng", "Giảm chuyển động" and the lamps switched by hand. They answer at once from this device and
 * follow the account (/api/world/preferences). Each save names the version it was based on: a save from an outdated
 * screen gets a conflict, then this device's change is put on top of the newest settings and sent once more. Without a
 * connection it stays marked as unsent, and goes with the next open. Effects follow the OS "reduce motion" setting until
 * the user chooses otherwise.
 */
export function useRoomPrefs(userId: number) {
  const osReduce = useReduceMotion();
  const key = `mirabi.room.prefs:${userId}`;
  const [stored, setStored] = useState<Stored>({});
  const latest = useRef<Stored>({});
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const keep = useCallback((next: Stored) => {
    latest.current = next;
    if (alive.current) setStored(next);
    setMotionPreference(next.motion ?? 'auto');
    void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {});
  }, [key]);

  /** Sends what this device has until the server has seen it. One at a time, so answers can't come back out of order. */
  const push = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (let tries = 0; latest.current.dirty && tries < 3; tries++) {
        const sent = latest.current;
        try {
          const answer = await request('/api/world/preferences', { method: 'PUT', body: { version: sent.version ?? 0, settings: settingsOf(sent) } });
          if (!validAnswer(answer)) return;
          // Changed again while this was on its way: stays dirty, and the loop sends the newer one on this version.
          keep(latest.current === sent ? { ...answer.settings, version: answer.version, dirty: false } : { ...latest.current, version: answer.version });
        } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'preferences_version_conflict') return;
          const fresh = await request('/api/world/preferences');
          if (!validAnswer(fresh)) return;
          keep({ ...fresh.settings, ...settingsOfChanges(latest.current), version: fresh.version, dirty: true });
        }
      }
    } catch { /* offline: stays dirty until the next open */ } finally { sending.current = false; }
  }, [keep]);

  useEffect(() => {
    let active = true;
    latest.current = {};
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (active && raw) { latest.current = JSON.parse(raw); setStored(latest.current); setMotionPreference(latest.current.motion ?? 'auto'); }
      } catch { /* ignore a corrupt value */ }
      if (!active) return;
      const local = latest.current;
      try {
        const answer = await request('/api/world/preferences');
        if (!active || !validAnswer(answer)) return;
        if (local.dirty || (answer.version === 0 && Object.keys(local).length)) {
          // Changes made offline, or settings from before they followed the account.
          latest.current = { ...local, version: answer.version, dirty: true };
          void push();
        } else keep({ ...answer.settings, version: answer.version, dirty: false });
      } catch { /* keeps this device's copy */ }
    })();
    return () => { active = false; };
  }, [key, keep, push]);

  const save = useCallback((patch: Settings) => {
    keep({ ...latest.current, ...patch, dirty: true });
    void push();
  }, [keep, push]);

  const lamps = useMemo(() => stored.lamps ?? {}, [stored.lamps]);
  return {
    sound: stored.sound ?? true,
    effects: stored.effects ?? !osReduce,
    motion: stored.motion ?? 'auto',
    /** Lamps switched by hand: their placement key and whether on. A lamp not listed follows the time of day. */
    lamps,
    setSound: (value: boolean) => save({ sound: value }),
    setEffects: (value: boolean) => save({ effects: value }),
    setMotion: (value: MotionChoice) => save({ motion: value }),
    setLamp: (lamp: string, on: boolean) => save({ lamps: { ...latest.current.lamps, [lamp]: on } }),
  };
}

const settingsOfChanges = ({ version: _version, dirty: _dirty, ...settings }: Stored): Settings => settings;

/** How long one interaction with a pet plays (its longest animation, the ball, is 1.2 s): taps meanwhile are ignored,
 * so the same animation (or a friend's greeting) is not started again and again. */
export const PLAY_MS = 1200;

/** What the owner can do with their pet from the menu that opens on a tap. Only play: no EXP, nothing used up. */
export type PetAction = 'pet' | 'feed' | 'play' | 'talk';

export const PET_ACTIONS: { id: PetAction; label: string; icon: 'heart' | 'nutrition' | 'tennisball' | 'chatbubble-ellipses' }[] = [
  { id: 'pet', label: 'Vuốt ve', icon: 'heart' },
  { id: 'feed', label: 'Cho ăn', icon: 'nutrition' },
  { id: 'play', label: 'Chơi cùng', icon: 'tennisball' },
  { id: 'talk', label: 'Trò chuyện', icon: 'chatbubble-ellipses' },
];

const SOUNDS: Record<PetAction, number> = {
  pet: require('../../assets/audio/room-pet.wav'), feed: require('../../assets/audio/room-feed.wav'),
  play: require('../../assets/audio/room-play.wav'), talk: require('../../assets/audio/room-talk.wav'),
};

/** One short sound per interaction, from one player; silent while "Âm thanh" is off. */
export function useRoomSounds(enabled: boolean) {
  const player = useAudioPlayer(null);
  return useCallback((action: PetAction) => {
    if (!enabled) return;
    try {
      player.replace(SOUNDS[action]);
      player.volume = 0.6;
      player.play();
    } catch { /* a missing audio device never breaks the room */ }
  }, [enabled, player]);
}
