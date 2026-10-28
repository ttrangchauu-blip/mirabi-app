import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '../screens/main/shared';
import type { Greeting, GreetingResult, Layout, OwnRoom, PetPlayResult, Pose, SavedRoom, StudyInviteInput, StudyInviteResult, VisitedRoom } from './types';

// v2: rooms with freely placed items (v1 rooms had fixed slots and are not read back).
const cacheKey = (userId: number) => `mirabi.room.v2:${userId}`;

export const roomApi = {
  get: (): Promise<OwnRoom> => request('/api/personal-room'),
  save: (name: string, layout: Layout, version: number): Promise<{ room: SavedRoom }> => request('/api/personal-room', {
    method: 'PUT',
    body: { name, version, wall_id: layout.wall, floor_id: layout.floor, items: layout.items },
  }),
  preview: (pose: Pose, title: string, message: string): Promise<{ svg: string; pose: Pose }> =>
    request('/api/personal-room/photo/preview', { method: 'POST', body: { pose, title: title.trim() || null, message: message.trim() || null } }),
  savePhoto: (pose: Pose, title: string, message: string, clientRequestId: string) => request('/api/personal-room/photo', {
    method: 'POST', body: { pose, title: title.trim() || null, message: message.trim() || null, client_request_id: clientRequestId },
  }),
  visit: (userId: number): Promise<VisitedRoom> => request(`/api/personal-room/visit/${userId}`),
  /** `clientRequestId` stays the same when one tap is retried, so the friend never gets it twice. */
  greet: (userId: number, kind: Greeting, message: string | null, clientRequestId: string): Promise<GreetingResult> =>
    request(`/api/personal-room/visit/${userId}/greetings`, { method: 'POST',
      body: { kind, ...(message ? { message } : {}), client_request_id: clientRequestId } }),
  /** Playing with a friend's pet; the backend decides whether it gives EXP. Same id on a retry: the same answer. */
  playWithPet: (userId: number, clientRequestId: string): Promise<PetPlayResult> =>
    request(`/api/personal-room/visit/${userId}/pet-play`, { method: 'POST', body: { client_request_id: clientRequestId } }),
  inviteToStudy: (userId: number, input: StudyInviteInput, clientRequestId: string): Promise<StudyInviteResult> =>
    request(`/api/personal-room/visit/${userId}/study-invite`, { method: 'POST', body: { ...input, client_request_id: clientRequestId } }),
};

/** The last room the server confirmed, so the room still shows (read only) without a connection. */
export const roomCache = {
  load: async (userId: number): Promise<OwnRoom | null> => {
    try { const raw = await AsyncStorage.getItem(cacheKey(userId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  store: (userId: number, room: OwnRoom) => AsyncStorage.setItem(cacheKey(userId), JSON.stringify(room)).catch(() => {}),
};
