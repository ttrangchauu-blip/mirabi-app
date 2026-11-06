import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from '../../components/Typography';
import type { NewWorkTask, Priority, WorkProject } from '../../life/types';
import { AppModal } from '../../ui/AppModal';
import { Button, Chip } from '../../ui/kit';
import { makeStyles, useTheme } from '../../ui/theme';

export const PRIORITIES: { id: Priority; label: string; color: string; exp: number }[] = [
  { id: 'low', label: 'Thấp', color: '#5DAF6A', exp: 5 },
  { id: 'medium', label: 'Vừa', color: '#2E9AD6', exp: 5 },
  { id: 'high', label: 'Cao', color: '#E09A2B', exp: 8 },
  { id: 'urgent', label: 'Khẩn', color: '#D64C5B', exp: 10 },
];
export const priorityOf = (p: Priority) => PRIORITIES.find((x) => x.id === p) ?? PRIORITIES[1];

/** A date as YYYY-MM-DD on the device's clock (the task's day is a local day). */
export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type DuePreset = 'none' | 'today_17' | 'today_end' | 'tomorrow_noon' | 'friday';
export const DUE_PRESETS: { id: DuePreset; label: string }[] = [
  { id: 'none', label: 'Không hạn' }, { id: 'today_17', label: 'Hôm nay 17:00' }, { id: 'today_end', label: 'Hôm nay 23:59' },
  { id: 'tomorrow_noon', label: 'Ngày mai 12:00' }, { id: 'friday', label: 'Thứ Sáu 17:00' },
];

/** The deadline a preset means from `now`; a time already past today moves to the same time tomorrow. */
export function dueFromPreset(preset: DuePreset, now = new Date()): Date | null {
  if (preset === 'none') return null;
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (preset === 'today_17') d.setHours(17, 0);
  else if (preset === 'today_end') d.setHours(23, 59);
  else if (preset === 'tomorrow_noon') { d.setDate(d.getDate() + 1); d.setHours(12, 0); }
  else { const ahead = (5 - d.getDay() + 7) % 7; d.setDate(d.getDate() + ahead); d.setHours(17, 0); }
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + (preset === 'friday' ? 7 : 1));
  return d;
}

export const ESTIMATES = [15, 25, 45, 60, 90];
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

type Props = {
  visible: boolean;
  projects: WorkProject[];
  /** Pre-selected project (the "+" on an island). */
  initialProject?: number | null;
  saving: boolean;
  onClose: () => void;
  onSave: (task: NewWorkTask) => void;
};

