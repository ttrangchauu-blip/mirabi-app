import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NetworkError } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { PetArt } from '../../components/PetArt';
import { Text, TextInput } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { completionQueue, workApi } from '../../life/api';
import type { Priority, ProjectTheme, WorkChest, WorkDashboard, WorkProject, WorkStatistics, WorkTask } from '../../life/types';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Chip, ProgressBar, Segmented } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import type { FocusTimer } from '../main/MainApp';
import { showError } from '../main/shared';
import { BackHeader, ErrorState, OptionSheet } from '../together/ui';
import { ChestArt, FocusDeskArt, ProjectIslandArt, QuestSky, StarBurst, useLoop } from './workArt';
import { PRIORITIES, WorkTaskSheet, priorityOf } from './WorkTaskSheet';

type Props = {
  user: User;
  timer: FocusTimer;
  onBack: () => void;
  /** EXP changed: the app reloads the pet's level and EXP. */
  onRewards?: () => void;
  /** "Kho đồ" after a chest was opened. */
  onOpenInventory?: () => void;
};

const THEMES: { id: ProjectTheme; label: string }[] = [
  { id: 'meadow', label: '🌿 Đồng cỏ' }, { id: 'beach', label: '🏖️ Bãi biển' }, { id: 'forest', label: '🌲 Rừng' },
  { id: 'snow', label: '❄️ Tuyết' }, { id: 'desert', label: '🏜️ Sa mạc' }, { id: 'sky', label: '☁️ Mây trời' },
];
const BUILD_LABEL = ['Đảo hoang', 'Có biển báo', 'Có lều nhỏ', 'Có cây xanh', 'Có nhà', 'Hoàn thiện'];

function dueLabel(task: WorkTask): string | null {
  if (!task.due_at) return null;
  const due = new Date(task.due_at);
  const now = new Date();
  const time = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
  const sameDay = due.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return `Hôm nay ${time}`;
  if (due.toDateString() === tomorrow.toDateString()) return `Ngày mai ${time}`;
  return `${due.getDate()}/${due.getMonth() + 1} ${time}`;
}

/**
 * Work Quest: work as an adventure. A desk where the pet works next to you (the app's one Pomodoro timer), a mission
 * board of quest cards stamped when done, a sea of project islands built up by their tasks, and reward chests. Tasks
 * are the app's tasks (/api/tasks): the EXP of a quest, and the pet's celebration, come only from the server's answer.
 */
