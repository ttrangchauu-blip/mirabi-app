import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import type { User } from '../../auth/AuthContext';
import { togetherApi } from '../../studyTogether/api';
import { RealtimeClient } from '../../studyTogether/realtime';
import { appTheme as t } from '../../theme';
import { useToast } from '../../ui/Toast';
import { CreateRoomScreen } from './CreateRoomScreen';
import type { FriendsTab } from './FriendsScreen';
import { InvitationScreen } from './InvitationScreen';
import { JoinRoomScreen } from './JoinRoomScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { RoomScreen } from './RoomScreen';
import { SessionSummaryScreen } from './SessionSummaryScreen';
import { TeamQuestDetailScreen, TeamQuestsScreen } from './TeamQuestsScreen';
import { TogetherHome } from './TogetherHome';
import { Nav, NavContext, RefreshContext, Route } from './navigation';
import type { StudyMode } from './StudyModeSwitch';

type Props = { user: User; onExit: (mode?: Exclude<StudyMode, 'together'>) => void; onRewards: () => void; createClient?: () => RealtimeClient;
  onVisitRoom?: (userId: number) => void;
  onOpenFriends?: (tab?: FriendsTab) => void;
  onOpenGarden?: () => void;
  /** Open on this screen (above the home), e.g. the inbox from the Home bell or a room after "Rủ học". */
  initialRoute?: Route | null };

export function StudyTogetherScreen({ user, onExit, onRewards, createClient, onVisitRoom, onOpenFriends, onOpenGarden, initialRoute }: Props) {
  const [stack, setStack] = useState<Route[]>(() => (initialRoute && initialRoute.name !== 'home' ? [{ name: 'home' }, initialRoute] : [{ name: 'home' }]));
  const [refreshing, setRefreshing] = useState(false);
  const loader = useRef<(() => Promise<void>) | null>(null);
  const realtime = useMemo(() => createClient?.() ?? new RealtimeClient(() => togetherApi.ticket()), [createClient]);
  const toast = useToast();
  const route = stack[stack.length - 1];

  useEffect(() => {
    realtime.start();
    const off = realtime.onMessage((m) => { if (m.type === 'notification') toast(m.notification.title, 'info'); });
    return () => { off(); realtime.stop(); };
  }, [realtime, toast]);

  const nav = useMemo<Nav>(() => ({
    push: (r) => setStack((st) => [...st, r]),
    replace: (r) => setStack((st) => [...st.slice(0, -1), r]),
    back: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    home: () => setStack([{ name: 'home' }]),
    exit: onExit,
    user, realtime, onRewards, visitRoom: onVisitRoom, openFriends: onOpenFriends, openGarden: onOpenGarden,
  }), [onExit, onRewards, realtime, user, onVisitRoom, onOpenFriends, onOpenGarden]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) nav.back(); else onExit();
      return true;
    });
    return () => sub.remove();
  }, [nav, onExit, stack.length]);

  const register = useCallback((load: (() => Promise<void>) | null) => { loader.current = load; }, []);
  const onRefresh = useCallback(async () => {
    if (!loader.current) return;
    setRefreshing(true);
    try { await loader.current(); } finally { setRefreshing(false); }
  }, []);

  return (
    <NavContext.Provider value={nav}>
      <RefreshContext.Provider value={register}>
        <ScrollView key={stack.length + route.name} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} colors={[t.accent]} />}>
          {route.name === 'home' && <TogetherHome />}
          {route.name === 'create' && <CreateRoomScreen />}
          {route.name === 'join' && <JoinRoomScreen initialCode={route.code} />}
          {route.name === 'room' && <RoomScreen roomId={route.roomId} initial={route.initial ?? null} />}
          {route.name === 'summary' && <SessionSummaryScreen sessionId={route.sessionId} />}
          {route.name === 'quests' && <TeamQuestsScreen />}
          {route.name === 'quest' && <TeamQuestDetailScreen questId={route.questId} />}
          {route.name === 'notifications' && <NotificationsScreen />}
          {route.name === 'invitation' && <InvitationScreen invitationId={route.invitationId} />}
        </ScrollView>
      </RefreshContext.Provider>
    </NavContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 28 },
});
