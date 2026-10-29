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
  kind: 'walk_reward' | 'legacy' | 'plant' | 'place' | 'store'; delta: number; placed_delta: number; ref: string | null; at: string;
  walk_id: number | null; location: { id: string; name: string } | null; memory_id: number | null;
};
export type ItemDetail = {
  item: InventoryItem; placements: { uid: string; room: RoomKind; x: number; y: number; placed_at: string }[];
  history: ItemHistory[]; memory_id: number | null; walk_id: number | null;
};
/** "Tưới nước" and "Chăm sóc": each plant takes each once a day (the owner's day), from the owner or a friend. */
export type CareKind = 'water' | 'tend';
export type PlotCare = { done: boolean; by: { id: number; display_name: string; me: boolean } | null; at: string | null };
export type GardenPlot = { plot: number; empty: true } | {
  plot: number; empty: false; item_id: string; variant: string; name: string; rarity: string; planted_at: string;
  stage: 0 | 1 | 2; stage_label: string; grown: boolean; next_stage_at: string | null;
  /** Today's care (missing in a garden cached before care existed). */ care?: Record<CareKind, PlotCare>;
};
export type PlantedPlot = Extract<GardenPlot, { empty: false }>;
/** `seeds` only in one's own garden: a friend's garden never shows their inventory. */
export type GardenData = { size: number; plots: GardenPlot[]; seeds: InventoryItem[]; server_now: string; care_day?: string };
export type CareResult = { cared: boolean; replayed: boolean; reason: 'already_cared' | null };
/** A friend's garden, see backend/app/garden.py: the owner, their plots, and how much care the visitor has left today. */
export type GardenOwner = { id: number; display_name: string; avatar_theme: string; pet: string; pet_name: string | null; pet_level: number };
export type VisitedGarden = {
  owner: GardenOwner; garden: Omit<GardenData, 'seeds'>; care: { daily_limit: number; used: number; left: number };
};
