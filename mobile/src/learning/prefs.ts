import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { useReduceMotion } from '../components/useReduceMotion';
// A `mode` saved by older versions (Học tập / Thử thách) is ignored: every game now plays in Học tập.
type Stored = { sound?: boolean; reduceMotion?: boolean };

/** Sound and "giảm chuyển động" for the learning games, saved per account
 * on this device. Reduced motion follows the OS setting until the user chooses otherwise. */
export function useLearningPrefs(userId: number) {
  const osReduce = useReduceMotion();
  const key = `mirabi.learning.prefs:${userId}`;
  const [stored, setStored] = useState<Stored>({});
  const latest = useRef<Stored>({});
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key).then((raw) => {
      if (!active || !raw) return;
      try { latest.current = JSON.parse(raw); setStored(latest.current); } catch { /* ignore a corrupt value */ }
    }).catch(() => {});
    return () => { active = false; };
  }, [key]);
  const save = useCallback((patch: Stored) => {
    latest.current = { ...latest.current, ...patch };
    setStored(latest.current);
    void AsyncStorage.setItem(key, JSON.stringify(latest.current)).catch(() => {});
  }, [key]);
  const sound = stored.sound ?? true;
  return {
    sound,
    reduceMotion: stored.reduceMotion ?? osReduce,
    setSound: (value: boolean) => { if (!value) void Speech.stop(); save({ sound: value }); },
    setReduceMotion: (value: boolean) => save({ reduceMotion: value }),
  };
}

export type LearningPrefs = ReturnType<typeof useLearningPrefs>;

/** English pronunciation through the device's text-to-speech voice (no audio files to ship). */
export function speakEnglish(text: string, prefs: { sound: boolean }) {
  if (!prefs.sound || !text) return;
  void Speech.stop();
  Speech.speak(text, { language: 'en-US', rate: 0.85 });
}