export function WorkQuestScreen({ user, timer, onBack, onRewards, onOpenInventory }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<WorkDashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Completions shown done on screen while the server hasn't confirmed them (sending, or waiting for a connection).
  const [local, setLocal] = useState<Record<string, 'sending' | 'queued'>>({});
  // The card whose stamp is landing now (it plays once per completion).
  const [stamped, setStamped] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [cheer, setCheer] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ project: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<WorkTask | null>(null);
  const [project, setProject] = useState<WorkProject | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [stats, setStats] = useState(false);
  const [openedChest, setOpenedChest] = useState<WorkChest | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      // Completions made offline go first, so the board shows them confirmed.
      const synced = await completionQueue.flush(user.id);
      const exp = synced.reduce((sum, r) => sum + (r.awarded_exp || 0), 0);
      if (synced.length) { toast(`Đã đồng bộ ${synced.length} nhiệm vụ${exp ? ` · +${exp} EXP` : ''}`, 'success'); onRewards?.(); }
      const fresh = await workApi.dashboard();
      if (!mounted.current) return;
      const queued = await completionQueue.load(user.id);
      setLocal(Object.fromEntries(queued.map((q) => [`${q.taskId}:${q.occurrence}`, 'queued' as const])));
      setData(fresh); setError(null);
    } catch (e) { if (mounted.current) setError(e); }
  }, [user.id, toast, onRewards]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!cheer) return;
    const id = setTimeout(() => setCheer(null), 3200);
    return () => clearTimeout(id);
  }, [cheer]);

  async function complete(task: WorkTask) {
    const key = task.occurrence_id;
    if (task.completed || local[key]) return;
    setDetail(null);
    setLocal((l) => ({ ...l, [key]: 'sending' }));
    setStamped(key);
    try {
      const result = await workApi.complete(task.id, task.scheduled_date);
      if (!mounted.current) return;
      if (result.awarded_exp > 0) { setBurst((b) => b + 1); setCheer(`+${result.awarded_exp} EXP! Tuyệt vời!`); onRewards?.(); }
      else setCheer(result.already_completed ? 'Nhiệm vụ này đã xong rồi nè!' : 'Xong rồi! Hôm nay đã đủ EXP, mai mình nhận tiếp nhé.');
      await load();
    } catch (e) {
      if (e instanceof NetworkError) {
        await completionQueue.add(user.id, { taskId: task.id, occurrence: task.scheduled_date });
        setLocal((l) => ({ ...l, [key]: 'queued' }));
        toast('Chưa có mạng: đã lưu, Mirabi sẽ đồng bộ khi có kết nối.', 'info');
      } else {
        setLocal((l) => { const { [key]: _drop, ...rest } = l; return rest; });
        setStamped(null);
        showError('Chưa hoàn thành được nhiệm vụ', e);
      }
    }
  }

  async function toggleStep(task: WorkTask, stepId: number, done: boolean) {
    try {
      const updated = await workApi.toggleStep(task.id, stepId, task.scheduled_date, done);
      setDetail((d) => (d && d.occurrence_id === task.occurrence_id ? { ...d, steps: updated.steps } : d));
      setData((d) => d && ({ ...d, tasks_today: d.tasks_today.map((x) => (x.occurrence_id === task.occurrence_id ? { ...x, steps: updated.steps } : x)) }));
      if (done && updated.steps.every((s) => s.done) && !task.completed) {
        if (await confirm({ title: 'Xong hết các bước rồi!', message: 'Đánh dấu hoàn thành nhiệm vụ này luôn nhé?', confirmLabel: 'Hoàn thành', cancelLabel: 'Để sau', icon: 'checkmark-done-outline' })) {
          void complete({ ...task, steps: updated.steps });
        }
      }
    } catch (e) { showError('Chưa lưu được bước này', e); }
  }

  async function remove(task: WorkTask) {
    if (!(await confirm({ title: 'Xóa nhiệm vụ?', message: 'Nhiệm vụ sẽ biến mất khỏi bảng. Những lần đã hoàn thành vẫn được giữ trong thống kê.', confirmLabel: 'Xóa', cancelLabel: 'Giữ lại', icon: 'trash-outline' }))) return;
    try { await workApi.deleteTask(task.id); setDetail(null); await load(); } catch (e) { showError('Chưa xóa được nhiệm vụ', e); }
  }

  async function changePriority(task: WorkTask, priority: Priority) {
    try {
      const updated = await workApi.updateTask(task.id, task.scheduled_date, { priority });
      setDetail((d) => (d ? { ...d, priority: updated.priority, exp: updated.exp } : d));
      await load();
    } catch (e) { showError('Chưa đổi được mức ưu tiên', e); }
  }

  async function openChest(chest: WorkChest) {
    if (chest.status === 'opened') { setOpenedChest(chest); return; }
    if (chest.status === 'locked') { toast(`Hoàn thành thêm ${chest.required - chest.progress} nhiệm vụ để mở ${chest.name}.`, 'info'); return; }
    setOpening(chest.code);
    try {
      const result = await workApi.openChest(chest.code);
      if (!mounted.current) return;
      setData((d) => d && ({ ...d, chests: result.chests }));
      setBurst((b) => b + 1);
      setTimeout(() => { if (mounted.current) { setOpening(null); setOpenedChest(result.chest); } }, 700);
    } catch (e) { setOpening(null); showError('Chưa mở được rương', e); }
  }

  async function updateProject(p: WorkProject, body: Partial<Pick<WorkProject, 'status' | 'name' | 'theme'>>) {
    try {
      const updated = await workApi.updateProject(p.id, body);
      setProject(null);
      if (body.status === 'completed') { setBurst((b) => b + 1); setCheer(`Đảo "${updated.name}" đã sáng đèn!`); }
      await load();
    } catch (e) { showError('Chưa cập nhật được dự án', e); }
  }

  if (!data) {
    return (
      <View style={s.fill}>
        <BackHeader title="Nhiệm vụ công việc" subtitle="Biến công việc thành chuyến phiêu lưu" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <WorkSkeleton />}
      </View>
    );
  }

  const done = (task: WorkTask) => task.completed || !!local[task.occurrence_id];
  const todayDone = data.tasks_today.filter(done).length;
  const focusing = timer.running && timer.phase === 'focus';
  const board = [...data.overdue, ...data.tasks_today];

  return (
    <View style={s.fill} testID="work-quest">
      <BackHeader title="Nhiệm vụ công việc" subtitle="Biến công việc thành chuyến phiêu lưu" onBack={onBack}
        right={<Pressable onPress={() => setStats(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Thống kê công việc" style={s.headerBtn}>
          <Ionicons name="stats-chart" size={20} color={t.accent} /></Pressable>} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <DeskScene user={user} timer={timer} focusing={focusing} line={cheer ?? data.pet_line} burst={burst}
          celebrating={!!cheer && burst > 0} />

        <View style={s.statsRow} accessible accessibilityLabel={`Hôm nay xong ${todayDone} trên ${data.tasks_today.length} nhiệm vụ, tập trung ${data.summary.focus_minutes_today} phút`}>
          <Stat icon="flag" color="#E09A2B" value={`${todayDone}/${data.tasks_today.length}`} label="Nhiệm vụ" />
          <Stat icon="timer-outline" color="#2E9AD6" value={`${data.summary.focus_minutes_today}'`} label="Tập trung" />
          <Stat icon="sparkles" color="#9B5DE5" value={`${data.summary.exp_remaining_today}`} label="EXP còn nhận" />
        </View>
        <WalkHint walk={data.walk} />

        <View style={s.sectionHead}>
          <Text style={s.section} accessibilityRole="header">📌 Bảng nhiệm vụ</Text>
          <Pressable onPress={() => setCreating({ project: null })} style={s.addPill} accessibilityRole="button" accessibilityLabel="Nhận nhiệm vụ mới">
            <Ionicons name="add" size={16} color="#FFFFFF" /><Text style={s.addPillText}>Nhận nhiệm vụ</Text>
          </Pressable>
        </View>
        <View style={s.board} testID="mission-board">
          {board.length === 0 ? (
            <View style={s.boardEmpty}>
              <Text style={s.boardEmptyEmoji}>🗺️</Text>
              <Text style={s.boardEmptyTitle}>Bảng nhiệm vụ đang trống</Text>
              <Text style={s.boardEmptyText}>Ghim nhiệm vụ đầu tiên của hôm nay, pet sẽ cùng bạn hoàn thành!</Text>
              <Button title="Ghim nhiệm vụ" icon="add" onPress={() => setCreating({ project: null })} />
            </View>
          ) : (
            <View style={s.cards}>
              {board.map((task, i) => (
                <QuestCard key={task.occurrence_id} task={task} index={i} done={done(task)} state={local[task.occurrence_id]}
                  project={data.projects.find((p) => p.id === task.project_id)?.name}
                  stamping={stamped === task.occurrence_id} onPress={() => setDetail(task)} onComplete={() => { void complete(task); }} />
              ))}
            </View>
          )}
        </View>

        <View style={s.sectionHead}>
          <Text style={s.section} accessibilityRole="header">🏝️ Bản đồ dự án</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sea} testID="project-map">
          {data.projects.map((p) => (
            <Pressable key={p.id} onPress={() => setProject(p)} style={s.island} accessibilityRole="button"
              accessibilityLabel={`Dự án ${p.name}: ${p.tasks_done} trên ${p.tasks_total} nhiệm vụ, ${BUILD_LABEL[p.build_stage]}`}>
              <ProjectIslandArt theme={p.theme} stage={p.build_stage} lit={p.status === 'completed'} />
              <Text style={s.islandName} numberOfLines={1}>{p.name}</Text>
              <Text style={s.islandMeta}>{p.status === 'completed' ? '✨ Hoàn thành' : `${p.tasks_done}/${p.tasks_total} nhiệm vụ`}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setNewProject(true)} style={[s.island, s.newIsland]} accessibilityRole="button" accessibilityLabel="Tạo dự án mới">
            <Ionicons name="add-circle" size={40} color="#FFFFFF" />
            <Text style={s.newIslandText}>Đảo mới</Text>
          </Pressable>
        </ScrollView>

        <Text style={[s.section, s.sectionGap]} accessibilityRole="header">🎁 Rương phần thưởng</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chests}>
          {data.chests.map((chest) => (
            <Pressable key={chest.code} onPress={() => { void openChest(chest); }} style={s.chest} accessibilityRole="button"
              accessibilityLabel={`${chest.name}: ${chest.status === 'opened' ? 'đã mở' : chest.status === 'ready' ? 'sẵn sàng mở' : `${chest.progress} trên ${chest.required}`}`}>
              <ChestArt status={chest.status} opening={opening === chest.code} />
              <Text style={s.chestName} numberOfLines={1}>{chest.name}</Text>
              <View style={s.chestBar}><ProgressBar value={chest.progress / chest.required} color={chest.status === 'locked' ? '#A7B4C0' : '#E09A2B'} animated /></View>
              <Text style={s.chestMeta}>{chest.status === 'opened' ? 'Đã mở' : chest.status === 'ready' ? 'Mở ngay!' : `${chest.progress}/${chest.required}`}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {data.upcoming.length ? <>
          <Text style={[s.section, s.sectionGap]} accessibilityRole="header">🧭 Sắp tới</Text>
          {data.upcoming.slice(0, 6).map((task) => (
            <Pressable key={task.occurrence_id} onPress={() => setDetail(task)} style={s.upcoming} accessibilityRole="button" accessibilityLabel={`${task.title}, ngày ${task.scheduled_date}`}>
              <View style={[s.dot, { backgroundColor: priorityOf(task.priority).color }]} />
              <Text style={s.upcomingTitle} numberOfLines={1}>{task.title}</Text>
              <Text style={s.upcomingDate}>{task.scheduled_date.slice(8, 10)}/{task.scheduled_date.slice(5, 7)}</Text>
            </Pressable>
          ))}
        </> : null}
      </ScrollView>

      <WorkTaskSheet visible={!!creating} projects={data.projects} initialProject={creating?.project ?? null} saving={saving}
        onClose={() => setCreating(null)} onSave={async (task) => {
          setSaving(true);
          try { await workApi.createTask(task); setCreating(null); toast('Đã ghim nhiệm vụ lên bảng!', 'success'); await load(); }
          catch (e) { showError('Chưa tạo được nhiệm vụ', e); }
          finally { setSaving(false); }
        }} />
      <TaskDetail task={detail} done={detail ? done(detail) : false} onClose={() => setDetail(null)} onComplete={(task) => { void complete(task); }}
        onToggleStep={(task, id, value) => { void toggleStep(task, id, value); }} onRemove={(task) => { void remove(task); }}
        onPriority={(task, p) => { void changePriority(task, p); }} />
      <ProjectSheet project={project} onClose={() => setProject(null)} onAddTask={(p) => { setProject(null); setCreating({ project: p.id }); }}
        onUpdate={(p, body) => { void updateProject(p, body); }} />
      <NewProjectSheet visible={newProject} onClose={() => setNewProject(false)} onCreated={() => { setNewProject(false); void load(); }} />
      <StatsSheet visible={stats} onClose={() => setStats(false)} />
      <OptionSheet visible={!!openedChest} title={openedChest ? `${openedChest.name} đã mở!` : ''} onClose={() => setOpenedChest(null)}>
        <View style={s.rewardList}>
          {openedChest?.rewards.map((item) => (
            <View key={item.id} style={s.rewardItem}>
              <ItemIcon id={item.id} art={item.art} size={48} />
              <Text style={s.rewardName}>{item.name} ×{item.quantity}</Text>
            </View>
          ))}
          <Text style={s.rewardNote}>Phần thưởng đã vào Kho đồ, bạn có thể đặt vào phòng.</Text>
          {onOpenInventory ? <Button title="Xem kho đồ" icon="cube-outline" variant="secondary" onPress={() => { setOpenedChest(null); onOpenInventory(); }} /> : null}
        </View>
      </OptionSheet>
    </View>
  );
}

/** The Focus Desk: the pet walks to the desk when a focus session starts, works next to you, and cheers a finished quest. */
function DeskScene({ user, timer, focusing, line, burst, celebrating }: {
  user: User; timer: FocusTimer; focusing: boolean; line: string; burst: number; celebrating: boolean;
}) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(320);
  const x = useRef(new Animated.Value(0)).current;
  const jump = useRef(new Animated.Value(0)).current;
  const [walking, setWalking] = useState(false);
  const atDesk = useRef(false);
  const night = new Date().getHours() >= 19 || new Date().getHours() < 6;
  const breath = useLoop(1800, !focusing);
  useEffect(() => {
    if (atDesk.current === focusing) return;
    atDesk.current = focusing;
    if (reduce) { x.setValue(focusing ? 1 : 0); return; }
    setWalking(true);
    const anim = Animated.timing(x, { toValue: focusing ? 1 : 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    anim.start(() => setWalking(false));
    return () => anim.stop();
  }, [focusing, reduce, x]);
  useEffect(() => {
    if (!celebrating || reduce) return;
    const anim = Animated.sequence([
      Animated.timing(jump, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(jump, { toValue: 0, friction: 3, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [celebrating, burst, reduce, jump]);
  const petSize = 92;
  const minutes = Math.floor(timer.seconds / 60);
  const seconds = timer.seconds % 60;
  return (
    <View style={s.scene} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="focus-desk">
      <QuestSky night={night} />
      <FocusDeskArt focusing={focusing} />
      <Animated.View style={[s.pet, { width: petSize, height: petSize, transform: [
        { translateX: x.interpolate({ inputRange: [0, 1], outputRange: [width * 0.06, width * 0.5 - petSize / 2] }) },
        { translateY: jump.interpolate({ inputRange: [0, 1], outputRange: [0, -36] }) },
        { scaleY: breath ? breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) : 1 },
      ] }]} accessible accessibilityLabel={`${user.pet_name ?? 'Pet'} ${focusing ? 'đang làm việc cùng bạn' : 'đang chờ bên bàn'}`}>
        <PetArt pet={user.pet} stage={user.level} size={petSize} walking={walking} studying={focusing && !walking} />
      </Animated.View>
      <StarBurst burstKey={burst} />
      <View style={s.bubble} accessibilityLiveRegion="polite">
        <Text style={s.bubbleText} numberOfLines={2}>{line}</Text>
      </View>
      <View style={s.timerDock}>
        <Text style={s.timerText} accessibilityLabel={`Đồng hồ tập trung ${minutes} phút ${seconds} giây`}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Text>
        <Pressable onPress={timer.toggle} style={s.timerBtn} accessibilityRole="button" accessibilityLabel={timer.running ? 'Tạm dừng tập trung' : 'Bắt đầu tập trung'}>
          <Ionicons name={timer.running ? 'pause' : 'play'} size={18} color="#FFFFFF" />
        </Pressable>
        {timer.running || timer.activeCycle ? (
          <Pressable onPress={timer.reset} style={[s.timerBtn, s.timerStop]} accessibilityRole="button" accessibilityLabel="Kết thúc phiên tập trung">
            <Ionicons name="stop" size={16} color={t.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ icon, color, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** How the day's goals stand for the pet's exploration (the same rule as everywhere: every goal of today). */
function WalkHint({ walk }: { walk: WorkDashboard['walk'] }) {
  const text = walk.status === 'walking' ? 'Pet đang đi khám phá, sẽ mang quà về cho bạn!'
    : walk.status === 'rested' ? 'Pet đã đi khám phá hôm nay rồi.'
    : walk.status === 'returned' ? 'Pet đã về, mở quà ở Trang chủ nhé!'
    : walk.status === 'waiting_hatch' ? 'Trứng sắp nở, chuyến khám phá sẽ bắt đầu ngay sau đó.'
    : walk.goals_total ? `Xong ${walk.goals_done}/${walk.goals_total} mục tiêu hôm nay để pet đi khám phá.` : 'Thêm mục tiêu hôm nay để pet đi khám phá.';
  return (
    <View style={s.walkHint}>
      <Ionicons name="compass" size={16} color="#22703A" />
      <Text style={s.walkHintText}>{text}</Text>
    </View>
  );
}

/** A quest card pinned on the board. Done cards get a stamp, which lands with a thump the moment it's completed. */
function QuestCard({ task, index, done, state, project, stamping, onPress, onComplete }: {
  task: WorkTask; index: number; done: boolean; state?: 'sending' | 'queued'; project?: string; stamping: boolean;
  onPress: () => void; onComplete: () => void;
}) {
  const reduce = useReduceMotion();
  const stamp = useRef(new Animated.Value(done ? 1 : 0)).current;
  useEffect(() => {
    if (!done) { stamp.setValue(0); return; }
    if (!stamping || reduce) { stamp.setValue(1); return; }
    stamp.setValue(0);
    const anim = Animated.spring(stamp, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [done, stamping, reduce, stamp]);
  const p = priorityOf(task.priority);
  const steps = task.steps.length ? `${task.steps.filter((x) => x.done).length}/${task.steps.length}` : null;
  const due = dueLabel(task);
  const tilt = ['-1.5deg', '1deg', '-0.5deg', '1.5deg'][index % 4];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { transform: [{ rotate: tilt }] }, task.overdue && !done && s.cardLate, pressed && s.pressed]}
      accessibilityRole="button" accessibilityLabel={`${task.title}, ưu tiên ${p.label}${due ? `, hạn ${due}` : ''}${task.overdue && !done ? ', quá hạn' : ''}${done ? ', đã hoàn thành' : ''}`}
      testID={`quest-${task.occurrence_id}`}>
      <View style={[s.pin, { backgroundColor: task.overdue && !done ? '#D64C5B' : p.color }]} />
      <Text style={[s.cardTitle, done && s.cardTitleDone]} numberOfLines={2}>{task.title}</Text>
      {project ? <Text style={s.cardProject} numberOfLines={1}>🏝️ {project}</Text> : null}
      <View style={s.cardMeta}>
        {task.overdue && !done ? <Text style={s.late}>Quá hạn</Text> : due ? <Text style={s.metaText}>⏰ {due}</Text> : null}
        {steps ? <Text style={s.metaText}>☑ {steps}</Text> : null}
        {task.estimated_minutes ? <Text style={s.metaText}>⏳ {task.estimated_minutes}'</Text> : null}
      </View>
      <View style={s.cardFoot}>
        <Text style={s.exp}>+{task.exp} EXP</Text>
        {!done ? (
          <Pressable onPress={onComplete} hitSlop={8} style={s.doneBtn} accessibilityRole="button" accessibilityLabel={`Hoàn thành ${task.title}`}>
            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
          </Pressable>
        ) : state === 'queued' ? <Ionicons name="cloud-upload-outline" size={18} color={t.muted} accessibilityLabel="Chờ đồng bộ" /> : null}
      </View>
      {done ? (
        <Animated.View pointerEvents="none" style={[s.stamp, { opacity: stamp, transform: [
          { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }, { rotate: '-14deg' }] }]}>
          <Text style={s.stampText}>{state === 'queued' ? 'CHỜ GỬI' : 'XONG'}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

function TaskDetail({ task, done, onClose, onComplete, onToggleStep, onRemove, onPriority }: {
  task: WorkTask | null; done: boolean; onClose: () => void; onComplete: (task: WorkTask) => void;
  onToggleStep: (task: WorkTask, stepId: number, done: boolean) => void; onRemove: (task: WorkTask) => void;
  onPriority: (task: WorkTask, p: Priority) => void;
}) {
  return (
    <OptionSheet visible={!!task} title={task?.title ?? ''} onClose={onClose}>
      {task ? (
        <ScrollView contentContainerStyle={s.detail}>
          <Text style={s.detailMeta}>
            {task.repeat === 'none' ? 'Một lần' : 'Lặp lại'} · {task.scheduled_date.slice(8, 10)}/{task.scheduled_date.slice(5, 7)}
            {dueLabel(task) ? ` · Hạn ${dueLabel(task)}` : ''}{task.estimated_minutes ? ` · ${task.estimated_minutes} phút` : ''}
          </Text>
          {task.steps.length ? <Text style={s.detailLabel}>Các bước nhỏ</Text> : null}
          {task.steps.map((step) => (
            <Pressable key={step.id} onPress={() => onToggleStep(task, step.id, !step.done)} style={s.stepRow} accessibilityRole="checkbox"
              accessibilityState={{ checked: step.done }} accessibilityLabel={step.title}>
              <Ionicons name={step.done ? 'checkbox' : 'square-outline'} size={22} color={step.done ? '#22703A' : t.muted} />
              <Text style={[s.stepTitle, step.done && s.cardTitleDone]}>{step.title}</Text>
            </Pressable>
          ))}
          {!done ? <>
            <Text style={s.detailLabel}>Mức ưu tiên</Text>
            <View style={s.chipRow}>
              {PRIORITIES.map((p) => <Chip key={p.id} label={`${p.label} · +${p.exp}`} selected={task.priority === p.id} onPress={() => onPriority(task, p.id)} />)}
            </View>
            <Button title={`Hoàn thành · +${task.exp} EXP`} icon="checkmark-done" onPress={() => onComplete(task)} />
          </> : <Text style={s.doneNote}>✅ Nhiệm vụ đã hoàn thành</Text>}
          <Button title="Xóa nhiệm vụ" icon="trash-outline" variant="danger" onPress={() => onRemove(task)} />
        </ScrollView>
      ) : null}
    </OptionSheet>
  );
}

function ProjectSheet({ project, onClose, onAddTask, onUpdate }: {
  project: WorkProject | null; onClose: () => void; onAddTask: (p: WorkProject) => void;
  onUpdate: (p: WorkProject, body: Partial<Pick<WorkProject, 'status'>>) => void;
}) {
  return (
    <OptionSheet visible={!!project} title={project?.name ?? ''} onClose={onClose}>
      {project ? (
        <View style={s.detail}>
          <View style={s.projectHero}>
            <ProjectIslandArt theme={project.theme} stage={project.build_stage} lit={project.status === 'completed'} size={150} />
          </View>
          <Text style={s.detailMeta}>{BUILD_LABEL[project.build_stage]} · {project.tasks_done}/{project.tasks_total} nhiệm vụ một lần
            {project.recurring_tasks ? ` · ${project.recurring_tasks} nhiệm vụ lặp lại` : ''}</Text>
          <ProgressBar value={project.progress} color="#E09A2B" animated />
          {project.status === 'active' ? <Button title="Thêm nhiệm vụ cho đảo" icon="add" onPress={() => onAddTask(project)} /> : null}
          {project.ready_to_complete ? <Button title="Hoàn thành dự án ✨" icon="flag" onPress={() => onUpdate(project, { status: 'completed' })} /> : null}
          {project.status === 'completed' ? <Button title="Mở lại dự án" variant="secondary" icon="refresh" onPress={() => onUpdate(project, { status: 'active' })} /> : null}
          <Button title="Lưu trữ dự án" variant="ghost" icon="archive-outline" onPress={() => onUpdate(project, { status: 'archived' })} />
        </View>
      ) : null}
    </OptionSheet>
  );
}

function NewProjectSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [theme, setTheme] = useState<ProjectTheme>('meadow');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setName(''); setTheme('meadow'); } }, [visible]);
  return (
    <OptionSheet visible={visible} title="🏝️ Khám phá hòn đảo mới" onClose={onClose}>
      <View style={s.detail}>
        <View style={s.projectHero}><ProjectIslandArt theme={theme} stage={0} lit={false} size={120} /></View>
        <TextInput value={name} onChangeText={setName} placeholder="Tên dự án" placeholderTextColor="#7F95A8" maxLength={60} style={s.input}
          accessibilityLabel="Tên dự án" />
        <View style={s.chipRow}>{THEMES.map((x) => <Chip key={x.id} label={x.label} selected={theme === x.id} onPress={() => setTheme(x.id)} />)}</View>
        <Button title="Tạo đảo" icon="boat-outline" loading={saving} disabled={!name.trim()} onPress={async () => {
          setSaving(true);
          try { await workApi.createProject({ name: name.trim(), theme }); onCreated(); }
          catch (e) { showError('Chưa tạo được dự án', e); }
          finally { setSaving(false); }
        }} />
      </View>
    </OptionSheet>
  );
}

function StatsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<WorkStatistics['period']>('week');
  const [stats, setStats] = useState<WorkStatistics | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setStats(null); setError(null);
    workApi.statistics(period).then((v) => { if (live) setStats(v); }).catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [visible, period, attempt]);
  const max = Math.max(1, ...(stats?.days.map((d) => d.completed) ?? [1]));
  return (
    <OptionSheet visible={visible} title="📊 Thống kê công việc" onClose={onClose}>
      <View style={s.detail}>
        <Segmented compact value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Ngày' }, { value: 'week', label: 'Tuần' }, { value: 'month', label: 'Tháng' }]} />
        {error ? <ErrorState error={error} onRetry={() => setAttempt((n) => n + 1)} /> : !stats ? <WorkSkeleton compact /> : <>
          <Text style={s.statsBig}>{stats.completed} nhiệm vụ hoàn thành</Text>
          <View style={s.bars} accessible accessibilityLabel={stats.days.map((d) => `${d.date}: ${d.completed}`).join(', ')}>
            {stats.days.slice(-14).map((d) => (
              <View key={d.date} style={s.barCol}>
                <View style={[s.bar, { height: 8 + (d.completed / max) * 80 }]} />
                <Text style={s.barLabel}>{d.date.slice(8, 10)}</Text>
              </View>
            ))}
          </View>
          <Text style={s.detailMeta}>Đúng hạn {stats.on_time} · Trễ hạn {stats.late}</Text>
          <Text style={s.detailMeta}>Ưu tiên: {PRIORITIES.map((p) => `${p.label} ${stats.by_priority[p.id] ?? 0}`).join(' · ')}</Text>
          {stats.by_project.map((p) => <Text key={p.project_id} style={s.detailMeta}>🏝️ {p.name || 'Dự án'}: {p.completed}</Text>)}
        </>}
      </View>
    </OptionSheet>
  );
}

/** Placeholder blocks while the world loads; they shimmer unless motion is reduced. */
function WorkSkeleton({ compact = false }: { compact?: boolean }) {
  const pulse = useLoop(800);
  const opacity = pulse ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) : 0.6;
  return (
    <View style={s.skeleton} accessibilityLabel="Đang tải" accessibilityLiveRegion="polite">
      {(compact ? [90] : [210, 60, 160, 140]).map((h, i) => <Animated.View key={i} style={[s.skeletonBlock, { height: h, opacity }]} />)}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 16 },
  content: { paddingBottom: 120 },
  headerBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  scene: { height: 240, borderRadius: 26, overflow: 'hidden', backgroundColor: '#BFE6FA', marginBottom: 12 },
  pet: { position: 'absolute', bottom: 34, left: 0 },
  bubble: { position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleText: { color: t.ink, fontSize: 14, fontWeight: '800', lineHeight: 19 },
  timerDock: { position: 'absolute', right: 12, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 18, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 },
  timerText: { fontSize: 18, fontWeight: '900', color: t.ink, fontVariant: ['tabular-nums'] },
  timerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  timerStop: { backgroundColor: t.tint },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stat: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 10, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontWeight: '900', color: t.ink },
  statLabel: { fontSize: 11, fontWeight: '700', color: t.muted },
  walkHint: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E3F5E6', borderRadius: 14, padding: 10, marginBottom: 6 },
  walkHintText: { flex: 1, color: '#22703A', fontSize: 13, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 },
  section: { fontSize: 19, fontWeight: '900', color: t.ink },
  sectionGap: { marginTop: 16, marginBottom: 10 },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#C47A3D', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  addPillText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  board: { backgroundColor: '#D9A86C', borderRadius: 22, borderWidth: 8, borderColor: '#9C6A3C', padding: 10, minHeight: 160 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: { width: '48%', backgroundColor: '#FFFBF2', borderRadius: 10, padding: 10, paddingTop: 14, minHeight: 128,
    shadowColor: '#5A3A1A', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  cardLate: { backgroundColor: '#FFF0F0' },
  pin: { position: 'absolute', top: -5, alignSelf: 'center', left: '46%', width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#FFFFFF' },
  cardTitle: { fontSize: 14, fontWeight: '900', color: t.ink, lineHeight: 18 },
  cardTitleDone: { color: t.muted, textDecorationLine: 'line-through' },
  cardProject: { fontSize: 11, fontWeight: '700', color: '#9C6A3C', marginTop: 2 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  metaText: { fontSize: 11, fontWeight: '700', color: t.muted },
  late: { fontSize: 11, fontWeight: '900', color: '#D64C5B' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  exp: { fontSize: 12, fontWeight: '900', color: '#9B5DE5' },
  doneBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#22A06B', alignItems: 'center', justifyContent: 'center' },
  stamp: { position: 'absolute', top: '32%', alignSelf: 'center', borderWidth: 3, borderColor: '#D64C5B', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.7)' },
  stampText: { color: '#D64C5B', fontWeight: '900', fontSize: 18, letterSpacing: 2 },
  pressed: { opacity: 0.9 },
  boardEmpty: { alignItems: 'center', padding: 16, gap: 6, backgroundColor: '#FFFBF2', borderRadius: 14 },
  boardEmptyEmoji: { fontSize: 36 },
  boardEmptyTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  boardEmptyText: { fontSize: 13, color: t.muted, textAlign: 'center' },
  sea: { gap: 14, padding: 12, backgroundColor: '#8FD4F2', borderRadius: 24 },
  island: { width: 132, alignItems: 'center' },
  islandName: { fontSize: 13, fontWeight: '900', color: '#0B4F75', marginTop: -6, maxWidth: 128 },
  islandMeta: { fontSize: 11, fontWeight: '700', color: '#185E86' },
  newIsland: { justifyContent: 'center', height: 150, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: '#FFFFFF' },
  newIslandText: { color: '#FFFFFF', fontWeight: '900', marginTop: 4 },
  chests: { gap: 12, paddingVertical: 4 },
  chest: { width: 96, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 8, gap: 4 },
  chestName: { fontSize: 12, fontWeight: '900', color: t.ink },
  chestBar: { alignSelf: 'stretch' },
  chestMeta: { fontSize: 11, fontWeight: '700', color: t.muted },
  upcoming: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  upcomingTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: t.ink },
  upcomingDate: { fontSize: 12, fontWeight: '800', color: t.muted },
  detail: { gap: 10, paddingBottom: 8 },
  detailMeta: { fontSize: 13, color: t.muted, fontWeight: '700' },
  detailLabel: { fontSize: 14, fontWeight: '900', color: t.ink, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 44 },
  stepTitle: { flex: 1, fontSize: 15, color: t.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  doneNote: { fontSize: 15, fontWeight: '800', color: '#22703A' },
  projectHero: { alignItems: 'center' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  rewardList: { gap: 10 },
  rewardItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardName: { fontSize: 15, fontWeight: '800', color: t.ink },
  rewardNote: { fontSize: 13, color: t.muted },
  statsBig: { fontSize: 18, fontWeight: '900', color: t.ink },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 110 },
  barCol: { flex: 1, alignItems: 'center', gap: 2 },
  bar: { width: '80%', borderRadius: 4, backgroundColor: '#E09A2B' },
  barLabel: { fontSize: 9, color: t.muted },
  skeleton: { gap: 12, paddingTop: 8 },
  skeletonBlock: { borderRadius: 18, backgroundColor: '#DCEAF3' },
});
