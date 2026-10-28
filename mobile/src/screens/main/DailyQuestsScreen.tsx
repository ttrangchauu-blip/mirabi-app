import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { useConfirm } from '../../ui/ConfirmDialog';
import { appTheme as t } from '../../theme';
import { Card, Segmented } from '../../ui/kit';
import { request, ScheduledTask, showError, taskRepeatDetail } from './shared';

type ViewMode = 'day' | 'week';
type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';
type Category = 'study' | 'health' | 'habit' | 'personal' | 'other';
type Props = { onBack: () => void; onChanged: () => void; onOpenTaskCreate: (date: string, onCreated: (date: string) => void) => void };

const today = () => toIso(new Date());
function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function rangeFor(selected: string) {
  const day = fromIso(selected);
  const monday = new Date(day);
  monday.setDate(day.getDate() - (day.getDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toIso(monday), end: toIso(sunday) };
}
function calendarDates(mode: ViewMode, selected: string) {
  const focus = fromIso(selected);
  if (mode === 'day') return [selected];
  const monday = new Date(focus);
  monday.setDate(focus.getDate() - (focus.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return toIso(d); });
}

const CATEGORY_OPTIONS: { id: Category; label: string }[] = [
  { id: 'study', label: 'Học tập' }, { id: 'health', label: 'Sức khỏe' }, { id: 'habit', label: 'Thói quen' },
  { id: 'personal', label: 'Cá nhân' }, { id: 'other', label: 'Khác' },
];
const REPEAT_OPTIONS: { id: Repeat; label: string }[] = [
  { id: 'none', label: 'Không lặp' }, { id: 'daily', label: 'Hằng ngày' }, { id: 'weekly', label: 'Hằng tuần' }, { id: 'monthly', label: 'Hằng tháng' },
];
const categoryLabel = (id: string) => id === 'daily' ? 'Nhiệm vụ hằng ngày' : CATEGORY_OPTIONS.find((option) => option.id === id)?.label ?? id;
const repeatLabel = (id: string) => ({ yearly: 'Hằng năm', custom: 'Tùy chỉnh' } as Record<string, string>)[id] ?? REPEAT_OPTIONS.find((option) => option.id === id)?.label ?? id;
export function DailyQuestsScreen({ onBack, onChanged, onOpenTaskCreate }: Props) {
  const [view, setView] = useState<ViewMode>('day');
  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const confirm = useConfirm();
  const range = useMemo(() => rangeFor(selectedDate), [selectedDate]);
  const dates = useMemo(() => calendarDates(view, selectedDate), [view, selectedDate]);
  const loadTasks = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoadingTasks(true);
    try {
      const result = await request(`/api/tasks?start_date=${range.start}&end_date=${range.end}&quest_date=${today()}`) as ScheduledTask[];
      if (sequence === loadSequence.current) setTasks(result);
    } catch (e) { showError('Không tải được nhiệm vụ đã tạo', e); }
    finally { if (sequence === loadSequence.current) setLoadingTasks(false); }
  }, [range.start, range.end]);
  useEffect(() => { void loadTasks(); }, [loadTasks]);

  function shiftDate(amount: number) {
    const date = fromIso(selectedDate);
    if (view === 'day') date.setDate(date.getDate() + amount);
    else date.setDate(date.getDate() + amount * 7);
    setSelectedDate(toIso(date));
  }

  const rangeLabel = view === 'day'
    ? fromIso(selectedDate).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${fromIso(range.start).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })} – ${fromIso(range.end).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })}`;

  async function completeTask(task: ScheduledTask) {
    if (completing || task.completed) return;
    if (!(await confirm({ title: 'Hoàn thành nhiệm vụ?', message: task.title, confirmLabel: 'Hoàn thành', icon: 'checkmark-circle-outline' }))) return;
    const key = task.occurrence_id;
    setCompleting(key);
    try {
      if (task.kind === 'daily_quest') await request(`/api/pet/quests/${task.id}/complete`, { method: 'POST' });
      else await request(`/api/tasks/${task.id}/complete`, { method: 'POST', body: { occurrence_date: task.scheduled_date } });
      setTasks((current) => current.map((item) => item.occurrence_id === key ? { ...item, completed: true } : item));
      onChanged();
    } catch (e) { showError('Không hoàn thành được nhiệm vụ', e); }
    finally { setCompleting(null); }
  }

  async function handleTaskCreated(scheduledDate: string) {
    setSelectedDate(scheduledDate); setView('day'); onChanged();
    const targetRange = rangeFor(scheduledDate);
    const sequence = ++loadSequence.current;
    setLoadingTasks(true);
    try {
      const result = await request(`/api/tasks?start_date=${targetRange.start}&end_date=${targetRange.end}&quest_date=${today()}`) as ScheduledTask[];
      if (sequence === loadSequence.current) setTasks(result);
    } catch (e) { showError('Không tải được lịch sau khi tạo nhiệm vụ', e); }
    finally { if (sequence === loadSequence.current) setLoadingTasks(false); }
  }

  return <>
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại" style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={t.ink} />
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.title} accessibilityRole="header">Nhiệm vụ</Text>
        <Text style={styles.subtitle}>Lên kế hoạch và theo dõi tiến độ của bạn.</Text>
      </View>
      <Pressable onPress={() => onOpenTaskCreate(selectedDate, handleTaskCreated)} style={styles.headerAddButton} accessibilityRole="button" accessibilityLabel="Thêm nhiệm vụ mới">
        <Ionicons name="add" size={19} color="#FFFFFF" /><Text style={styles.headerAddText}>Thêm mới</Text>
      </Pressable>
    </View>

    <Segmented options={[{ value: 'day', label: 'Ngày' }, { value: 'week', label: 'Tuần' }]} value={view} onChange={setView} />
    <View style={styles.dateNav}>
      <Pressable onPress={() => shiftDate(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Khoảng thời gian trước"><Ionicons name="chevron-back" size={20} color={t.accent} /></Pressable>
      <View style={styles.dateCenter}><Pressable onPress={() => setSelectedDate(today())} style={styles.todayButton} accessibilityRole="button"><Text style={styles.todayButtonText}>Hôm nay</Text></Pressable><Text style={styles.dateLabel}>{rangeLabel}</Text></View>
      <Pressable onPress={() => shiftDate(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Khoảng thời gian tiếp theo"><Ionicons name="chevron-forward" size={20} color={t.accent} /></Pressable>
    </View>

    <TeamCalendar mode={view} dates={dates} selectedDate={selectedDate} tasks={tasks} onSelectDate={setSelectedDate} onCompleteTask={completeTask} />
    {loadingTasks ? <Text style={styles.calendarLoading}>Đang đồng bộ lịch…</Text> : null}


  </>;
}

function TeamCalendar({ mode, dates, selectedDate, tasks, onSelectDate, onCompleteTask }: {
  mode: ViewMode; dates: string[]; selectedDate: string; tasks: ScheduledTask[];
  onSelectDate: (date: string) => void; onCompleteTask: (task: ScheduledTask) => void | Promise<void>;
}) {
  const columnWidth = mode === 'day' ? 250 : 132;
  const hours = Array.from({ length: 17 }, (_, i) => i + 6);
  return <Card style={styles.teamCalendarCard}>
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={styles.teamHeaderRow}>
          <View style={styles.timeGutter} />
          {dates.map((date) => {
            const day = fromIso(date);
            const selected = date === selectedDate;
            return <Pressable key={date} onPress={() => onSelectDate(date)} style={[styles.teamDayHeader, { width: columnWidth }, selected && styles.teamDayHeaderSelected]}>
              <Text style={[styles.teamWeekday, selected && styles.teamAccent]}>{day.toLocaleDateString('vi-VN', { weekday: 'long' })}</Text>
              <Text style={[styles.teamDate, selected && styles.teamAccent]}>{day.getDate()}</Text>
            </Pressable>;
          })}
        </View>
        <View style={styles.teamAllDayRow}>
          <View style={styles.allDayLabel}><Text style={styles.allDayText}>Cả ngày</Text></View>
          {dates.map((date) => {
            const dayTasks = tasks.filter((task) => task.scheduled_date === date && !task.start_time);
            return <View key={date} style={[styles.teamAllDayCell, { width: columnWidth }]}>
              {dayTasks.length === 0 ? <View style={styles.emptyAllDay} /> : dayTasks.map((task) => <Pressable key={task.occurrence_id} onPress={() => void onCompleteTask(task)} disabled={task.completed} accessibilityRole="checkbox" accessibilityState={{ checked: task.completed, disabled: task.completed }} style={[styles.teamEvent, task.completed && styles.teamEventDone]}>
                <Text numberOfLines={2} style={[styles.teamEventTitle, task.completed && styles.teamEventTitleDone]}>{task.title}</Text>
                <Text numberOfLines={1} style={[styles.teamEventMeta, task.completed && styles.teamEventTitleDone]}>{categoryLabel(task.category)} · {task.start_time ? `${task.start_time}${task.end_time ? `–${task.end_time}` : ''} · ` : ''}{taskRepeatDetail(task)} · {task.kind === 'daily_quest' ? '+10 EXP' : '+5 EXP'}</Text>
              </Pressable>)}
            </View>;
          })}
        </View>
        <View style={styles.teamTimeGrid}>
          <View style={styles.hourLabels}>{hours.map((hour) => <View key={hour} style={styles.hourLabelCell}><Text style={styles.hourLabel}>{hour}:00</Text></View>)}</View>
          {dates.map((date) => <View key={date} style={[styles.timeColumn, { width: columnWidth }, date === selectedDate && styles.selectedTimeColumn]}>
            {hours.map((hour) => <View key={hour} style={styles.hourSlot} />)}
            {tasks.filter((task) => task.scheduled_date === date && task.start_time).map((task) => {
              const [startHour, startMinute] = (task.start_time ?? '06:00').split(':').map(Number);
              const [endHour, endMinute] = (task.end_time ?? task.start_time ?? '06:30').split(':').map(Number);
              const top = Math.max(0, ((startHour * 60 + startMinute) - 360) / 60 * 46);
              const height = Math.max(30, ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60 * 46);
              return <Pressable key={task.occurrence_id} onPress={() => void onCompleteTask(task)} disabled={task.completed} accessibilityRole="checkbox" accessibilityState={{ checked: task.completed, disabled: task.completed }} style={[styles.timedEvent, { top, height }, task.completed && styles.teamEventDone]}>
                <Text numberOfLines={1} style={[styles.teamEventTitle, task.completed && styles.teamEventTitleDone]}>{task.start_time} {task.title}</Text>
                {task.end_time ? <Text style={[styles.teamEventMeta, task.completed && styles.teamEventTitleDone]}>{task.start_time}–{task.end_time}</Text> : null}
              </Pressable>;
            })}
          </View>)}
        </View>
      </View>
    </ScrollView>
    <Text style={styles.calendarHint}>Nhiệm vụ chưa có giờ cụ thể sẽ nằm trong hàng “Cả ngày”.</Text>
  </Card>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1 }, title: { fontSize: 24, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 13, lineHeight: 19, color: t.muted, marginTop: 2 },
  headerAddButton: { minHeight: 40, borderRadius: 13, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.accent },
  headerAddText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 14, paddingHorizontal: 6 },
  dateCenter: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  todayButton: { borderWidth: 1, borderColor: '#D8E2E9', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  todayButtonText: { color: t.ink, fontSize: 11, fontWeight: '800' },
  dateLabel: { fontSize: 15, fontWeight: '800', color: t.ink, textTransform: 'capitalize' },
  calendarLoading: { color: t.muted, fontSize: 11, textAlign: 'center', marginTop: 8 },
  teamCalendarCard: { paddingHorizontal: 0, paddingVertical: 0, overflow: 'hidden' },
  teamHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#D8E2E9' },
  timeGutter: { width: 48 },
  teamDayHeader: { minHeight: 66, paddingHorizontal: 8, paddingVertical: 7, borderLeftWidth: 1, borderColor: '#E3EAF0', justifyContent: 'center' },
  teamDayHeaderSelected: { borderTopWidth: 3, borderTopColor: '#6C63E8', backgroundColor: '#F5F4FF' },
  teamWeekday: { fontSize: 11, fontWeight: '700', color: t.muted, textTransform: 'capitalize' },
  teamDate: { fontSize: 21, fontWeight: '700', color: t.ink, marginTop: 2 },
  teamAccent: { color: '#6258D9' },
  teamAllDayRow: { flexDirection: 'row', minHeight: 82, borderBottomWidth: 1, borderColor: '#D8E2E9' },
  allDayLabel: { width: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  allDayText: { color: t.muted, fontSize: 9, fontWeight: '700' },
  teamAllDayCell: { minHeight: 82, padding: 4, gap: 3, borderLeftWidth: 1, borderColor: '#E3EAF0' },
  emptyAllDay: { flex: 1 },
  teamEvent: { borderLeftWidth: 3, borderLeftColor: '#2CA66F', backgroundColor: '#E4F4EC', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 4 },
  teamEventDone: { borderLeftColor: '#9AACA1', backgroundColor: '#EEF2EF' },
  teamEventTitle: { color: '#185B3C', fontSize: 10, lineHeight: 13, fontWeight: '800' },
  teamEventTitleDone: { color: '#77867D', textDecorationLine: 'line-through' },
  teamEventMeta: { color: '#658273', fontSize: 8, lineHeight: 11 },
  teamTimeGrid: { flexDirection: 'row' },
  hourLabels: { width: 48 },
  hourLabelCell: { height: 46, alignItems: 'center', paddingTop: 3 },
  hourLabel: { color: t.muted, fontSize: 9 },
  timeColumn: { borderLeftWidth: 1, borderColor: '#E3EAF0', position: 'relative' },
  selectedTimeColumn: { backgroundColor: '#FBFAFF' },
  hourSlot: { height: 46, borderBottomWidth: 1, borderStyle: 'dashed', borderColor: '#E5EBF0' },
  timedEvent: { position: 'absolute', left: 4, right: 4, zIndex: 2, borderLeftWidth: 3, borderLeftColor: '#6C63E8', backgroundColor: '#EEEAFE', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3, overflow: 'hidden' },
  calendarHint: { paddingHorizontal: 12, paddingVertical: 10, color: t.muted, fontSize: 11 },
  modalBackdrop: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(17, 39, 58, 0.48)', padding: 18 },
  modalKeyboard: { maxHeight: '100%' },
  modalContent: { flexGrow: 1, justifyContent: 'center' },
  modalCard: { marginBottom: 0 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  formTitle: { fontSize: 17, fontWeight: '900', color: t.ink, marginBottom: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: t.ink, marginTop: 12, marginBottom: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, backgroundColor: t.bg },
  choiceSelected: { backgroundColor: t.accent },
  choiceText: { fontSize: 12, fontWeight: '700', color: t.accent },
  choiceTextSelected: { color: '#FFFFFF' },
  saveButton: { height: 48, marginTop: 18, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' }, disabled: { opacity: 0.55 },
});
