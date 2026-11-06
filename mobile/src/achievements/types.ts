/** Thành tựu, as GET /api/achievements returns them (backend/app/achievements.py). The app never computes progress:
 * every number here was read by the backend from the feature's own records. */
export type Material = 'bronze' | 'silver' | 'gold' | 'diamond' | 'legendary';

export type AchievementTier = {
  rank: number; threshold: number; title: string; goal: string; name: string; material: Material; reward_coins: number;
  unlocked: boolean; unlock_id: number | null; unlocked_at: string | null; claimed_at: string | null; claimable: boolean;
  backfilled: boolean; new: boolean;
};

export type Achievement = {
  id: string; group: string; icon: string; unit: string; description: string; milestone: boolean; coins: boolean;
  progress: number; title: string; tier: number; material: Material | null; tier_name: string | null;
  next: Pick<AchievementTier, 'rank' | 'threshold' | 'title' | 'goal' | 'name' | 'material' | 'reward_coins'> | null;
  completed: boolean; claimable: number; new: boolean; tiers: AchievementTier[];
};

export type AchievementUnlock = {
  id: number; achievement: string; tier: number; title: string; name: string; material: Material; icon: string;
  group: string | null; reward_coins: number; unlocked_at: string; claimed_at: string | null; claimable: boolean;
  backfilled: boolean; new: boolean;
};

export type AchievementGroup = { id: string; name: string; icon: string; total: number; unlocked: number };

export type AchievementsOverview = {
  summary: { unlocked: number; total: number; percent: number; claimable: number; claimable_coins: number };
  groups: AchievementGroup[];
  tiers: { rank: number; name: string; material: Material }[];
  achievements: Achievement[];
  near: string[];
  recent: AchievementUnlock[];
  daily_tasks_counted: number;
  coins: number;
};

export type ClaimResult = { paid: boolean; already_claimed: boolean; reward_coins: number; coins: number; unlock: AchievementUnlock };
export type ClaimAllResult = { paid: number; reward_coins: number; coins: number };
