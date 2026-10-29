import type { PublicUser, RoomSnapshot } from '../studyTogether/types';

/** Personal pet room, see backend/app/pet_room.py. A room has a wall, a floor and items placed freely in it. */
export type Placement = { item: string; variant: string; x: number; y: number; flip: boolean; rotate: number;
  /** A found decoration's copy (`counted` items): "p<id>" once saved, a temporary "new-…" until then. */
  uid?: string };
export type Layout = { wall: string; floor: string; items: Placement[] };
/** Where the pet is drawn: on its rug, at the desk (studying) or on its bed (resting). */
export type Pose = 'rug' | 'study' | 'rest';
/** Phòng cá nhân, or the Focus Space room (Phòng tập trung): same catalog and rules, each its own canvas and layout. */
export type RoomKind = 'personal' | 'focus';

export type SavedRoom = { name: string; layout: Layout; version: number; updated_at: string };
export type CatalogItem = { id: string; kind: 'wall' | 'floor' | 'item'; group: string; name: string; source: 'starter' | 'walk'; owned: boolean;
  /** A found decoration: placed copy by copy, from the inventory (`Catalog.found`). */
  counted?: boolean };
/** One item and variant of found decorations the user owns: everything owned, placed in any room, and free. */
export type FoundStack = { item: string; item_id: string; variant: string; name: string; rarity: string; rarity_label: string;
  owned: number; placed: number; available: number };
export type Catalog = {
  groups: { id: string; label: string }[];
  surfaces: { id: 'wall' | 'floor'; label: string }[];
  items: CatalogItem[];
  found?: FoundStack[];
  max_items: number;
};
export type WalkState = { away: boolean; return_at: string | null };
export type RoomPet = { id: string; name: string | null; level: number };

export type FocusRoomData = { room: SavedRoom; catalog: Catalog };
export type OwnRoom = { room: SavedRoom; catalog: Catalog; pet: RoomPet & { xp: number }; activity: 'studying' | 'idle'; walk: WalkState };
/** A friend's saved room as a visitor sees it (backend room_visits.visit_room): nothing else about the host. */
export type VisitedRoom = {
  owner: Omit<PublicUser, 'public_code'>; room: { name: string; layout: Layout }; pet: RoomPet; activity: 'studying' | 'idle';
  walk: { away: boolean }; guest_pet: RoomPet; can_invite_study: boolean;
  /** When each interaction can be sent to this friend again; null: now. */
  available_at: Record<VisitAction, string | null>;
  /** What playing with the pet gives today (room_visits.pet_gift_state): `exp` if `available`, else why not. */
  pet_gift: PetGift;
};
export type PetGiftReason = 'already_given' | 'pet_full' | 'pet_away';
export type PetGift = { exp: number; daily_cap: number; available: boolean; reason: PetGiftReason | null };
export type PetPlayResult = { granted: number; reason: 'granted' | PetGiftReason; pet_name: string | null; pet_level: number; replayed: boolean };
export type VisitAction = 'hello' | 'cheer' | 'study_invite';
export type Greeting = Exclude<VisitAction, 'study_invite'>;
export type GreetingResult = { sent: boolean; id: number; kind: Greeting; message: string | null; host_away: boolean; available_at: string; replayed: boolean };
export type StudyInviteInput = { subject: string; focus_minutes: number; break_minutes: number; cycles: number };
export type StudyInviteResult = {
  sent: boolean; id: number; replayed: boolean; created_room: boolean; room: RoomSnapshot | null;
  invitation: { id: number; status: string; expires_at: string } | null; available_at: string;
};
