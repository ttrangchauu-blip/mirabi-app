import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
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
import { HelpScreen, InviteScreen, PrivacyScreen, SettingsScreen } from './SettingsScreens';
import { StudyProfileScreen } from './StudyProfileScreen';
import { EducationAdminScreen } from '../admin/EducationAdminScreen';
import { ForgotPasswordScreen } from '../ForgotPasswordScreen';
import { WelcomeTour } from '../WelcomeTour';
import { StudyTab } from './StudyTab';
import { usePomodoroTimer } from './usePomodoroTimer';
import { TabBar } from './TabBar';
import { Dashboard, Post, Quest, request, showError } from './shared';
import { TaskCreateModal } from './TaskCreateModal';
import { todayOf } from './taskDateTime';
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
import type { FriendsTab } from '../together/FriendsScreen';
import { ExploreSpace } from '../life/ExploreSpace';
import { FriendsSpace } from '../life/FriendsSpace';
import { LifeHub } from '../life/LifeHub';
import { lifeTop, type LifeSpace } from '../life/spaces';
import { WeatherProvider } from '../../world/weather';
import { InventoryScreen } from '../inventory/InventoryScreen';
import { FriendGardenScreen } from '../garden/FriendGardenScreen';
import { GardenScreen } from '../garden/GardenScreen';
import { requestPlace } from '../../inventory/api';
import type { InventoryItem } from '../../inventory/types';
import type { RoomKind } from '../../room/types';
import { WorkQuestScreen } from '../work/WorkQuestScreen';
import { AdventureMapScreen } from '../adventure/AdventureMapScreen';
import { MoneyGardenScreen } from '../money/MoneyGardenScreen';
import { TownScreen } from '../town/TownScreen';
import { CareerJourneyScreen } from '../career/CareerJourneyScreen';
import { lifeEligible } from '../../life/access';
import { AchievementsScreen } from '../achievements/AchievementsScreen';
import { useAchievementNotices } from '../../achievements/useAchievementNotices';

export type FocusTimer = ReturnType<typeof usePomodoroTimer>;

type Overlay = 'profile' | 'studyProfile' | 'educationAdmin' | 'quests' | 'streak' | 'album' | 'visit' | 'feed' | 'inventory' | 'achievements' | 'keepsakes' | 'settings' | 'privacy' | 'help' | 'invite' | 'password' | 'tour' | 'gardenVisit' | 'work' | 'adventure' | 'money' | 'town' | 'career';

