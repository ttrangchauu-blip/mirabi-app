import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from '../screens/main/shared';
import { inZones } from './art';
import type { Catalog, FocusRoomData, Greeting, GreetingResult, Layout, OwnRoom, PetPlayResult, Pose, RoomKind, SavedRoom, StudyInviteInput, StudyInviteResult, VisitedRoom } from './types';

// v3: rooms on the full-screen canvas of art v5 (v2 rooms are on the older canvas, v1 rooms had fixed slots; neither is
// read back).
const cacheKey = (userId: number) => `mirabi.room.v3:${userId}`;

/** Every room the app draws comes through here: each item inside its part of the room (`art.inZones`). */
const placed = <T extends { room: { layout: Layout } }>(data: T, kind: RoomKind = 'personal'): T =>
  ({ ...data, room: { ...data.room, layout: inZones(data.room.layout, kind) } });
const placedOrNull = <T extends { room: { layout: Layout } }>(data: T | null, kind: RoomKind = 'personal') => (data ? placed(data, kind) : null);

export const roomApi = {
  get: async (): Promise<OwnRoom> => placed<OwnRoom>(await request('/api/personal-room')),
  /** Saves the whole room; its placed copies of found decorations are claimed and freed with it (`catalog`: the new counts). */
  save: async (name: string, layout: Layout, version: number): Promise<{ room: SavedRoom; catalog?: Catalog }> => placed<{ room: SavedRoom; catalog?: Catalog }>(await request('/api/personal-room', {
    method: 'PUT',
    body: { name, version, wall_id: layout.wall, floor_id: layout.floor, items: layout.items },
  })),
  preview: (pose: Pose, title: string, message: string): Promise<{ svg: string; pose: Pose }> =>
    request('/api/personal-room/photo/preview', { method: 'POST', body: { pose, title: title.trim() || null, message: message.trim() || null } }),
  savePhoto: (pose: Pose, title: string, message: string, clientRequestId: string) => request('/api/personal-room/photo', {
    method: 'POST', body: { pose, title: title.trim() || null, message: message.trim() || null, client_request_id: clientRequestId },
  }),
  visit: async (userId: number): Promise<VisitedRoom> => placed<VisitedRoom>(await request(`/api/personal-room/visit/${userId}`)),
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

/** The decorated Phòng tập trung: same catalog and rules as the personal room, its own layout (pet_room.py). */
export const focusRoomApi = {
  get: async (): Promise<FocusRoomData> => placed<FocusRoomData>(await request('/api/focus-room'), 'focus'),
  save: async (layout: Layout, version: number): Promise<{ room: SavedRoom; catalog?: Catalog }> => placed<{ room: SavedRoom; catalog?: Catalog }>(await request('/api/focus-room', {
    method: 'PUT', body: { version, wall_id: layout.wall, floor_id: layout.floor, items: layout.items },
  }), 'focus'),
};
const focusCacheKey = (userId: number) => `mirabi.focusRoom.v1:${userId}`;
export const focusRoomCache = {
  load: async (userId: number): Promise<FocusRoomData | null> => {
    try { const raw = await AsyncStorage.getItem(focusCacheKey(userId)); return placedOrNull<FocusRoomData>(raw ? JSON.parse(raw) : null, 'focus'); } catch { return null; }
  },
  store: (userId: number, room: FocusRoomData) => AsyncStorage.setItem(focusCacheKey(userId), JSON.stringify(room)).catch(() => {}),
};

/** The last room the server confirmed, so the room still shows (read only) without a connection. */
export const roomCache = {
  load: async (userId: number): Promise<OwnRoom | null> => {
    try { const raw = await AsyncStorage.getItem(cacheKey(userId)); return placedOrNull<OwnRoom>(raw ? JSON.parse(raw) : null); } catch { return null; }
  },
  store: (userId: number, room: OwnRoom) => AsyncStorage.setItem(cacheKey(userId), JSON.stringify(room)).catch(() => {}),
};
