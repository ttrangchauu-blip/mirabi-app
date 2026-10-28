import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../../components/Typography';
import { Button, Chip } from '../../ui/kit';
import { useReduceMotion } from '../../components/useReduceMotion';
import { request } from './shared';
import type { FocusTimer } from './MainApp';
import { focusTheme as f } from './focusSpaceTheme';

export const studyMinutes = (seconds: number) => Math.round(seconds / 60 * 10) / 10;

export function useStudyStatistics(timer: FocusTimer, userId: number) {
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState('week');
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setStats(null); }, [userId]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { if (timer.ready) void request(`/api/study/pomodoro-statistics?period=${period}`).then(data => {
      if (!disposed) { setStats(data); setError(false); }
    }).catch(() => { if (!disposed) setError(true); }); };
    refresh(); const id = setInterval(refresh, 60000);
    const listener = AppState.addEventListener('change', status => { if (status === 'active') refresh(); });
    return () => { disposed = true; clearInterval(id); listener.remove(); };
    // pending.length changes when a started/ended session reaches the server, so early endings show up at once.
  }, [period, timer.completion, timer.pending.length, timer.ready, timer.dailyGoalMinutes, timer.settingsVersion, userId, retry]);
  return { stats, period, setPeriod, error, retry: () => setRetry(v => v + 1) };
}
export type StudyStatisticsState = ReturnType<typeof useStudyStatistics>;

export function StudyStatsBar({ data, onPress, triggerRef }: { data: StudyStatisticsState; onPress: () => void; triggerRef?: React.Ref<View> }) {
  const { stats, error } = data;
  return <Pressable ref={triggerRef} testID="study-stats-bar" accessibilityRole="button" accessibilityLabel="Mở thống kê học tập" accessibilityHint="Xem biểu đồ và mục tiêu học tập" onPress={onPress} style={s.strip}>
    <View style={s.metric}><Ionicons name="time-outline" size={17} color={f.blue} /><View><Text style={s.metricValue}>{stats ? `${studyMinutes(stats.today_seconds)} phút` : '—'}</Text><Text style={s.metricLabel}>Hôm nay</Text></View></View>
    <View style={s.metric}><Ionicons name="checkmark-circle-outline" size={17} color="#748D7B" /><View><Text style={s.metricValue}>{stats ? `${stats.today_sessions} phiên` : '—'}</Text><Text style={s.metricLabel}>Hoàn thành</Text></View></View>
    <View style={s.metric}><Ionicons name="flame-outline" size={17} color="#A37D68" /><View><Text style={s.metricValue}>{stats ? `${stats.current_streak} ngày` : '—'}</Text><Text style={s.metricLabel}>{error ? 'Thử tải lại' : 'Chuỗi học'}</Text></View></View>
    <Ionicons name="chevron-forward" size={16} color={f.muted} />
  </Pressable>;
}