export function MainApp() {
  const { user, setUser, streakPopup, dismissStreakPopup, logout } = useAuth();
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
  // The place of Cuộc sống Mirabi on show, kept while another tab is open.
  const [lifeSpace, setLifeSpace] = useState<LifeSpace>('home');
  // Decorating the pet's home takes the whole screen: the switcher of places steps aside (RoomTab says when).
  const [decorating, setDecorating] = useState(false);
  // Khám phá's photo mode: only the scene is left on the screen, nothing else changes (the place stays mounted).
  const [photoMode, setPhotoMode] = useState(false);
  // The part of the "Bạn bè" place a shortcut opens (the room, Study Together or a notification).
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
  // The friend whose garden is visited.
  const [gardenOwnerId, setGardenOwnerId] = useState<number | null>(null);
  // Học tập opened from Tiện ích on one of its screens (Sổ tay, Lịch sử, Thống kê) instead of its first one.
  const [studyView, setStudyView] = useState<'notebook' | 'archive' | null>(null);
  const [focusStatistics, setFocusStatistics] = useState(false);
  // "Nhật ký phản tư" in Tiện ích: the pet's home opens in Góc thư giãn with the journal, once.
  const [startJournal, setStartJournal] = useState(false);
  // The weather starts on the first visit to the living world, not at login.
  const [worldVisited, setWorldVisited] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [taskModal, setTaskModal] = useState<{ visible: boolean; initialDate: string; onCreated: (date: string) => void }>({
    visible: false, initialDate: todayOf(), onCreated: () => {},
  });

  const [dashboardFailed, setDashboardFailed] = useState(false);
  // Only the latest read may update the numbers: an older answer arriving late would undo a quest just completed.
  const dashboardRead = useRef(0);
  /** Resolves to what went wrong, or null. */
  const readDashboard = useCallback(async (): Promise<unknown> => {
    const read = ++dashboardRead.current;
    try {
      const d = await request('/api/dashboard');
      if (read !== dashboardRead.current) return null;
      setDashboard(d); setDashboardFailed(false); setUser(d.user);
      return null;
    } catch (e) {
      if (read !== dashboardRead.current) return null;
      setDashboardFailed(true);
      return e;
    }
  }, [setUser]);
  const loadDashboard = useCallback(async () => {
    const failure = await readDashboard();
    if (failure) showError('Không tải được dữ liệu', failure);
  }, [readDashboard]);
  // Each on its own: the Feed's posts failing must not cost Home its quests. One message for the two.
  const refresh = useCallback(async () => {
    const [dashboardError, postsError] = await Promise.all([readDashboard(),
      request('/api/community/posts').then((p) => { setPosts(p); return null; }, (e: unknown) => e)]);
    const failure = dashboardError ?? postsError;
    if (failure) showError('Không tải được dữ liệu', failure);
  }, [readDashboard]);
  const timer = usePomodoroTimer(refresh, user?.id);
  const muteToasts = useMuteToasts();
  useEffect(() => { muteToasts(timer.quiet); return () => muteToasts(false); }, [muteToasts, timer.quiet]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Back in the app, maybe on another day: the quests and tasks on show may be yesterday's. Quiet: the phone may still be offline.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void readDashboard(); });
    return () => sub.remove();
  }, [readDashboard]);
  // A check-in answered after Home has loaded gave EXP that its numbers don't have yet.
  const shownClaim = useRef(streakPopup);
  useEffect(() => {
    if (streakPopup && streakPopup !== shownClaim.current && streakPopup.daily_exp_awarded + streakPopup.milestone_exp_awarded > 0) void readDashboard();
    shownClaim.current = streakPopup;
  }, [streakPopup, readDashboard]);
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
  // Every answer of /api/pet/space from a screen, for the hatching and the gift popup to follow.
  const { sync: syncHatch } = petHatch;
  const { track: trackWalk } = petReward;
  const onPetSpace = useCallback((space: unknown) => { syncHatch(space); trackWalk(space); }, [syncHatch, trackWalk]);
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
  // "🏅 Mở khóa thành tựu": not while focus mode mutes notices, nor on the achievements screen, which shows them itself.
  const openAchievements = useCallback(() => setOverlays((s) => (s[s.length - 1] === 'achievements' ? s : [...s, 'achievements'])), []);
  useAchievementNotices(!!user && !timer.quiet && overlay !== 'achievements', openAchievements);
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
    setOverlays([]); setFreeStudy(false); setStudyMode('personal'); setTab(key); setTogetherRoute(null); setFriendsTab('friends'); setStudyView(null); setFocusStatistics(false); setStartJournal(false);
    if (key === 'Study') setStudyVisit((v) => v + 1);
    if (key === 'Room') setWorldVisited(true);
    if (key === 'Home' || key === 'Room') void loadDashboard(); // fresh counts on the bell and the "Bạn bè" badge
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
  const openSpace = (space: LifeSpace) => { navigate('Room'); setLifeSpace(space); };
  const openFriends = (friends: FriendsTab = 'friends') => { openSpace('friends'); setFriendsTab(friends); };
  const openNotebook = () => { navigate('Study'); setStudyView('notebook'); };
  const openArchive = () => { navigate('Study'); setStudyView('archive'); };
  const openStatistics = () => { openFreeStudy(); setFocusStatistics(true); };
  const openJournal = () => { openSpace('home'); setStartJournal(true); };
  const pendingRequests = dashboard?.pending_friend_requests ?? 0;
  const openInventory = () => open('inventory');
  /** Every way into Vườn nhà ("Trồng" in Kho đồ, a notification) leads to this one place. */
  const openGarden = (seed: { id: string; variant: string } | null = null) => { setGardenSeed(seed); openSpace('garden'); };
  const visitGarden = (userId: number) => { setGardenOwnerId(userId); open('gardenVisit'); };
  const openAlbum = (memoryId: number | null = null) => { setAlbumMemory(memoryId); open('album'); };
  /** "Đặt vào phòng" in Kho đồ: that room opens its decorating with one more copy of the item. */
  const placeInRoom = (item: InventoryItem, room: RoomKind) => {
    if (!item.art) return;
    requestPlace({ room, item: item.art, variant: item.variant, name: item.name });
    if (room === 'personal') openSpace('home'); else openFreeStudy();
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
  const inventory = overlay === 'inventory' || overlay === 'keepsakes'; // Kỷ vật pet mang về (from Thành tựu): Kho đồ on its Kỷ vật tab
  // These bring their own whole-screen layout (the signed-out shell): nothing of the app around them.
  const fullScreen = overlay === 'password' || overlay === 'tour';
  const gardenVisit = overlay === 'gardenVisit' && gardenOwnerId !== null;
  const visiting = overlay === 'visit' && visitUserId !== null;
  const room = !overlay && tab === 'Room';
  const sceneAlone = photoMode && room && lifeSpace === 'explore';
  // The room with friends, reached from the tabs of "Học tự chọn": one object, so its screens aren't rebuilt for nothing.
  const roomTabs = useMemo(() => (freeStudy ? { onBack: () => { setStudyMode('personal'); setFreeStudy(false); setFocusStatistics(false); } } : undefined), [freeStudy]);
  const lifeContentTop = lifeTop(insets.top);
  // Cuộc sống Mirabi's screens: only for users aged 16 and over (the backend refuses anyone else too).
  const lifeScreen = lifeEligible(user) && (overlay === 'work' || overlay === 'adventure' || overlay === 'money' || overlay === 'town'
    || overlay === 'career') ? overlay : null;

  return (
    <WeatherProvider enabled={worldVisited || room}>
    <LinearGradient colors={appTheme.backdrop} style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      {overlay === 'password' ? (
        <ForgotPasswordScreen account email={user.email} onEmailChange={() => {}}
          onBackToLogin={(done) => { if (done) { toast(done, 'success'); void logout(); } else back(); }} />
      ) : overlay === 'tour' ? (
        <WelcomeTour onDone={back} />
      ) : album ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}><MemoryAlbumScreen user={user} onBack={back} initialMemoryId={albumMemory} /></View>
      ) : lifeScreen ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          {lifeScreen === 'work' ? <WorkQuestScreen user={user} timer={timer} onBack={back} onRewards={loadDashboard} onOpenInventory={openInventory} />
            : lifeScreen === 'adventure' ? <AdventureMapScreen user={user} onBack={back} onRewards={loadDashboard} onOpenInventory={openInventory} />
            : lifeScreen === 'money' ? <MoneyGardenScreen onBack={back} pet={petHatch.phase !== 'idle' || dashboard?.pet_walk === 'walking' ? null : { id: user.pet, level: user.level }} />
            : lifeScreen === 'town' ? <TownScreen user={user} onBack={back} onVisitRoom={visitRoom} onVisitGarden={visitGarden} onOpenFriends={() => openFriends()} />
            : <CareerJourneyScreen user={user} onBack={back} onRewards={loadDashboard} />}
        </View>
      ) : inventory ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10 }]}>
          <InventoryScreen key={overlay} userId={user.id} initialTab={overlay === 'keepsakes' ? 'keepsake' : undefined} onBack={back} onPlace={placeInRoom} onPlant={(item) => openGarden({ id: item.id, variant: item.variant })}
            onOpenAlbum={openAlbum} />
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
            onRewards={loadDashboard} onVisitRoom={visitRoom} onOpenFriends={openFriends} onOpenGarden={() => openGarden()} onOpenInventory={openInventory} initialRoute={togetherRoute?.route}
            roomTabs={roomTabs} />
        </View>
      ) : room ? (
        <LifeHub space={lifeSpace} onSpace={setLifeSpace} immersive={(lifeSpace === 'home' && decorating) || sceneAlone} badges={{ friends: pendingRequests }}>
          {lifeSpace === 'home' ? (
            <RoomTab user={user} timer={timer} leaveGuard={roomLeave} healingAllowed={lifeEligible(user)} onOpenAlbum={() => openAlbum()}
              contentTop={lifeContentTop} onDecorating={setDecorating} onOpenExplore={() => setLifeSpace('explore')}
              hatching={petHatch.phase !== 'idle'} onOpenInventory={openInventory} startJournal={startJournal} onJournalStarted={() => setStartJournal(false)} />
          ) : lifeSpace === 'garden' ? (
            <GardenScreen key={gardenSeed ? `${gardenSeed.id}.${gardenSeed.variant}` : 'garden'} user={user} onOpenInventory={openInventory} onOpenExplore={() => setLifeSpace('explore')} initialSeed={gardenSeed}
              top={lifeContentTop} petAway={petHatch.phase !== 'idle' || dashboard?.pet_walk === 'walking'} petWalking={dashboard?.pet_walk === 'walking'} version={petReward.version}
              onRewarded={() => { void readDashboard(); }} />
          ) : lifeSpace === 'explore' ? (
            <ExploreSpace user={user} top={lifeContentTop} bottom={0} version={petReward.version + hatchVersion} onOpenGifts={openPetGifts} onOpenInventory={openInventory}
              onOpenQuests={openDailyQuests} onOpenAdventure={() => open('adventure')} onPetSpace={onPetSpace} onPhotoMode={setPhotoMode} safeBottom={insets.bottom} />
          ) : (
            <FriendsSpace top={lifeContentTop} initialTab={friendsTab} onVisit={visitRoom} onVisitGarden={visitGarden} onOpenStudyRoom={openStudyRoom}
              onRequestsChanged={() => { void loadDashboard(); }} onOpenFeed={() => open('feed')} onOpenTown={lifeEligible(user) ? () => open('town') : undefined} />
          )}
        </LifeHub>
      ) : games ? (
        <View style={[styles.fill, { paddingTop: insets.top + 10, paddingBottom: immersive ? insets.bottom : 0 }]}>
          <LearningScreen key={`${studyVisit}.${studyView ?? ''}`} user={user} defaultDuration={timer.focusMinutes} focus={focus} onFreeStudy={() => setFreeStudy(true)} initialView={studyView ?? undefined}
            onRewards={loadDashboard} onImmersiveChange={setImmersive} onUserUpdated={setUser} modeSwitch={<StudyModeSwitch value="personal" onChange={setStudyMode} />} />
        </View>
      ) : (
      <ScrollView key={overlay ?? tab} contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
        showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {overlay === 'profile' ? <ProfileScreen user={user} onBack={back} />
          : overlay === 'studyProfile' ? <StudyProfileScreen user={user} onBack={back} onUserUpdated={setUser} />
          : overlay === 'educationAdmin' && user.role === 'admin' ? <EducationAdminScreen onBack={back} />
          : overlay === 'settings' ? <SettingsScreen user={user} onBack={back} onOpenProfile={() => open('profile')} onChangePassword={() => open('password')}
              onOpenNotifications={() => openTogether({ name: 'notifications' })} onOpenPrivacy={() => open('privacy')} onOpenHelp={() => open('help')} />
          : overlay === 'privacy' ? <PrivacyScreen onBack={back} />
          : overlay === 'invite' ? <InviteScreen onBack={back} />
          : overlay === 'help' ? <HelpScreen onBack={back} onReplayTour={() => open('tour')} onOpenFeed={() => open('feed')} />
          : overlay === 'quests' ? <DailyQuestsScreen today={dashboard?.today} quests={dashboard?.daily_quests} onBack={back} onChanged={loadDashboard} onOpenTaskCreate={openTaskCreate} />
            : overlay === 'streak' ? <LoginStreakScreen onBack={back} user={user} onUserUpdated={setUser} />
            : overlay === 'achievements' ? <AchievementsScreen onBack={back} onCoins={(coins) => setUser({ ...user, coins })} onOpenKeepsakes={() => open('keepsakes')} />
            : overlay === 'feed' ? <FeedScreen user={user} posts={posts} onPosts={setPosts} onPosted={loadDashboard} onBack={back} /> : <>
            {tab === 'Home' && <HomeTab user={user} dashboard={dashboard} dashboardFailed={dashboardFailed} onRetryDashboard={() => { void loadDashboard(); }} onNavigate={navigate} onOpenProfile={() => open('profile')} onOpenStreak={openStreak} onOpenDailyQuests={openDailyQuests} onOpenTaskCreate={openTaskCreate} onQuestChanged={onQuestChanged}
              petSpaceVersion={petReward.version + hatchVersion} onPetReturned={() => { void petReward.check(); }} onOpenPetGifts={openPetGifts} onOpenStudyTogether={openStudyTogether} onOpenFreeStudy={openFreeStudy} onOpenFriends={() => openFriends()} onOpenMemories={() => openAlbum()}
              onOpenNotifications={() => openTogether({ name: 'notifications' })} onPetSpace={onPetSpace}
              hatch={{ phase: petHatch.phase, level: petHatch.level, waitingReturn: petHatch.waitingReturn, onPlayed: petHatch.played }} />}
            {tab === 'Study' && <StudyTab timer={timer} petId={user.pet} petName={user.pet_name} petLevel={user.level} userId={user.id} onBack={() => { setFreeStudy(false); setFocusStatistics(false); }} onOpenGroup={() => setStudyMode('together')} showStatistics={focusStatistics} />}
            {tab === 'More' && <MoreTab user={user} onOpenProfile={() => open('profile')} onOpenStudyProfile={() => open('studyProfile')}
              onOpenEducationAdmin={() => open('educationAdmin')} onOpenFocus={openFreeStudy} onOpenNotebook={openNotebook} onOpenAlbum={() => openAlbum()} onOpenStreak={openStreak}
              onOpenStatistics={openStatistics} onOpenArchive={openArchive} onOpenTeamQuests={() => openTogether({ name: 'quests' })} onOpenAchievements={() => open('achievements')}
              onOpenInvite={() => open('invite')} onOpenSettings={() => open('settings')} onOpenJournal={openJournal}
              life={{ work: () => open('work'), money: () => open('money'), career: () => open('career') }} />}
          </>}
      </ScrollView>
      )}
      {/* Keeps the status bar readable when content scrolls underneath it; the room's wall goes up to the top instead. */}
      {room || fullScreen ? null : <LinearGradient pointerEvents="none" colors={[appTheme.backdrop[0], 'rgba(217,240,252,0)']}
        style={[styles.scrim, { height: insets.top + 12 }]} />}
      {(games && immersive) || fullScreen || sceneAlone ? null : <TabBar active={tab} onChange={(key) => { void leaveTo(key); }} bottomInset={insets.bottom}
        badges={{ Room: pendingRequests }} />}
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
    </WeatherProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});
