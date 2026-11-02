/** Mirabi Life: Work Quest (backend/app/work.py on top of /api/tasks) and the Healing Room (backend/app/life.py). */

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type ProjectTheme = 'meadow' | 'beach' | 'forest' | 'snow' | 'desert' | 'sky';

export type TaskStep = { id: number; title: string; done: boolean };

/** One occurrence of a task, as /api/tasks and the work dashboard return it. */
export type WorkTask = {
  id: number; occurrence_id: string; title: string; description?: string | null; category: string;
  scheduled_date: string; repeat: string; project_id: number | null; priority: Priority; due_at: string | null;
  estimated_minutes: number | null; exp: number; steps: TaskStep[]; completed: boolean; overdue?: boolean;
  /** Set on the screen while a completion made offline waits to be sent. */
  pendingSync?: boolean;
};

export type WorkProject = {
  id: number; name: string; description: string | null; theme: ProjectTheme; status: 'active' | 'completed' | 'archived';
  tasks_total: number; tasks_done: number; recurring_tasks: number; completions: number; progress: number;
  /** 0 (bare island) .. 5 (finished, lit up). */
  build_stage: number; ready_to_complete: boolean; completed_at: string | null; created_at: string;
};

export type ChestReward = { id: string; name: string; art: string | null; rarity: string; quantity: number };
export type WorkChest = {
  code: string; name: string; required: number; progress: number; status: 'locked' | 'ready' | 'opened';
  opened_at: string | null; rewards: ChestReward[];
};

export type WalkStatus = 'locked' | 'ready' | 'waiting_hatch' | 'walking' | 'returned' | 'rested';

export type WorkDashboard = {
  today: string;
  tasks_today: WorkTask[];
  overdue: WorkTask[];
  upcoming: WorkTask[];
  projects: WorkProject[];
  chests: WorkChest[];
  summary: { today_total: number; today_done: number; focus_minutes_today: number; exp_remaining_today: number };
  walk: { status: WalkStatus; goals_total: number; goals_done: number };
  pet_line: string;
};

export type WorkStatistics = {
  period: 'day' | 'week' | 'month'; start: string; end: string; completed: number;
  days: { date: string; completed: number }[]; on_time: number; late: number;
  by_priority: Record<Priority, number>; by_project: { project_id: number; name: string; completed: number }[];
  best_day: string | null;
};

export type CompleteResult = WorkTask & { awarded_exp: number; already_completed: boolean; daily_exp_remaining: number };

export type NewWorkTask = {
  title: string; scheduled_date: string; project_id: number | null; priority: Priority; due_at: string | null;
  estimated_minutes: number | null; steps: string[]; repeat: 'none' | 'daily' | 'weekly'; repeat_weekdays: number[];
  description: string | null;
};

// ---- Healing Room ----

export type Mood = 'happy' | 'neutral' | 'tired' | 'stressed' | 'sad' | 'excited';
export type Ambience = 'cozy_night' | 'rainy_day' | 'morning_calm' | 'forest_retreat' | 'starry_night';
export type RelaxActivity = 'breathing' | 'nature_sound' | 'journal' | 'gratitude' | 'rest' | 'pet';
export type PetMoodAnimation = 'celebrate' | 'idle' | 'rest' | 'comfort';

export type PetMoodResponse = { animation: PetMoodAnimation; line: string; suggest: RelaxActivity; support_hint?: string };
export type MoodEntry = { id: number; mood: Mood; note: string | null; local_date: string; created_at: string };
export type AmbiencePrefs = { ambience_type: Ambience; sound_enabled: boolean; volume: number };
export type RelaxSummary = { today_seconds: number; today_sessions: number; week_seconds: number; calm_days: number };

export type HealingSummary = {
  today: string; ambience: AmbiencePrefs; mood_today: MoodEntry | null; pet: PetMoodResponse | null;
  relaxation: RelaxSummary; journal_count: number;
};

export type JournalEntry = {
  id: number; kind: 'free' | 'gratitude'; title: string; content: string; mood: Mood | null; visibility: 'private';
  memory_id: number | null; created_at: string; updated_at: string;
};
