// Payloads of the Study Together API (backend/app/friends.py, study_rooms.py, team_quests.py, notifications.py).
// Every number shown as a result (minutes, cycles, EXP) comes from these server payloads, never from the device.

export type PublicUser = {
  id: number; display_name: string; avatar_theme: string; pet: string; pet_name: string | null; pet_level: number;
  public_code: string | null;
};

export type Presence = 'studying' | 'online' | 'offline' | 'hidden';
export type Friend = PublicUser & {
  presence: Presence; room: { id: number; name: string; member_count: number; max_members: number } | null;
  /** The friend lets friends visit their pet room / accepts study invitations (their privacy settings). */
  can_visit: boolean; accepts_study_invites: boolean;
};
export type Relationship = 'none' | 'friend' | 'outgoing' | 'incoming';
export type SearchResult = PublicUser & { relationship: Relationship; request_id: number | null };
/** The short profile behind an exact friend code (typed or scanned); `self` is your own code. */
export type CodeLookup = PublicUser & { relationship: Relationship | 'self'; request_id: number | null };
export type FriendRequest = { id: number; status: 'pending' | 'accepted' | 'declined'; direction: 'incoming' | 'outgoing'; user: PublicUser; created_at: string; auto_accepted?: boolean };
export type SocialSettings = PublicUser & {
  presence_visibility: 'friends' | 'nobody'; share_study_stats: boolean; discoverable: boolean;
  allow_room_visits: boolean; allow_study_invites: boolean;
};

export type RoomState = 'waiting' | 'focus' | 'break' | 'paused' | 'closed';
export type Visibility = 'private' | 'code';
export type RoomMember = PublicUser & {
  user_id: number; role: 'host' | 'member'; presence: 'online' | 'away'; joined_at: string; in_session: boolean;
  /** null when the member keeps their study stats private. */ focus_seconds: number | null; cycles_completed: number | null;
};
export type RoomSession = {
  id: number; status: 'active' | 'paused' | 'completed' | 'cancelled'; phase: 'focus' | 'break'; cycle: number;
  total_cycles: number; completed_cycles: number; focus_seconds: number; break_seconds: number; phase_seconds: number;
  /** Server-computed time left in the phase when the snapshot was built. */ remaining_ms: number;
  started_at: string; phase_ends_at: string | null;
};
export type RoomQuestBrief = { id: number; template_key: string; title: string; unit: 'minutes' | 'cycles'; progress: number; target: number; status: string; ends_at: string; member_ids: number[] };
export type RoomSnapshot = {
  id: number; code: string; name: string; goal: string | null; subject: string; visibility: Visibility;
  status: 'open' | 'closed'; state: RoomState; host_id: number; focus_minutes: number; break_minutes: number; cycles: number;
  max_members: number; member_count: number; version: number; members: RoomMember[]; session: RoomSession | null;
  last_session_id: number | null; team_quests: RoomQuestBrief[]; server_time: string;
};
export type JoinRefusal = 'room_closed' | 'room_unavailable' | 'room_invite_only' | 'room_full';
export type RoomPreview = {
  id: number; name: string; goal: string | null; subject: string; visibility: Visibility; status: 'open' | 'closed';
  state: 'waiting' | 'in_session' | 'closed'; focus_minutes: number; break_minutes: number; cycles: number;
  member_count: number; max_members: number; host: PublicUser | null; can_join: boolean;
  reason: JoinRefusal | 'already_member' | null;
};
export type EligibleRoom = RoomPreview & { relation: 'member' | 'invited' | 'friend_room'; invitation_id: number | null };
/** What the invitee can do now (backend study_rooms.invitation_state). */
export type InvitationState = 'pending' | 'expired' | 'room_closed' | 'accepted' | 'declined' | 'cancelled';
export type RoomInvitation = { id: number; status: string; state: InvitationState; expires_at: string; created_at: string; inviter: PublicUser; room: RoomPreview };

