import { newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import type { Catalog, EventResponse, GameId, LearningSession, LessonDetail, Intro, Mode, ReviewGroup, SessionResult, StartOptions,
  VocabFilter, VocabHistory, VocabWordDetail } from './types';

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const s = (id: number) => `/api/learning/sessions/${id}`;

/** A turn action. `eventId` is created once per user action and reused on every retry, so a retried request after a
 * timeout or lost connection is recognised by the backend and never scored twice. */
export type TurnAction =
  | { type: 'answer'; turnId: string; answer: string | string[]; eventId: string }
  | { type: 'hint' | 'reveal' | 'miss'; turnId: string; eventId: string };

// Thin typed wrappers; `request` adds the access token and refreshes it when needed.
export const learningApi = {
  catalog: (): Promise<Catalog> => request('/api/learning/catalog'),
  lesson: (id: number): Promise<LessonDetail> => request(`/api/learning/lessons/${id}`),
  current: async (): Promise<LearningSession | null> => (await request('/api/learning/sessions/current'))?.session ?? null,
  session: (id: number): Promise<LearningSession> => request(s(id)),
  intro: async (id: number): Promise<Intro> => (await request(`${s(id)}/intro`)).intro,
  /** Created paused: the app shows the lesson drawn for this session first, and the clock starts with `resume`.
   * Same key on a retry returns the same session instead of starting a second one. */
  start: (o: StartOptions, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/sessions', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { lesson_id: o.lessonId, mode: o.mode, duration_minutes: o.durationMinutes, variant: o.variant ?? undefined, timezone: deviceTimezone(), start_paused: true } }),
  /** "Chơi ngay": an English game whose words or questions the backend picks from the user's progress. Created paused;
   * the game's 3-2-1 countdown resumes it. The same key on a retry returns the same session. */
  play: (game: GameId, mode: Mode, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/play', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { game, mode, timezone: deviceTimezone() } }),
  /** Created paused, like "Chơi ngay": the game's 3-2-1 countdown resumes it. */
  startReview: (topicId: number, mode: Mode, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/review/sessions', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { topic_id: topicId, mode, timezone: deviceTimezone(), start_paused: true } }),
  turn: (id: number, a: TurnAction): Promise<EventResponse> =>
    request(`${s(id)}/${a.type}`, { method: 'POST', body: { turn_id: a.turnId, client_event_id: a.eventId, ...(a.type === 'answer' ? { answer: a.answer } : {}) } }),
  next: (id: number, count = 1): Promise<EventResponse> => request(`${s(id)}/next`, { method: 'POST', body: { count } }),
  pause: (id: number): Promise<EventResponse> => request(`${s(id)}/pause`, { method: 'POST', body: {} }),
  resume: (id: number): Promise<EventResponse> => request(`${s(id)}/resume`, { method: 'POST', body: {} }),
  extend: (id: number, minutes: number, eventId: string): Promise<EventResponse> =>
    request(`${s(id)}/extend`, { method: 'POST', body: { minutes, client_event_id: eventId } }),
  complete: (id: number): Promise<EventResponse> => request(`${s(id)}/complete`, { method: 'POST', body: {} }),
  abandon: (id: number, reason: 'user_ended' | 'time_up' = 'user_ended'): Promise<EventResponse> =>
    request(`${s(id)}/abandon`, { method: 'POST', body: { reason } }),
  result: (id: number): Promise<SessionResult> => request(`${s(id)}/result`),
  review: async (): Promise<{ groups: ReviewGroup[]; total: number }> => request('/api/learning/review'),
  /** "Từ đã học", most recently studied first, one page (`limit` words from `offset`) at a time. */
  vocabHistory: (q: string, filter: VocabFilter, offset = 0, limit = 15): Promise<VocabHistory> =>
    request(`/api/learning/vocabulary/history?filter=${filter}&limit=${limit}&offset=${offset}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`),
  vocabWord: (entryKey: string): Promise<VocabWordDetail> => request(`/api/learning/vocabulary/history/${encodeURIComponent(entryKey)}`),
  /** "Luyện lại": a review stage of the chosen game with these words, or the "Cần ôn" words when none are given.
   * Created paused: the countdown resumes it. */
  practiseWords: (game: 'word_shooter' | 'meteor', entryKeys: string[] | null, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/vocabulary/practice', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { game, ...(entryKeys ? { entry_keys: entryKeys } : {}), mode: 'practice', timezone: deviceTimezone(), start_paused: true } }),
  /** "Cách chơi": the games whose first-time guide this account has finished (with "Bắt đầu"). */
  tutorials: async (): Promise<GameId[]> => {
    const body = await request('/api/learning/tutorials');
    return Array.isArray(body?.seen) ? body.seen : [];
  },
  finishTutorial: (game: GameId): Promise<unknown> => request(`/api/learning/tutorials/${game}`, { method: 'POST', body: {} }),
};
