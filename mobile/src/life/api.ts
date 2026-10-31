import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, NetworkError, newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import type {
  AmbiencePrefs, CompleteResult, HealingSummary, JournalEntry, Mood, MoodEntry, NewWorkTask, PetMoodResponse, RelaxActivity,
  RelaxSummary, WorkChest, WorkDashboard, WorkProject, WorkStatistics, WorkTask,
} from './types';

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const tzQuery = () => `tz=${encodeURIComponent(localZone())}`;

/** Work Quest. Tasks themselves are the app's one task system (/api/tasks); /api/work adds projects, the dashboard,
 * statistics and chests. */
export const workApi = {
  dashboard: () => request(`/api/work/dashboard?${tzQuery()}`) as Promise<WorkDashboard>,
  statistics: (period: WorkStatistics['period']) => request(`/api/work/statistics?period=${period}&${tzQuery()}`) as Promise<WorkStatistics>,
  createProject: (body: { name: string; theme: WorkProject['theme']; description?: string | null }) =>
    request('/api/work/projects', { method: 'POST', body }) as Promise<WorkProject>,
  updateProject: (id: number, body: Partial<Pick<WorkProject, 'name' | 'theme' | 'status' | 'description'>>) =>
    request(`/api/work/projects/${id}`, { method: 'PATCH', body }) as Promise<WorkProject>,
  openChest: (code: string) => request(`/api/work/rewards/${code}/claim`, { method: 'POST' }) as
    Promise<{ chest: WorkChest; already_opened: boolean; chests: WorkChest[] }>,
  createTask: (task: NewWorkTask) => request('/api/tasks', { method: 'POST', body: {
    ...task, category: 'work', all_day: true, repeat_weekdays: task.repeat === 'weekly' ? task.repeat_weekdays : [],
  } }) as Promise<WorkTask>,
  updateTask: (id: number, occurrence: string, body: Partial<Pick<WorkTask, 'title' | 'priority' | 'project_id' | 'due_at' | 'estimated_minutes'>>) =>
    request(`/api/tasks/${id}?occurrence_date=${occurrence}`, { method: 'PATCH', body }) as Promise<WorkTask>,
  deleteTask: (id: number) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  complete: (id: number, occurrence: string) =>
    request(`/api/tasks/${id}/complete`, { method: 'POST', body: { occurrence_date: occurrence } }) as Promise<CompleteResult>,
  toggleStep: (taskId: number, stepId: number, occurrence: string, done: boolean) =>
    request(`/api/tasks/${taskId}/steps/${stepId}`, { method: 'PUT', body: { occurrence_date: occurrence, done } }) as Promise<WorkTask>,
};

/** Completions made without a connection wait here and are sent on the next load. The backend completes an occurrence
 * once, so sending one twice (another device got there first) is harmless; EXP is only shown once the server confirms. */
const QUEUE_KEY = (userId: number) => `mirabi.work.pending.v1:${userId}`;
export type PendingCompletion = { taskId: number; occurrence: string };

export const completionQueue = {
  async load(userId: number): Promise<PendingCompletion[]> {
    try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY(userId))) ?? '[]'); } catch { return []; }
  },
  async add(userId: number, entry: PendingCompletion) {
    const queue = await completionQueue.load(userId);
    if (!queue.some((q) => q.taskId === entry.taskId && q.occurrence === entry.occurrence)) queue.push(entry);
    await AsyncStorage.setItem(QUEUE_KEY(userId), JSON.stringify(queue));
  },
  /** Send what waits; returns the confirmed results (and keeps what still can't be sent). */
  async flush(userId: number): Promise<CompleteResult[]> {
    const queue = await completionQueue.load(userId);
    if (!queue.length) return [];
    const left: PendingCompletion[] = [];
    const done: CompleteResult[] = [];
    for (const entry of queue) {
      try { done.push(await workApi.complete(entry.taskId, entry.occurrence)); }
      catch (e) {
        // Offline again: keep it. Refused by the server (the task was removed, wrong day): drop it.
        if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) left.push(entry);
      }
    }
    await AsyncStorage.setItem(QUEUE_KEY(userId), JSON.stringify(left));
    return done;
  },
};

/** Healing Room. Every day is the device's local day. */
export const healingApi = {
  summary: () => request(`/api/life/healing?${tzQuery()}`) as Promise<HealingSummary>,
  checkIn: (mood: Mood, note?: string | null) => request('/api/life/moods', { method: 'POST', body: { mood, note: note || null, timezone: localZone() } }) as
    Promise<{ entry: MoodEntry; pet: PetMoodResponse }>,
  moodHistory: (days = 14) => request(`/api/life/moods/history?days=${days}&${tzQuery()}`) as
    Promise<{ start: string; end: string; entries: MoodEntry[]; days: { date: string; mood: Mood }[]; counts: Partial<Record<Mood, number>> }>,
  journal: (before?: number) => request(`/api/life/journal?limit=20${before ? `&before=${before}` : ''}`) as
    Promise<{ items: JournalEntry[]; next_before: number | null }>,
  writeJournal: (body: { kind: JournalEntry['kind']; title: string; content: string; mood?: Mood | null; save_to_album?: boolean }) =>
    request('/api/life/journal', { method: 'POST', body }) as Promise<JournalEntry>,
  editJournal: (id: number, body: { title?: string; content?: string }) =>
    request(`/api/life/journal/${id}`, { method: 'PATCH', body }) as Promise<JournalEntry>,
  deleteJournal: (id: number) => request(`/api/life/journal/${id}`, { method: 'DELETE' }),
  relaxed: (activity: RelaxActivity, seconds: number) => request('/api/life/relaxation-sessions', { method: 'POST', body: {
    activity_type: activity, duration_seconds: Math.max(1, Math.round(seconds)), client_ref: newIdempotencyKey().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64),
    timezone: localZone(),
  } }) as Promise<{ already_recorded: boolean; summary: RelaxSummary }>,
  saveAmbience: (prefs: AmbiencePrefs) => request('/api/life/room-ambience', { method: 'PUT', body: prefs }) as Promise<AmbiencePrefs>,
};

/** The Healing Room's last state, so the room opens with its ambience even offline. */
const HEALING_CACHE = (userId: number) => `mirabi.healing.v1:${userId}`;
export const healingCache = {
  async load(userId: number): Promise<HealingSummary | null> {
    try { const raw = await AsyncStorage.getItem(HEALING_CACHE(userId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  store: (userId: number, value: HealingSummary) => AsyncStorage.setItem(HEALING_CACHE(userId), JSON.stringify(value)).catch(() => {}),
};
