import { apiRequest } from '../../api/client';
import { errorMessage, isSessionExpired } from '../../auth/messages';
import { showAlert } from '../../components/dialogs';
import type { IconName } from '../../ui/kit';

export type Post = { id: number; author: string; body: string; likes: number };
export type Career = { title: string; category: string; match: number; description: string; skills: string[] };
export type Quest = { id: string; title: string; progress: number; target: number };
export type TaskDifficulty = 'easy' | 'medium' | 'hard' | 'very_hard';
export type ScheduledTask = { id: number | string; occurrence_id: string; title: string; description?: string | null; category: string; difficulty?: TaskDifficulty; scheduled_date: string; repeat: string; start_time?: string | null; end_time?: string | null; all_day?: boolean; repeat_interval?: number; repeat_frequency?: string | null; repeat_weekdays?: number[]; repeat_month_day?: number | null; repeat_month_week?: number | null; repeat_month_weekday?: number | null; repeat_until?: string | null; repeat_count?: number | null; completed: boolean; kind?: 'scheduled' | 'daily_quest' };

export function taskRepeatDetail(task: ScheduledTask): string {
  const labels: Record<string, string> = { none: 'Một lần', daily: 'Hằng ngày', weekly: 'Hằng tuần', monthly: 'Hằng tháng', yearly: 'Hằng năm', custom: 'Tùy chỉnh' };
  const frequency = task.repeat_frequency || task.repeat;
  const frequencyNames: Record<string, string> = { daily: 'ngày', weekly: 'tuần', monthly: 'tháng', yearly: 'năm' };
  let label = task.repeat_interval && task.repeat_interval > 1 ? `Mỗi ${task.repeat_interval} ${frequencyNames[frequency] ?? frequency}` : (labels[task.repeat] ?? task.repeat);
  if (frequency === 'weekly' && task.repeat_weekdays?.length) label += ` · ${task.repeat_weekdays.map((day) => ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][day]).join(', ')}`;
  if (frequency === 'monthly' && task.repeat_month_weekday != null) label += ` · Tuần ${task.repeat_month_week} ${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][task.repeat_month_weekday]}`;
  else if (frequency === 'monthly' && task.repeat_month_day) label += ` · Ngày ${task.repeat_month_day}`;
  if (task.repeat_until) label += ` · đến ${task.repeat_until}`;
  else if (task.repeat_count) label += ` · ${task.repeat_count} lần`;
  return label;
}
export const DAILY_QUEST_IDS = ['focus', 'lesson', 'share'] as const;
export function resolveQuestId(quest: Quest, quests: Quest[]) {
  return quest.id && quest.id !== 'undefined' ? quest.id : DAILY_QUEST_IDS[quests.indexOf(quest)];
}
/** Companion walk, see backend/app/companion.py: locked -> ready -> walking -> returned -> rested (until tomorrow). */
export type WalkStatus = 'locked' | 'ready' | 'waiting_hatch' | 'walking' | 'returned' | 'rested';
export type Dashboard = { study?: { total_minutes: number; today_minutes: number; today_sessions: number; current_streak: number; longest_streak: number; daily_goal_minutes: number; goal_progress: number }; daily_quests?: Quest[]; scheduled_tasks?: ScheduledTask[]; pet_walk?: WalkStatus; unread_notifications?: number; pending_friend_requests?: number };

export const FOCUS_SECONDS = 25 * 60;

// Authenticated by default; the client attaches the access token and refreshes it transparently.
export const request = (path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => apiRequest<any>(path, { ...options, auth: true });

// When the session expires the app is already returning to the login screen, so don't stack an alert on top.
export function showError(title: string, e: unknown) { if (!isSessionExpired(e)) showAlert(title, errorMessage(e)); }

const CATEGORY_ICONS: Record<string, IconName> = {
  'Sáng tạo': 'color-palette-outline', 'Công nghệ': 'code-slash-outline', 'Con người': 'heart-outline',
  'Sức khỏe tinh thần': 'leaf-outline', 'Kỹ năng sống': 'wallet-outline', 'Nghề nghiệp': 'briefcase-outline',
};
export const categoryIcon = (category: string): IconName => CATEGORY_ICONS[category] ?? 'book-outline';
