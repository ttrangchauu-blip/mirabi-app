import { createContext, useContext, useEffect } from 'react';
import type { User } from '../../auth/AuthContext';
import type { RealtimeClient } from '../../studyTogether/realtime';
import type { RoomSnapshot } from '../../studyTogether/types';
import type { FriendsTab } from './FriendsScreen';
import type { StudyMode } from './StudyModeSwitch';

// Kept apart from StudyTogetherScreen so its screens can use these without importing the container (no require cycle).

export type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'join'; code?: string }
  | { name: 'room'; roomId: number; initial?: RoomSnapshot | null }
  | { name: 'summary'; sessionId: number }
  | { name: 'quests' }
  | { name: 'quest'; questId: number }
  | { name: 'notifications' }
  | { name: 'invitation'; invitationId: number };

export type Nav = {
  push: (route: Route) => void;
  replace: (route: Route) => void;
  back: () => void;
  home: () => void;
  /** Leave Study Together for another study mode (the personal space by default). */
  exit: (mode?: Exclude<StudyMode, 'together'>) => void;
  user: User;
  realtime: RealtimeClient;
  /** EXP or level may have changed (after a session or quest); the main app reloads its numbers. */
  onRewards: () => void;
  /** Opens a friend's personal room (read only). */
  visitRoom?: (userId: number) => void;
  /** Opens Community → Bạn bè (friends, requests, adding friends), where friends now live. */
  openFriends?: (tab?: FriendsTab) => void;
  /** Opens your own Vườn nhà (a friend watered or tended it). */
  openGarden?: () => void;
};

export const NavContext = createContext<Nav | null>(null);
export const RefreshContext = createContext<(load: (() => Promise<void>) | null) => void>(() => {});

export function useTogetherNav() {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useTogetherNav must be used inside <StudyTogetherScreen>');
  return nav;
}

/** Screens register their loader; pulling down the list calls it. */
export function usePullToRefresh(load: () => Promise<void>) {
  const register = useContext(RefreshContext);
  useEffect(() => { register(load); return () => register(null); }, [load, register]);
}
