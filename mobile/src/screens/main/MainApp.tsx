import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { petById } from '../../pets';
import { TabKey } from '../../tabs';
import { appTheme } from '../../theme';
import { useMuteToasts, useToast } from '../../ui/Toast';
import { DailyQuestsScreen } from './DailyQuestsScreen';
import { FeedScreen } from './FeedScreen';
import { HomeTab } from './HomeTab';
import { LoginStreakPopup } from './LoginStreakPopup';
import { LoginStreakScreen } from './LoginStreakScreen';
import { MoreTab } from './MoreTab';
import { PetHatchedPopup } from './PetHatchedPopup';
import { PetRewardPopup } from './PetRewardPopup';
import { ProfileScreen } from './ProfileScreen';
import { StudyProfileScreen } from './StudyProfileScreen';
import { StudyTab } from './StudyTab';
import { usePomodoroTimer } from './usePomodoroTimer';
import { TabBar } from './TabBar';
import { Dashboard, Post, Quest, request, showError } from './shared';
import { TaskCreateModal } from './TaskCreateModal';
import { usePetHatch } from './usePetHatch';
import { usePetReward } from './usePetReward';
import { StudyMode, StudyModeSwitch } from '../together/StudyModeSwitch';
import { StudyTogetherScreen } from '../together/StudyTogetherScreen';
import type { Route as TogetherRoute } from '../together/navigation';
import { LearningScreen } from '../learning/LearningScreen';
import { formatClock } from '../../learning/labels';
import { MemoryAlbumScreen } from './MemoryAlbumScreen';
import { RoomTab } from '../room/RoomTab';
import { VisitRoom } from '../room/VisitRoom';
import { FriendsScreen, FriendsTab } from '../together/FriendsScreen';
import { InventoryScreen } from '../inventory/InventoryScreen';
import { FriendGardenScreen } from '../garden/FriendGardenScreen';
import { GardenScreen, type GardenTab } from '../garden/GardenScreen';
import { requestPlace } from '../../inventory/api';
import type { InventoryItem } from '../../inventory/types';
import type { RoomKind } from '../../room/types';

export type FocusTimer = ReturnType<typeof usePomodoroTimer>;

type Overlay = 'profile' | 'studyProfile' | 'quests' | 'streak' | 'album' | 'visit' | 'feed' | 'inventory' | 'garden' | 'gardenVisit';

