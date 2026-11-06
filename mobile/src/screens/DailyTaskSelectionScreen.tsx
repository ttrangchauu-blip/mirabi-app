import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { errorMessage, isSessionExpired } from '../auth/messages';
import { AuthLayout } from '../components/AuthLayout';
import { FormBanner, GradientButton } from '../components/AuthForm';
import { Text } from '../components/Typography';
import { makeStyles, useTheme } from '../ui/theme';
import { useConfirmLogout } from '../auth/useConfirmLogout';

type DailyTask = { id: string; group: string; title: string; description: string; exp: number; icon: string };
type Catalog = { tasks: DailyTask[]; selected_task_ids: string[] };

// Keep onboarding usable if the catalog request is temporarily unavailable. The API remains authoritative
// for validating selected IDs and awarding EXP.
const TASK_FALLBACK: DailyTask[] = [
  { id: 'health', group: 'Sức khỏe', title: 'Vận động ít nhất 15 phút', description: 'Đi bộ, giãn cơ hoặc tập luyện phù hợp', exp: 10, icon: 'water' },
  { id: 'learning', group: 'Học tập', title: 'Học một điều mới trong 15 phút', description: 'Học ngoại ngữ, đọc sách hoặc phát triển kỹ năng', exp: 10, icon: 'book' },
  { id: 'work', group: 'Công việc', title: 'Hoàn thành việc quan trọng nhất hôm nay', description: 'Hoàn thành một việc ưu tiên đã xác định từ đầu ngày', exp: 15, icon: 'briefcase' },
  { id: 'home', group: 'Cuộc sống', title: 'Dọn dẹp không gian sống trong 10 phút', description: 'Dọn bàn, phòng hoặc khu vực thường sử dụng', exp: 10, icon: 'home' },
  { id: 'wellbeing', group: 'Tinh thần', title: 'Dành 5 phút nhìn lại bản thân', description: 'Ghi lại cảm xúc hoặc suy nghĩ về ngày hôm nay', exp: 10, icon: 'heart' },
];

export function DailyTaskSelectionScreen() {
  const { t, auth } = useTheme();
  const styles = useStyles();
  const { user, selectDailyTasks } = useAuth();
  const confirmLogout = useConfirmLogout();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<Catalog>('/api/onboarding/daily-tasks', { auth: true })
      .then((catalog) => {
        if (!active) return;
        setTasks(catalog.tasks);
        setSelected(catalog.selected_task_ids);
      })
      .catch((e) => {
        if (!active || isSessionExpired(e)) return;
        setTasks(TASK_FALLBACK);
        setError(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function toggle(id: string) {
    setSelected((current) => current.includes(id)
      ? current.filter((taskId) => taskId !== id)
      : current.length < 3 ? [...current, id] : current);
  }

  async function continueOnboarding() {
    if (submitting || loading) return;
    setSubmitting(true);
    setError(null);
    try { await selectDailyTasks(selected); }
    catch (e) { if (!isSessionExpired(e)) setError(errorMessage(e)); setSubmitting(false); }
  }

  return (
    <AuthLayout title="Chọn nhiệm vụ mỗi ngày" subtitle={`Chọn từ 1 đến 3 nhiệm vụ để ${user?.pet_name ?? 'pet'} cùng bạn tạo thói quen tốt.`}
      footer={<Pressable onPress={() => { void confirmLogout(); }} accessibilityRole="button"><Text style={styles.logout}>Đăng xuất</Text></Pressable>}>
      {error ? <FormBanner tone="error" message={error} /> : null}
      <View style={styles.counterRow}>
        <Text style={styles.counter}>Đã chọn {selected.length}/3</Text>
      </View>
      {loading ? <ActivityIndicator color={auth.link} style={styles.loader} /> : tasks.map((task) => {
        const checked = selected.includes(task.id);
        const disabled = !checked && selected.length >= 3;
        return (
          <Pressable key={task.id} onPress={() => toggle(task.id)} disabled={disabled || submitting}
            accessibilityRole="checkbox" accessibilityState={{ checked, disabled: disabled || submitting }}
            style={[styles.task, checked && styles.taskSelected, disabled && styles.taskDisabled]}>
            <View style={[styles.iconWrap, checked && styles.iconWrapSelected]}>
              <Ionicons name={task.icon as React.ComponentProps<typeof Ionicons>['name']} size={20} color={checked ? t.onPrimary : auth.link} />
            </View>
            <View style={styles.taskBody}>
              <Text style={styles.group}>{task.group}</Text>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.description}>{task.description}</Text>
            </View>
            <View style={styles.trailing}>
              <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? auth.link : t.placeholder} />
            </View>
          </Pressable>
        );
      })}
      <GradientButton title="Tiếp tục" onPress={continueOnboarding} loading={submitting} loadingTitle="Đang lưu lựa chọn…" disabled={loading || selected.length === 0} />
    </AuthLayout>
  );
}

const useStyles = makeStyles(({ t, auth }) => StyleSheet.create({
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  counter: { color: auth.ink, fontWeight: '900', fontSize: 15 },
  loader: { marginVertical: 32 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, borderWidth: 1.5, borderColor: t.border, backgroundColor: t.card, marginBottom: 10 },
  taskSelected: { borderColor: auth.link, backgroundColor: t.surfaceSecondary },
  taskDisabled: { opacity: 0.48 },
  iconWrap: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.tint },
  iconWrapSelected: { backgroundColor: t.accentFill },
  taskBody: { flex: 1, gap: 2 },
  group: { color: auth.link, fontSize: 11, fontWeight: '900' },
  taskTitle: { color: auth.ink, fontSize: 14, fontWeight: '800', lineHeight: 19 },
  description: { color: auth.muted, fontSize: 11, lineHeight: 16 },
  trailing: { alignItems: 'center', gap: 7 },
  logout: { color: auth.link, fontWeight: '800', fontSize: 14 },
}));
