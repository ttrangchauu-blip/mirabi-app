import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform } from 'react-native';

// How every game answered one question at a time moves from one question to the next:
//
//   ANSWERING → FEEDBACK → TRANSITIONING → NEXT_QUESTION → ANSWERING
//
// ANSWERING: the learner plays. FEEDBACK: the answer is judged, the question stays on screen (locked) with its result,
// the right answer, the explanation and "Tiếp theo"; nothing moves on by itself. TRANSITIONING: "Tiếp theo" was pressed,
// the question fades away and nothing can be touched. NEXT_QUESTION: the question answered is let go, the game screen
// clears what belonged to it and the next one fades in. The backend owns the session and has already opened the next
// question when it judged the answer, so moving on sends nothing and cannot skip or repeat anything.
//
// Separate from the feedback loop (feedback.tsx), which holds the game while a scene's own animation plays: the scenes
// know nothing about this flow. Guards: one press moves on once, a callback of an animation that was replaced is ignored
// (each transition has its own number) and every step has a watchdog, so an animation that never reports back can never
// jam the game. Plain TypeScript apart from the hooks at the end; the timer is injected so tests can step it.

export type FlowPhase = 'ANSWERING' | 'FEEDBACK' | 'TRANSITIONING' | 'NEXT_QUESTION';
export type FlowSnapshot<T> = { phase: FlowPhase; held: T | null; transition: number };

export type FlowTimers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const REAL_TIMERS: FlowTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The question leaves in this long and the next one comes in in this long: 400 ms in all. */
export const LEAVE_MS = 170;
export const ENTER_MS = 230;
/** A step of the transition is ended anyway after this long. */
export const STEP_MAX_MS = 1000;
const TRAIL_MAX = 40;

export class QuestionFlow<T> {
  private snap: FlowSnapshot<T> = { phase: 'ANSWERING', held: null, transition: 0 };
  private watchdog: unknown = null;
  private listeners = new Set<() => void>();
  /** The phases gone through, latest last (tests and debugging). */
  readonly trail: FlowPhase[] = ['ANSWERING'];

  constructor(private readonly timers: FlowTimers = REAL_TIMERS) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): FlowSnapshot<T> => this.snap;

  /** An answer was judged and the question is over: it stays on screen with `held` until "Tiếp theo". False while another
   * question is still held (a late reply): it is not shown over it. */
  answered(held: T): boolean {
    if (this.snap.phase !== 'ANSWERING') return false;
    this.go('FEEDBACK', held);
    return true;
  }

  /** "Tiếp theo". False for anything but the first press. `instant`: no transition (nothing on screen is replaced). */
  next(instant = false): boolean {
    if (this.snap.phase !== 'FEEDBACK') return false;
    if (instant) { this.go('ANSWERING', null); return true; }
    this.snap = { ...this.snap, transition: this.snap.transition + 1 };
    this.go('TRANSITIONING', this.snap.held);
    return true;
  }

  /** The question has left the screen (for transition `transition`). */
  left(transition: number) {
    if (transition !== this.snap.transition || this.snap.phase !== 'TRANSITIONING') return;
    this.go('NEXT_QUESTION', null);
  }

  /** The next question has come in (for transition `transition`). */
  entered(transition: number) {
    if (transition !== this.snap.transition || this.snap.phase !== 'NEXT_QUESTION') return;
    this.go('ANSWERING', null);
  }

  /** The game screen is gone: no timer is left behind. */
  dispose() {
    this.timers.clear(this.watchdog);
    this.watchdog = null;
  }

  private go(phase: FlowPhase, held: T | null) {
    this.snap = { ...this.snap, phase, held };
    this.trail.push(phase);
    if (this.trail.length > TRAIL_MAX) this.trail.splice(0, this.trail.length - TRAIL_MAX);
    this.timers.clear(this.watchdog);
    this.watchdog = null;
    if (phase === 'TRANSITIONING' || phase === 'NEXT_QUESTION') {
      const transition = this.snap.transition;
      this.watchdog = this.timers.set(() => (phase === 'TRANSITIONING' ? this.left(transition) : this.entered(transition)), STEP_MAX_MS);
    }
    for (const listener of [...this.listeners]) listener();
  }
}

// --- React ---------------------------------------------------------------------------------------------------------

const NATIVE = Platform.OS !== 'web';

/** The flow of a game screen, one for its whole life. */
export function useQuestionFlow<T>() {
  const ref = useRef<QuestionFlow<T> | null>(null);
  const flow = (ref.current ??= new QuestionFlow<T>());
  useEffect(() => () => flow.dispose(), [flow]);
  const snap = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  return { flow, snap };
}

/** Plays the transition (reduced motion: none) and returns the style of what fades: the question, not the game around it. */
export function useQuestionStage<T>(flow: QuestionFlow<T>, snap: FlowSnapshot<T>, reduceMotion?: boolean) {
  const opacity = useRef(new Animated.Value(1)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const { phase, transition } = snap;
  useEffect(() => {
    if (phase !== 'TRANSITIONING' && phase !== 'NEXT_QUESTION') return;
    const leaving = phase === 'TRANSITIONING';
    const done = () => (leaving ? flow.left(transition) : flow.entered(transition));
    if (reduceMotion) { opacity.setValue(1); shift.setValue(0); done(); return; }
    if (!leaving) { opacity.setValue(0); shift.setValue(10); }
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: leaving ? 0 : 1, duration: leaving ? LEAVE_MS : ENTER_MS, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(shift, { toValue: leaving ? -8 : 0, duration: leaving ? LEAVE_MS : ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
    ]);
    anim.start(done);
    return () => anim.stop();
  }, [phase, transition, reduceMotion, flow, opacity, shift]);
  return { opacity, transform: [{ translateY: shift }] };
}
