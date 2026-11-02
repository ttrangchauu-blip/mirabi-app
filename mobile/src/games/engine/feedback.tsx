import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

// The visual feedback loop shared by every scene game. A learning action goes
//
//   IDLE → INTERACTING → VALIDATING → SUCCESS_ANIMATION | FAILURE_ANIMATION → WORLD_UPDATED → NEXT_CHALLENGE → IDLE
//
// (after a wrong answer, WORLD_UPDATED goes back to INTERACTING: the same challenge goes on). The game screen drives the
// first half: the learner touched the scene, an answer was sent, the backend judged it. The scenes drive the second:
// each reaction they play (the pet's spell, the bridge being crossed, the door opening) is begun and ended here. While a
// critical reaction plays, nothing can be sent, the next challenge waits and the stage does not finish, so the world
// always shows what an answer did before anything else happens. Independent effects (falling words, a bubbling beaker)
// are not reactions and never wait for one.
//
// Guards: one answer at a time (no double submit), the exact answer already judged wrong for a challenge is not sent
// again, a verdict is applied once per request (a retried request or a re-render never replays it), and every reaction
// has a watchdog, so an animation that never reports back (stopped, unmounted, broken) can never jam the game.
// "Bỏ qua" (skip) jumps the skippable reactions to their end state. Plain TypeScript apart from the React hooks at the
// end; the timer is injected so tests can step it.

export type Phase = 'IDLE' | 'INTERACTING' | 'VALIDATING' | 'SUCCESS_ANIMATION' | 'FAILURE_ANIMATION' | 'WORLD_UPDATED' | 'NEXT_CHALLENGE';

export type ReactionOptions = {
  /** Holds the next challenge, new answers and the end of the stage until it ends. Default true. */
  critical?: boolean;
  /** Ended anyway after this long (with `finish`). Default DEFAULT_MAX_MS. */
  maxMs?: number;
  /** Puts the scene in the reaction's end state at once: called on skip and on timeout, never on a normal end. */
  finish?: () => void;
  /** "Bỏ qua" may end it early. Default true. */
  skippable?: boolean;
};

export type SubmitVerdict = 'ok' | 'busy' | 'repeat';
export type Snapshot = { phase: Phase; blocking: boolean; skippable: boolean };

export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** No reaction blocks longer than this unless it says so. */
export const DEFAULT_MAX_MS = 6000;
/** After a verdict, the scene has this long to begin its reaction (it does in the same commit; this covers a scene that
 * has nothing to show, or reduced motion). */
export const GRACE_MS = 250;
const TRAIL_MAX = 40;
const ANIMATING = new Set<Phase>(['SUCCESS_ANIMATION', 'FAILURE_ANIMATION']);

type Reaction = { name: string; critical: boolean; skippable: boolean; finish?: () => void; timer: unknown };

export class FeedbackLoop {
  private phase: Phase = 'IDLE';
  private challenge: string | null = null;
  /** The challenge shown on screen while a reaction still plays: it becomes current once the reactions are over. */
  private waiting: string | null | undefined = undefined;
  private verdict: { correct: boolean; resolved: boolean } | null = null;
  private sent: { challenge: string; answer: string } | null = null;
  private wrongAnswers = new Map<string, Set<string>>();
  private judged = new Set<string>();
  private reactions = new Map<number, Reaction>();
  private seq = 0;
  private graceId: number | null = null;
  private listeners = new Set<() => void>();
  private snap: Snapshot = { phase: 'IDLE', blocking: false, skippable: false };
  private disposed = false;
  /** The phases gone through, latest last (tests and debugging). */
  readonly trail: Phase[] = ['IDLE'];

  constructor(private readonly timers: Timers = REAL_TIMERS) {}

  // --- reading ------------------------------------------------------------------------------------------------------

