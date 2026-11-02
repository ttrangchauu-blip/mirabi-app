import type { GameId, Turn } from '../types';

/**
 * What a tutorial step may ask for, point at and play. The backend's definitions (backend app/game_tutorials.py:
 * ACTIONS, TARGETS, EXPECTED_ACTIONS, EXPECTED_RESULTS, ANIMATIONS) only name these: keep both lists in step. A step is
 * data, never code: the app does every action with the game's own controls and draws every animation from here.
 */
export const ACTIONS = ['observe', 'tap', 'drag', 'type', 'submit', 'connect', 'aim', 'interact'] as const;
/** Regions of the game screen: the HUD, the question card, the play area, the falling word aimed at, the input under
 * the play area (number pad), or nothing. */
export const TARGETS = ['header', 'prompt', 'play', 'aimed', 'input', 'none'] as const;
/** next: the learner taps "Tiếp" (or it moves on by itself); answer: an answer is checked; miss: a falling target lands;
 * continue: the explanation of an answer is closed ("Câu tiếp theo", "Thí nghiệm tiếp theo"). */
export const EXPECTED_ACTIONS = ['next', 'answer', 'miss', 'continue'] as const;
export const EXPECTED_RESULTS = ['correct', 'any'] as const;
export const ANIMATIONS = ['none', 'arrow', 'pulse', 'hand_tap', 'hand_drag', 'hand_type', 'watch'] as const;

export type TutorialAction = (typeof ACTIONS)[number];
export type TutorialTarget = (typeof TARGETS)[number];
export type ExpectedAction = (typeof EXPECTED_ACTIONS)[number];
export type DemoAnimation = (typeof ANIMATIONS)[number];

export type TutorialStep = {
  id: string;
  action: TutorialAction;
  instruction: string;
  target: TutorialTarget;
  expected_action: ExpectedAction;
  expected_result: (typeof EXPECTED_RESULTS)[number];
  demo_animation: DemoAnimation;
  success_feedback?: string;
  retry_feedback?: string;
  /** Demo turns that come into the game when the step starts. */
  release: string[];
  /** Falling words released by this step fall to the ground in this many seconds (else they drift in and wait). */
  fall_seconds?: number;
  /** An observe step moves on by itself after this long (it can always be moved on with "Tiếp"). */
  advance_ms?: number;
};

/** A game's tutorial as the backend serves it (GET /api/games/{game}/tutorial): never the answers. */
export type TutorialDefinition = {
  game_id: GameId;
  game_mode: 'practice';
  gameplay_version: number;
  tutorial_version: number;
  subject: string;
  hearts: number;
  skippable: boolean;
  done_title: string;
  /** At most two short lines shown with "Bắt đầu chơi". */
  ready: string[];
  steps: TutorialStep[];
  demo: Turn[];
};

const has = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/** What in a definition this app cannot play (an older app, a newer server): the tutorial is then not shown at all,
 * rather than shown wrong. Empty when every step is known. */
export function unsupported(def: TutorialDefinition): string[] {
  const problems: string[] = [];
  const ids = new Set(def.demo.map((t) => t.turn_id));
  if (!def.steps.length) problems.push('no steps');
  if (!def.steps.some((s) => s.expected_action === 'answer')) problems.push('no hands-on step');
  def.steps.forEach((s, i) => {
    if (!has(ACTIONS, s.action)) problems.push(`step ${i + 1}: action ${s.action}`);
    if (!has(TARGETS, s.target)) problems.push(`step ${i + 1}: target ${s.target}`);
    if (!has(EXPECTED_ACTIONS, s.expected_action)) problems.push(`step ${i + 1}: expected ${s.expected_action}`);
    if (!has(EXPECTED_RESULTS, s.expected_result)) problems.push(`step ${i + 1}: result ${s.expected_result}`);
    if (!has(ANIMATIONS, s.demo_animation)) problems.push(`step ${i + 1}: animation ${s.demo_animation}`);
    for (const id of s.release ?? []) if (!ids.has(id)) problems.push(`step ${i + 1}: demo ${id}`);
  });
  return problems;
}

/** The steps that need the learner's own action: all of them must be done before the tutorial counts as completed. */
export const handsOnSteps = (def: TutorialDefinition) => def.steps.filter((s) => s.expected_action !== 'next').map((s) => s.id);
