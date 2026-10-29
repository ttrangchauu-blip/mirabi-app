import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import { useReduceMotion } from '../components/useReduceMotion';

type Stored = { sound?: boolean; effects?: boolean };

/** "Âm thanh" and "Hiệu ứng" of the personal room, saved per account on this device. Effects follow the OS
 * "reduce motion" setting until the user chooses otherwise. */
export function useRoomPrefs(userId: number) {
  const osReduce = useReduceMotion();
  const key = `mirabi.room.prefs:${userId}`;
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
  return {
    sound: stored.sound ?? true,
    effects: stored.effects ?? !osReduce,
    setSound: (value: boolean) => save({ sound: value }),
    setEffects: (value: boolean) => save({ effects: value }),
  };
}

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
