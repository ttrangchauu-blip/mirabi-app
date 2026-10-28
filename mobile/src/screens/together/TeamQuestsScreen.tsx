import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { TeamQuest } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card, ProgressBar, SectionHeader } from '../../ui/kit';
import { showError } from '../main/shared';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { BackHeader, EmptyState, ErrorState, LoadingState, PersonRow } from './ui';

const STATUS: Record<TeamQuest['status'], string> = { active: 'Đang diễn ra', completed: 'Đã hoàn thành', expired: 'Đã hết hạn' };
const unit = (q: Pick<TeamQuest, 'unit'>) => (q.unit === 'minutes' ? 'phút' : 'chu kỳ');

function deadline(q: TeamQuest) {
  const ms = Date.parse(q.ends_at) - Date.now();
  if (q.status !== 'active' || ms <= 0) return STATUS[q.status];
  const hours = Math.ceil(ms / 3600000);
  return hours > 48 ? `Còn ${Math.ceil(hours / 24)} ngày` : `Còn ${hours} giờ`;
}

export function TeamQuestsScreen() {
  const nav = useTogetherNav();
  const [quests, setQuests] = useState<TeamQuest[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { setQuests(await togetherApi.quests()); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);

  return (
    <>
      <BackHeader title="Nhiệm vụ nhóm" subtitle="Mục tiêu chung, không có bảng xếp hạng" onBack={nav.back} />
      {!quests ? (error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />) : quests.length === 0 ? (
        <Card><EmptyState icon="flag-outline" title="Chưa có nhiệm vụ nhóm" body="Vào một phòng học, chủ phòng có thể tạo nhiệm vụ để cả nhóm cùng hoàn thành." /></Card>
      ) : quests.map((q) => (
        <Pressable key={q.id} onPress={() => nav.push({ name: 'quest', questId: q.id })} accessibilityRole="button"
          accessibilityLabel={`${q.title}, ${q.progress} trên ${q.target} ${unit(q)}, ${STATUS[q.status]}`}>
          <Card>
            <View style={styles.row}>
              <Text style={[styles.title, styles.flex]}>{q.title}</Text>
              <Text style={[styles.status, q.status === 'completed' && styles.done]}>{deadline(q)}</Text>
            </View>
            <Text style={styles.sub}>{q.room_name}</Text>
            <ProgressBar value={q.progress / q.target} color={q.status === 'completed' ? t.success : t.accent} />
            <Text style={styles.sub}>{q.progress}/{q.target} {unit(q)} · Thưởng {q.reward_exp} EXP</Text>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

export function TeamQuestDetailScreen({ questId }: { questId: number }) {
  const nav = useTogetherNav();
  const [quest, setQuest] = useState<TeamQuest | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [joining, setJoining] = useState(false);
  const load = useCallback(async () => {
    try { setQuest(await togetherApi.quest(questId)); setError(null); } catch (e) { setError(e); }
  }, [questId]);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);

  async function join() {
    setJoining(true);
    try { setQuest(await togetherApi.joinQuest(questId)); } catch (e) { showError('Không thể tham gia nhiệm vụ', e); } finally { setJoining(false); }
  }

  if (!quest) return <><BackHeader title="Nhiệm vụ nhóm" onBack={nav.back} />{error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />}</>;
  return (
    <>
      <BackHeader title={quest.title} subtitle={quest.room_name} onBack={nav.back} />
      <Card>
        <Text style={styles.body}>{quest.description}</Text>
        <ProgressBar value={quest.progress / quest.target} color={quest.status === 'completed' ? t.success : t.accent} animated />
        <Text style={styles.big}>{quest.progress}/{quest.target} {unit(quest)}</Text>
        <Text style={styles.sub}>{deadline(quest)} · Mỗi người góp sức nhận {quest.reward_exp} EXP khi hoàn thành</Text>
        {quest.joined ? (
          <Text style={styles.mine}>Bạn đã góp {quest.my_contribution} {unit(quest)}{quest.my_reward_exp ? ` · đã nhận ${quest.my_reward_exp} EXP` : ''}</Text>
        ) : quest.status === 'active' ? <Button title="Tham gia nhiệm vụ" icon="flag-outline" onPress={() => { void join(); }} loading={joining} /> : null}
      </Card>
      <SectionHeader title={`Thành viên (${quest.members.length})`} />
      <Card>
        {quest.members.map((m) => (
          <PersonRow key={m.user_id} user={m} subtitle={m.rewarded ? 'Đã nhận thưởng' : undefined}
            right={<Text style={styles.stat}>{m.contribution == null ? 'Ẩn' : `${m.contribution} ${unit(quest)}`}</Text>} />
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '900', color: t.ink },
  status: { fontSize: 12, fontWeight: '800', color: t.accent },
  done: { color: t.success },
  sub: { fontSize: 13, color: t.muted, marginVertical: 4 },
  body: { fontSize: 15, color: t.ink, lineHeight: 22, marginBottom: 12 },
  big: { fontSize: 22, fontWeight: '900', color: t.ink, marginTop: 8 },
  mine: { fontSize: 14, fontWeight: '800', color: t.success, marginTop: 8 },
  stat: { fontSize: 13, fontWeight: '800', color: t.muted },
});