  get current(): Phase { return this.phase; }
  get blocking(): boolean { for (const r of this.reactions.values()) if (r.critical) return true; return false; }
  get skippable(): boolean { for (const r of this.reactions.values()) if (r.critical && r.skippable) return true; return false; }
  /** The reactions playing, by name (tests and debugging). */
  get playing(): string[] { return [...this.reactions.values()].map((r) => r.name); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): Snapshot => this.snap;

  // --- the game screen ----------------------------------------------------------------------------------------------

  /** The challenge on screen (a turn id; null between two). While a reaction plays it waits; then it becomes current. */
  present(challenge: string | null) {
    if (this.disposed) return;
    if (challenge === this.challenge && this.waiting === undefined) return;
    if (this.blocking || ANIMATING.has(this.phase)) { this.waiting = challenge; return; }
    this.advance(challenge);
  }

  /** The learner is working on the challenge (dragging, typing, choosing). */
  touch() { if (this.phase === 'IDLE') this.go('INTERACTING'); }

  /** An answer is about to be sent: 'ok' (sent, now VALIDATING), 'busy' (one is on its way or the world is still
   * reacting: drop it) or 'repeat' (this exact answer was already judged wrong for this challenge: not sent again).
   * After a wrong answer a fix may be sent as soon as no critical reaction plays (the pieces kept can be moved at once). */
  submit(challenge: string, answer: string): SubmitVerdict {
    if (this.disposed) return 'busy';
    if (this.phase === 'VALIDATING' || this.blocking) return 'busy';
    if (this.wrongAnswers.get(challenge)?.has(answer)) return 'repeat';
    if (challenge !== this.challenge && this.waiting === undefined) this.challenge = challenge;
    this.sent = { challenge, answer };
    this.go('VALIDATING');
    return 'ok';
  }

  /** The answer sent was not judged (a network error, refused): the learner can go on. */
  cancel() {
    if (this.phase !== 'VALIDATING') return;
    this.sent = null;
    this.go('INTERACTING');
  }

  /** The backend's verdict for the request `key` (its event id). Applied once per key: false for one already applied (a
   * retried request answered again), which must not be shown again. `resolved`: the challenge is over (a step of a
   * two-step challenge is right but not resolved). */
  judge(key: string, correct: boolean, resolved = correct): boolean {
    if (this.disposed || this.judged.has(key)) return false;
    this.judged.add(key);
    if (!correct && this.sent) {
      const set = this.wrongAnswers.get(this.sent.challenge) ?? new Set<string>();
      set.add(this.sent.answer);
      this.wrongAnswers.set(this.sent.challenge, set);
    }
    this.sent = null;
    this.verdict = { correct, resolved };
    this.go(correct ? 'SUCCESS_ANIMATION' : 'FAILURE_ANIMATION');
    // The scene begins its reaction in the same commit; until then (and for a scene with none) a challenge solved holds
    // the world briefly. A wrong answer or a step of a challenge never holds it by itself: only a scene's own critical
    // reaction does.
    this.graceId = this.add({ name: 'verdict', critical: correct && resolved, skippable: true, timer: null }, GRACE_MS);
    return true;
  }

  // --- the scenes ---------------------------------------------------------------------------------------------------

  /** A reaction starts playing; call the function returned when it is over (calling it again does nothing). */
  begin(name: string, options: ReactionOptions = {}): () => void {
    if (this.disposed) return () => {};
    const critical = options.critical ?? true;
    const id = this.add({ name, critical, skippable: options.skippable ?? true, finish: options.finish, timer: null },
      options.maxMs ?? DEFAULT_MAX_MS);
    // A critical reaction takes over from the verdict's grace (added first, so the world never settles in between).
    if (critical && this.graceId !== null) { const grace = this.graceId; this.graceId = null; this.remove(grace, false); }
    this.emit();
    return () => this.remove(id, false);
  }

