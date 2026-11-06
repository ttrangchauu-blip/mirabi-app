import type { RoomKind } from '../room/types';

/** Kho đồ, see backend/app/inventory.py. One entry is one item in one variant; `owned` = `available` + `placed`. */
export type InventoryTab = 'all' | 'decor' | 'seed' | 'material' | 'keepsake';
export type ItemUse = 'room' | 'garden' | 'album' | 'craft';
export type InventoryItem = {
  id: string; variant: string; name: string; description: string; group: string; group_label: string;
  tab: Exclude<InventoryTab, 'all'>; rarity: string; rarity_label: string; use: ItemUse; use_label: string;
  /** Rooms a decoration can be placed in. */ rooms: RoomKind[];
  /** The room artwork that draws a decoration (also its picture here). */ art: string | null;
  owned: number; placed: number; available: number; is_new: boolean; first_obtained_at: string; last_obtained_at: string;
};
export type InventoryData = {
  tabs: { id: InventoryTab; label: string }[]; rarities: { id: string; label: string }[]; uses: { id: ItemUse; label: string }[];
  items: InventoryItem[]; server_now: string;
};
export type ItemHistory = {
  kind: 'walk_reward' | 'legacy' | 'adventure' | 'work_chest' | 'gift_in' | 'gift_out' | 'plant' | 'place' | 'store' | (string & {}); delta: number; placed_delta: number; ref: string | null; at: string;
  walk_id: number | null; location: { id: string; name: string } | null; memory_id: number | null;
};
export type ItemDetail = {
  item: InventoryItem; placements: { uid: string; room: RoomKind; x: number; y: number; placed_at: string }[];
  history: ItemHistory[]; memory_id: number | null; walk_id: number | null;
};
/** "Tưới nước" and "Chăm sóc": each plant takes each once a day (the owner's day), from the owner or a friend. */
export type CareKind = 'water' | 'tend';
export type PlotCare = { done: boolean; by: { id: number; display_name: string; me: boolean } | null; at: string | null };
/** A plant of the garden's catalog (backend/app/data/garden_plants.json): its tier, growing time and rewards come from the backend. */
export type PlantInfo = {
  plant_id: string; item_id: string; name: string; seed_name: string; description: string; tier: string; tier_label: string;
  /** Which pictures draw it (gardenArt.ts); one the app doesn't know grows as a seedling. */ art: string;
  grow_seconds: number; harvest_exp: number; harvest_coins: number; seed_price: number | null; profit: number | null; unlock_level: number;
};
export type GardenPlot = { plot: number; empty: true } | {
  plot: number; empty: false; item_id: string; variant: string; name: string; rarity: string; planted_at: string;
  /** 0 seed, 1 sprout, 2 young, 3 grown, 4 ready to harvest (older answers had three stages, 0 to 2). */
  stage: number; stage_label: string; grown: boolean; next_stage_at: string | null;
  plant_id?: string; art?: string; tier?: string; tier_label?: string; ready?: boolean; ready_at?: string; grow_seconds?: number; progress?: number;
  stage_count?: number; /** What harvesting it gives, decided by the backend. */ harvest?: { exp: number; coins: number };
  /** Today's care (missing in a garden cached before care existed). */ care?: Record<CareKind, PlotCare>;
};
export type PlantedPlot = Extract<GardenPlot, { empty: false }>;
export type Seed = InventoryItem & { plant?: PlantInfo };
export type GardenExp = { daily_cap: number; earned_today: number; left: number };
/** `seeds`, `coins` and `garden_exp` only in one's own garden: a friend's garden never shows them. */
export type GardenData = { size: number; plots: GardenPlot[]; seeds: Seed[]; server_now: string; care_day?: string; stages?: string[];
  coins?: number; garden_exp?: GardenExp };
export type CareResult = { cared: boolean; replayed: boolean; reason: 'already_cared' | null };
/** A friend's garden, see backend/app/garden.py: the owner, their plots, and how much care the visitor has left today. */
export type GardenOwner = { id: number; display_name: string; avatar_theme: string; pet: string; pet_name: string | null; pet_level: number };
export type VisitedGarden = {
  owner: GardenOwner; garden: Omit<GardenData, 'seeds' | 'coins' | 'garden_exp'>; care: { daily_limit: number; used: number; left: number };
};
/** One harvest, as the backend paid it: `exp` is what the day's cap let through of `exp_requested`. */
export type Harvest = { plot: number; item_id: string; plant_id: string; name: string; art: string; tier: string; tier_label: string;
  coins: number; exp: number; exp_requested: number; exp_capped: boolean; harvested_at: string };
export type HarvestResult = { harvested: boolean; replayed: boolean; harvest: Harvest; coins: number; pet_level: number; xp: number; garden: GardenData };
/** Vườn nhà's seed shop: prices and rewards are the backend's; the app only says what and how many. */
export type ShopItem = PlantInfo & { unlocked: boolean; owned: number };
export type GardenShop = { coins: number; pet_level: number; max_quantity: number; tiers: { id: string; label: string; unlock_level: number }[];
  items: ShopItem[]; garden_exp: GardenExp };
export type BuyResult = { bought: boolean; replayed: boolean; spent: number; coins: number; shop: GardenShop };
