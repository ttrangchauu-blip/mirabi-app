import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { DemoSession } from './demoSession';
import { INITIAL, reduce, TutorialEvent, watching } from './machine';
import type { TutorialDefinition } from './registry';

/** How long each phase lasts on screen (ms). With reduced motion there is no demo animation and no wait for one. */
export const TIMING = { intro: 650, demo: 1900, success: 1400, quiet: 350 };

/**
 * Runs a tutorial's state machine against its demo session: each step brings in its demo turns, the instruction shows,
 * the demo animation plays, then the learner acts in the real game; the checked answer (or a landing, or a closed
 * explanation) moves the step on, or keeps it with its retry feedback. `onStep` is told each step reached (to save
 * where the tutorial was left).
 */
export function useTutorialController(def: TutorialDefinition, demo: DemoSession, reduceMotion: boolean, onStep?: (index: number) => void) {
  const [snap, dispatch] = useReducer((s: typeof INITIAL, e: TutorialEvent) => reduce(def.steps, s, e), INITIAL);
  const step = def.steps[snap.index];
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => { dispatch({ type: 'start' }); }, []);
  // The game's answers, landings and failures drive the machine.
  useEffect(() => demo.onEvent((e) => {
    if (e.type === 'submitted') dispatch({ type: 'submitted' });
    else if (e.type === 'answer') dispatch({ type: 'answer', correct: e.correct });
    else if (e.type === 'failed') dispatch({ type: 'failed' });
    else if (e.type === 'miss') dispatch({ type: 'miss' });
  }), [demo]);

  // A step starts: its demo turns come into the game (once), and where the tutorial is gets saved.
  const started = useRef(-1);
  useEffect(() => {
    if (snap.state !== 'INTRO' || started.current === snap.index || !step) return;
    started.current = snap.index;
    demo.release(step.release, step.fall_seconds);
    onStepRef.current?.(snap.index);
  }, [snap.state, snap.index, step, demo]);

  // The phases' own timers. Each is cleared when the phase changes, so nothing runs on after it (or after leaving).
  useEffect(() => {
    if (!step) return;
    let delay: number | null = null;
    let event: TutorialEvent | null = null;
    if (snap.state === 'INTRO') { delay = reduceMotion ? 0 : TIMING.intro; event = { type: 'intro_done', animate: !reduceMotion }; }
    else if (snap.state === 'DEMONSTRATING') { delay = TIMING.demo; event = { type: 'demo_done' }; }
    else if (snap.state === 'STEP_COMPLETED') { delay = snap.feedback ? TIMING.success : TIMING.quiet; event = { type: 'step_done' }; }
    if (delay === null || !event) return;
    const fire = event;
    const timer = setTimeout(() => dispatch(fire), delay);
    return () => clearTimeout(timer);
  }, [snap.state, snap.index, snap.feedback, step, reduceMotion]);

  // An observe step may move on by itself once it has been watched long enough.
  useEffect(() => {
    if (!step || step.expected_action !== 'next' || !step.advance_ms || snap.state === 'STEP_COMPLETED') return;
    const timer = setTimeout(() => dispatch({ type: 'next' }), step.advance_ms);
    return () => clearTimeout(timer);
  }, [snap.index, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);
  /** Something done in the game outside an answer: the explanation closed. */
  const onGameEvent = useCallback((event: 'continue') => dispatch({ type: event }), []);

  const active = snap.state !== 'TUTORIAL_COMPLETED' && snap.state !== 'SKIPPED' && snap.state !== 'NOT_STARTED';
  return { snap, step, next, skip, onGameEvent,
    /** The game's input is held while a step only asks to watch (a tap on the game does nothing then). */
    holdInput: active && watching(step) };
}

export type TutorialController = ReturnType<typeof useTutorialController>;