export type SessionBrief = {
  id: number; room_id: number; room_name: string; status: 'completed' | 'cancelled'; started_at: string; ended_at: string | null;
  total_cycles: number; completed_cycles: number; focus_seconds: number; cycles_completed: number; exp_awarded: number;
  participant_count: number;
};
export type SessionSummary = {
  id: number; status: RoomSession['status']; end_reason: string | null; finalized: boolean; started_at: string; ended_at: string | null;
  total_cycles: number; completed_cycles: number; focus_minutes: number; break_minutes: number;
  room: { id: number; name: string; goal: string | null; status: string } | null;
  me: { focus_seconds: number; cycles_completed: number; study_exp: number; bonus_exp: number; exp_awarded: number; rewarded: boolean };
  participants: (PublicUser & { user_id: number; focus_seconds: number | null; cycles_completed: number | null })[];
  team_quests: { id: number; title: string; unit: 'minutes' | 'cycles'; progress: number; target: number; status: string; added: number }[];
};

export type QuestTemplate = { key: string; title: string; description: string; unit: 'minutes' | 'cycles'; target: number; days: number; reward_exp: number };
export type TeamQuest = {
  id: number; room_id: number; room_name: string; template_key: string; title: string; description: string;
  unit: 'minutes' | 'cycles'; target: number; progress: number; status: 'active' | 'completed' | 'expired'; reward_exp: number;
  starts_at: string; ends_at: string; completed_at: string | null; joined: boolean; my_contribution: number; my_reward_exp: number;
  members: (PublicUser & { user_id: number; contribution: number | null; rewarded: boolean })[];
};

export type NotificationKind = 'friend_request' | 'friend_accepted' | 'room_invitation' | 'session_started' | 'session_completed' | 'team_quest_completed'
  /** A friend visited the personal room: "Chào pet", "Động viên" or "Rủ học". */
  | 'room_visit'
  /** Friends watered or tended plants in Vườn nhà (merged while unread). */
  | 'garden_care';
export type NotificationData = {
  user_id?: number; room_id?: number; session_id?: number; quest_id?: number; invitation_id?: number; request_id?: number;
  /** room_visit: what was sent; unread greetings or cheers of one kind are merged (`actor_ids`, newest first, `count`). */
  action?: 'hello' | 'cheer'; actor_ids?: number[]; count?: number; message?: string | null; host_away?: boolean;
  /** room_invitation sent with "Rủ học" from a pet room. */ source?: 'visit';
};
export type SocialNotification = { id: number; kind: NotificationKind; title: string; body: string; data: NotificationData; read: boolean; created_at: string };

export type TogetherHome = {
  me: PublicUser; current_room: RoomSnapshot | null; friends: Friend[]; incoming_requests: FriendRequest[];
  outgoing_request_count: number; invitations: RoomInvitation[]; rooms: EligibleRoom[]; team_quests: TeamQuest[];
  recent_sessions: SessionBrief[]; unread_notifications: number;
};

export type ReactionKey = 'cheer' | 'clap' | 'star' | 'fire' | 'coffee' | 'heart';

/** Room chat (backend/app/room_chat.py). A removed message keeps its place with `body: null`. */
export type ChatMessage = {
  id: number; room_id: number; client_id: string | null; sender: PublicUser | null; body: string | null;
  deleted: boolean; removed_by: 'sender' | 'host' | null; created_at: string;
};
export type ChatPage = { items: ChatMessage[]; next_before_id: number | null };

/** Messages the realtime socket delivers (backend/app/realtime.py). */
export type RealtimeMessage =
  | { type: 'hello'; user_id: number; heartbeat_seconds: number }
  | { type: 'pong' }
  | { type: 'error'; code: string; room_id?: number }
  | { type: 'room.snapshot' | 'room.updated'; room_id: number; version: number; event?: string; room: RoomSnapshot }
  | { type: 'room.removed'; room_id: number }
  | { type: 'room.reaction'; room_id: number; user_id: number; reaction: ReactionKey; at: string }
  | { type: 'room.message'; room_id: number; message: ChatMessage }
  | { type: 'room.message_deleted'; room_id: number; message_id: number; removed_by: 'sender' | 'host' }
  | { type: 'room.typing'; room_id: number; user_id: number }
  /** `replaces`: an unread notification this one was merged into (drop it from the list). */
  | { type: 'notification'; notification: SocialNotification; replaces?: number };
