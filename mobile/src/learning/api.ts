import { newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import type { Band, Catalog, CatalogLesson, EventResponse, GameId, LearningSession, LessonDetail, LessonProgramme, Intro, Mode, ReviewGroup, SessionResult,
  StartOptions, SubjectLessons, VocabFilter, VocabGame, VocabHistory, VocabPlay, VocabProgress, VocabQuery, VocabWordDetail } from './types';

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const s = (id: number) => `/api/learning/sessions/${id}`;

/** A turn action. `eventId` is created once per user action and reused on every retry, so a retried request after a
 * timeout or lost connection is recognised by the backend and never scored twice. `holdNext` (falling words): when the
 * turn ends no new one opens; the app opens new words on its own timer (`next` with `refill`). */
export type TurnAction =
  | { type: 'answer'; turnId: string; answer: string | string[]; eventId: string; holdNext?: boolean }
  | { type: 'miss'; turnId: string; eventId: string; holdNext?: boolean }
  | { type: 'hint' | 'reveal'; turnId: string; eventId: string };

// Thin typed wrappers; `request` adds the access token and refreshes it when needed.
export const learningApi = {
  /** The learner's own grade (the backend's, never one picked here); outside school, `band` is the level chosen. */
  catalog: (band: Band = {}): Promise<Catalog> => request(`/api/learning/catalog${band.level ? `?level=${band.level}` : ''}`),
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
  play: (game: GameId, mode: Mode, idempotencyKey = newIdempotencyKey(), band: Band = {}, vocab?: VocabPlay): Promise<LearningSession> =>
    request('/api/learning/play', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { game, mode, timezone: deviceTimezone(), ...(band.level ? { level: band.level } : {}),
        ...(vocab ? { vocab: vocab.vocab, ...(vocab.topic ? { topic: vocab.topic } : {}) } : {}) } }),
  /** Khám phá từ mới of one vocabulary game: levels, new words left, words due and a level to celebrate. */
  vocabProgress: (game: VocabGame): Promise<VocabProgress> => request(`/api/learning/vocabulary/progress?game=${game}`),
  /** The celebration of a completed level was shown: it never comes back. */
  vocabCelebrated: (game: VocabGame, level: number): Promise<unknown> =>
    request(`/api/learning/vocabulary/levels/${game}/${level}/celebrated`, { method: 'POST', body: {} }),
  /** Created paused, like "Chơi ngay": the game's 3-2-1 countdown resumes it. */
  startReview: (topicId: number, mode: Mode, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/review/sessions', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { topic_id: topicId, mode, timezone: deviceTimezone(), start_paused: true } }),
  turn: (id: number, a: TurnAction): Promise<EventResponse> =>
    request(`${s(id)}/${a.type}`, { method: 'POST', body: { turn_id: a.turnId, client_event_id: a.eventId, ...(a.type === 'answer' ? { answer: a.answer } : {}),
      ...('holdNext' in a && a.holdNext ? { hold_next: true } : {}) } }),
  /** Open `count` more turns; with `refill`, only until `count` are open in all (asking twice never opens an extra one). */
  next: (id: number, count = 1, refill = false): Promise<EventResponse> =>
    request(`${s(id)}/next`, { method: 'POST', body: { count, ...(refill ? { refill: true } : {}) } }),
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
  vocabHistory: (q: string, filter: VocabFilter, offset = 0, limit = 15, more: VocabQuery = {}): Promise<VocabHistory> =>
    request(`/api/learning/vocabulary/history?filter=${filter}&limit=${limit}&offset=${offset}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`
      + `${more.topic ? `&topic=${encodeURIComponent(more.topic)}` : ''}${more.level ? `&level=${more.level}` : ''}${more.year ? `&year=${more.year}` : ''}`),
  vocabWord: (entryKey: string): Promise<VocabWordDetail> => request(`/api/learning/vocabulary/history/${encodeURIComponent(entryKey)}`),
  /** "Luyện lại": a review stage of the chosen game with these words, or the "Cần ôn" words when none are given.
   * Created paused: the countdown resumes it. */
  practiseWords: (game: 'word_shooter' | 'meteor', entryKeys: string[] | null, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request('/api/learning/vocabulary/practice', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { game, ...(entryKeys ? { entry_keys: entryKeys } : {}), mode: 'practice', timezone: deviceTimezone(), start_paused: true } }),
  /** Học tập theo bài: every subject of the learner's current grade, with this school year's progress. */
  programme: (): Promise<LessonProgramme> => request('/api/learning/programme'),
  /** The chapters and lessons of a subject at the learner's grade, with each lesson's status and progress. */
  subjectLessons: (code: string): Promise<SubjectLessons> =>
    request(`/api/learning/programme/subjects/${encodeURIComponent(code)}`),
  lessonDetail: (key: string): Promise<CatalogLesson> => request(`/api/learning/lesson-catalog/${encodeURIComponent(key)}`),
  /** A game of a lesson, created paused (the countdown resumes it). The same key on a retry returns the same session. */
  playLesson: (key: string, game: GameId, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request(`/api/learning/lesson-catalog/${encodeURIComponent(key)}/play`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
      body: { game, timezone: deviceTimezone() } }),
  /** THPT: the elective subjects studied (at most 4), shown first. */
  saveSelection: (subjects: string[]): Promise<{ chosen: string[] }> =>
    request('/api/learning/programme/selection', { method: 'PUT', body: { subjects } }),
  /** "Cách chơi": the games whose first-time guide this account has finished (with "Bắt đầu"). */
  tutorials: async (): Promise<GameId[]> => {
    const body = await request('/api/learning/tutorials');
    return Array.isArray(body?.seen) ? body.seen : [];
  },
  /** Finished at guide `version` (tutorials.TUTORIAL_VERSION); `tutorials` lists the games finished at the current one. */
  finishTutorial: (game: GameId, version: number): Promise<unknown> => request(`/api/learning/tutorials/${game}`, { method: 'POST', body: { version } }),
};

/** What a game screen needs from whoever owns its session: `learningApi` for a stage (Play Mode), a tutorial's demo
 * session for Tutorial Mode (learning/tutorial/demoSession.ts). The screen, its gameplay and its checks are the same. */
export type GameBackend = Pick<typeof learningApi, 'session' | 'intro' | 'turn' | 'next' | 'pause' | 'resume' | 'extend' | 'complete' | 'abandon'> & {
  /** Session changes the screen did not ask for (a tutorial bringing in the next demo turn). */
  subscribe?: (listener: (session: LearningSession) => void) => () => void;
};
