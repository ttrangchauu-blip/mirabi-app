import { newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import type { WorkTask } from './types';

/** Phiêu lưu cuộc sống, Vườn tài chính, Thị trấn Mirabi and Hành trình sự nghiệp (backend/app/adventure.py, finance.py,
 * town.py, careers.py). */

export const clientRef = () => newIdempotencyKey().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);

/** A date as YYYY-MM-DD on the device's clock. */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---- Phiêu lưu cuộc sống
export type ItemReward = { id: string; name: string; art: string | null; rarity: string; quantity: number };
export type AdventureMilestone = { code: string; required: number; rewards: ItemReward[]; status: 'locked' | 'ready' | 'claimed' };
export type AdventureRegion = {
  code: string; name: string; theme: string; emoji: string; description: string; progress: number; unlocked: boolean;
  unlock_hint: string | null; next_milestone: number | null; milestones: AdventureMilestone[];
  activities: { code: string; name: string; emoji: string }[];
  tasks_today: (WorkTask & { adventure_activity: string })[];
};
export type AdventureMap = { day: string; regions: AdventureRegion[]; pet_region: string; total_progress: number; daily_count_limit: number };

export const adventureApi = {
  map: () => request(`/api/adventure/map?day=${localDay()}`) as Promise<AdventureMap>,
  start: (code: string) => request(`/api/adventure/activities/${code}/start`, { method: 'POST', body: { scheduled_date: localDay() } }) as
    Promise<WorkTask & { region: string }>,
  claim: (milestone: string) => request(`/api/adventure/rewards/${encodeURIComponent(milestone)}/claim?day=${localDay()}`, { method: 'POST' }) as
    Promise<{ already_claimed: boolean; rewards: ItemReward[]; map: AdventureMap }>,
  complete: (taskId: number, day: string) => request(`/api/tasks/${taskId}/complete`, { method: 'POST', body: { occurrence_date: day } }) as
    Promise<{ awarded_exp: number; already_completed: boolean }>,
};

// ---- Vườn tài chính
export type Plant = 'sakura' | 'oak' | 'sunflower' | 'bamboo' | 'maple' | 'lotus';
export type FinanceGoal = {
  id: number; name: string; target_amount: number; currency: 'VND'; target_date: string | null; plant: Plant; status: 'active' | 'archived';
  saved_amount: number; percent: number; stage: number; stage_name: string; milestones: { percent: number; reached: boolean }[];
  estimated_date: string | null; created_at: string;
};
export type TxType = 'deposit' | 'withdraw' | 'income' | 'expense';
export type FinanceTx = { id: number; transaction_type: TxType; amount: number; goal_id: number | null; category_id: number | null;
  category: { name: string; icon: string } | null; occurred_at: string; note: string | null };
export type FinanceCategory = { id: number; name: string; type: 'income' | 'expense'; icon: string; custom: boolean };
export type FinanceBudget = { id: number; category_id: number; category: { name: string; icon: string } | null; period: string;
  limit_amount: number; spent: number; left: number; over: boolean };
export type FinanceSummary = { period: string; income: number; expense: number; net: number;
  by_category: { category_id: number | null; name: string; icon: string; income: number; expense: number }[];
  budgets: FinanceBudget[]; goals: FinanceGoal[]; saved_total: number; target_total: number };

export const financeApi = {
  goals: () => request('/api/finance/goals') as Promise<FinanceGoal[]>,
  createGoal: (body: { name: string; target_amount: number; plant: Plant; target_date?: string | null }) =>
    request('/api/finance/goals', { method: 'POST', body }) as Promise<FinanceGoal>,
  updateGoal: (id: number, body: Partial<Pick<FinanceGoal, 'name' | 'target_amount' | 'plant' | 'status' | 'target_date'>>) =>
    request(`/api/finance/goals/${id}`, { method: 'PATCH', body }) as Promise<FinanceGoal>,
  transactions: (query = '') => request(`/api/finance/transactions${query}`) as Promise<{ items: FinanceTx[]; next_before: number | null }>,
  record: (body: { transaction_type: TxType; amount: number; goal_id?: number | null; category_id?: number | null; note?: string | null; client_ref: string }) =>
    request('/api/finance/transactions', { method: 'POST', body }) as Promise<{ transaction: FinanceTx; already_recorded: boolean; goal: FinanceGoal | null }>,
  editTx: (id: number, body: { amount?: number; note?: string | null }) =>
    request(`/api/finance/transactions/${id}`, { method: 'PATCH', body }) as Promise<{ transaction: FinanceTx; goal: FinanceGoal | null }>,
  deleteTx: (id: number) => request(`/api/finance/transactions/${id}`, { method: 'DELETE' }) as Promise<{ deleted: boolean; goal: FinanceGoal | null }>,
  categories: () => request('/api/finance/categories') as Promise<FinanceCategory[]>,
  setBudget: (body: { category_id: number; period: string; limit_amount: number }) =>
    request('/api/finance/budgets', { method: 'POST', body }) as Promise<FinanceBudget>,
  summary: (period: string) => request(`/api/finance/summary?period=${period}`) as Promise<FinanceSummary>,
};

