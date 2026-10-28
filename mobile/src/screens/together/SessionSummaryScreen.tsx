import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import { formatMinutes } from '../../studyTogether/timer';
import type { SessionSummary } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card, ProgressBar, SectionHeader } from '../../ui/kit';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { BackHeader, ErrorState, LoadingState, PersonRow } from './ui';

const SETTLE_RETRY_MS = 2000;
const SETTLE_ATTEMPTS = 5;

export function SessionSummaryScreen({ sessionId }: { sessionId: number }) {
  const nav = useTogetherNav();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const attempts = useRef(0);

  const load = useCallback(async () => {
    try { setSummary(await togetherApi.summary(sessionId)); setError(null); } catch (e) { setError(e); }
  }, [sessionId]);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);
  // Results are written by the server right after the session ends; if we arrive first, ask again shortly.
  useEffect(() => {
    if (!summary || summary.finalized || attempts.current >= SETTLE_ATTEMPTS) return;
    const timer = setTimeout(() => { attempts.current += 1; void load(); }, SETTLE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [load, summary]);

  if (!summary) return <><BackHeader title="Tổng kết phiên học" onBack={nav.back} />{error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />}</>;

  const finished = summary.status === 'completed';
  const { me } = summary;
  const roomOpen = summary.room?.status === 'open';
  return (
    <>
      <BackHeader title="Tổng kết phiên học" subtitle={summary.room?.name} onBack={nav.back} />
      <Card style={styles.hero}>
        <PetCompanion pet={nav.user.pet} stage={nav.user.level} size={96} />
        <Text style={styles.title} accessibilityRole="header">{finished ? 'Hoàn thành phiên học!' : summary.finalized ? 'Phiên học đã kết thúc' : 'Đang tổng kết…'}</Text>
        <Text style={styles.sub}>{finished ? 'Cả nhóm đã đi trọn hành trình hôm nay.' : 'Thời gian tập trung hợp lệ vẫn được ghi nhận cho bạn.'}</Text>
      </Card>
      <View style={styles.tiles}>
        <Tile label="Tập trung hợp lệ" value={formatMinutes(me.focus_seconds)} />
        <Tile label="Chu kỳ hoàn thành" value={`${me.cycles_completed}/${summary.total_cycles}`} />
        <Tile label="EXP thực nhận" value={me.rewarded ? `+${me.exp_awarded}` : '…'} accent />
      </View>
      {me.rewarded ? (
        <Text style={styles.note}>
          {me.study_exp} EXP học tập{me.bonus_exp ? ` + ${me.bonus_exp} EXP học cùng bạn bè` : ''}. EXP được máy chủ tính theo giới hạn mỗi ngày.
        </Text>
      ) : <Text style={styles.note}>Máy chủ đang xác nhận kết quả, bạn đợi một chút nhé.</Text>}

      <SectionHeader title={`Thành viên (${summary.participants.length})`} />
      <Card>
        {summary.participants.map((p) => (
          <PersonRow key={p.user_id} user={p} subtitle={p.user_id === nav.user.id ? 'Bạn' : undefined}
            right={<Text style={styles.stat}>{p.focus_seconds == null ? 'Ẩn' : formatMinutes(p.focus_seconds)}</Text>} />
        ))}
      </Card>

      {summary.team_quests.length > 0 && <>
        <SectionHeader title="Nhiệm vụ nhóm" />
        <Card>
          {summary.team_quests.map((q) => (
            <View key={q.id} style={styles.quest}>
              <Text style={styles.questTitle}>{q.title}{q.status === 'completed' ? ' ✓' : ''}</Text>
              <ProgressBar value={q.progress / q.target} animated />
              <Text style={styles.sub}>{q.progress}/{q.target} {q.unit === 'minutes' ? 'phút' : 'chu kỳ'}{q.added ? ` · bạn góp +${q.added}` : ''}</Text>
            </View>
          ))}
        </Card>
      </>}

      {roomOpen && summary.room ? <Button title="Học tiếp" icon="play" onPress={() => nav.replace({ name: 'room', roomId: summary.room!.id })} /> : null}
      {!roomOpen ? <Button title="Tạo phiên mới" icon="add-circle-outline" variant="secondary" onPress={() => nav.replace({ name: 'create' })} /> : null}
      <Button title="Về trang chủ" icon="home-outline" variant="ghost" onPress={nav.home} />
    </>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.tileValue, accent && styles.tileAccent]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, backgroundColor: t.hero },
  title: { fontSize: 21, fontWeight: '900', color: t.ink, textAlign: 'center' },
  sub: { fontSize: 13, color: t.muted, textAlign: 'center', lineHeight: 19 },
  tiles: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  tile: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  tileValue: { fontSize: 19, fontWeight: '900', color: t.ink },
  tileAccent: { color: t.success },
  tileLabel: { fontSize: 11, fontWeight: '700', color: t.muted, textAlign: 'center', marginTop: 3 },
  note: { fontSize: 12, color: t.muted, marginBottom: 6, lineHeight: 18 },
  stat: { fontSize: 13, fontWeight: '800', color: t.muted },
  quest: { paddingVertical: 8, gap: 6 },
  questTitle: { fontSize: 15, fontWeight: '800', color: t.ink },
});
