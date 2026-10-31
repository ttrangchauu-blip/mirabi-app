import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useReactions } from '../engine/feedback';
import type { GameWorld, LearningSession, Turn } from '../../learning/types';
import { ERA_ARTIFACTS, ERAS, type ArtifactKind, type Era } from '../art/timeTravel';
import { PLANET_KINDS, type PlanetKind } from '../art/space';

// The worlds a lesson's own games (Sắp xếp, Ghép cặp, Chọn đáp án, Phân loại) are played in: a drawn scene above the
// game that moves on with every right answer and reacts to every wrong one. The backend names the world of the lesson
// (`catalog.world`, lesson_catalog.world_of); an older backend's session falls back to the subject's. The rules of each
// world's progress are pure functions here, so they can be tested without drawing anything.

export type World = GameWorld;
export const WORLD_NAME: Record<World, string> = { kingdom: 'Math Kingdom', space: 'Space Adventure', forest: 'Word Forest', lab: 'Magic Laboratory',
  time: 'Time Traveler', map: 'Treasure Explorer' };
const SUBJECT_WORLD: Partial<Record<string, World>> = { math: 'kingdom', english: 'space', vietnamese: 'forest', science: 'lab', physics: 'lab',
  chemistry: 'lab', biology: 'lab', history: 'time', geography: 'map', history_geography: 'time' };

/** The turns played under a world's scene (the lesson games that are cards and buttons on their own). */
export const QUEST_KINDS = new Set<Turn['kind']>(['order_steps', 'match_pairs', 'choice_explain', 'sort_card']);

export function worldOf(session: Pick<LearningSession, 'subject' | 'catalog'>): World | null {
  const named = session.catalog?.world;
  if (named !== undefined) return named ?? null;
  return SUBJECT_WORLD[session.subject.code] ?? null;
}

/** Transforms and opacity of the scenes' own effects run on the native thread (not the web, which has none). */
export const NATIVE = Platform.OS !== 'web';

/** How long a world's reaction may hold the next question at most (it normally reports its own end). */
export const QUEST_RIGHT_MAX_MS = 4500;
export const QUEST_WRONG_MAX_MS = 2000;

/** The part of a right answer's reaction that brings the next challenge in (the next monster, asteroid, era, door). It
 * gets its own `end`. */
export type Advance = (enter: (end: () => void) => void) => void;

/** Holds the next challenge of a world while `hold` is on (the answered question waits for "Câu tiếp theo"): the answer's
 * own reaction plays at once, but what brings the next challenge in (`advance`) waits until `hold` goes off. A held
 * reaction ends where it stops (so the explanation shows); the entrance is then a reaction of its own. */
export function useAdvance(hold: boolean) {
  const reactions = useReactions();
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const queued = useRef<((end: () => void) => void) | null>(null);
  useEffect(() => {
    if (hold || !queued.current) return;
    const enter = queued.current;
    queued.current = null;
    enter(reactions.begin('world:next', { maxMs: QUEST_RIGHT_MAX_MS }));
  }, [hold]); // eslint-disable-line react-hooks/exhaustive-deps
  /** `advance` for the reaction ended by `end`: the entrance plays now (and ends that reaction), or once released. */
  return (end: () => void): Advance => (enter) => {
    if (!holdRef.current) { enter(end); return; }
    end();
    queued.current = enter;
  };
}

/** Calls `onRight` when `done` goes up and `onWrong` when `wrongKey` changes (never for the values at mount). Each is a
 * reaction of the feedback loop (games/engine/feedback.ts): the handler calls `end` once the world shows the result
 * (the explanation and the next question wait for it; a reaction that never ends is ended after its maximum). What
 * brings the next challenge in goes through `advance`, which waits for "Câu tiếp theo" while `hold` is on. */
export function useQuestEvents(done: number, wrongKey: number,
  onRight: (done: number, before: number, end: () => void, advance: Advance) => void, onWrong: (end: () => void) => void, hold = false) {
  const lastDone = useRef(done);
  const lastWrong = useRef(wrongKey);
  const handlers = useRef({ onRight, onWrong });
  handlers.current = { onRight, onWrong };
  const reactions = useReactions();
  const advanceFor = useAdvance(hold);
  useEffect(() => {
    const before = lastDone.current;
    lastDone.current = done;
    if (done <= before) return;
    const end = reactions.begin('world:right', { maxMs: QUEST_RIGHT_MAX_MS });
    handlers.current.onRight(done, before, end, advanceFor(end));
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wrongKey === lastWrong.current) return;
    lastWrong.current = wrongKey;
    // Felt in the world, but never holding the lesson game: the learner fixes the answer at once.
    handlers.current.onWrong(reactions.begin('world:wrong', { critical: false, maxMs: QUEST_WRONG_MAX_MS }));
  }, [wrongKey]); // eslint-disable-line react-hooks/exhaustive-deps
}

// --- Space Adventure ------------------------------------------------------------------------------------------------

/** The planets of a trip: 1 for a short stage, 2 from 4 questions, 3 from 9. */
export const planetCount = (total: number) => (total >= 9 ? 3 : total >= 4 ? 2 : 1);
/** The planets rescued after `done` right answers of `total`. */
export const planetsRescued = (done: number, total: number) => (total <= 0 ? 0 : Math.floor((Math.min(done, total) * planetCount(total)) / total));
export const planetKind = (i: number): PlanetKind => PLANET_KINDS[i % PLANET_KINDS.length];

// --- Time Traveler --------------------------------------------------------------------------------------------------

/** The eras of a trip: one per three questions, at least 1, at most 4, from the oldest. */
export const tripEras = (total: number): Era[] => ERAS.slice(0, Math.max(1, Math.min(ERAS.length, Math.ceil(total / 3))));
/** The era the pet is in after `done` right answers (the last one once the trip is done). */
export function eraIndex(done: number, total: number): number {
  const n = tripEras(total).length;
  if (total <= 0) return 0;
  return Math.min(n - 1, Math.floor((Math.min(done, total) * n) / total));
}
/** The artifacts found after `done` right answers: each comes from the era it was dug up in. */
export function artifactsFound(done: number, total: number): ArtifactKind[] {
  const eras = tripEras(total);
  const seen = new Map<number, number>();
  return Array.from({ length: Math.min(done, total) }, (_, k) => {
    const e = eraIndex(k, total);
    const i = seen.get(e) ?? 0;
    seen.set(e, i + 1);
    const list = ERA_ARTIFACTS[eras[e]];
    return list[i % list.length];
  });
}

// --- Magic Laboratory -----------------------------------------------------------------------------------------------

/** How full the potion is (0 → 1). */
export const potionLevel = (done: number, total: number) => (total <= 0 ? 0 : Math.min(1, done / total));