export function PomodoroCompletion({ timer }: { timer: FocusTimer }) {
  const reduce = useReduceMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const completed = timer.completion;
  const visible = !!completed && !timer.running && timer.phase !== 'focus';
  useEffect(() => {
    fade.stopAnimation(); fade.setValue(1);
    if (!visible || reduce) return;
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [visible, completed, reduce, fade]);
  if (!visible) return null;
  return <Animated.View style={[s.completion, { opacity: fade }]}>
    <View style={s.completionHeader}><Ionicons name="sparkles-outline" size={22} color={f.blue} /><View style={s.flex}>
      <Text style={s.title}>Hoàn thành phiên học!</Text><Text style={s.caption}>Một bước nhỏ, một hành trình dài.</Text>
    </View><Pressable onPress={timer.dismissCompletion} accessibilityRole="button" accessibilityLabel="Đóng thông báo hoàn thành" style={s.close}><Ionicons name="close" size={19} color={f.muted} /></Pressable></View>
    <Text style={s.copy}>Đã tập trung: {studyMinutes(completed.focus_seconds)} phút{completed.xp_awarded > 0 ? ` · +${completed.xp_awarded} EXP cho thú cưng` : ''}</Text>
    <Text style={s.caption}>Hôm nay: {studyMinutes(completed.today_seconds)} phút · {completed.today_sessions} phiên · {completed.current_streak} ngày liên tiếp</Text>
    <Text style={s.caption}>Mục tiêu hằng ngày: {Math.round(completed.goal_progress * 100)}%</Text>
    <View style={s.row}><Button title="Phiên tiếp theo" onPress={timer.nextFocus} style={s.flex} /><Button title="Nghỉ ngơi" variant="secondary" style={s.flex} onPress={() => { timer.dismissCompletion(); timer.toggle(); }} /></View>
  </Animated.View>;
}

/** Detail view lives inside the same tool panel as notes and audio. */
export function PomodoroStatistics({ timer, data }: { timer: FocusTimer; data: StudyStatisticsState }) {
  const { stats, period, setPeriod, error } = data;
  const [goal, setGoal] = useState(String(timer.dailyGoalMinutes));
  useEffect(() => { setGoal(String(timer.dailyGoalMinutes)); }, [timer.dailyGoalMinutes]);
  return <>
    {error ? <><Text style={s.copy}>Chưa tải được thống kê. Dữ liệu đã lưu vẫn được giữ nguyên.</Text><Button title="Thử tải lại thống kê" variant="secondary" onPress={data.retry} /></> : null}
    {stats ? <>
      <View style={s.row}>{[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([value, label]) => <Chip key={value} label={label} selected={period === value} onPress={() => setPeriod(value)} />)}</View>
      <Text style={s.total}>{studyMinutes(stats.seconds)}<Text style={s.unit}> phút</Text></Text>
      <Text style={s.caption}>{stats.completed} phiên hoàn thành trong {period === 'day' ? 'ngày' : period === 'week' ? 'tuần' : 'tháng'} này</Text>
      <View style={s.chart} accessibilityLabel="Biểu đồ thời gian học theo ngày">{stats.days.map((day: any, index: number) => <View key={day.date} style={s.column} accessible accessibilityLabel={`${day.date}: ${studyMinutes(day.seconds)} phút`}>
        <View style={s.barTrack}><View style={[s.bar, { height: Math.max(2, day.seconds / Math.max(60, ...stats.days.map((d: any) => d.seconds)) * 90) }]} /></View>
        <Text style={s.axis}>{stats.days.length <= 7 || index % 5 === 0 || index === stats.days.length - 1 ? day.date.slice(-2) : ''}</Text>
      </View>)}</View>
      <Text style={s.caption}>{stats.timezone} · tuần bắt đầu từ thứ Hai</Text>
      <View style={s.divider} />
      <View style={s.row}><View style={s.flex}><Text style={s.label}>Tuần này</Text><Text style={s.value}>{studyMinutes(stats.week_seconds)} phút</Text></View><View style={s.flex}><Text style={s.label}>Tháng này</Text><Text style={s.value}>{studyMinutes(stats.month_seconds)} phút</Text></View></View>
      <View style={s.row}><View style={s.flex}><Text style={s.label}>Chuỗi hiện tại</Text><Text style={s.value}>{stats.current_streak} ngày</Text></View><View style={s.flex}><Text style={s.label}>Chuỗi dài nhất</Text><Text style={s.value}>{stats.longest_streak} ngày</Text></View></View>
      <Text style={s.copy}>Tỷ lệ hoàn thành: {Math.round(stats.completion_rate * 100)}% / {stats.started} phiên bắt đầu</Text>
      <Text style={s.caption}>{stats.rate_completed} đã xong · {stats.cancelled} bỏ dở · {stats.in_progress} chưa kết thúc. Trung bình {studyMinutes(stats.average_daily_seconds)} phút/ngày.</Text>
      <Text style={s.label}>Khung giờ học tuần này</Text>
      <View style={s.wrap}>{stats.hours.length ? stats.hours.map((h: any) => <View key={h.hour} style={s.hour}><Text style={s.copy}>{h.hour}h</Text><Text style={s.caption}>{h.completed}/{h.started} phiên</Text></View>) : <Text style={s.caption}>Căn phòng đang chờ phiên học đầu tiên của bạn.</Text>}</View>
      <View style={s.divider} />
      <Text style={s.label}>Mục tiêu hằng ngày</Text>
      <Text style={s.copy}>Hôm nay {studyMinutes(stats.today_seconds)} / {stats.daily_goal_minutes} phút</Text>
      <View style={s.track}><View style={[s.progress, { width: `${Math.min(100, stats.goal_progress * 100)}%` }]} /></View>
      <View style={s.row}><TextInput value={goal} onChangeText={setGoal} keyboardType="number-pad" maxLength={4} style={s.input} accessibilityLabel="Mục tiêu học mỗi ngày" /><Text style={s.caption}>phút mỗi ngày</Text></View>
      <Button title="Lưu mục tiêu" variant="secondary" disabled={!/^\d+$/.test(goal) || +goal < 1 || +goal > 1440} onPress={() => timer.configure({ dailyGoalMinutes: +goal })} />
      <View style={s.divider} />
      <Text style={s.caption}>Study Streak độc lập với chuỗi đăng nhập. Mỗi ngày có ít nhất một phiên tập trung hợp lệ được tính một lần. Phiên kết thúc sớm vẫn được tính số phút đã học và EXP, nhưng không tính là phiên hoàn thành và không tăng chuỗi.</Text>
    </> : !error ? <Text style={s.copy}>Đang tải nhật ký học tập…</Text> : null}
    {timer.pending.length ? <Text style={s.caption}>Có phiên đang chờ đồng bộ. Dữ liệu được gửi lại tự động.</Text> : null}
    {timer.syncMessage ? <Text style={s.caption}>{timer.syncMessage}</Text> : null}
    {timer.settingsError ? <><Text style={s.caption}>Cài đặt chưa đồng bộ với máy chủ.</Text><Button title="Thử đồng bộ cài đặt" variant="secondary" onPress={timer.retrySettings} /></> : null}
  </>;
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, strip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 17, paddingHorizontal: 12, gap: 4, borderTopWidth: 1, borderTopColor: '#E8E8E2' },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 7 }, metricValue: { color: f.ink, fontSize: 13, fontWeight: '800' }, metricLabel: { color: f.muted, fontSize: 10, marginTop: 2 },
  completion: { backgroundColor: '#EDF5F3', borderRadius: 18, padding: 18, gap: 6, margin: 16 }, completionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, close: { padding: 9 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { color: f.ink, fontSize: 16, fontWeight: '800' }, copy: { color: f.ink, fontSize: 13, lineHeight: 21 }, caption: { color: f.muted, fontSize: 11, lineHeight: 18 },
  label: { color: f.muted, fontSize: 12, fontWeight: '700' }, value: { color: f.ink, fontSize: 18, fontWeight: '800', marginTop: 6 }, total: { color: f.ink, fontSize: 42, fontWeight: '800', marginTop: 8 }, unit: { color: f.muted, fontSize: 15 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 118, gap: 3, marginTop: 12 }, column: { flex: 1, minWidth: 0, alignItems: 'center' }, barTrack: { height: 90, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  bar: { backgroundColor: '#93B6C2', width: '70%', maxWidth: 23, borderRadius: 4 }, axis: { fontSize: 8, color: f.muted, height: 17, marginTop: 5 },
  track: { height: 5, backgroundColor: '#E3E9E7', borderRadius: 4, overflow: 'hidden' }, progress: { backgroundColor: '#8DAF9F', height: 5, borderRadius: 4 },
  input: { borderWidth: 1, borderColor: f.line, borderRadius: 12, padding: 12, color: f.ink, width: 80, backgroundColor: '#FFFFFF' },
  divider: { height: 1, backgroundColor: f.line, marginVertical: 8 }, hour: { backgroundColor: f.cream, padding: 10, borderRadius: 10, gap: 2 },
});
