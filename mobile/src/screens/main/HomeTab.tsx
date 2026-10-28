import React, { useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useCallback, useEffect, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { useConfirm } from '../../ui/ConfirmDialog';
import { PetCompanion } from '../../components/PetCompanion';
import { useReduceMotion } from '../../components/useReduceMotion';
import { PetEvolutionProgress } from '../../components/PetEvolutionProgress';
import { usePetHatch } from './usePetHatch';
import { Text } from '../../components/Typography';
import { petById } from '../../pets';
import { TabKey } from '../../tabs';
import { appTheme as t } from '../../theme';
import { Avatar, Button, Card, formatNumber, IconCircle, IconName, ProgressBar, SectionHeader } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { WalkLandscape } from './WalkLandscape';
import { Dashboard, Quest, request, resolveQuestId, ScheduledTask, showError, taskRepeatDetail, WalkStatus } from './shared';

const DAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const todayLabel = (d = new Date()) => `${DAYS[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}`;

const SHORTCUTS: { icon: IconName; title: string; subtitle: string; tab: TabKey; color: string; bg: string; together?: boolean; focus?: boolean }[] = [
  { icon: 'timer-outline', title: 'Tập trung', subtitle: 'Pomodoro 25 phút', tab: 'Study', color: '#136FA8', bg: '#DDF0FA', focus: true },
  { icon: 'bed-outline', title: 'Phòng cá nhân', subtitle: 'Góc nhỏ của pet', tab: 'Room', color: '#5141A8', bg: '#EEEAFF' },
  { icon: 'people-outline', title: 'Bạn bè', subtitle: 'Kết bạn, ghé phòng', tab: 'Community', color: '#B23A0A', bg: '#FFEBDD' },
  { icon: 'people-circle-outline', title: 'Học cùng bạn', subtitle: 'Phòng học nhóm', tab: 'Study', color: '#0B6577', bg: '#DFF6FA', together: true },
];

type Props = { user: User; dashboard: Dashboard | null; onNavigate: (tab: TabKey) => void; onOpenProfile: () => void; onOpenStreak: () => void; onOpenDailyQuests: () => void; onOpenTaskCreate: (date: string, onCreated: (date: string) => void) => void; onQuestChanged: (quests: Quest[]) => Promise<void> | void;
  /** Changes after the gift popup is confirmed, so the walk frame reloads. */ petSpaceVersion?: number;
  /** The pet is due back: the app asks the backend for its (already granted) gifts. */ onPetReturned?: () => void;
  /** "Xem quà": reopens the gift popup from the backend, or tells the user why there is none yet. */ onOpenPetGifts?: () => Promise<void>;
  /** Opens Study Together (the Study tab in its group mode). */ onOpenStudyTogether?: () => void;
  /** Opens the in-app inbox (friend requests, study invitations, greetings and cheers). */ onOpenNotifications?: () => void;
  /** Opens "Học tự chọn" (the focus timer) directly. */ onOpenFreeStudy?: () => void;
  /** Opens the private pet memory album. */ onOpenMemories?: () => void };
type PetSpace = { status: WalkStatus; seconds_left: number; walk_minutes: number; started_at?: string | null; return_at?: string | null; server_now?: string; task_cycle_id?: string | null; last_find?: FoundItem | null; collection: { id: string; name: string; emoji: string; count: number }[] };
type FoundItem = { id?: string; name: string; emoji: string };
/** Server times are UTC. Older backends sent them without an offset, which JS would read as local time. */
function serverTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function normalizePetSpace(value: any): PetSpace | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.collection)) return null;
  const aliases: Record<string, WalkStatus> = {
    locked: 'locked', idle: 'locked', ready: 'ready', walking: 'walking', exploring: 'walking',
    returned: 'returned', return_ready: 'returned', returning: 'returned', rested: 'rested', completed: 'rested',
  };
  const returnAt = serverTime(value.return_at ?? value.returns_at);
  const rawStatus = String(value.status ?? value.state ?? '').toLowerCase();
  const status = aliases[rawStatus] ?? (returnAt && new Date(returnAt).getTime() > Date.now() ? 'walking' : 'locked');
  const minutes = Number(value.walk_minutes);
  const serverNowIso = serverTime(value.server_now);
  const serverNow = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
  const fromReturnAt = returnAt ? Math.max(0, Math.ceil((new Date(returnAt).getTime() - serverNow) / 1000)) : 0;
  const secondsLeft = Number(value.seconds_left);
  return { ...value, status, return_at: returnAt, started_at: serverTime(value.started_at), server_now: serverNowIso ?? undefined,
    walk_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 480,
    seconds_left: Number.isFinite(secondsLeft) && secondsLeft > 0 ? secondsLeft : fromReturnAt } as PetSpace;
}
function formatRemaining(seconds: number) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function localTodayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export function HomeTab({ user, dashboard, onNavigate, onOpenProfile, onOpenStreak, onOpenDailyQuests, onOpenTaskCreate, onQuestChanged, petSpaceVersion = 0, onPetReturned, onOpenPetGifts, onOpenStudyTogether, onOpenFreeStudy, onOpenMemories, onOpenNotifications }: Props) {
  const pet = petById(user.pet);
  const petName = user.pet_name ?? pet.name;
  const today = dashboard?.study?.today_sessions ?? 0;
  const unread = dashboard?.unread_notifications ?? 0;
  const quests = dashboard?.daily_quests ?? [];
  const ownTasks = (dashboard?.scheduled_tasks ?? []).filter((task) => task.kind !== 'daily_quest');
  const tasksTotal = quests.length + ownTasks.length;
  const tasksDone = quests.filter((q) => q.progress >= q.target).length + ownTasks.filter((task) => task.completed).length;
  // The egg hatches in the evolution frame once the pet reaches Lv.1 (see usePetHatch).
  const petHatch = usePetHatch(user);
  const [tasksOpen, setTasksOpen] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const [completing, setCompleting] = useState<string | null>(null);
  const [petSpace, setPetSpace] = useState<PetSpace | null>(null);
  const [petSpaceError, setPetSpaceError] = useState(false);
  const serverTimeOffset = useRef(0);
  // Only the latest load may update the frame: an older answer arriving late (e.g. sent before the gift was confirmed) is stale.
  const petSpaceLoad = useRef(0);
  const loadPetSpace = useCallback(async () => {
    const load = ++petSpaceLoad.current;
    try {
      const result = normalizePetSpace(await request('/api/pet/space'));
      if (load !== petSpaceLoad.current) return;
      setPetSpaceError(false);
      if (result?.server_now) serverTimeOffset.current = new Date(result.server_now).getTime() - Date.now();
      setPetSpace(result);
    }
    catch (e) { if (load === petSpaceLoad.current) { setPetSpaceError(true); showError('Không tải được trạng thái đi dạo', e); } }
  }, []);
  useEffect(() => { void loadPetSpace(); }, [loadPetSpace, petSpaceVersion]);
  // Keep the frame in sync when the last quest is completed from another tab or
  // when an initial request fails. The backend remains the source of truth.
  useEffect(() => {
    if (petSpace && petSpace.status !== 'locked' && petSpace.status !== 'ready') return;
    const timer = setInterval(() => { void loadPetSpace(); }, 10000);
    return () => clearInterval(timer);
  }, [petSpace?.status, loadPetSpace]);
  useEffect(() => {
    if (petSpace?.status !== 'walking') return;
    const timer = setInterval(() => setPetSpace((current) => {
      if (!current || current.status !== 'walking') return current;
      const seconds = current.return_at
        ? Math.max(0, Math.ceil((new Date(current.return_at).getTime() - (Date.now() + serverTimeOffset.current)) / 1000))
        : Math.max(0, current.seconds_left - 1);
      return { ...current, seconds_left: seconds, status: seconds === 0 ? 'returned' : 'walking' };
    }), 1000);
    return () => clearInterval(timer);
  }, [petSpace?.status]);
  // The countdown reached zero: the backend grants the gifts by itself; the app only asks for them to show the popup.
  const wasWalking = useRef(false);
  useEffect(() => {
    if (petSpace?.status === 'walking') { wasWalking.current = true; return; }
    if (petSpace?.status === 'returned' && wasWalking.current) {
      wasWalking.current = false;
      onPetReturned?.();
      void loadPetSpace();
    }
  }, [petSpace?.status, onPetReturned, loadPetSpace]);

  async function completeQuest(quest: Quest) {
    const id = resolveQuestId(quest, quests);
    if (!id) { showError('Không thể hoàn thành nhiệm vụ', new Error('Không xác định được nhiệm vụ. Vui lòng tải lại trang.')); return; }
    if (!(await confirm({ title: 'Hoàn thành nhiệm vụ?', message: quest.title, confirmLabel: 'Hoàn thành', icon: 'checkmark-circle-outline' }))) return;
    setCompleting(id);
    try {
      const result = await request(`/api/pet/quests/${id}/complete`, { method: 'POST' }) as { quests: Quest[]; awarded_exp: number; daily_exp_remaining: number };
      await onQuestChanged(result.quests);
      toast(expRewardMessage(result.awarded_exp, result.daily_exp_remaining), result.awarded_exp > 0 ? 'success' : 'info');
      void loadPetSpace();
    }
    catch (e) { showError('Không hoàn thành được nhiệm vụ', e); }
    finally { setCompleting(null); }
  }

  async function completeScheduledTask(task: ScheduledTask) {
    if (!(await confirm({ title: 'Hoàn thành nhiệm vụ?', message: task.title, confirmLabel: 'Hoàn thành', icon: 'checkmark-circle-outline' }))) return;
    setCompleting(task.occurrence_id);
    try {
      const result = await request(`/api/tasks/${task.id}/complete`, { method: 'POST', body: { occurrence_date: task.scheduled_date } }) as { awarded_exp: number; daily_exp_remaining: number };
      await onQuestChanged(quests);
      toast(expRewardMessage(result.awarded_exp, result.daily_exp_remaining), result.awarded_exp > 0 ? 'success' : 'info');
      void loadPetSpace(); // the last goal of today starts the walk on the server
    } catch (e) { showError('Không hoàn thành được nhiệm vụ', e); }
    finally { setCompleting(null); }
  }

  return (
    <>
      <View style={styles.greetRow}>
        <Pressable onPress={onOpenProfile} hitSlop={6} accessibilityRole="button" accessibilityLabel="Xem hồ sơ và thú cưng"
          style={({ pressed }) => pressed && styles.pressed}>
          <Avatar name={user.display_name} theme={user.avatar_theme} size={40} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.date}>{todayLabel()}</Text>
          <Text style={styles.greeting} numberOfLines={1}>Chào bạn, {user.display_name}!</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={onOpenStreak} hitSlop={6} accessibilityRole="button" accessibilityLabel="Chuỗi đăng nhập"
            style={({ pressed }) => [styles.streakButton, pressed && styles.pressed]}>
            <Ionicons name="flame" size={21} color="#E77832" />
          </Pressable>
          <Pressable onPress={() => (onOpenNotifications ? onOpenNotifications() : toast('Bạn chưa có thông báo mới'))} hitSlop={6}
            accessibilityRole="button" accessibilityLabel={`Thông báo${unread ? `, ${unread} chưa đọc` : ''}`}
            style={({ pressed }) => [styles.bell, pressed && styles.pressed]}>
            <Ionicons name="notifications-outline" size={22} color={t.ink} />
            {unread ? <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{Math.min(99, unread)}</Text></View> : null}
          </Pressable>
        </View>
      </View>
      <View style={styles.wallet}>
        <Pill icon="trophy" color="#B7791F" text={`Cấp ${user.level}`} />
        <Pill icon="cash" color="#C08A1E" text={formatNumber(user.coins)} label="Xu" />
        <Pill icon="diamond" color="#2E9AD6" text={formatNumber(user.gems)} label="Pha lê" />
      </View>

      <LinearGradient colors={[pet.element.bg, '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
        <View style={styles.petHeader} accessible accessibilityLabel={`${petName}, hệ ${pet.element.label}`}>
          <Text style={styles.petName} numberOfLines={1}>{petName}</Text>
          <View style={[styles.elementChip, { borderColor: `${pet.element.color}2E` }]}>
            <Text style={[styles.elementChipText, { color: pet.element.color }]}>Hệ {pet.element.label}</Text>
          </View>
          <Pressable onPress={onOpenMemories} accessibilityRole="button" accessibilityLabel="Mở Album kỷ niệm"
            style={({ pressed }) => [styles.albumButton, pressed && styles.pressed]}>
            <Ionicons name="images-outline" size={17} color={t.accent} /><Text style={styles.albumText}>Album</Text>
          </Pressable>
        </View>
        {!petSpace ? <View style={styles.petSpaceLoading}>{petSpaceError
          ? <Pressable onPress={() => { void loadPetSpace(); }} accessibilityRole="button" style={styles.petRetry}><Ionicons name="refresh" size={16} color={t.accent} /><Text style={styles.petRetryText}>Tải lại khung Pet</Text></Pressable>
          : <><ActivityIndicator color={pet.element.color} /><Text style={styles.petLoadingText}>Đang tìm Pet của bạn…</Text></>}</View> :
        petSpace.status === 'walking' ? <WalkScene pet={pet.id} level={user.level} color={pet.element.color}
          seconds={petSpace.seconds_left} walkMinutes={petSpace.walk_minutes} returnAt={petSpace.return_at} /> :
          petSpace.status === 'returned'
            ? <WalkReturnedScene pet={pet.id} name={petName} level={user.level} onOpenGifts={onOpenPetGifts ?? (async () => onPetReturned?.())} />
            : <PetEvolutionProgress pet={pet.id} currentPetLevel={user.level} totalExp={user.xp} hatching={petHatch.hatching} onHatched={petHatch.done} />}
      </LinearGradient>

      <View style={styles.stats}>
        <Stat icon="flame-outline" value={String(today)} label="Phiên hôm nay" />
        <Stat icon="time-outline" value={formatNumber(dashboard?.study?.total_minutes ?? 0)} label="Phút tập trung" />
        <Stat icon="star-outline" value={formatNumber(user.xp)} label="XP" />
      </View>

      <Card style={styles.questCard}>
        <Pressable onPress={() => setTasksOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: tasksOpen }}
          accessibilityLabel={`Nhiệm vụ hằng ngày: ${tasksDone}/${tasksTotal} nhiệm vụ hoàn thành`} accessibilityHint={tasksOpen ? 'Thu gọn danh sách nhiệm vụ' : 'Mở danh sách nhiệm vụ'}
          style={styles.questSummary}>
          <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.questBadge}><Ionicons name="ribbon" size={22} color="#FFFFFF" /></LinearGradient>
          <View style={styles.questSummaryCopy}>
            <Text style={styles.questSummaryTitle} accessibilityRole="header">Nhiệm vụ hằng ngày</Text>
            <Text style={styles.questSummaryCount}>{tasksDone}/{tasksTotal} nhiệm vụ hoàn thành</Text>
            <ProgressBar value={tasksTotal ? tasksDone / tasksTotal : 0} animated />
          </View>
          <Ionicons name={tasksOpen ? 'chevron-up' : 'chevron-down'} size={20} color={t.muted} />
        </Pressable>
        {tasksOpen ? <View style={styles.questList}>
        {quests.filter((q) => q.progress < q.target).length === 0 && !(dashboard?.scheduled_tasks?.some((task) => !task.completed)) ? <Text style={[styles.muted, styles.questAllDone]}>Bạn đã hoàn thành tất cả nhiệm vụ hôm nay!</Text> : <>
        {quests.filter((q) => q.progress < q.target).map((q, i) => (
          <Pressable key={q.id || q.title} onPress={() => completeQuest(q)} disabled={!!completing} accessibilityRole="checkbox" accessibilityState={{ checked: false, disabled: !!completing }} style={[styles.quest, i > 0 && styles.questDivider]}>
            <Ionicons name={completing === resolveQuestId(q, quests) ? 'time-outline' : 'ellipse-outline'} size={24} color={t.muted} />
            <View style={styles.questCopy}><Text style={styles.questTitle}>{q.title}</Text><Text style={styles.questDetail}>{questDetail(resolveQuestId(q, quests) ?? '')}</Text></View>
            <Text style={styles.questProgress}>{q.progress}/{q.target}</Text>
          </Pressable>
        ))}
        {(dashboard?.scheduled_tasks ?? []).filter((task) => task.kind !== 'daily_quest' && !task.completed).map((task, i) => <Pressable key={task.occurrence_id} onPress={() => completeScheduledTask(task)} disabled={!!completing} accessibilityRole="checkbox" accessibilityState={{ checked: false, disabled: !!completing }} style={[styles.quest, (i > 0 || quests.some((q) => q.progress < q.target)) && styles.questDivider]}>
          <Ionicons name={completing === task.occurrence_id ? 'time-outline' : 'ellipse-outline'} size={24} color={t.muted} />
          <View style={styles.questCopy}><Text style={styles.questTitle}>{task.title}</Text><Text style={styles.questDetail}>{taskCategory(task.category)} · {taskSchedule(task)} · {taskDifficulty()}</Text></View>
          <Text style={styles.questProgress}>0/1</Text>
        </Pressable>)}
        </>}
        <View style={[styles.questDivider, styles.questFooter]}>
          <Pressable onPress={() => onOpenTaskCreate(localTodayIso(), () => onQuestChanged(quests))} accessibilityRole="button" accessibilityLabel="Thêm nhiệm vụ mới"
            style={({ pressed }) => [styles.addTaskRow, pressed && styles.pressed]}>
            <View style={styles.addTaskIcon}><Ionicons name="add" size={18} color={t.accent} /></View>
            <Text style={styles.addTaskText}>Thêm nhiệm vụ</Text>
          </Pressable>
          <Pressable onPress={() => onOpenDailyQuests()} hitSlop={8} accessibilityRole="button"><Text style={styles.allTasksLink}>Xem tất cả</Text></Pressable>
        </View>
        </View> : null}
      </Card>
      <SectionHeader title="Khám phá nhanh" />
      <View style={styles.grid}>
        {SHORTCUTS.map((s) => (
          <Pressable key={s.title} onPress={() => (s.together && onOpenStudyTogether ? onOpenStudyTogether()
            : s.focus && onOpenFreeStudy ? onOpenFreeStudy() : onNavigate(s.tab))} accessibilityRole="button"
            accessibilityLabel={`${s.title}: ${s.subtitle}`} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
            <IconCircle name={s.icon} color={s.color} bg={s.bg} />
            <Text style={styles.tileTitle}>{s.title}</Text>
            <Text style={styles.tileSub}>{s.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function useWalkEntrance() {
  const reduceMotion = useReduceMotion();
  const opacity = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  React.useEffect(() => {
    if (reduceMotion) { opacity.setValue(1); return; }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  return opacity;
}

function WalkScene({ pet, level, color, seconds, walkMinutes, returnAt }: { pet: string; level: number; color: string; seconds: number; walkMinutes: number; returnAt?: string | null }) {
  const opacity = useWalkEntrance();
  const total = Math.max(1, walkMinutes * 60);
  const fraction = Math.max(0, Math.min(1, 1 - seconds / total));
  const arrival = returnAt ? new Date(returnAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  return <Animated.View style={[styles.walkContent, { opacity, transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
    <WalkLandscape pet={pet} level={level} />
    <Text style={styles.walkHeroTitle}>Pet đang đi dạo...</Text>
    <Text style={styles.walkHeroCopy}>Bé đang khám phá thế giới và tìm một món quà bất ngờ cho bạn!</Text>
    <View style={styles.walkTimerRow}><Ionicons name="time-outline" size={16} color={color} /><Text style={[styles.walkTimer, { color }]}>{formatRemaining(seconds)}</Text><Text style={styles.walkArrival}>{arrival ? `Về lúc ${arrival}` : 'Thời gian trở về'}</Text></View>
    <ProgressBar value={fraction} color={color} />
    <View style={styles.walkGiftLine}><Ionicons name="gift-outline" size={15} color="#966718" /><Text style={styles.mysteryRewardText}>Pet sẽ mang quà về cho bạn khi trở về</Text></View>
  </Animated.View>;
}

/** Behind the gift popup while it is waiting to be confirmed; the button brings the popup back if it couldn't load. */
function WalkReturnedScene({ pet, name, level, onOpenGifts }: { pet: string; name: string; level: number; onOpenGifts: () => Promise<void> }) {
  const opacity = useWalkEntrance();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try { await onOpenGifts(); } finally { setOpening(false); }
  };
  return <Animated.View style={[styles.returnedContent, { opacity, transform: [{ translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
    <View style={styles.returnedPet}><PetCompanion pet={pet} size={96} stage={level} interactive /></View>
    <Text style={styles.walkHeroTitle}>{name} đã trở về!</Text>
    <Text style={styles.walkHeroCopy}>{name} đã mang về một món quà dành cho bạn!</Text>
    <Button title="Xem quà" icon="gift-outline" onPress={() => { void open(); }} loading={opening} />
  </Animated.View>;
}

function Pill({ icon, color, text, label }: { icon: IconName; color: string; text: string; label?: string }) {
  return (
    <View style={styles.pill} accessibilityLabel={label ? `${label}: ${text}` : text}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.pillText}>{text}</Text>
    </View>
  );
}

function Stat({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color={t.accent} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function questDetail(id: string) {
  const descriptions: Record<string, string> = { focus: 'Hoàn thành một phiên tập trung.', lesson: 'Mở và khám phá một bài học.', share: 'Chia sẻ một điều tích cực với cộng đồng.' };
  return `${descriptions[id] ?? 'Chạm để đánh dấu nhiệm vụ hoàn thành.'} · +10 EXP`;
}

function taskCategory(category: string) {
  const labels: Record<string, string> = { study: 'Học tập', health: 'Sức khỏe', habit: 'Thói quen', personal: 'Cá nhân', other: 'Khác' };
  return labels[category] ?? category;
}
function taskSchedule(task: ScheduledTask) {
  return `${task.start_time ? `${task.start_time}${task.end_time ? `–${task.end_time}` : ''} · ` : ''}${taskRepeatDetail(task)}`;
}
function taskDifficulty() { return '+5 EXP'; }
function expRewardMessage(awarded: number, remaining: number) {
  if (awarded > 0) return `+${awarded} EXP`;
  if (remaining <= 0) return 'Đã chạm giới hạn EXP nhiệm vụ hôm nay.';
  return 'Nhiệm vụ này đã được hoàn thành trước đó; EXP không cộng trùng.';
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streakButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E6',
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  date: { fontSize: 12, color: t.muted, fontWeight: '600' },
  greeting: { fontSize: 19, fontWeight: '900', color: t.ink },
  bell: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  bellBadge: { position: 'absolute', top: 3, right: 3, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: t.danger, alignItems: 'center',
    justifyContent: 'center', paddingHorizontal: 4 },
  bellBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  wallet: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  pillText: { fontSize: 14, fontWeight: '800', color: t.ink },
  hero: { borderRadius: 28, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#FFFFFF',
    shadowColor: t.shadow, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  petSpaceLoading: { minHeight: 230, alignItems: 'center', justifyContent: 'center', gap: 10 }, petLoadingText: { color: t.muted, fontSize: 12, fontWeight: '700' },
  petRetry: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, backgroundColor: t.tint, paddingHorizontal: 14 }, petRetryText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  walkHeroTitle: { color: t.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  walkHeroCopy: { color: t.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4, maxWidth: 310 },
  walkContent: { alignItems: 'center', paddingHorizontal: 8, paddingBottom: 4 },
  walkTimerRow: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 5 },
  walkTimer: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] }, walkArrival: { color: t.muted, fontSize: 10, fontWeight: '700', marginLeft: 3 },
  walkGiftLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  returnedContent: { alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6 },
  returnedPet: { height: 110, justifyContent: 'center' },
  petHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 2, marginBottom: 10 },
  albumButton: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFFCC', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  albumText: { color: t.accent, fontSize: 13, fontWeight: '900' },
  petName: { flexShrink: 1, fontSize: 22, lineHeight: 27, fontWeight: '900', color: t.ink, letterSpacing: -0.3 },
  elementChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.75)' },
  elementChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  stats: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stat: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 14, paddingHorizontal: 12,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  statValue: { fontSize: 20, fontWeight: '900', color: t.ink, marginTop: 6 },
  statLabel: { fontSize: 12, color: t.muted, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 },
  tile: { width: '47.8%', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  tileTitle: { fontSize: 16, fontWeight: '800', color: t.ink, marginTop: 12 },
  tileSub: { fontSize: 13, color: t.muted, marginTop: 2 },
  muted: { fontSize: 14, lineHeight: 21, color: t.muted },
  walkIntro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  walkIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4F2FC' },
  walkCopy: { flex: 1, gap: 3 },
  walkTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  walkProgress: { color: t.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  walkCountdown: { height: 44, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EAF5FC' },
  walkCountdownText: { color: t.accent, fontSize: 16, fontWeight: '900' },
  walkProgressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 },
  mysteryReward: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#FFF8E5', paddingVertical: 10, borderRadius: 13, marginTop: 12 },
  mysteryRewardText: { color: '#805A18', fontSize: 11, fontWeight: '800' },
  foundItem: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#FFF6D9' },
  foundEmoji: { fontSize: 28 },
  foundText: { flex: 1, color: t.ink, fontSize: 13, fontWeight: '800' },
  collectionSummary: { marginTop: 10, color: t.muted, fontSize: 12, fontWeight: '700' },
  questCard: { marginTop: 16 },
  questSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  questBadge: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  questSummaryCopy: { flex: 1, minWidth: 0, gap: 4 },
  questSummaryTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  questSummaryCount: { fontSize: 13, fontWeight: '700', color: t.muted, marginBottom: 2 },
  questList: { marginTop: 12, borderTopWidth: 1, borderTopColor: t.tint },
  questAllDone: { paddingVertical: 12 },
  questFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  addTaskRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  addTaskIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.tint },
  addTaskText: { color: t.accent, fontSize: 15, fontWeight: '800' },
  allTasksLink: { fontSize: 13, color: t.accent, fontWeight: '800' },
  quest: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  questCopy: { flex: 1 },
  questDetail: { fontSize: 12, color: t.muted, marginTop: 2, lineHeight: 17 },
  questDivider: { borderTopWidth: 1, borderTopColor: t.tint },
  questTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: t.ink },
  questDone: { color: t.success },
  questProgress: { fontSize: 14, fontWeight: '800', color: t.muted },
});
