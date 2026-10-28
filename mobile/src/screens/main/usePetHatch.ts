import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const seenKey = (userId: number, pet: string) => `refmi.petLevelSeen.v1:${userId}:${pet}`;

/**
 * Whether the pet's egg hatching should be shown: the pet was last seen on this device as an egg (Lv.0) and is now
 * Lv.1 or above, whether it got there while the app was open or closed. The backend keeps no record of the hatching
 * having been watched, so the last level seen is remembered per user and pet on the device. A device that never saw
 * the egg (a new install, a pet already grown) just remembers the current level.
 */
export function usePetHatch(user: { id: number; pet: string; level: number } | null) {
  const [hatching, setHatching] = useState(false);
  const userId = user?.id;
  const pet = user?.pet;
  const level = user?.level;

  useEffect(() => {
    if (userId == null || !pet || level == null) return;
    let active = true;
    const key = seenKey(userId, pet);
    AsyncStorage.getItem(key).then((seen) => {
      if (!active) return;
      // The level is only remembered once the hatching has been watched (see `done`).
      if (seen === '0' && level >= 1) setHatching(true);
      else if (seen !== String(level)) void AsyncStorage.setItem(key, String(level)).catch(() => {});
    }).catch(() => {});
    return () => { active = false; };
  }, [userId, pet, level]);

  const done = useCallback(() => {
    setHatching(false);
    if (userId != null && pet && level != null) void AsyncStorage.setItem(seenKey(userId, pet), String(level)).catch(() => {});
  }, [userId, pet, level]);

  return { hatching, done };
}