/** 20000000 -> "20.000.000 ₫" (whole đồng; amounts are integers). */
export const formatVnd = (amount: number) => `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
/** Digits typed by the user ("20.000.000", "20 000 000 đ") -> 20000000; null when there is no valid amount. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits || digits.length > 12) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ---- Thị trấn Mirabi
export type TownFriend = { id: number; display_name: string; avatar_theme: string; pet: string; pet_name: string | null; pet_level: number;
  presence: string; can_visit: boolean };
export type TownProject = { id: number; code: string; name: string; description: string; target: number; current: number; percent: number;
  stage: number; status: 'active' | 'completed'; my_contribution: number; contributors: number };
export type TownEvent = { id: number; code: string; title: string; description: string; project_code: string | null; start_at: string;
  end_at: string; status: 'upcoming' | 'active' | 'ended' };
export type TownAchievement = { user_id: number; display_name: string; pet: string; pet_level: number; me: boolean; chests_opened: number;
  career_badges: number };
export type TownMap = { me: { id: number; display_name: string; pet: string; pet_name: string | null; pet_level: number; coins: number };
  friends: TownFriend[]; projects: TownProject[]; events: TownEvent[]; achievements: TownAchievement[];
  contribution_left_today: number; gifts_left_today: number };
export type GiftableItem = { id: string; name: string; art: string | null; rarity: string; variant: string; free: number };
export type TownGift = { id: number; direction: 'sent' | 'received'; other_id: number; other_name: string;
  item: { id: string; name: string; art: string | null } | null; created_at: string };

export const townApi = {
  map: () => request('/api/town/map') as Promise<TownMap>,
  contribute: (projectId: number, amount: number, ref: string) =>
    request(`/api/town/projects/${projectId}/contribute`, { method: 'POST', body: { amount, client_ref: ref } }) as
    Promise<{ project: TownProject; coins: number; already_recorded: boolean; contribution_left_today: number }>,
  giftable: () => request('/api/town/giftable') as Promise<GiftableItem[]>,
  gifts: () => request('/api/town/gifts') as Promise<TownGift[]>,
  sendGift: (receiverId: number, item: GiftableItem, ref: string) => request('/api/town/gifts', { method: 'POST', body: {
    receiver_id: receiverId, item_id: item.id, variant: item.variant, client_ref: ref } }) as Promise<{ already_sent: boolean }>,
  visits: () => request('/api/town/visits/history') as Promise<{ direction: 'in' | 'out'; user_id: number; display_name: string; visited_at: string }[]>,
  report: (userId: number, reason: string) => request(`/api/users/${userId}/report`, { method: 'POST', body: { reason, details: null } }),
};

// ---- Hành trình sự nghiệp
export type SkillStatus = 'locked' | 'available' | 'in_progress' | 'practiced' | 'assessed';
export type CareerSkill = { id: number; code: string; group: string; name: string; description: string; goal: string; level: number;
  prerequisites: string[]; activities: string[]; has_assessment: boolean; assessment: { q: string; options: string[] }[];
  unlocked: boolean; status: SkillStatus; progress_percent: number };
export type CareerSummary = { id: number; code: string; name: string; description: string; icon: string; skills_total: number;
  skills_done: number; selected: boolean; active: boolean; current_goal: string | null };
export type CareerDetail = CareerSummary & { groups: { name: string; skills: CareerSkill[] }[];
  milestones: { code: string; title: string; earned: boolean }[]; new_badges: { milestone: string; title: string }[] };

export const careerApi = {
  list: () => request('/api/careers') as Promise<CareerSummary[]>,
  detail: (code: string) => request(`/api/careers/${code}`) as Promise<CareerDetail>,
  choose: (code: string, goal?: string | null) => request('/api/careers/profile', { method: 'POST', body: { career_code: code, current_goal: goal ?? null } }) as
    Promise<CareerDetail>,
  progress: (skillId: number, body: { progress_percent?: number; practiced?: boolean }) =>
    request(`/api/careers/skills/${skillId}/progress`, { method: 'PATCH', body }) as Promise<CareerDetail & { awarded_exp: number }>,
  assess: (skillId: number, answers: number[]) => request(`/api/careers/skills/${skillId}/assessment`, { method: 'POST', body: { answers } }) as
    Promise<CareerDetail & { passed: boolean; correct: number; total: number; awarded_exp: number }>,
};
