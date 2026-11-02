import { request } from '../../screens/main/shared';
import type { GameId, TurnResult } from '../types';
import type { TutorialDefinition } from './registry';

export type TutorialStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';
export type TutorialProgress = { game_id: GameId; game_mode: string; tutorial_version: number; gameplay_version: number;
  /** Still to play before this game (never played at this tutorial version and gameplay version, or left unfinished). */
  required: boolean; status: TutorialStatus; current_step: number; completed_at: string | null };
/** A demo answer checked by the game's own checker; `prompt` is the turn's next step (Thám tử chính tả: the spellings). */
export type TutorialCheck = TurnResult & { prompt?: Record<string, unknown> | null };

const g = (game: GameId) => `/api/games/${game}/tutorial`;

/** The interactive tutorials (backend app/game_tutorials.py). Nothing here creates a session or grants anything. */
export const tutorialApi = {
  definition: (game: GameId): Promise<TutorialDefinition> => request(g(game)),
  allProgress: async (): Promise<Partial<Record<GameId, TutorialProgress>>> => (await request('/api/games/tutorials/progress'))?.games ?? {},
  saveProgress: (game: GameId, body: { tutorial_version: number; current_step: number; status: 'in_progress' | 'skipped' }): Promise<TutorialProgress> =>
    request(`${g(game)}/progress`, { method: 'POST', body: { game_mode: 'practice', ...body } }),
  complete: (game: GameId, body: { tutorial_version: number; gameplay_version: number; steps_done: string[] }): Promise<TutorialProgress> =>
    request(`${g(game)}/complete`, { method: 'POST', body: { game_mode: 'practice', ...body } }),
  check: async (game: GameId, body: { tutorial_version: number; turn_id: string; answer: string | string[] | null; event?: 'miss' }): Promise<TutorialCheck> =>
    (await request(`${g(game)}/check`, { method: 'POST', body })).result,
};
