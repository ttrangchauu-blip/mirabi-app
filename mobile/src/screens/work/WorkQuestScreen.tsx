import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NetworkError } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { PetArt } from '../../components/PetArt';
import { Text, TextInput } from '../../components/Typography';
import { completionQueue, workApi } from '../../life/api';
import type { Priority, ProjectTheme, WorkChest, WorkDashboard, WorkProject, WorkStatistics, WorkTask } from '../../life/types';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Chip, ProgressBar, Segmented } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import type { FocusTimer } from '../main/MainApp';
import { showError } from '../main/shared';
import { ErrorState, OptionSheet } from '../together/ui';
import { useFrameWatch } from '../../world/budget';
import { Carved, ContactShadow, Knob, Paper, Plate, SceneHeader, SceneIn, Tiles, Triumph, useSize } from '../../world/diorama';
import { useAtmosphere } from '../../world/atmosphere';
import { useWeather } from '../../world/weather';
import { LivingPet, type LivingPetHandle } from '../../world/living';
import { ChestArt, ProjectIslandArt, useLoop } from './workArt';

const SEA = require('../../../assets/world/work/sea.webp');
import { type Box, DESK_DAY, DESK_NIGHT, DESK_TOP, DeskNote, DeskScreen, DeskWindow, DropDock, type DropTarget, PLATE, targetAt } from './WorkDesk';
import { DUE_PRESETS, type DuePreset, dueFromPreset, ESTIMATES, PRIORITIES, WorkTaskSheet, priorityOf } from './WorkTaskSheet';

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
 * The Work Desk: a real desk by a window. The pet works next to you (the app's one Pomodoro timer), today's tasks lie on
 * it as notes you can pick up and drop on the "Xong" tray or a priority folder, a framed sea of project islands hangs
 * below, and reward chests stand on a shelf. Tasks are the app's tasks (/api/tasks): the EXP of a quest, and the pet's
 * celebration, come only from the server's answer. A drop calls exactly what the buttons call.
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
  // A note being carried: the page holds still, and the tray and folders are out.
  const [carrying, setCarrying] = useState(false);
  const [hover, setHover] = useState<DropTarget | null>(null);
  const zones = useRef<Partial<Record<DropTarget, Box>>>({});
  useFrameWatch('work-desk');
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
      const withSteps = (list: WorkTask[]) => list.map((x) => (x.occurrence_id === task.occurrence_id ? { ...x, steps: updated.steps } : x));
      setData((d) => d && ({ ...d, tasks_today: withSteps(d.tasks_today), overdue: withSteps(d.overdue) }));
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

  /** Title, estimate and deadline: the same call as changing the priority. */
  async function editTask(task: WorkTask, body: Partial<Pick<WorkTask, 'title' | 'due_at' | 'estimated_minutes'>>) {
    try {
      const updated = await workApi.updateTask(task.id, task.scheduled_date, body);
      setDetail((d) => (d ? { ...d, ...body, title: updated.title, due_at: updated.due_at, estimated_minutes: updated.estimated_minutes } : d));
      toast('Đã cập nhật nhiệm vụ', 'success');
      await load();
    } catch (e) { showError('Chưa lưu được nhiệm vụ', e); }
  }

  /** A note let go over the desk: the tray completes it, a folder moves it to that priority. Anywhere else, it goes back. */
  function dropNote(task: WorkTask, x: number, y: number) {
    const target = targetAt(zones.current, x, y);
    setHover(null);
    if (!target) return false;
    if (target === 'done') void complete(task);
    else if (target !== task.priority) { void changePriority(task, target); toast(`Đã chuyển sang ưu tiên ${priorityOf(target).label}`, 'info'); }
    return true;
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
    if (body.status === 'archived' && !(await confirm({ title: 'Lưu trữ dự án?', message: `Đảo "${p.name}" sẽ rời khỏi bản đồ dự án và hiện chưa mở lại được. Nhiệm vụ của đảo vẫn ở trên bàn.`,
      confirmLabel: 'Lưu trữ', cancelLabel: 'Giữ lại', icon: 'archive-outline' }))) return;
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
        <SceneHeader title="Nhiệm vụ công việc" subtitle="Bàn làm việc của bạn" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <WorkSkeleton />}
      </View>
    );
  }

  const done = (task: WorkTask) => task.completed || !!local[task.occurrence_id];
  const todayDone = data.tasks_today.filter(done).length;
  const focusing = timer.running && timer.phase === 'focus';
  // A task of today whose deadline has passed is in both lists: one note on the desk, the overdue one.
  const board = [...data.overdue, ...data.tasks_today.filter((task) => !data.overdue.some((late) => late.occurrence_id === task.occurrence_id))];

  return (
    <View style={s.fill} testID="work-quest">
      <SceneHeader title="Nhiệm vụ công việc" subtitle="Bàn làm việc của bạn" onBack={onBack} right={<Knob icon="stats-chart" label="Thống kê công việc" onPress={() => setStats(true)} />} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} scrollEnabled={!carrying}>
        <SceneIn>
          <DeskScene user={user} timer={timer} focusing={focusing} line={cheer ?? data.pet_line} burst={burst} celebrating={!!cheer && burst > 0} />

          <View style={s.desktop} testID="mission-board">
            <DeskSurface />
            <View style={s.deskEdge} />
            <Paper style={s.ledger}>
              <View style={s.statsRow} accessible accessibilityLabel={`Hôm nay xong ${todayDone} trên ${data.tasks_today.length} nhiệm vụ, tập trung ${data.summary.focus_minutes_today} phút`}>
                <Stat icon="flag" color="#B56F12" value={`${todayDone}/${data.tasks_today.length}`} label="Nhiệm vụ" />
                <Stat icon="timer-outline" color="#136FA8" value={`${data.summary.focus_minutes_today}'`} label="Tập trung" />
                <Stat icon="sparkles" color="#6A3FB5" value={`${data.summary.exp_remaining_today}`} label="EXP còn nhận" />
              </View>
              <WalkHint walk={data.walk} />
            </Paper>
            <Carved right={
              <Pressable onPress={() => setCreating({ project: null })} style={s.addPill} accessibilityRole="button" accessibilityLabel="Nhận nhiệm vụ mới">
                <Ionicons name="add" size={18} color="#123B5C" /><Text style={s.addPillText}>Thêm note</Text>
              </Pressable>}>Trên bàn hôm nay</Carved>
            {board.length === 0 ? (
              <Paper style={s.boardEmpty}>
                <Text style={s.boardEmptyTitle}>Bảng nhiệm vụ đang trống</Text>
                <Text style={s.boardEmptyText}>Viết note đầu tiên của hôm nay, pet sẽ cùng bạn hoàn thành!</Text>
                <Button title="Ghim nhiệm vụ" icon="add" onPress={() => setCreating({ project: null })} />
              </Paper>
            ) : (
              <>
                <View style={s.cards}>
                  {board.map((task) => (
                    <DeskNote key={task.occurrence_id} task={task} done={done(task)} state={local[task.occurrence_id]} due={dueLabel(task)}
                      project={data.projects.find((p) => p.id === task.project_id)?.name}
                      stamping={stamped === task.occurrence_id} onPress={() => setDetail(task)} onComplete={() => { void complete(task); }}
                      onLift={(lifted) => { setCarrying(lifted); if (!lifted) setHover(null); }}
                      onHover={(x, y) => setHover(targetAt(zones.current, x, y))}
                      onDrop={(x, y) => dropNote(task, x, y)} />
                  ))}
                </View>
                <Text style={s.dragHint}>Giữ một note rồi kéo vào khay Xong hoặc đổi mức ưu tiên.</Text>
              </>
            )}
          </View>

          <View style={s.wall} testID="project-map">
            <Carved>Bản đồ dự án</Carved>
            <View style={s.mapFrame}>
              <Image source={SEA} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} accessibilityIgnoresInvertColors />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sea}>
                {data.projects.map((p) => (
                  <Pressable key={p.id} onPress={() => setProject(p)} style={s.island} accessibilityRole="button"
                    accessibilityLabel={`Dự án ${p.name}: ${p.tasks_done} trên ${p.tasks_total} nhiệm vụ, ${BUILD_LABEL[p.build_stage]}`}>
                    <ProjectIslandArt theme={p.theme} stage={p.build_stage} lit={p.status === 'completed'} />
                    <Text style={s.islandName} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.islandMeta}>{p.status === 'completed' ? 'Hoàn thành' : `${p.tasks_done}/${p.tasks_total} nhiệm vụ`}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => setNewProject(true)} style={[s.island, s.newIsland]} accessibilityRole="button" accessibilityLabel="Tạo dự án mới">
                  <Ionicons name="add-circle" size={40} color="#FFFFFF" />
                  <Text style={s.newIslandText}>Đảo mới</Text>
                </Pressable>
              </ScrollView>
            </View>

            <Carved>Kệ phần thưởng</Carved>
            <View style={s.shelfWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chests}>
                {data.chests.map((chest) => (
                  <Pressable key={chest.code} onPress={() => { void openChest(chest); }} style={s.chest} accessibilityRole="button"
                    accessibilityLabel={`${chest.name}: ${chest.status === 'opened' ? 'đã mở' : chest.status === 'ready' ? 'sẵn sàng mở' : `${chest.progress} trên ${chest.required}`}`}>
                    <ChestArt status={chest.status} opening={opening === chest.code} />
                    <ContactShadow width={70} height={12} style={s.chestShadow} />
                    <Text style={s.chestName} numberOfLines={1}>{chest.name}</Text>
                    <Text style={s.chestMeta}>{chest.status === 'opened' ? 'Đã mở' : chest.status === 'ready' ? 'Mở ngay!' : `${chest.progress}/${chest.required}`}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={s.shelfBoard} />
            </View>

            {data.upcoming.length ? <>
              <Carved>Sắp tới</Carved>
              <Paper style={s.upcomingSheet}>
                {data.upcoming.slice(0, 6).map((task) => (
                  <Pressable key={task.occurrence_id} onPress={() => setDetail(task)} style={s.upcoming} accessibilityRole="button" accessibilityLabel={`${task.title}, ngày ${task.scheduled_date}`}>
                    <View style={[s.dot, { backgroundColor: priorityOf(task.priority).color }]} />
                    <Text style={s.upcomingTitle} numberOfLines={1}>{task.title}</Text>
                    <Text style={s.upcomingDate}>{task.scheduled_date.slice(8, 10)}/{task.scheduled_date.slice(5, 7)}</Text>
                  </Pressable>
                ))}
              </Paper>
            </> : null}
          </View>
        </SceneIn>
      </ScrollView>
      {carrying ? <DropDock hover={hover} bottom={100} onZones={(next) => { zones.current = next; }} /> : null}

      <WorkTaskSheet visible={!!creating} projects={data.projects} initialProject={creating?.project ?? null} saving={saving}
        onClose={() => setCreating(null)} onSave={async (task) => {
          setSaving(true);
          try { await workApi.createTask(task); setCreating(null); toast('Đã ghim nhiệm vụ lên bảng!', 'success'); await load(); }
          catch (e) { showError('Chưa tạo được nhiệm vụ', e); }
          finally { setSaving(false); }
        }} />
      <TaskDetail task={detail} done={detail ? done(detail) : false} onClose={() => setDetail(null)} onComplete={(task) => { void complete(task); }}
        onToggleStep={(task, id, value) => { void toggleStep(task, id, value); }} onRemove={(task) => { void remove(task); }}
        onPriority={(task, p) => { void changePriority(task, p); }} onEdit={(task, body) => { void editTask(task, body); }} />
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

/** The wood of the desk, as big as the desk has become: the same boards as the back of the desk, seen from above. */
function DeskSurface() {
  const [size, onLayout] = useSize({ width: 390, height: 600 });
  return <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none"><Tiles source={DESK_TOP} width={size.width} height={size.height} /></View>;
}

/** The back of the desk under the window: the pet walks over when a focus session starts, works next to you, and cheers
 * a finished quest. */
function DeskScene({ user, timer, focusing, line, burst, celebrating }: {
  user: User; timer: FocusTimer; focusing: boolean; line: string; burst: number; celebrating: boolean;
}) {
  const [size, onLayout] = useSize({ width: 390, height: 236 });
  const width = size.width;
  // Exactly the picture's shape, so the glass and the screen stay where the picture has them.
  const height = Math.round(width / PLATE.ratio);
  const { reading } = useWeather();
  const { light } = useAtmosphere(reading);
  const pet = useRef<LivingPetHandle>(null);
  const petSize = Math.round(height * 0.38);
  const feet = Math.round(height * 0.93);
  const rest = Math.round(width * 0.14);
  const desk = Math.round(width * 0.38);
  const atDesk = useRef(false);
  useEffect(() => {
    if (atDesk.current === focusing) return;
    atDesk.current = focusing;
    void pet.current?.walkTo(focusing ? desk : rest, feet);
  }, [focusing, desk, rest, feet]);
  useEffect(() => {
    if (celebrating) void pet.current?.act('celebrate');
  }, [celebrating, burst]);
  const minutes = Math.floor(timer.seconds / 60);
  const seconds = timer.seconds % 60;
  return (
    <View style={[s.scene, { height }]} onLayout={onLayout} testID="focus-desk">
      <Plate source={DESK_DAY} width={width} height={height} />
      {/* The same desk in the evening; it comes up with the stars, so dusk blends the two. */}
      {light.stars > 0.02 ? <Plate source={DESK_NIGHT} width={width} height={height} opacity={Math.min(1, light.stars * 1.3)} /> : null}
      <DeskWindow width={width} height={height} />
      <DeskScreen lit={focusing} width={width} height={height} />
      <LivingPet ref={pet} pet={user.pet} level={user.level} size={petSize} x={focusing ? desk : rest} y={feet} initialState={focusing ? 'study' : 'idle'} shadow={{ dx: 0, stretch: 1, opacity: 0.2 }} />
      <Triumph play={burst} size={220} style={{ left: rest, top: feet - petSize * 0.5 }} />
      <View style={s.bubble} accessibilityLiveRegion="polite"><Text style={s.bubbleText} numberOfLines={2}>{line}</Text><View style={s.bubbleTail} /></View>
      <View style={s.timerDock}>
        <Text style={s.timerText} accessibilityLabel={`Đồng hồ tập trung ${minutes} phút ${seconds} giây`}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </Text>
        <Pressable onPress={timer.toggle} style={s.timerBtn} accessibilityRole="button" accessibilityLabel={timer.running ? 'Tạm dừng tập trung' : 'Bắt đầu tập trung'}>
          <Ionicons name={timer.running ? 'pause' : 'play'} size={18} color="#FFFFFF" />
        </Pressable>
        {timer.running || timer.activeCycle ? (
          <Pressable onPress={timer.reset} style={[s.timerBtn, s.timerStop]} accessibilityRole="button" accessibilityLabel="Kết thúc phiên tập trung">
            <Ionicons name="stop" size={16} color="#123B5C" />
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

/** Rewriting a note: its title, how long it should take, its deadline. */
function TaskEditor({ task, onSave, onCancel }: { task: WorkTask; onSave: (body: Partial<Pick<WorkTask, 'title' | 'due_at' | 'estimated_minutes'>>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState<number | null>(task.estimated_minutes);
  const [due, setDue] = useState<DuePreset | 'keep'>('keep');
  const name = title.trim();
  return (
    <View style={s.detail} testID="task-editor">
      <TextInput value={title} onChangeText={setTitle} maxLength={120} style={s.input} accessibilityLabel="Tên nhiệm vụ" placeholder="Tên nhiệm vụ" placeholderTextColor="#7F95A8" />
      <Text style={s.detailLabel}>Thời gian dự kiến</Text>
      <View style={s.chipRow}>
        <Chip label="Không đặt" selected={estimate === null} onPress={() => setEstimate(null)} />
        {ESTIMATES.map((m) => <Chip key={m} label={`${m} phút`} selected={estimate === m} onPress={() => setEstimate(m)} />)}
      </View>
      <Text style={s.detailLabel}>Hạn hoàn thành</Text>
      <View style={s.chipRow}>
        <Chip label={task.due_at ? `Giữ hạn: ${dueLabel(task)}` : 'Giữ như cũ'} selected={due === 'keep'} onPress={() => setDue('keep')} />
        {DUE_PRESETS.map((d) => <Chip key={d.id} label={d.label} selected={due === d.id} onPress={() => setDue(d.id)} />)}
      </View>
      <Button title="Lưu thay đổi" icon="checkmark" disabled={!name} onPress={() => {
        const deadline = due === 'keep' ? undefined : dueFromPreset(due);
        onSave({ title: name, estimated_minutes: estimate, ...(deadline === undefined ? {} : { due_at: deadline ? deadline.toISOString() : null }) });
      }} />
      <Button title="Huỷ" variant="ghost" onPress={onCancel} />
    </View>
  );
}

function TaskDetail({ task, done, onClose, onComplete, onToggleStep, onRemove, onPriority, onEdit }: {
  task: WorkTask | null; done: boolean; onClose: () => void; onComplete: (task: WorkTask) => void;
  onToggleStep: (task: WorkTask, stepId: number, done: boolean) => void; onRemove: (task: WorkTask) => void;
  onPriority: (task: WorkTask, p: Priority) => void;
  onEdit: (task: WorkTask, body: Partial<Pick<WorkTask, 'title' | 'due_at' | 'estimated_minutes'>>) => void;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => { setEditing(false); }, [task?.occurrence_id]);
  return (
    <OptionSheet visible={!!task} title={task?.title ?? ''} onClose={onClose}>
      {task && editing ? <ScrollView><TaskEditor task={task} onCancel={() => setEditing(false)} onSave={(body) => { setEditing(false); onEdit(task, body); }} /></ScrollView> : task ? (
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
              <Text style={[s.stepTitle, step.done && s.stepDone]}>{step.title}</Text>
            </Pressable>
          ))}
          {!done ? <>
            <Text style={s.detailLabel}>Mức ưu tiên</Text>
            <View style={s.chipRow}>
              {PRIORITIES.map((p) => <Chip key={p.id} label={`${p.label} · +${p.exp}`} selected={task.priority === p.id} onPress={() => onPriority(task, p.id)} />)}
            </View>
            <Button title={`Hoàn thành · +${task.exp} EXP`} icon="checkmark-done" onPress={() => onComplete(task)} />
            <Button title="Sửa nhiệm vụ" icon="create-outline" variant="secondary" onPress={() => setEditing(true)} />
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
    <OptionSheet visible={visible} title="Khám phá hòn đảo mới" onClose={onClose}>
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
    <OptionSheet visible={visible} title="Thống kê công việc" onClose={onClose}>
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
          {stats.by_project.map((p) => <Text key={p.project_id} style={s.detailMeta}>{p.name || 'Dự án'}: {p.completed}</Text>)}
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
  fill: { flex: 1, backgroundColor: '#EAF7FD' },
  content: { paddingBottom: 120 },
  scene: { overflow: 'hidden', backgroundColor: '#F2E6D3' },
  bubble: { position: 'absolute', top: 12, right: 12, left: '42%', backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, shadowColor: '#1F6E9E', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  bubbleTail: { position: 'absolute', left: -6, bottom: 12, width: 12, height: 12, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }] },
  bubbleText: { color: '#123B5C', fontSize: 13, fontWeight: '800', lineHeight: 18 },
  timerDock: { position: 'absolute', right: 10, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 22, paddingLeft: 12, paddingRight: 4, paddingVertical: 4, borderWidth: 1, borderColor: '#C5E2F2' },
  timerText: { fontSize: 17, fontWeight: '900', color: '#136FA8', fontVariant: ['tabular-nums'] },
  timerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#136FA8', alignItems: 'center', justifyContent: 'center' },
  timerStop: { backgroundColor: '#EAF7FD' },
  desktop: { paddingTop: 20, paddingBottom: 16, overflow: 'visible', zIndex: 2 },
  deskEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: 7, backgroundColor: '#E3CBA8', borderBottomWidth: 2, borderBottomColor: '#C9AB84' },
  ledger: { marginHorizontal: 14, marginBottom: 14, paddingVertical: 8, paddingHorizontal: 8, gap: 6, transform: [{ rotate: '-0.4deg' }] },
  statsRow: { flexDirection: 'row', gap: 4 },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  statValue: { fontSize: 16, lineHeight: 20, fontWeight: '900', color: '#123B5C' },
  statLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: '#4F6C86' },
  walkHint: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  walkHintText: { flex: 1, color: '#22703A', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#C6E6F8', borderRadius: 999, paddingHorizontal: 12, minHeight: 40, borderWidth: 1, borderColor: '#C5E2F2' },
  addPillText: { color: '#123B5C', fontWeight: '900', fontSize: 13 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16, paddingHorizontal: 14, paddingTop: 6 },
  dragHint: { fontSize: 11, lineHeight: 15, fontWeight: '700', color: '#123B5C', textAlign: 'center', paddingHorizontal: 16, marginTop: 14 },
  boardEmpty: { alignItems: 'center', marginHorizontal: 14, gap: 6 },
  boardEmptyTitle: { fontSize: 16, fontWeight: '900', color: '#123B5C' },
  boardEmptyText: { fontSize: 13, lineHeight: 18, color: '#4F6C86', textAlign: 'center' },
  wall: { backgroundColor: '#EAF7FD', paddingTop: 16, gap: 8 },
  mapFrame: { marginHorizontal: 14, marginBottom: 14, borderRadius: 22, overflow: 'hidden', borderWidth: 4, borderColor: '#FFFFFF' },
  sea: { gap: 14, padding: 10 },
  island: { width: 132, alignItems: 'center' },
  islandName: { fontSize: 13, fontWeight: '900', color: '#06324D', marginTop: -6, maxWidth: 128 },
  islandMeta: { fontSize: 11, fontWeight: '800', color: '#0A3F5F' },
  newIsland: { justifyContent: 'center', height: 150, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: '#FFFFFF' },
  newIslandText: { color: '#FFFFFF', fontWeight: '900', marginTop: 4 },
  shelfWrap: { marginBottom: 14 },
  shelfBoard: { height: 12, marginHorizontal: 8, marginTop: -2, borderRadius: 3, backgroundColor: '#E3CBA8', borderTopWidth: 2, borderTopColor: '#E3BE8E', shadowColor: '#1F6E9E', shadowOpacity: 0.45, shadowRadius: 5, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  chests: { gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  chest: { width: 96, alignItems: 'center', gap: 2, paddingBottom: 4 },
  chestShadow: { marginTop: -8 },
  chestName: { fontSize: 12, fontWeight: '900', color: '#123B5C' },
  chestMeta: { fontSize: 11, fontWeight: '800', color: '#136FA8' },
  upcomingSheet: { marginHorizontal: 14, marginBottom: 8, paddingVertical: 6 },
  upcoming: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  upcomingTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: t.ink },
  upcomingDate: { fontSize: 12, fontWeight: '800', color: t.muted },
  detail: { gap: 10, paddingBottom: 8 },
  detailMeta: { fontSize: 13, color: t.muted, fontWeight: '700' },
  detailLabel: { fontSize: 14, fontWeight: '900', color: t.ink, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 44 },
  stepTitle: { flex: 1, fontSize: 15, color: t.ink },
  stepDone: { color: t.muted, textDecorationLine: 'line-through' },
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
  skeleton: { gap: 12, paddingTop: 8, paddingHorizontal: 16 },
  skeletonBlock: { borderRadius: 18, backgroundColor: '#EAF7FD' },
});
