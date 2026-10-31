import type { GameBackend, TurnAction } from '../api';
import { GAME_INFO } from '../labels';
import type { EventResponse, LearningSession, Turn, TurnResult } from '../types';
import type { TutorialCheck } from './api';
import type { TutorialDefinition } from './registry';

/** Something the learner did in the demo, for the tutorial's state machine. */
export type DemoEvent =
  | { type: 'submitted' }
  | { type: 'answer'; correct: boolean; resolved: boolean }
  | { type: 'failed'; error: unknown }
  | { type: 'miss' };

type Check = (turnId: string, answer: string | string[] | null, event?: 'miss') => Promise<TutorialCheck>;

const REF = { id: 0, code: 'tutorial', name: 'Hướng dẫn' };
/** Never a real session id: nothing the game sends can reach a real stage. */
export const DEMO_SESSION_ID = -1;

/**
 * The session of a tutorial, kept on the device: the game screen (Tutorial Mode) plays it exactly as it plays a stage,
 * through the same GameBackend calls. Nothing is sent to a session on the server, so a tutorial can never score, take a
 * real heart, grant EXP or move a lesson on. Answers are still checked by the game's own checker on the server
 * (`check`, POST /api/games/{game}/tutorial/check, which saves nothing).
 *
 * - Demo turns come in when a step releases them (`release`), never by themselves.
 * - A wrong answer in a game that retries keeps the turn open; in a game that reveals (gates, comparisons, choices)
 *   the turn ends with its explanation and comes back once more, as a stage plays it again later.
 * - A falling word that lands takes a demo heart (never below one): the hearts shown are the tutorial's own.
 */
export class DemoSession implements GameBackend {
  private current: LearningSession;
  private listeners = new Set<(session: LearningSession) => void>();
  private eventListeners = new Set<(event: DemoEvent) => void>();
  /** Turn id on screen → demo turn id (a wrong answer in a reveal game comes back under a new id). */
  private origin = new Map<string, string>();
  private copies = 0;

  constructor(private def: TutorialDefinition, private check: Check) {
    const info = GAME_INFO[def.game_id];
    this.current = {
      id: DEMO_SESSION_ID, status: 'active', kind: 'lesson', mode: 'practice', game_type: info.gameType, variant: info.variant,
      game: def.game_id, subject: { ...REF, code: def.subject }, topic: REF, level: REF, lesson: REF,
      duration_seconds: 0, active_ms: 0, remaining_ms: 0, time_up: false, timed: false,
      hearts: def.hearts, hearts_max: def.hearts, score: 0, combo: 0, max_combo: 0,
      required_count: def.demo.length, resolved_count: 0, pending_practice: 0, open_turns: [], can_complete: false,
      end_reason: null, reward: null, version: 1, server_time: new Date().toISOString(), catalog: null,
    };
  }

  get snapshot() { return this.current; }

  // ------------------------------------------------------------------------------------------- the tutorial's side
  /** Brings demo turns into the game (a step starts). Falling words fall to the ground in `fallSeconds`, else drift in
   * and wait. A turn already in the game is never added twice. */
  release(ids: readonly string[], fallSeconds?: number) {
    const fresh = ids.map((id) => this.def.demo.find((t) => t.turn_id === id)).filter((t): t is Turn => !!t && !this.origin.has(t.turn_id));
    if (!fresh.length) return;
    for (const t of fresh) this.origin.set(t.turn_id, t.turn_id);
    const turns = fresh.map((t) => ({ ...t, travel_seconds: fallSeconds ?? 0 }));
    this.update({ open_turns: [...this.current.open_turns, ...turns] }, true);
  }

