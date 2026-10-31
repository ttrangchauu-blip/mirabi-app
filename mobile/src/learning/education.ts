// The learner's school grade and school year, and Kho lưu trữ học tập (backend education.py). The grade is locked at
// registration and moved on by the backend on the school calendar: the app never chooses or sends one. The last state
// read is kept on the device so Học tập can show it offline; it is replaced by the backend's as soon as it answers
// (an app offline across a new school year gets the new grade then).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import { deviceTimezone } from './api';
import type { GameId, LearningSession } from './types';

export type Celebration = { id: number; kind: 'promotion' | 'completed'; grade: string; grade_label: string; from_grade: string | null;
  academic_year: number; academic_year_label: string; message: string };

export type YearProgress = { lessons_ready: number; lessons_completed: number; lessons_in_progress: number; percent: number };

export type EducationState = {
  /** False for accounts that have not given a grade yet (Học tập asks once). */
  enrolled: boolean; locked: boolean; grade: string | null; grade_label: string;
  initial_grade?: string; academic_year: number | null; academic_year_label: string | null;
  status: 'studying' | 'completed' | 'outside_school' | null; status_label?: string;
  progress: YearProgress | null; promotion_pending: boolean;
  /** A new school year has begun but its calendar is not verified yet: the grade stays until it is. */
  awaiting_calendar?: boolean;
  next_promotion: { academic_year: number; academic_year_label: string;
    /** The verified promotion day; null until the school year's calendar is verified. */ date: string | null; confirmed?: boolean;
    to_grade: string | null; to_grade_label: string | null; completes: boolean } | null;
  celebration: Celebration | null; archives: number; support_note?: string;
};

export type ArchiveCard = { academic_year: number; academic_year_label: string; grade: string; grade_label: string; subjects: number;
  lessons_completed: number; lessons_ready: number; percent: number; had_activity: boolean; archived_at: string };

export type ArchivedLesson = { key: string; title: string; status: 'ready' | 'planned'; content_version: string | null;
  progress: { status: 'not_started' | 'in_progress' | 'completed'; label: string; percent: number } | null };
export type ArchivedSubject = { code: string; name: string; type: string; icon: string; bg: string; color: string;
  lessons: number; ready: number; completed: number; started: number;
  chapters: { key: string; title: string; lessons: ArchivedLesson[] }[] };
export type ArchiveReviews = { stages: number; completed: number; best_score: number | null; open_session: number | null;
  last: { session_id: number; status: string; game: string | null; score: number; at: string } | null };

export type ArchiveYear = ArchiveCard & {
  snapshot_version: number; read_only: true;
  stats: { sessions: number; stages_completed: number; active_minutes: number; score: number; exp: number; days_active: number;
    answers: number; first_try: number; accuracy: number | null; lessons_total: number; lessons_ready: number;
    lessons_completed: number; percent: number };
  subjects: ArchivedSubject[];
  free_practice: { game: string; subject: string; stages: number; completed: number; best_score: number }[];
  lesson_results: { lesson: string; game: string; subject: string; stages: number; completed: number; best: number | null;
    passed: boolean; content_version: string | null }[];
  knowledge: { key: string; title: string; subject: string; subject_name: string | null; chapter: string | null }[];
  vocabulary: { key: string; word: string | null; meaning_vi: string | null; phonetic: string | null; outcome: string | null }[];
  mistakes: { key: string; label: string; answer: string | null; reason: string; subject: string | null; lesson: string | null }[];
  reviews: ArchiveReviews;
  /** The learner's own notes of that school year (kept, editable from Sổ tay kiến thức). */
  notes?: Note[];
};

export type KnowledgeEntry = { key: string; title: string; description: string | null; grade: number; subject: string;
  subject_name: string | null; chapter: string; objectives: string[]; summary: string[];
  examples: { title: string; lines: string[] }[]; content_version: string };

export type ArchiveLessonDetail = KnowledgeEntry & { academic_year: number; academic_year_label: string; grade_label: string;
  frozen: boolean; current_content_version: string | null; read_only: true;
  results: { game: string; stages: number; completed: number; best: number | null; passed: boolean }[];
  games: { game: GameId; title: string; gameplay: string; playable: boolean; review: ArchiveReviews }[] };

export type Notebook = { academic_year?: number | null; academic_year_label: string | null; grade_label: string; entries: KnowledgeEntry[] };

/** Ghi chú cá nhân: written by the learner, per school year, on a subject and optionally a lesson. */
export type Note = { id: number; academic_year: number | null; academic_year_label: string | null; grade: string | null; grade_label: string;
  subject: string; subject_name: string; lesson_key: string | null; lesson_title: string | null; title: string; body: string;
  created_at: string; updated_at: string };
export type NoteInput = { title: string; body: string; subject: string; lesson_key: string | null };
export type NoteFilter = { q?: string; academic_year?: number | null; subject?: string | null; lesson_key?: string | null };

