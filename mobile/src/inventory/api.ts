import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { request } from '../screens/main/shared';
import type { RoomKind } from '../room/types';
import type { CareKind, CareResult, GardenData, InventoryData, ItemDetail, VisitedGarden } from './types';

/** The inventory and the garden. The backend decides everything; changes need a connection and its answer. */
export const inventoryApi = {
  list: (): Promise<InventoryData> => request('/api/inventory'),
  detail: (item: string, variant: string): Promise<ItemDetail> =>
    request(`/api/inventory/items/${encodeURIComponent(item)}?variant=${encodeURIComponent(variant)}`),
  /** Its detail was opened: it is no longer "Mới". */
  seen: (item: string, variant: string) => request(`/api/inventory/items/${encodeURIComponent(item)}/seen`, { method: 'POST', body: { variant } }),
  garden: (): Promise<GardenData> => request('/api/garden'),
  /** `clientRequestId` stays the same when one tap is retried, so the seed is planted (and used) once. */
  plant: (plot: number, item: string, variant: string, clientRequestId: string): Promise<{ planted: boolean; replayed: boolean; garden: GardenData }> =>
    request(`/api/garden/plots/${plot}/plant`, { method: 'POST', body: { item_id: item, variant, client_request_id: clientRequestId } }),
  clear: (plot: number): Promise<{ garden: GardenData }> => request(`/api/garden/plots/${plot}/clear`, { method: 'POST' }),
  /** Water or tend one's own plant; the same `clientRequestId` on a retry is handled once. */
  care: (plot: number, kind: CareKind, clientRequestId: string): Promise<CareResult & { garden: GardenData }> =>
    request(`/api/garden/plots/${plot}/care`, { method: 'POST', body: { kind, client_request_id: clientRequestId } }),
  /** A friend's garden (read only, plus caring). */
  visit: (userId: number): Promise<VisitedGarden> => request(`/api/garden/visit/${userId}`),
  careFriend: (userId: number, plot: number, kind: CareKind, clientRequestId: string): Promise<CareResult & VisitedGarden> =>
    request(`/api/garden/visit/${userId}/plots/${plot}/care`, { method: 'POST', body: { kind, client_request_id: clientRequestId } }),
};

/** The last inventory and garden the server confirmed, shown (read only) without a connection. */
function cache<T>(name: string, valid: (value: any) => boolean) {
  const key = (userId: number) => `mirabi.${name}.v1:${userId}`;
  return {
    load: async (userId: number): Promise<T | null> => {
      try { const raw = await AsyncStorage.getItem(key(userId)); const value = raw ? JSON.parse(raw) : null; return valid(value) ? value : null; } catch { return null; }
    },
    store: (userId: number, value: T) => AsyncStorage.setItem(key(userId), JSON.stringify(value)).catch(() => {}),
  };
}
export const inventoryCache = cache<InventoryData>('inventory', (v) => Array.isArray(v?.items) && Array.isArray(v?.tabs));
export const gardenCache = cache<GardenData>('garden', (v) => Array.isArray(v?.plots));

// ------------------------------------------------------------------------------------------------ "Đặt vào phòng"
/** A decoration chosen in the inventory, to be placed in a room: that room opens its decorating with one more copy. */
export type PlaceRequest = { room: RoomKind; item: string; variant: string; name: string };
let pending: PlaceRequest | null = null;
const listeners = new Set<() => void>();

export function requestPlace(next: PlaceRequest) {
  pending = next;
  listeners.forEach((listener) => listener());
}

/** The waiting request for `room`, taken (it is handled once). */
export function takePlace(room: RoomKind): PlaceRequest | null {
  if (pending?.room !== room) return null;
  const taken = pending;
  pending = null;
  return taken;
}

/** Calls `onRequest` with a request for `room`, one waiting when the screen opens or one made while it is open. */
export function usePlaceRequest(room: RoomKind, enabled: boolean, onRequest: (request: PlaceRequest) => void) {
  useEffect(() => {
    if (!enabled) return;
    const check = () => { const next = takePlace(room); if (next) onRequest(next); };
    check();
    listeners.add(check);
    return () => { listeners.delete(check); };
  }, [room, enabled, onRequest]);
}
