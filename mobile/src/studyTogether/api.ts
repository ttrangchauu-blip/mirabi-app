import { newIdempotencyKey } from '../api/client';
import { request } from '../screens/main/shared';
import type {
  ChatMessage, ChatPage, CodeLookup, EligibleRoom, Friend, FriendRequest, QuestTemplate, ReactionKey, RoomInvitation, RoomPreview, RoomSnapshot, SearchResult,
  SessionBrief, SessionSummary, SocialNotification, SocialSettings, TeamQuest, TogetherHome, Visibility,
} from './types';

export type RoomInput = {
  name: string; goal: string | null; subject: string; focus_minutes: number; break_minutes: number; cycles: number;
  max_members: number; visibility: Visibility; invitee_ids: number[];
};
type RoomResponse = { room: RoomSnapshot };

// Thin typed wrappers; `request` adds the access token and refreshes it when needed.
export const togetherApi = {
  home: (): Promise<TogetherHome> => request('/api/study-together/home'),

  socialSettings: (): Promise<SocialSettings> => request('/api/social/me'),
  updateSocialSettings: (patch: Partial<Pick<SocialSettings, 'presence_visibility' | 'share_study_stats' | 'discoverable' | 'allow_room_visits' | 'allow_study_invites'>>): Promise<SocialSettings> =>
    request('/api/social/me', { method: 'PATCH', body: patch }),
  search: async (q: string): Promise<SearchResult[]> =>
    (await request(`/api/users/search?q=${encodeURIComponent(q)}`))?.results ?? [],
  /** Exact friend code, typed or read from a friend QR code (sent in the body, never in the URL). */
  lookupFriend: (code: string): Promise<CodeLookup> => request('/api/users/lookup', { method: 'POST', body: { public_code: code } }),
  friends: async (): Promise<Friend[]> => (await request('/api/friends'))?.items ?? [],
  requests: async (direction: 'incoming' | 'outgoing'): Promise<FriendRequest[]> =>
    (await request(`/api/friend-requests?direction=${direction}`))?.items ?? [],
  sendRequest: (target: { user_id: number } | { public_code: string }): Promise<FriendRequest> =>
    request('/api/friend-requests', { method: 'POST', body: target }),
  acceptRequest: (id: number): Promise<FriendRequest> => request(`/api/friend-requests/${id}/accept`, { method: 'POST' }),
  declineRequest: (id: number) => request(`/api/friend-requests/${id}/decline`, { method: 'POST' }),
  cancelRequest: (id: number) => request(`/api/friend-requests/${id}`, { method: 'DELETE' }),
  removeFriend: (userId: number) => request(`/api/friends/${userId}`, { method: 'DELETE' }),
  block: (userId: number) => request(`/api/users/${userId}/block`, { method: 'POST' }),
  report: (userId: number, reason: string, details?: string, roomId?: number, messageId?: number) =>
    request(`/api/users/${userId}/report`, { method: 'POST', body: { reason, details: details || undefined, room_id: roomId, message_id: messageId } }),

  /** The idempotency key makes a retried create (e.g. after a timeout) return the same room instead of a second one. */
  createRoom: (input: RoomInput, idempotencyKey = newIdempotencyKey()): Promise<RoomResponse> =>
    request('/api/study-rooms', { method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey } }),
  rooms: async (): Promise<EligibleRoom[]> => (await request('/api/study-rooms'))?.items ?? [],
  room: (id: number): Promise<RoomSnapshot> => request(`/api/study-rooms/${id}`),
  lookup: (code: string): Promise<RoomPreview> => request('/api/study-rooms/lookup', { method: 'POST', body: { code } }),
  joinByCode: (code: string): Promise<RoomResponse> => request('/api/study-rooms/join', { method: 'POST', body: { code } }),
  joinRoom: (id: number): Promise<RoomResponse> => request(`/api/study-rooms/${id}/join`, { method: 'POST' }),
  leave: (id: number): Promise<{ left: boolean; room_closed: boolean; last_session_id: number | null }> =>
    request(`/api/study-rooms/${id}/leave`, { method: 'POST' }),
  invite: (id: number, userIds: number[]): Promise<{ invited: number[]; skipped: { user_id: number; reason: string }[] }> =>
    request(`/api/study-rooms/${id}/invitations`, { method: 'POST', body: { user_ids: userIds } }),
  start: (id: number): Promise<RoomResponse> => request(`/api/study-rooms/${id}/start`, { method: 'POST' }),
  pause: (id: number): Promise<RoomResponse> => request(`/api/study-rooms/${id}/pause`, { method: 'POST' }),
  resume: (id: number): Promise<RoomResponse> => request(`/api/study-rooms/${id}/resume`, { method: 'POST' }),
  end: (id: number): Promise<RoomResponse & { session_id: number }> => request(`/api/study-rooms/${id}/end`, { method: 'POST' }),
  close: (id: number): Promise<{ closed: boolean; last_session_id: number | null }> => request(`/api/study-rooms/${id}/close`, { method: 'POST' }),
  heartbeat: (id: number): Promise<RoomSnapshot> => request(`/api/study-rooms/${id}/heartbeat`, { method: 'POST' }),
  react: (id: number, reaction: ReactionKey) => request(`/api/study-rooms/${id}/reactions`, { method: 'POST', body: { reaction } }),

  messages: async (roomId: number, beforeId?: number | null): Promise<ChatPage> => {
    const page = await request(`/api/study-rooms/${roomId}/messages${beforeId ? `?before_id=${beforeId}` : ''}`);
    return { items: page?.items ?? [], next_before_id: page?.next_before_id ?? null };
  },
  /** `clientId` stays the same across retries of one message, so the server never posts it twice. */
  sendMessage: (roomId: number, body: string, clientId: string): Promise<{ message: ChatMessage; replayed: boolean }> =>
    request(`/api/study-rooms/${roomId}/messages`, { method: 'POST', body: { body, client_id: clientId } }),
  deleteMessage: (roomId: number, messageId: number) => request(`/api/study-rooms/${roomId}/messages/${messageId}`, { method: 'DELETE' }),

  invitations: async (): Promise<RoomInvitation[]> => (await request('/api/room-invitations'))?.items ?? [],
  invitation: (id: number): Promise<RoomInvitation> => request(`/api/room-invitations/${id}`),
  acceptInvitation: (id: number): Promise<RoomResponse> => request(`/api/room-invitations/${id}/accept`, { method: 'POST' }),
  declineInvitation: (id: number) => request(`/api/room-invitations/${id}/decline`, { method: 'POST' }),

  history: async (): Promise<SessionBrief[]> => (await request('/api/group-sessions/history'))?.items ?? [],
  summary: (sessionId: number): Promise<SessionSummary> => request(`/api/group-sessions/${sessionId}/summary`),

  questTemplates: async (): Promise<QuestTemplate[]> => (await request('/api/team-quests/templates'))?.items ?? [],
  quests: async (): Promise<TeamQuest[]> => (await request('/api/team-quests'))?.items ?? [],
  quest: (id: number): Promise<TeamQuest> => request(`/api/team-quests/${id}`),
  joinQuest: (id: number): Promise<TeamQuest> => request(`/api/team-quests/${id}/join`, { method: 'POST' }),
  createQuest: (roomId: number, templateKey: string): Promise<TeamQuest> =>
    request(`/api/study-rooms/${roomId}/team-quests`, { method: 'POST', body: { template_key: templateKey } }),

  notifications: (): Promise<{ items: SocialNotification[]; unread_count: number }> => request('/api/notifications'),
  markRead: (id: number) => request(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request('/api/notifications/read-all', { method: 'POST' }),

  ticket: (): Promise<{ ticket: string; path: string; heartbeat_seconds: number }> => request('/api/realtime/ticket', { method: 'POST' }),
};
