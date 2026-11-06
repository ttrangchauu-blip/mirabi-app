import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { NotificationSettings } from '../settings/accountSettings';

/**
 * The device's own permission to show Mirabi's notifications: separate from what the user chose in Mirabi (the account's
 * NotificationSettings). Mirabi asks the system only when the user turns notifications on, or starts something that
 * notifies (a focus session), and only while the system hasn't been asked yet: never in a loop, never at launch.
 */
export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type Permission = { status: PermissionStatus; canAskAgain: boolean };

/** The web build has no scheduled notifications (the browser would need a service worker Mirabi doesn't have). */
export const NOTIFICATIONS_SUPPORTED = Platform.OS !== 'web';

function read(p: any): Permission {
  if (p?.granted) return { status: 'granted', canAskAgain: true };
  const status: PermissionStatus = p?.status === 'denied' ? 'denied' : 'undetermined';
  return { status, canAskAgain: p?.canAskAgain ?? status === 'undetermined' };
}

export async function readPermission(): Promise<Permission> {
  if (!NOTIFICATIONS_SUPPORTED) return { status: 'unsupported', canAskAgain: false };
  try { return read(await Notifications.getPermissionsAsync()); } catch { return { status: 'undetermined', canAskAgain: false }; }
}

/** Shows the system's question if it can still be shown; otherwise just reads the answer already given. */
export async function askPermission(): Promise<Permission> {
  const current = await readPermission();
  if (current.status === 'granted' || current.status === 'unsupported' || !current.canAskAgain) return current;
  try { return read(await Notifications.requestPermissionsAsync()); } catch { return current; }
}

/** Asks only the first time (the system was never asked); later it respects the answer the user gave. */
export async function permissionToSchedule(): Promise<boolean> {
  const current = await readPermission();
  if (current.status === 'granted') return true;
  if (current.status !== 'undetermined') return false;
  return (await askPermission()).status === 'granted';
}

/** The device's permission, read again whenever Mirabi comes back to the front (the user may have changed it). */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<Permission | null>(null);
  const refresh = useCallback(async () => { const next = await readPermission(); setPermission(next); return next; }, []);
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => sub.remove();
  }, [refresh]);
  const ask = useCallback(async () => { const next = await askPermission(); setPermission(next); return next; }, []);
  return { permission, refresh, ask, openSettings: () => { void Linking.openSettings().catch(() => {}); } };
}

/** Kinds that are notifications of the device (scheduled here); the others are notices inside the app. */
export const DEVICE_KINDS = ['focus', 'pet'] as const;
export type NoticeKind = 'focus' | 'pet' | 'achievements' | 'friends';

/** Whether Mirabi may notify about `kind`: the user's choice for it, and the master switch. */
export const wants = (prefs: NotificationSettings, kind: NoticeKind) => prefs.enabled && prefs[kind];