  /** "Bỏ qua": every skippable reaction jumps to its end state now. Returns how many were skipped. */
  skip(): number {
    const ids = [...this.reactions.entries()].filter(([, r]) => r.skippable).map(([id]) => id);
    for (const id of ids) this.remove(id, true);
    return ids.length;
  }

  /** The game screen is gone: no timer is left behind. */
  dispose() {
    this.disposed = true;
    for (const r of this.reactions.values()) this.timers.clear(r.timer);
    this.reactions.clear();
    this.listeners.clear();
  }

  // --- inside -------------------------------------------------------------------------------------------------------

  private add(reaction: Reaction, maxMs: number): number {
    const id = ++this.seq;
    reaction.timer = this.timers.set(() => this.remove(id, true), maxMs);
    this.reactions.set(id, reaction);
    return id;
  }

  private remove(id: number, finish: boolean) {
    const reaction = this.reactions.get(id);
    if (!reaction) return;
    this.reactions.delete(id);
    if (this.graceId === id) this.graceId = null;
    this.timers.clear(reaction.timer);
    if (finish && reaction.finish) {
      try { reaction.finish(); } catch { /* a broken scene never jams the game */ }
    }
    this.settle();
    this.emit();
  }

  /** The reactions are over: the world shows its new state, then the next challenge (or the same one, after a wrong
   * answer) can be played. */
  private settle() {
    if (this.blocking || !ANIMATING.has(this.phase)) return;
    this.go('WORLD_UPDATED');
    const verdict = this.verdict;
    this.verdict = null;
    if (this.waiting !== undefined && this.waiting !== this.challenge) { this.advance(this.waiting); return; }
    this.waiting = undefined;
    if (!verdict?.correct || !verdict.resolved) this.go('INTERACTING');
  }

  private advance(challenge: string | null) {
    this.waiting = undefined;
    if (challenge !== this.challenge) {
      this.challenge = challenge;
      this.go('NEXT_CHALLENGE');
    }
    this.go('IDLE');
  }

  private go(phase: Phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.trail.push(phase);
    if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
    this.emit();
  }

  private emit() {
    const next: Snapshot = { phase: this.phase, blocking: this.blocking, skippable: this.skippable };
    if (next.phase === this.snap.phase && next.blocking === this.snap.blocking && next.skippable === this.snap.skippable) return;
    this.snap = next;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The key of an answer (to recognise the same answer sent again). */
export const answerText = (answer: string | string[]) => (Array.isArray(answer) ? answer.join('␟') : answer.trim().toLowerCase());

// --- React ---------------------------------------------------------------------------------------------------------

const FeedbackContext = createContext<FeedbackLoop | null>(null);
/** Outside a game screen (the guides' demos, tests of one scene) the reactions go nowhere. */
const DETACHED = new FeedbackLoop({ set: () => null, clear: () => {} });

export function FeedbackProvider({ loop, children }: { loop: FeedbackLoop; children: React.ReactNode }) {
  return <FeedbackContext.Provider value={loop}>{children}</FeedbackContext.Provider>;
}

export const useFeedbackLoop = () => useContext(FeedbackContext) ?? DETACHED;

/** The loop's phase, whether it blocks and whether it can be skipped; re-renders only when one of them changes. */
export function useFeedbackState(loop: FeedbackLoop): Snapshot {
  return useSyncExternalStore(loop.subscribe, loop.getSnapshot, loop.getSnapshot);
}

/** A scene's reactions: `begin` as on the loop, and whatever is still playing is ended when the scene goes away. */
export function useReactions() {
  const loop = useFeedbackLoop();
  const open = useRef(new Set<() => void>());
  useEffect(() => () => { for (const end of [...open.current]) end(); open.current.clear(); }, [loop]);
  return useMemo(() => ({
    begin(name: string, options?: ReactionOptions): () => void {
      const end = loop.begin(name, options);
      const done = () => { if (open.current.delete(done)) end(); };
      open.current.add(done);
      return done;
    },
  }), [loop]);
}