  onEvent(listener: (event: DemoEvent) => void) {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  /** The game is left: nothing it still sends changes anything. */
  close() { this.listeners.clear(); this.eventListeners.clear(); }

  private emit(event: DemoEvent) { for (const l of [...this.eventListeners]) l(event); }

  private update(patch: Partial<LearningSession>, push = false) {
    this.current = { ...this.current, ...patch, version: this.current.version + 1, server_time: new Date().toISOString() };
    if (push) for (const l of [...this.listeners]) l(this.current);
  }

  private reply(result: TurnResult | null): EventResponse { return { result, session: this.current, replayed: false }; }

  // ------------------------------------------------------------------------------------------- GameBackend
  subscribe = (listener: (session: LearningSession) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  session = async () => this.current;

  intro = async (): Promise<never> => { throw new Error('A tutorial has no lesson to read'); };

  turn = async (_id: number, action: TurnAction): Promise<EventResponse> => {
    const target = this.current.open_turns.find((t) => t.turn_id === action.turnId);
    if (!target) return this.reply(null); // already resolved (a late tap): nothing happens
    if (action.type === 'miss') return this.miss(target);
    if (action.type !== 'answer') return this.reply(null); // hints and "Xem đáp án" are not part of a tutorial
    this.emit({ type: 'submitted' });
    let checked: TutorialCheck;
    try {
      checked = await this.check(this.origin.get(target.turn_id) ?? target.turn_id, action.answer);
    } catch (error) {
      this.emit({ type: 'failed', error });
      throw error; // the game handles it as any request (offline: paused and retried with the same answer)
    }
    const { prompt, ...rest } = checked;
    const result: TurnResult = { ...rest, turn_id: target.turn_id, score_delta: 0, hearts_delta: 0, combo: 0 };
    let open = this.current.open_turns;
    const patch: Partial<LearningSession> = {};
    if (result.resolved) {
      open = open.filter((t) => t.turn_id !== target.turn_id);
      if (result.correct) patch.resolved_count = this.current.resolved_count + 1;
      else open = [...open, this.again(target)]; // a reveal game: the explanation, then the same question once more
    } else {
      // Kept open; a step done in two parts gets its next prompt (the spellings to choose from).
      open = open.map((t) => (t.turn_id === target.turn_id
        ? { ...t, attempts: t.attempts + 1, wrong_attempts: t.wrong_attempts + (result.correct ? 0 : 1), ...(prompt ? { prompt: prompt as Turn['prompt'] } : {}) }
        : t));
    }
    this.update({ ...patch, open_turns: open });
    this.emit({ type: 'answer', correct: !!result.correct, resolved: result.resolved });
    return this.reply(result);
  };

  private async miss(target: Turn): Promise<EventResponse> {
    // The word it carried is shown where it landed, as in a stage: the server says which (nothing is saved).
    let word: TurnResult['word'] = null;
    let correctAnswer: string | null = null;
    try {
      const told = await this.check(this.origin.get(target.turn_id) ?? target.turn_id, null, 'miss');
      word = told.word ?? null;
      correctAnswer = told.correct_answer ?? null;
    } catch { /* the landing still counts in the demo */ }
    const hearts = this.current.hearts_max > 0 ? Math.max(1, this.current.hearts - 1) : this.current.hearts;
    const delta = hearts - this.current.hearts;
    this.update({ hearts, open_turns: this.current.open_turns.filter((t) => t.turn_id !== target.turn_id) });
    this.emit({ type: 'miss' });
    return this.reply({ turn_id: target.turn_id, event: 'miss', correct: false, outcome: 'missed', resolved: true, retry_allowed: false,
      error_type: null, score_delta: 0, hearts_delta: delta, combo: 0, hint: null, correct_answer: correctAnswer, explanation: null,
      practice_added: false, word });
  }

  private again(turn: Turn): Turn {
    const id = `${this.origin.get(turn.turn_id) ?? turn.turn_id}~${++this.copies}`;
    this.origin.set(id, this.origin.get(turn.turn_id) ?? turn.turn_id);
    this.current = { ...this.current, required_count: this.current.required_count + 1 };
    return { ...turn, turn_id: id, attempts: 0, wrong_attempts: 0, practice: true };
  }

  next = async () => this.reply(null);
  pause = async () => { this.update({ status: 'paused' }); return this.reply(null); };
  resume = async () => { this.update({ status: 'active' }); return this.reply(null); };
  extend = async () => this.reply(null);
  /** A tutorial is finished by its steps, never by the session: nothing to complete. */
  complete = async () => this.reply(null);
  abandon = async () => { this.update({ status: 'abandoned' }); return this.reply(null); };
}
