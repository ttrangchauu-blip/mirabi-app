import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { request } from '../screens/main/shared';
import { useToast } from '../ui/Toast';
import type { AchievementUnlock } from './types';

export const NOTICE_POLL_MS = 45000;
const FIRST_CHECK_MS = 4000;

type Unseen = { count: number; ids?: number[]; unlocks: AchievementUnlock[] };

/**
 * "🏅 Mở khóa thành tựu": asks the backend now and then (and when the app comes back) whether a tier was reached that
 * hasn't been announced, on any device. The backend decides from its own records; the app only shows the notice and
 * acknowledges it. Off while `enabled` is false (focus mode mutes toasts, and the achievements screen shows them itself),
 * so a notice is never acknowledged without being seen. A network error just waits for the next check.
 */
export function useAchievementNotices(enabled: boolean, onOpen: () => void) {
  const toast = useToast();
  const toastRef = useRef(toast);
  const openRef = useRef(onOpen);
  toastRef.current = toast;
  openRef.current = onOpen;
  const busy = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const check = useCallback(async () => {
    if (!enabledRef.current || busy.current) return;
    busy.current = true;
    try {
      const body = await request('/api/achievements/unseen') as Unseen | null;
      const unlocks = Array.isArray(body?.unlocks) ? body!.unlocks : [];
      if (!body?.count || !unlocks.length || !enabledRef.current) return;
      const last = unlocks[unlocks.length - 1];
      toastRef.current(body.count === 1 ? `🏅 Mở khóa thành tựu “${last.title}” · ${last.name}` : `🏅 Bạn vừa mở khóa ${body.count} thành tựu mới`,
        'success', { label: 'Xem', onPress: () => openRef.current() });
      const ids = Array.isArray(body.ids) && body.ids.length ? body.ids : unlocks.map((u) => u.id);
      await request('/api/achievements/seen', { method: 'POST', body: { ids } });
    } catch { /* offline or signed out: the next check tries again */ }
    finally { busy.current = false; }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => { void check(); }, FIRST_CHECK_MS);
    const timer = setInterval(() => { void check(); }, NOTICE_POLL_MS);
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void check(); });
    return () => { clearTimeout(first); clearInterval(timer); sub.remove(); };
  }, [enabled, check]);

  return check;
}
