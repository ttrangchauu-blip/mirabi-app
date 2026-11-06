import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useT } from '../i18n';
import { NOTIFICATIONS_SUPPORTED, readPermission } from './permission';

// One per device, whoever is signed in: the OS keeps a scheduled notification across accounts.
const KEY = 'mirabi.pet.return:notification';
async function cancelScheduled() {
  const existing = await AsyncStorage.getItem(KEY);
  if (!existing) return;
  await AsyncStorage.removeItem(KEY);
  await Notifications.cancelScheduledNotificationAsync(existing).catch(() => {});
}

/**
 * "Mây đã trở về!": a notification of the device for the moment the pet's walk ends (`returnAt`, from /api/pet/space).
 * It is scheduled only while a walk is under way and the device already allows notifications (this never asks: it runs
 * when the app opens). No walk, the choice turned off, or signing out: nothing stays scheduled. Whatever the pet
 * brings back, and whether it hatches, is still decided by the backend when the walk ends.
 */
export function usePetReturnNotice(returnAt: number | null, petName: string, enabled: boolean) {
  const t = useT();
  // Each read of the walk gives a return time a few milliseconds apart: the same second is the same notification.
  const at = returnAt ? Math.ceil(returnAt / 1000) * 1000 : null;
  const title = t('notification.petBackTitle', { pet: petName });
  const body = t('notification.petBackBody');
  useEffect(() => {
    if (!NOTIFICATIONS_SUPPORTED) return;
    let cancelled = false;
    void (async () => {
      await cancelScheduled();
      if (!enabled || !at || at <= Date.now()) return;
      if ((await readPermission()).status !== 'granted' || cancelled) return;
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('pet', { name: 'Pet', importance: Notifications.AndroidImportance.DEFAULT, sound: 'default' });
      const identifier = await Notifications.scheduleNotificationAsync({
        content: { title, body, sound: 'default', data: { kind: 'pet_returned' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), ...(Platform.OS === 'android' ? { channelId: 'pet' } : {}) },
      });
      if (cancelled) await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      else await AsyncStorage.setItem(KEY, identifier);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, at, title, body]);
  // Signing out: this account's pet must not notify whoever signs in next.
  useEffect(() => () => { if (NOTIFICATIONS_SUPPORTED) void cancelScheduled().catch(() => {}); }, []);
}