export function MainApp() {
  const { user, setUser, streakPopup, dismissStreakPopup } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('Home');
  // The Study tab holds both modes: the personal focus space and Study Together.
  const [studyMode, setStudyMode] = useState<StudyMode>('personal');
  // Personal study opens on the subject screen (English, Math, Học tự chọn); "Học tự chọn" is the focus timer.
  // While a game is on screen the tab bar steps aside.
  const [freeStudy, setFreeStudy] = useState(false);
  // Bumped on every visit to the Study tab: the subject screen is rebuilt (fresh catalog and open session).
  const [studyVisit, setStudyVisit] = useState(0);
  const [immersive, setImmersive] = useState(false);
  // Decorating the personal room keeps the tab bar: leaving the tab first asks about unsaved changes (RoomTab sets it).
  const roomLeave = useRef<(() => Promise<boolean>) | null>(null);
  // A friend's room shown over the current tab (from Bạn bè or a notification); back returns there.
  const [visitUserId, setVisitUserId] = useState<number | null>(null);
  // The part of the "Bạn bè" tab a shortcut opens (the room, Study Together or a notification).
  const [friendsTab, setFriendsTab] = useState<FriendsTab>('friends');
  // A Study Together screen to open directly (inbox from the Home bell, friend search or a study room from the Room tab).
  const [togetherRoute, setTogetherRoute] = useState<{ route: TogetherRoute; key: number } | null>(null);
  const togetherKey = useRef(0);
  // Screens opened over the current tab (profile, pet space). Back pops one; switching tabs closes them all.
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const overlay = overlays[overlays.length - 1];
  // The album opened on one memory (a keepsake's), and the seed "Trồng" chose in Kho đồ for the garden.
  const [albumMemory, setAlbumMemory] = useState<number | null>(null);
  const [gardenSeed, setGardenSeed] = useState<{ id: string; variant: string } | null>(null);
  // Vườn nhà's tab (kept while a friend's garden is open over it) and the friend whose garden is visited.
  const [gardenTab, setGardenTab] = useState<GardenTab>('mine');
  const [gardenOwnerId, setGardenOwnerId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [taskModal, setTaskModal] = useState<{ visible: boolean; initialDate: string; onCreated: (date: string) => void }>({
    visible: false, initialDate: new Date().toISOString().slice(0, 10), onCreated: () => {},
  });

  const refresh = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([request('/api/dashboard'), request('/api/community/posts')]);
      setDashboard(d); setUser(d.user); setPosts(p);
    } catch (e) { showError('Không tải được dữ liệu', e); }
  }, [setUser]);
  const timer = usePomodoroTimer(refresh, user?.id);
  const muteToasts = useMuteToasts();
  useEffect(() => { muteToasts(timer.quiet); return () => muteToasts(false); }, [muteToasts, timer.quiet]);
  useEffect(() => { void refresh(); }, [refresh]);
  const loadDashboard = useCallback(async () => {
    try { const d = await request('/api/dashboard'); setDashboard(d); setUser(d.user); } catch (e) { showError('Không tải được dữ liệu', e); }
  }, [setUser]);
  const onQuestChanged = useCallback(async (quests: Quest[]) => {
    setDashboard((current) => current ? { ...current, daily_quests: quests } : current);
    await loadDashboard();
  }, [loadDashboard]);
  // The walk's EXP was granted when the pet came back; reloading shows the latest numbers.
  const petReward = usePetReward(loadDashboard);
  // Hatching first, the walk after: the hatch's confirmation may have started it, so the pet frame reloads.
  const [hatchVersion, setHatchVersion] = useState(0);
  const userRef = useRef(user);
  userRef.current = user;
  const onHatched = useCallback((result: any) => {
    const current = userRef.current;
    if (current && Number.isInteger(result?.pet_level)) setUser({ ...current, level: result.pet_level, xp: Number.isInteger(result?.xp) ? result.xp : current.xp });
    setHatchVersion((v) => v + 1);
    void loadDashboard();
  }, [setUser, loadDashboard]);
  const petHatch = usePetHatch(user, onHatched);
  const toast = useToast();
  const checkMemory = useCallback(async () => {
    try {
      const memory = await request('/api/memories/pending') as { id?: number } | null;
      // Only a real memory (one with an id): anything else would toast over the current notice and acknowledge "undefined".
      if (!memory || !Number.isInteger(memory.id)) return;
      toast('📸 Đã lưu một kỷ niệm mới!', 'success', { label: 'Xem', onPress: () => { setAlbumMemory(null); open('album'); } });
      await request(`/api/memories/${memory.id}/acknowledge`, { method: 'POST' });
    } catch { /* A memory notification never interrupts the current activity. */ }
  }, [toast]);
  useEffect(() => {
    void checkMemory();
    const timerId = setInterval(() => { void checkMemory(); }, 30000);
    return () => clearInterval(timerId);
  }, [checkMemory]);
  // "Xem quà" on the pet frame: always answer, even when the backend has nothing to show yet.
  const openPetGifts = useCallback(async () => {
    const found = await petReward.check();
    if (found === undefined) toast('Chưa kết nối được với Mirabi. Bạn hãy thử lại nhé.');
    else if (!found) toast('Pet đang chuẩn bị quà, bạn quay lại sau ít phút nhé!');
  }, [petReward.check, toast]);
  const back = useCallback(() => setOverlays((o) => o.slice(0, -1)), []);
  useEffect(() => {
    if (!overlay) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  }, [overlay, back]);
  const inFreeStudy = !overlay && tab === 'Study' && studyMode === 'personal' && freeStudy;
  useEffect(() => {
    if (!inFreeStudy) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setFreeStudy(false); return true; });
    return () => sub.remove();
  }, [inFreeStudy]);

  if (!user) return null;
  // Every visit to "Học tập" from the menu starts on the subject screen.
  const navigate = (key: TabKey) => {
    setOverlays([]); setFreeStudy(false); setStudyMode('personal'); setTab(key); setTogetherRoute(null); setFriendsTab('friends');
    if (key === 'Study') setStudyVisit((v) => v + 1);
    if (key === 'Home' || key === 'Community') void loadDashboard(); // fresh counts on the bell and the "Bạn bè" badge
  };
  /** A tab from the tab bar: away from a room being decorated only once its changes are dropped (or there are none). */
  const leaveTo = async (key: TabKey) => {
    if (room && key !== 'Room' && roomLeave.current && !(await roomLeave.current())) return;
    navigate(key);
  };
  const open = (o: Overlay) => setOverlays((s) => [...s, o]);
  const openDailyQuests = () => open('quests');
  const openStreak = () => open('streak');
  const openTaskCreate = (initialDate: string, onCreated: (date: string) => void) => setTaskModal({ visible: true, initialDate, onCreated });
  const openStudyTogether = () => { navigate('Study'); setStudyMode('together'); };
  const openTogether = (route: TogetherRoute) => { openStudyTogether(); setTogetherRoute({ route, key: ++togetherKey.current }); };
  const openFreeStudy = () => { navigate('Study'); setFreeStudy(true); };
  const visitRoom = (userId: number) => { setVisitUserId(userId); open('visit'); };
  const openFriends = (friends: FriendsTab = 'friends') => { navigate('Community'); setFriendsTab(friends); };
  const pendingRequests = dashboard?.pending_friend_requests ?? 0;
  const openInventory = () => open('inventory');
  /** Every way into Vườn nhà (Tiện ích, the room's settings, "Trồng" in Kho đồ, a notification) opens this one screen. */
  const openGarden = (seed: { id: string; variant: string } | null = null) => { setGardenSeed(seed); setGardenTab('mine'); open('garden'); };
  const visitGarden = (userId: number) => { setGardenOwnerId(userId); open('gardenVisit'); };
  const openAlbum = (memoryId: number | null = null) => { setAlbumMemory(memoryId); open('album'); };
  /** "Đặt vào phòng" in Kho đồ: that room opens its decorating with one more copy of the item. */
  const placeInRoom = (item: InventoryItem, room: RoomKind) => {
    if (!item.art) return;
    requestPlace({ room, item: item.art, variant: item.variant, name: item.name });
    if (room === 'personal') navigate('Room'); else openFreeStudy();
  };
  const openStudyRoom = (roomId: number) => openTogether({ name: 'room', roomId });
  // A "Học tự chọn" session under way (running or paused) is offered on the subject screen.
  const focus = timer.running || timer.activeCycle ? {
    status: timer.phase === 'focus' ? (timer.running ? 'Đang tập trung' : 'Đang tạm dừng') : timer.running ? 'Đang nghỉ' : 'Chờ nghỉ',
    clock: formatClock(timer.seconds * 1000) } : null;
  // Study Together and the learning games scroll on their own (nested screens), so they replace the shared ScrollView.
  const together = !overlay && tab === 'Study' && studyMode === 'together';
  const games = !overlay && tab === 'Study' && studyMode === 'personal' && !freeStudy;
  const album = overlay === 'album';
  const inventory = overlay === 'inventory';
  const garden = overlay === 'garden';
  const gardenVisit = overlay === 'gardenVisit' && gardenOwnerId !== null;
  const visiting = overlay === 'visit' && visitUserId !== null;
  const room = !overlay && tab === 'Room';

  return (
    <LinearGradient colors={appTheme.backdrop} style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      {album ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}><MemoryAlbumScreen user={user} onBack={back} initialMemoryId={albumMemory} /></View>
      ) : inventory ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          <InventoryScreen userId={user.id} onBack={back} onPlace={placeInRoom} onPlant={(item) => openGarden({ id: item.id, variant: item.variant })}
            onOpenAlbum={openAlbum} />
        </View>
      ) : garden ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          <GardenScreen key={gardenSeed ? `${gardenSeed.id}.${gardenSeed.variant}` : 'garden'} user={user} onBack={back} onOpenInventory={openInventory} initialSeed={gardenSeed}
            tab={gardenTab} onTabChange={setGardenTab} onVisitGarden={visitGarden} />
        </View>
      ) : gardenVisit ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          <FriendGardenScreen key={gardenOwnerId} userId={gardenOwnerId!} onBack={back} />
        </View>
      ) : visiting ? (
        <VisitRoom key={visitUserId} userId={visitUserId!} me={user} onBack={back} onOpenStudyRoom={openStudyRoom} />
      ) : together ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          <StudyTogetherScreen key={togetherRoute?.key ?? 0} user={user} onExit={(mode) => { setTogetherRoute(null); setStudyMode(mode ?? 'personal'); }}
            onRewards={loadDashboard} onVisitRoom={visitRoom} onOpenFriends={openFriends} onOpenGarden={() => openGarden()} initialRoute={togetherRoute?.route} />
        </View>
      ) : room ? (
        <RoomTab user={user} timer={timer} leaveGuard={roomLeave} onOpenAlbum={() => openAlbum()} onOpenFriends={() => openFriends()}
          hatching={petHatch.phase !== 'idle'} onOpenInventory={openInventory} onOpenGarden={() => openGarden()} />
      ) : games ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10, paddingBottom: immersive ? insets.bottom : 0 }]}>
          <LearningScreen key={studyVisit} user={user} defaultDuration={timer.focusMinutes} focus={focus} onFreeStudy={() => setFreeStudy(true)}
            onRewards={loadDashboard} onImmersiveChange={setImmersive} onUserUpdated={setUser} modeSwitch={<StudyModeSwitch value="personal" onChange={setStudyMode} />} />
        </View>
      ) : (
      <ScrollView key={overlay ?? tab} contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
        showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {overlay === 'profile' ? <ProfileScreen user={user} onBack={back} />
          : overlay === 'studyProfile' ? <StudyProfileScreen user={user} onBack={back} onUserUpdated={setUser} />
          : overlay === 'quests' ? <DailyQuestsScreen onBack={back} onChanged={loadDashboard} onOpenTaskCreate={openTaskCreate} />
            : overlay === 'streak' ? <LoginStreakScreen onBack={back} user={user} onUserUpdated={setUser} />
            : overlay === 'feed' ? <FeedScreen user={user} posts={posts} onPosts={setPosts} onPosted={loadDashboard} onBack={back} /> : <>
            {tab === 'Home' && <HomeTab user={user} dashboard={dashboard} onNavigate={navigate} onOpenProfile={() => open('profile')} onOpenStreak={openStreak} onOpenDailyQuests={openDailyQuests} onOpenTaskCreate={openTaskCreate} onQuestChanged={onQuestChanged}
              petSpaceVersion={petReward.version + hatchVersion} onPetReturned={() => { void petReward.check(); }} onOpenPetGifts={openPetGifts} onOpenStudyTogether={openStudyTogether} onOpenFreeStudy={openFreeStudy} onOpenMemories={() => openAlbum()}
              onOpenNotifications={() => openTogether({ name: 'notifications' })} onPetSpace={petHatch.sync}
              hatch={{ phase: petHatch.phase, level: petHatch.level, waitingReturn: petHatch.waitingReturn, onPlayed: petHatch.played }} />}
            {tab === 'Study' && <StudyTab timer={timer} petId={user.pet} petName={user.pet_name} petLevel={user.level} userId={user.id} onBack={() => setFreeStudy(false)} />}
            {tab === 'Community' && <FriendsScreen key={friendsTab} initialTab={friendsTab} onVisit={visitRoom} onVisitGarden={visitGarden} onOpenStudyRoom={openStudyRoom}
              onRequestsChanged={() => { void loadDashboard(); }} />}
            {tab === 'More' && <MoreTab user={user} onOpenProfile={() => open('profile')} onOpenRoom={() => navigate('Room')} onOpenFeed={() => open('feed')}
              onOpenGarden={() => openGarden()} onOpenStudyProfile={() => open('studyProfile')} />}
          </>}
      </ScrollView>
      )}
      {/* Keeps the status bar readable when content scrolls underneath it; the room's wall goes up to the top instead. */}
      {room ? null : <LinearGradient pointerEvents="none" colors={[appTheme.backdrop[0], 'rgba(217,240,252,0)']}
        style={[styles.scrim, { height: insets.top + 12 }]} />}
      {(games && immersive) || album ? null : <TabBar active={tab} onChange={(key) => { void leaveTo(key); }} bottomInset={insets.bottom}
        badges={{ Community: pendingRequests }} />}
      <TaskCreateModal visible={taskModal.visible} initialDate={taskModal.initialDate}
        onClose={() => setTaskModal((current) => ({ ...current, visible: false }))}
        onCreated={(date) => taskModal.onCreated(date)} />
      {streakPopup ? <LoginStreakPopup claim={streakPopup} onClose={dismissStreakPopup}
        onOpenJourney={() => { dismissStreakPopup(); setTab('Home'); setOverlays(['streak']); }} />
        : petReward.pending ? <PetRewardPopup reward={petReward.pending} petId={user.pet} petName={user.pet_name ?? petById(user.pet).name}
          petLevel={user.level} confirming={petReward.confirming} error={petReward.error} onClose={() => { void petReward.confirm(); }}
          onOpenInventory={() => { void petReward.confirm(() => { setTab('Home'); setOverlays(['inventory']); }); }} />
        : petHatch.phase === 'celebrating' && petHatch.level != null ? <PetHatchedPopup petId={user.pet} petName={user.pet_name ?? petById(user.pet).name}
          level={petHatch.level} walkNext={petHatch.walkWaiting} confirming={petHatch.confirming} error={petHatch.error}
          onConfirm={() => { void petHatch.confirm(); }} /> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});
