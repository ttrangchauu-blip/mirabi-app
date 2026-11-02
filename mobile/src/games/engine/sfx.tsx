import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useAudioPlayer } from 'expo-audio';

// The sound effects of the scene games: one short cue per thing that happens (a spell, a hit, an item picked up, a door
// or portal opening, a level done, a gentle "not yet"). The game screen owns one player per cue and hands `play` down
// through context, so a scene never makes players of its own. Silent while "Âm thanh" is off; the volume is the
// learner's (Nhỏ / Vừa / Lớn). The gate keeps it calm: the same cue never restarts within GAP_MS, and at most
// MAX_TOGETHER cues start within WINDOW_MS (the rest are dropped, not queued). Sources: scripts/generate-game-sfx.py,
// plus the shooters' own shot and break.

export type Cue = 'cast' | 'hit' | 'pickup' | 'unlock' | 'complete' | 'wrong' | 'whoosh' | 'shot' | 'break';
export type Volume = 'low' | 'mid' | 'high';

const SOURCES: Record<Cue, number> = {
  cast: require('../../../assets/audio/sfx-cast.wav'),
  hit: require('../../../assets/audio/sfx-hit.wav'),
  pickup: require('../../../assets/audio/sfx-pickup.wav'),
  unlock: require('../../../assets/audio/sfx-unlock.wav'),
  complete: require('../../../assets/audio/sfx-complete.wav'),
  wrong: require('../../../assets/audio/sfx-wrong.wav'),
  whoosh: require('../../../assets/audio/sfx-whoosh.wav'),
  shot: require('../../../assets/audio/game-shot.wav'),
  break: require('../../../assets/audio/game-break.wav'),
};
/** Each cue's own loudness, so none stands out; multiplied by the learner's volume. */
const MIX: Record<Cue, number> = { cast: 0.5, hit: 0.55, pickup: 0.5, unlock: 0.55, complete: 0.6, wrong: 0.45, whoosh: 0.5, shot: 0.35, break: 0.5 };
export const VOLUME_LEVEL: Record<Volume, number> = { low: 0.4, mid: 0.7, high: 1 };
export const VOLUME_LABEL: Record<Volume, string> = { low: 'Nhỏ', mid: 'Vừa', high: 'Lớn' };

export const GAP_MS = 90;
export const WINDOW_MS = 160;
export const MAX_TOGETHER = 2;

/** Decides which cues may start: pure, with the time passed in. */
export function createSoundGate() {
  const last = new Map<Cue, number>();
  let recent: number[] = [];
  return (cue: Cue, now: number): boolean => {
    const before = last.get(cue);
    if (before !== undefined && now - before < GAP_MS) return false;
    recent = recent.filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_TOGETHER) return false;
    recent.push(now);
    last.set(cue, now);
    return true;
  };
}

export type PlayCue = (cue: Cue) => void;
const SfxContext = createContext<PlayCue>(() => {});
/** The `play` of the game screen around this scene (silent outside one). */
export const useSfx = () => useContext(SfxContext);

/** One player per cue for the whole game screen. */
export function useSfxPlayers(enabled: boolean, volume: Volume): PlayCue {
  const players: Record<Cue, ReturnType<typeof useAudioPlayer>> = {
    cast: useAudioPlayer(SOURCES.cast), hit: useAudioPlayer(SOURCES.hit), pickup: useAudioPlayer(SOURCES.pickup),
    unlock: useAudioPlayer(SOURCES.unlock), complete: useAudioPlayer(SOURCES.complete), wrong: useAudioPlayer(SOURCES.wrong),
    whoosh: useAudioPlayer(SOURCES.whoosh), shot: useAudioPlayer(SOURCES.shot), break: useAudioPlayer(SOURCES.break),
  };
  const ref = useRef(players);
  ref.current = players;
  const gate = useMemo(createSoundGate, []);
  return useCallback((cue: Cue) => {
    if (!enabled || !gate(cue, Date.now())) return;
    const player = ref.current[cue];
    try {
      player.volume = MIX[cue] * VOLUME_LEVEL[volume];
      void player.seekTo?.(0);
      player.play();
    } catch { /* a missing audio device never breaks the game */ }
  }, [enabled, volume, gate]);
}

export function SfxProvider({ play, children }: { play: PlayCue; children: React.ReactNode }) {
  return <SfxContext.Provider value={play}>{children}</SfxContext.Provider>;
}
