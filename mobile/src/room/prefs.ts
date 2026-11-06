import { useCallback, useEffect, useMemo } from 'react';
import { useAudioPlayer } from 'expo-audio';
import { useReduceMotion } from '../components/useReduceMotion';
import { type MotionChoice, observeAccountSettings, useAccountSettings } from '../settings/accountSettings';
import { setMotionPreference } from '../world/budget';

export type { MotionChoice };

// "Giảm chuyển động" reaches the whole world, wherever it was changed (or read back from the account).
observeAccountSettings((_user, settings) => setMotionPreference(settings.motion));

/**
 * "Âm thanh", "Hiệu ứng", "Giảm chuyển động" and the lamps switched by hand: part of the settings that follow the
 * account (settings/accountSettings.ts, which says how they are saved and synced). Effects follow the OS "reduce
 * motion" setting until the user chooses otherwise.
 */
export function useRoomPrefs(userId: number) {
  const osReduce = useReduceMotion();
  const { stored, save } = useAccountSettings(userId);
  useEffect(() => { setMotionPreference(stored.motion ?? 'auto'); }, [stored.motion]);
  const lamps = useMemo(() => stored.lamps ?? {}, [stored.lamps]);
  const setLamp = useCallback((lamp: string, on: boolean) => save((current) => ({ lamps: { ...current.lamps, [lamp]: on } })), [save]);
  return {
    sound: stored.sound ?? true,
    effects: stored.effects ?? !osReduce,
    motion: stored.motion ?? 'auto',
    /** Lamps switched by hand: their placement key and whether on. A lamp not listed follows the time of day. */
    lamps,
    setSound: (value: boolean) => save({ sound: value }),
    setEffects: (value: boolean) => save({ effects: value }),
    setMotion: (value: MotionChoice) => save({ motion: value }),
    setLamp,
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