/** "Nhận nhiệm vụ": a new work task, its project, priority, deadline, estimate, repeat and steps. */
export function WorkTaskSheet({ visible, projects, initialProject = null, saving, onClose, onSave }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const s = useStyles();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [project, setProject] = useState<number | null>(initialProject);
  const [due, setDue] = useState<DuePreset>('none');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly'>('none');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setTitle(''); setPriority('medium'); setProject(initialProject); setDue('none'); setEstimate(null); setRepeat('none');
    setWeekdays([]); setSteps([]); setStep(''); setError(null);
  }, [visible, initialProject]);

  const addStep = () => {
    const value = step.trim();
    if (!value) return;
    if (steps.length >= 20) { setError('Tối đa 20 bước nhỏ cho một nhiệm vụ.'); return; }
    setSteps((s) => [...s, value.slice(0, 120)]); setStep('');
  };
  const submit = () => {
    const name = title.trim();
    if (!name) { setError('Hãy đặt tên cho nhiệm vụ nhé.'); return; }
    const deadline = repeat === 'none' ? dueFromPreset(due) : null;
    const day = deadline ?? new Date();
    onSave({ title: name.slice(0, 120), scheduled_date: localDate(day), project_id: project, priority,
      due_at: deadline ? deadline.toISOString() : null, estimated_minutes: estimate,
      steps: step.trim() ? [...steps, step.trim().slice(0, 120)] : steps, repeat,
      repeat_weekdays: repeat === 'weekly' ? (weekdays.length ? weekdays : [(new Date().getDay() + 6) % 7]) : [], description: null });
  };
  const active = projects.filter((p) => p.status === 'active');

  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
          <View style={s.header}>
            <Text style={s.title} accessibilityRole="header">📜 Nhận nhiệm vụ mới</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng"><Ionicons name="close" size={22} color={t.muted} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
            <TextInput value={title} onChangeText={(v) => { setTitle(v); setError(null); }} placeholder="Ví dụ: Hoàn thành báo cáo tháng"
              placeholderTextColor={t.placeholder} maxLength={120} style={s.input} accessibilityLabel="Tên nhiệm vụ" autoFocus />
            <Text style={s.label}>Mức ưu tiên</Text>
            <View style={s.row}>
              {PRIORITIES.map((p) => <Chip key={p.id} label={`${p.label} · +${p.exp} EXP`} selected={priority === p.id} onPress={() => setPriority(p.id)} />)}
            </View>
            {active.length ? <>
              <Text style={s.label}>Dự án</Text>
              <View style={s.row}>
                <Chip label="Không thuộc dự án" selected={project === null} onPress={() => setProject(null)} />
                {active.map((p) => <Chip key={p.id} label={p.name} selected={project === p.id} onPress={() => setProject(p.id)} />)}
              </View>
            </> : null}
            <Text style={s.label}>Lặp lại</Text>
            <View style={s.row}>
              <Chip label="Một lần" selected={repeat === 'none'} onPress={() => setRepeat('none')} />
              <Chip label="Hằng ngày" selected={repeat === 'daily'} onPress={() => setRepeat('daily')} />
              <Chip label="Theo thứ" selected={repeat === 'weekly'} onPress={() => setRepeat('weekly')} />
            </View>
            {repeat === 'weekly' ? (
              <View style={s.row}>
                {WEEKDAYS.map((label, i) => <Chip key={label} label={label} selected={weekdays.includes(i)}
                  onPress={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()))} />)}
              </View>
            ) : (
              <>
                <Text style={s.label}>Hạn chót</Text>
                <View style={s.row}>{DUE_PRESETS.map((d) => <Chip key={d.id} label={d.label} selected={due === d.id} onPress={() => setDue(d.id)} />)}</View>
              </>
            )}
            <Text style={s.label}>Thời gian dự kiến</Text>
            <View style={s.row}>
              <Chip label="Chưa rõ" selected={estimate === null} onPress={() => setEstimate(null)} />
              {ESTIMATES.map((m) => <Chip key={m} label={`${m} phút`} selected={estimate === m} onPress={() => setEstimate(m)} />)}
            </View>
            <Text style={s.label}>Các bước nhỏ</Text>
            {steps.map((value, i) => (
              <View key={`${i}-${value}`} style={s.step}>
                <Ionicons name="ellipse-outline" size={16} color={t.muted} />
                <Text style={s.stepText} numberOfLines={2}>{value}</Text>
                <Pressable onPress={() => setSteps((x) => x.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Xóa bước ${value}`}>
                  <Ionicons name="close-circle" size={18} color={t.muted} />
                </Pressable>
              </View>
            ))}
            <View style={s.stepAdd}>
              <TextInput value={step} onChangeText={setStep} placeholder="Thêm một bước…" placeholderTextColor={t.placeholder} maxLength={120}
                style={[s.input, s.flex]} onSubmitEditing={addStep} returnKeyType="done" accessibilityLabel="Bước nhỏ mới" />
              <Pressable onPress={addStep} style={s.addBtn} accessibilityRole="button" accessibilityLabel="Thêm bước"><Ionicons name="add" size={22} color={t.onPrimary} /></Pressable>
            </View>
            {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button title="Nhận nhiệm vụ" icon="flag-outline" loading={saving} onPress={submit} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </AppModal>
  );
}

// The sheet is a sheet of parchment in light; in dark it is the app's card.
const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: t.scrim },
  sheet: { maxHeight: '88%', backgroundColor: dark ? t.card : '#FFF9EF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 6 },
  title: { fontSize: 19, fontWeight: '900', color: t.ink },
  body: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  label: { fontSize: 14, fontWeight: '800', color: t.ink, marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { backgroundColor: t.inputBg, borderRadius: 14, borderWidth: 1.5, borderColor: dark ? t.inputBorder : '#EADBC2', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  flex: { flex: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  stepText: { flex: 1, fontSize: 14, color: t.ink },
  stepAdd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: t.accentFill, alignItems: 'center', justifyContent: 'center' },
  error: { color: t.danger, fontWeight: '700', fontSize: 13 },
}));
