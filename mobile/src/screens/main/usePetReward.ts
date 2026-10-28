import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { request } from './shared';

export type PetRewardItem = { id: string; name: string; emoji: string; rarity: string; kind: string; quantity: number };
/** A finished walk whose rewards the backend has already granted; only the popup is still waiting. */
export type PendingPetReward = { walk_id: number; exp: number; items: PetRewardItem[] };

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Reads the backend's pending reward. Anything malformed is dropped rather than shown with made-up values. */
export function pendingRewardFrom(space: any): PendingPetReward | null {
  const reward = space?.pending_reward;
  if (!reward || !Number.isInteger(reward.walk_id) || !isCount(reward.exp) || !Array.isArray(reward.items)) return null;
  const items = reward.items.filter((item: any): item is PetRewardItem => !!item && typeof item.id === 'string'
    && typeof item.name === 'string' && item.name.length > 0 && isCount(item.quantity) && item.quantity > 0);
  return { walk_id: reward.walk_id, exp: reward.exp, items };
}

/**
 * The pet's gift popup. The backend is the only source: it is asked when the app opens, when it comes back to the
 * foreground and when a walk is due to end. "Nhận quà" only confirms the popup; the rewards were granted already.
 */
export function usePetReward(onConfirmed: () => void) {
  const [pending, setPending] = useState<PendingPetReward | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a confirmation so screens showing the walk reload it.
  const [version, setVersion] = useState(0);
  const [returnAt, setReturnAt] = useState<number | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  // Bumped by every check and confirmation, so an older answer arriving late never brings a confirmed popup back.
  const checkId = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  /** Resolves to the pending reward (or null), or undefined when the backend couldn't be reached. */
  const check = useCallback(async (): Promise<PendingPetReward | null | undefined> => {
    const id = ++checkId.current;
    try {
      const space = await request('/api/pet/space');
      if (!mounted.current) return undefined;
      const next = pendingRewardFrom(space);
      if (id !== checkId.current) return next;
      setPending(next);
      const seconds = Number(space?.seconds_left);
      setReturnAt(space?.status === 'walking' && seconds > 0 ? Date.now() + seconds * 1000 : null);
      return next;
    } catch {
      return undefined; // keep what is on screen; the next open or return time asks again
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void check(); });
    return () => sub.remove();
  }, [check]);
  useEffect(() => {
    if (returnAt === null) return;
    const timer = setTimeout(() => { void check(); }, Math.max(0, returnAt - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [returnAt, check]);

  const confirmed = useCallback(() => {
    checkId.current += 1;
    setPending(null); setError(null); setVersion((v) => v + 1); onConfirmed();
  }, [onConfirmed]);

  const confirm = useCallback(async () => {
    const current = pending;
    if (!current || busy.current) return;
    busy.current = true;
    setConfirming(true); setError(null);
    try {
      await request(`/api/pet/walks/${current.walk_id}/acknowledge`, { method: 'POST' });
      if (mounted.current) confirmed();
    } catch {
      // The request may have gone through anyway, or another device confirmed it: ask the backend.
      const latest = await check();
      if (!mounted.current) return;
      if (latest !== undefined && latest?.walk_id !== current.walk_id) confirmed();
      else setError('Chưa kết nối được. Quà vẫn được giữ an toàn, bạn hãy thử lại nhé.');
    } finally {
      busy.current = false;
      if (mounted.current) setConfirming(false);
    }
  }, [pending, check, confirmed]);

  return { pending, confirming, error, version, check, confirm };
}
