import { useCallback, useReducer } from 'react';
import type { ActName } from './motion';

/**
 * What the pet is doing, in one place. The scenes send events; only the moves listed here happen, so the pet can't play
 * two things at once, skip back to the wrong state or get stuck. Weather and the time of day are not events: they
 * change the world around the pet and never touch this state.
 */
export type PetState = 'idle' | 'walk' | 'interact' | 'celebrate' | 'study' | 'rest' | 'away';
export type PetEvent = 'WALK' | 'ARRIVE' | 'INTERACT' | 'CELEBRATE' | 'DONE' | 'STUDY' | 'REST' | 'WAKE' | 'LEAVE' | 'RETURN';

const MOVES: Record<PetState, Partial<Record<PetEvent, PetState>>> = {
  idle: { WALK: 'walk', INTERACT: 'interact', CELEBRATE: 'celebrate', STUDY: 'study', REST: 'rest', LEAVE: 'away' },
  walk: { ARRIVE: 'idle', INTERACT: 'interact', STUDY: 'study', REST: 'rest', LEAVE: 'away' },
  interact: { DONE: 'idle', STUDY: 'study', REST: 'rest', LEAVE: 'away' },
  celebrate: { DONE: 'idle', LEAVE: 'away' },
  study: { WAKE: 'idle', REST: 'rest', LEAVE: 'away' },
  rest: { WAKE: 'idle', STUDY: 'study', LEAVE: 'away' },
  away: { RETURN: 'idle' },
};

/** The next state, or the same one when this event means nothing now. */
export const nextPetState = (state: PetState, event: PetEvent): PetState => MOVES[state][event] ?? state;

/** Which drawn strip each state plays. An act (below) moves the whole body on top of it; no state adds or removes parts
 * of the pet: everything it can do comes from its own artwork or a transform of it. */
export function artFor(state: PetState): { walking: boolean; studying: boolean; still: boolean } {
  return { walking: state === 'walk', studying: state === 'study', still: state === 'rest' };
}

export const ACT_OF_INTERACTION: Record<'pet' | 'feed' | 'play' | 'talk', ActName> = { pet: 'lean', feed: 'nibble', play: 'pounce', talk: 'hop' };

export function usePetMachine(initial: PetState = 'idle') {
  const [state, dispatch] = useReducer(nextPetState, initial);
  const send = useCallback((event: PetEvent) => dispatch(event), []);
  return [state, send] as const;
}
