import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './shared';

/** What the backend says about the egg (/api/pet/space `hatch`): "ready" to hatch now, or waiting for the pet to come
 * back from its walk (and its gift popup to be confirmed). `level` is the pet's level once hatched. */
export type HatchInfo = { status: 'none' | 'ready' | 'waiting_return'; level: number | null };
/** 'hatching': the egg cracks in the Home frame. 'celebrating': the congratulations are open. */
export type HatchPhase = 'idle' | 'hatching' | 'celebrating';

const NONE: HatchInfo = { status: 'none', level: null };
const stepKey = (userId: number, pet: string) => `refmi.petHatchStep.v1:${userId}:${pet}`;

export function hatchFrom(space: any): HatchInfo {
  const status = space?.hatch?.status;
  const level = space?.hatch?.level;
  if ((status === 'ready' || status === 'waiting_return') && Number.isInteger(level) && level >= 1) return { status, level };
  return NONE;
}

/**
 * The egg's hatching, driven by the backend, which never has it ready while the pet is out on its walk. The app plays
 * the hatch, shows the congratulations, and only once they are closed tells the backend (POST /api/pet/hatch). That
 * hatches the egg for good and, with every goal of today done, starts the walk from that moment.
 *
 * The step reached is remembered on the device: an app closed after the animation reopens on the congratulations, one
 * closed during it plays the animation again. `sync` takes each /api/pet/space answer.
 */
export function usePetHatch(user: { id: number; pet: string } | null, onHatched: (result: any) => void) {
  const [info, setInfo] = useState<HatchInfo>(NONE);
  // The walk is waiting for the hatch ("Pet sẽ đi khám phá sau khi nở xong").
  const [walkWaiting, setWalkWaiting] = useState(false);
  const [phase, setPhase] = useState<HatchPhase>('idle');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const userId = user?.id;
  const pet = user?.pet;

  const sync = useCallback((space: any) => {
    setInfo(hatchFrom(space));
    setWalkWaiting(space?.status === 'waiting_hatch');
  }, []);

  useEffect(() => {
    if (userId == null || !pet) return;
    const key = stepKey(userId, pet);
    if (info.status !== 'ready') {
      // Hatched (maybe on another device), nothing to hatch, or the pet is out: no hatch on screen.
      setPhase('idle');
      if (info.status === 'none') void AsyncStorage.removeItem(key).catch(() => {});
      return;
    }
    let active = true;
    const resume = (step: string | null) => { if (active) setPhase((p) => p !== 'idle' ? p : step === 'celebrating' ? 'celebrating' : 'hatching'); };
    AsyncStorage.getItem(key).then(resume, () => resume(null));
    return () => { active = false; };
  }, [info.status, userId, pet]);

  /** The egg has cracked and the pet is out: on to the congratulations. */
  const played = useCallback(() => {
    setPhase((p) => (p === 'hatching' ? 'celebrating' : p));
    if (userId != null && pet) void AsyncStorage.setItem(stepKey(userId, pet), 'celebrating').catch(() => {});
  }, [userId, pet]);

  const finished = useCallback((result: any) => {
    if (userId != null && pet) void AsyncStorage.removeItem(stepKey(userId, pet)).catch(() => {});
    setPhase('idle'); setError(null); sync(result); onHatched(result);
  }, [userId, pet, sync, onHatched]);

  /** The congratulations are closed: the backend hatches the egg (once, however many taps or devices). */
  const confirm = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setConfirming(true); setError(null);
    try {
      const result = await request('/api/pet/hatch', { method: 'POST' });
      if (mounted.current) finished(result);
    } catch {
      // The request may have gone through anyway, or another device hatched the egg: ask the backend.
      let space: any;
      try { space = await request('/api/pet/space'); } catch { space = undefined; }
      if (!mounted.current) return;
      if (space && hatchFrom(space).status === 'none') finished(space);
      else setError('Chưa kết nối được. Bạn hãy thử lại nhé.');
    } finally {
      busy.current = false;
      if (mounted.current) setConfirming(false);
    }
  }, [finished]);

  return { phase, level: info.level, waitingReturn: info.status === 'waiting_return', walkWaiting, confirming, error, sync, played, confirm };
}
