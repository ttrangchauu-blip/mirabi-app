import type { TutorialStep } from './registry';

/**
 * The tutorial's state machine. It only decides which step the learner is on and what is said; the game itself (the
 * real GameScreen, fed by the demo session in demoSession.ts) plays every move. Pure, so it is tested on its own.
 *
 *   NOT_STARTED → INTRO → DEMONSTRATING → WAITING_FOR_ACTION → VALIDATING_ACTION → STEP_COMPLETED → INTRO (next step)
 *                                                       ↑______ wrong: retry feedback ______|           → TUTORIAL_COMPLETED
 *   any step → SKIPPED ("Bỏ qua", kept apart from completed)
 *
 * A wrong action never moves on and never skips a step: the step stays, with its short retry feedback, until it is done.
 */
export type TutorialState = 'NOT_STARTED' | 'INTRO' | 'DEMONSTRATING' | 'WAITING_FOR_ACTION' | 'VALIDATING_ACTION' | 'STEP_COMPLETED'
  | 'TUTORIAL_COMPLETED' | 'SKIPPED';

export type TutorialEvent =
  | { type: 'start' }
  /** The instruction has been shown; the demo animation (if any) plays next. */
  | { type: 'intro_done'; animate: boolean }
  | { type: 'demo_done' }
  /** "Tiếp" on an observe step, or its time is up. */
  | { type: 'next' }
  /** An answer is on its way to be checked. */
  | { type: 'submitted' }
  /** The check came back: right or wrong (a step done in two parts, like finding a misspelled word, is right but not
   * resolved yet). */
  | { type: 'answer'; correct: boolean }
  /** No result (a refused or failed request): the learner tries again. */
  | { type: 'failed' }
  | { type: 'miss' }
  | { type: 'continue' }
  /** The success feedback has been shown. */
  | { type: 'step_done' }
  | { type: 'skip' };

export type Feedback = { text: string; tone: 'good' | 'bad' } | null;
export type TutorialSnapshot = { state: TutorialState; index: number; feedback: Feedback; done: string[]; attempts: number };

export const INITIAL: TutorialSnapshot = { state: 'NOT_STARTED', index: 0, feedback: null, done: [], attempts: 0 };

const ACTIVE = new Set<TutorialState>(['INTRO', 'DEMONSTRATING', 'WAITING_FOR_ACTION', 'VALIDATING_ACTION']);
const DEFAULT_RETRY = 'Chưa đúng, thử lại nhé!';

/** Whether the step waits for the learner to look (input held) rather than to act. */
export const watching = (step: TutorialStep | undefined) => step?.action === 'observe';

function complete(s: TutorialSnapshot, step: TutorialStep): TutorialSnapshot {
  return { ...s, state: 'STEP_COMPLETED', feedback: step.success_feedback ? { text: step.success_feedback, tone: 'good' } : null,
    done: s.done.includes(step.id) ? s.done : [...s.done, step.id] };
}

function retry(s: TutorialSnapshot, step: TutorialStep): TutorialSnapshot {
  return { ...s, state: 'WAITING_FOR_ACTION', feedback: { text: step.retry_feedback || DEFAULT_RETRY, tone: 'bad' }, attempts: s.attempts + 1 };
}

export function reduce(steps: readonly TutorialStep[], s: TutorialSnapshot, e: TutorialEvent): TutorialSnapshot {
  if (s.state === 'TUTORIAL_COMPLETED' || s.state === 'SKIPPED') return s;
  if (e.type === 'skip') return { ...s, state: 'SKIPPED', feedback: null };
  if (e.type === 'start') return s.state === 'NOT_STARTED' ? { ...INITIAL, state: steps.length ? 'INTRO' : 'TUTORIAL_COMPLETED' } : s;
  const step = steps[s.index];
  if (!step) return s;
  if (e.type === 'step_done') {
    if (s.state !== 'STEP_COMPLETED') return s;
    const index = s.index + 1;
    return index >= steps.length ? { ...s, state: 'TUTORIAL_COMPLETED', feedback: null }
      : { ...s, state: 'INTRO', index, feedback: null, attempts: 0 };
  }
  if (!ACTIVE.has(s.state)) return s;
  switch (e.type) {
    case 'intro_done':
      return s.state === 'INTRO' ? { ...s, state: e.animate && step.demo_animation !== 'none' ? 'DEMONSTRATING' : 'WAITING_FOR_ACTION' } : s;
    case 'demo_done':
      return s.state === 'DEMONSTRATING' ? { ...s, state: 'WAITING_FOR_ACTION' } : s;
    case 'next':
      return step.expected_action === 'next' ? complete(s, step) : s;
    case 'continue':
      return step.expected_action === 'continue' ? complete(s, step) : s;
    case 'submitted':
      // The learner acts (also before the demo has finished): the answer is being checked, the feedback clears.
      return step.expected_action === 'answer' ? { ...s, state: 'VALIDATING_ACTION', feedback: null } : s;
    case 'failed':
      return s.state === 'VALIDATING_ACTION' ? { ...s, state: 'WAITING_FOR_ACTION' } : s;
    case 'answer':
      if (step.expected_action !== 'answer') return s;
      return e.correct || step.expected_result === 'any' ? complete(s, step) : retry(s, step);
    case 'miss':
      if (step.expected_action === 'miss') return complete(s, step);
      return step.expected_action === 'answer' ? retry(s, step) : s;
    default:
      return s;
  }
}