export const educationApi = {
  /** Also brings the learner to the current school year first (the backend's promotion check). */
  state: (): Promise<EducationState> => request('/api/education'),
  celebrationSeen: (id: number): Promise<{ seen: boolean }> => request(`/api/education/celebrations/${id}/seen`, { method: 'POST', body: {} }),
  archives: (): Promise<{ visible_years: number; items: ArchiveCard[] }> => request('/api/education/archives'),
  archive: (year: number): Promise<ArchiveYear> => request(`/api/education/archives/${year}`),
  archiveLesson: (year: number, key: string): Promise<ArchiveLessonDetail> =>
    request(`/api/education/archives/${year}/lessons/${encodeURIComponent(key)}`),
  /** A review of a finished year's lesson (kind 'archive'): created paused, the countdown resumes it. Kept apart from that
   * year's results and from the current grade. The same key on a retry returns the same session. */
  playArchive: (year: number, key: string, game: GameId, idempotencyKey = newIdempotencyKey()): Promise<LearningSession> =>
    request(`/api/education/archives/${year}/lessons/${encodeURIComponent(key)}/play`, { method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey }, body: { game, timezone: deviceTimezone() } }),
  notebook: (): Promise<Notebook> => request('/api/education/notebook'),
  notes: (f: NoteFilter = {}): Promise<{ items: Note[]; total: number }> => {
    const query = [f.q?.trim() ? `q=${encodeURIComponent(f.q.trim())}` : '', f.academic_year ? `academic_year=${f.academic_year}` : '',
      f.subject ? `subject=${encodeURIComponent(f.subject)}` : '', f.lesson_key ? `lesson_key=${encodeURIComponent(f.lesson_key)}` : '']
      .filter(Boolean).join('&');
    return request(`/api/education/notes${query ? `?${query}` : ''}`);
  },
  createNote: (note: NoteInput): Promise<Note> => request('/api/education/notes', { method: 'POST', body: note }),
  updateNote: (id: number, note: NoteInput): Promise<Note> => request(`/api/education/notes/${id}`, { method: 'PUT', body: note }),
  deleteNote: (id: number): Promise<unknown> => request(`/api/education/notes/${id}`, { method: 'DELETE' }),
};

// --- Quản trị lớp học (administrators only; the backend checks the role on every call) ---------------------------------

export type CalendarYear = { region: string; academic_year: number; label: string; configured: boolean; school_start_date: string | null;
  opening_date: string | null; promotion_date: string | null; end_date: string | null; source: string | null;
  decision_number: string | null; verified: boolean; verified_at: string | null; verified_by: number | null;
  updated_by: number | null; updated_at: string | null };
export type CalendarAlert = { region: string; academic_year: number; label: string; level: 'overdue' | 'upcoming';
  expected_start: string; configured: boolean; waiting: number };
export type CalendarChange = { academic_year: number; actor: string | null; reason: string; at: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> };
export type CalendarInput = { region: string; academic_year: number; school_start_date: string; opening_date: string | null;
  promotion_date: string | null; end_date: string | null; source: string | null; decision_number: string | null; verified: boolean;
  reason: string };
export type LearnerRow = { id: number; email: string; display_name: string; grade: string | null; grade_label: string;
  academic_year: number | null; academic_year_label: string | null; region: string | null; status: string | null;
  hold_next_promotion: boolean };
export type HistoryRow = { id: number; kind: string; academic_year: number; academic_year_label: string; from_grade: string | null;
  to_grade: string; skipped: boolean; reason: string | null; actor: string | null; at: string };
export type LearnerDetail = LearnerRow & { initial_grade: string | null; enrollment_date: string | null; awaiting_calendar: string | null;
  can_promote: boolean; history: HistoryRow[] };
export type SupportInput = { reason: string; verification: string };

const admin = '/api/admin/education';
export const educationAdminApi = {
  regions: (): Promise<{ items: { code: string; name: string; timezone: string }[] }> => request(`${admin}/regions`),
  alerts: (): Promise<CalendarAlert[]> => request(`${admin}/alerts`),
  calendar: (region: string): Promise<{ region: string; years: CalendarYear[]; changes: CalendarChange[]; alerts: CalendarAlert[] }> =>
    request(`${admin}/calendar?region=${encodeURIComponent(region)}`),
  saveCalendar: (input: CalendarInput): Promise<CalendarYear> => request(`${admin}/calendar`, { method: 'PUT', body: input }),
  findUsers: (q: string): Promise<{ items: LearnerRow[] }> => request(`${admin}/users?q=${encodeURIComponent(q.trim())}`),
  user: (id: number): Promise<LearnerDetail> => request(`${admin}/users/${id}`),
  correctGrade: (id: number, grade: string, s: SupportInput) => request(`${admin}/users/${id}/grade`, { method: 'POST', body: { grade, ...s } }),
  repeat: (id: number, s: SupportInput) => request(`${admin}/users/${id}/repeat`, { method: 'POST', body: s }),
  promote: (id: number, s: SupportInput) => request(`${admin}/users/${id}/promote`, { method: 'POST', body: s }),
  changeRegion: (id: number, region: string, s: SupportInput) => request(`${admin}/users/${id}/region`, { method: 'POST', body: { region, ...s } }),
};

const cacheKey = (userId: number) => `mirabi.education:${userId}`;

/** The education state: the device's last copy at once (offline), then the backend's. `reload` after anything that may
 * have moved the school year on (a stage that ended, the app coming back to the foreground). */
export function useEducation(userId: number) {
  const [education, setEducation] = useState<EducationState | null>(null);
  const [offline, setOffline] = useState(false);
  const fresh = useRef(false);
  useEffect(() => {
    void AsyncStorage.getItem(cacheKey(userId)).then((raw) => {
      if (raw && !fresh.current) setEducation(JSON.parse(raw) as EducationState);
    }).catch(() => {});
  }, [userId]);
  const reload = useCallback(async () => {
    try {
      const body = await educationApi.state();
      fresh.current = true;
      setEducation(body); setOffline(false);
      void AsyncStorage.setItem(cacheKey(userId), JSON.stringify({ ...body, celebration: null })).catch(() => {});
    } catch { setOffline(true); }
  }, [userId]);
  /** The celebration was shown: never again, on any device (the backend records it). */
  const celebrated = useCallback(async (id: number) => {
    setEducation((e) => (e && e.celebration?.id === id ? { ...e, celebration: null } : e));
    try { await educationApi.celebrationSeen(id); } catch { /* shown again next time, never lost */ }
  }, []);
  return { education, offline, reload, celebrated };
}
