import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { Friend, Presence, TeamQuest } from '../../studyTogether/types';
import { makeStyles, useTheme } from '../../ui/theme';
import { Button, ProgressBar } from '../../ui/kit';
import { Paper, SceneHeader, SceneIn, Triumph } from '../../world/diorama';
import { showError } from '../main/shared';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { ChalkBar, type HallMember, StudyHallScene } from './StudyHall';
import { ErrorState, LoadingState, PersonRow } from './ui';

const STATUS: Record<TeamQuest['status'], string> = { active: 'Đang diễn ra', completed: 'Đã hoàn thành', expired: 'Đã hết hạn' };
const unit = (q: Pick<TeamQuest, 'unit'>) => (q.unit === 'minutes' ? 'phút' : 'chu kỳ');

function deadline(q: TeamQuest) {
  const ms = Date.parse(q.ends_at) - Date.now();
  if (q.status !== 'active' || ms <= 0) return STATUS[q.status];
  const hours = Math.ceil(ms / 3600000);
  return hours > 48 ? `Còn ${Math.ceil(hours / 24)} ngày` : `Còn ${hours} giờ`;
}

/** Who is around, as far as is known: a friend's presence if they share it. Nobody else gets a dot. */
function usePresence() {
  const [friends, setFriends] = useState<Friend[]>([]);
  useEffect(() => {
    let live = true;
    togetherApi.friends().then((list) => { if (live) setFriends(list); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return useMemo(() => new Map(friends.map((f) => [f.id, f.presence])), [friends]);
}

function member(m: TeamQuest['members'][number], presence: Map<number, Presence>, tag?: string | null): HallMember {
  return { id: m.user_id, name: m.display_name, pet: m.pet, level: m.pet_level, presence: presence.get(m.user_id) ?? null, tag, rewarded: m.rewarded };
}

function questProgress(q: TeamQuest) {
  return q.target ? Math.min(1, q.progress / q.target) : 0;
}

/** The common room: the goals are on the chalkboard, the people they belong to around the table. */
export function TeamQuestsScreen() {
  const { t } = useTheme();
  const styles = useStyles();
  const nav = useTogetherNav();
  const [quests, setQuests] = useState<TeamQuest[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const presence = usePresence();
  const load = useCallback(async () => {
    try { setQuests(await togetherApi.quests()); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);
  const members = useMemo(() => {
    const seen = new Map<number, HallMember>();
    (quests ?? []).filter((q) => q.status === 'active').forEach((q) => q.members.forEach((m) => { if (!seen.has(m.user_id)) seen.set(m.user_id, member(m, presence)); }));
    return [...seen.values()];
  }, [quests, presence]);

  return (
    <View style={styles.bleed}>
      <View style={styles.ceiling}><SceneHeader title="Cùng bạn tiến bộ" subtitle="Mục tiêu chung, không có bảng xếp hạng" onBack={nav.back} /></View>
      {!quests ? (error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />) : (
        <SceneIn>
          <StudyHallScene members={members} board={quests.length === 0 ? (
            <View style={styles.boardEmpty}>
              <Text style={styles.chalkTitle}>Chưa có nhiệm vụ nhóm</Text>
              <Text style={styles.chalkText}>Vào một phòng học, chủ phòng có thể tạo nhiệm vụ để cả nhóm cùng hoàn thành.</Text>
            </View>
          ) : quests.slice(0, 4).map((q) => (
            <Pressable key={q.id} onPress={() => nav.push({ name: 'quest', questId: q.id })} accessibilityRole="button" style={styles.goalLine} testID={`quest-${q.id}`}
              accessibilityLabel={`${q.title}, ${q.progress} trên ${q.target} ${unit(q)}, ${STATUS[q.status]}`}>
              <View style={styles.row}>
                <Text style={[styles.chalkTitle, styles.flex]} numberOfLines={2}>{q.title}</Text>
                <Text style={[styles.chalkState, q.status === 'completed' && styles.chalkDone]}>{deadline(q)}</Text>
              </View>
              <ChalkBar value={questProgress(q)} done={q.status === 'completed'} />
              <Text style={styles.chalkText}>{q.room_name} · {q.progress}/{q.target} {unit(q)} · Thưởng {q.reward_exp} EXP</Text>
            </Pressable>
          ))} />
          <View style={styles.floor}>
            <Paper style={styles.door} tint={t.card}>
              <Text style={styles.doorTitle}>Phòng học chung</Text>
              <Text style={styles.sub}>Tạo phòng, mời bạn hoặc vào học cùng nhau bằng mã phòng.</Text>
              <Button title="Mở phòng học" icon="people-outline" variant="secondary" onPress={() => nav.push({ name: 'home' })} />
            </Paper>
            {quests.length > 4 ? quests.slice(4).map((q) => (
              <Pressable key={q.id} onPress={() => nav.push({ name: 'quest', questId: q.id })} accessibilityRole="button" accessibilityLabel={`${q.title}, ${q.progress} trên ${q.target} ${unit(q)}, ${STATUS[q.status]}`}>
                <Paper style={styles.door} tint={t.card}><Text style={styles.doorTitle}>{q.title}</Text><ProgressBar value={questProgress(q)} color={q.status === 'completed' ? t.success : t.accent} /><Text style={styles.sub}>{q.progress}/{q.target} {unit(q)} · {deadline(q)}</Text></Paper>
              </Pressable>
            )) : null}
          </View>
        </SceneIn>
      )}
    </View>
  );
}

/** One goal, up close. The pets hop when the server says someone added to it; the whole room cheers when it is reached. */
export function TeamQuestDetailScreen({ questId }: { questId: number }) {
  const { t } = useTheme();
  const styles = useStyles();
  const nav = useTogetherNav();
  const [quest, setQuest] = useState<TeamQuest | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [joining, setJoining] = useState(false);
  const [cheers, setCheers] = useState<Record<number, number>>({});
  const [party, setParty] = useState(0);
  const presence = usePresence();
  const before = useRef<TeamQuest | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await togetherApi.quest(questId);
      const old = before.current;
      if (old) {
        // Only what really changed between two answers of the server.
        setCheers((c) => {
          const out = { ...c };
          next.members.forEach((m) => {
            const was = old.members.find((x) => x.user_id === m.user_id)?.contribution ?? 0;
            if ((m.contribution ?? 0) > (was ?? 0)) out[m.user_id] = (out[m.user_id] ?? 0) + 1;
          });
          return out;
        });
        if (old.status !== 'completed' && next.status === 'completed') setParty((n) => n + 1);
      } else if (next.status === 'completed') setParty((n) => n + 1);
      before.current = next;
      setQuest(next); setError(null);
    } catch (e) { setError(e); }
  }, [questId]);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);
  // Stays current while it is open, so a friend's minutes show up without a pull.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function join() {
    setJoining(true);
    try { const next = await togetherApi.joinQuest(questId); before.current = next; setQuest(next); } catch (e) { showError('Không thể tham gia nhiệm vụ', e); } finally { setJoining(false); }
  }

  if (!quest) return <View style={styles.bleed}><View style={styles.ceiling}><SceneHeader title="Nhiệm vụ nhóm" onBack={nav.back} /></View>{error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />}</View>;
  const members = quest.members.map((m) => member(m, presence, m.contribution == null ? 'Ẩn' : `${m.contribution} ${unit(quest)}`));
  return (
    <View style={styles.bleed}>
      <View style={styles.ceiling}><SceneHeader title={quest.title} subtitle={quest.room_name} onBack={nav.back} /></View>
      <SceneIn>
        <StudyHallScene members={members} cheers={cheers} board={<>
          <Text style={styles.chalkBig}>{quest.progress}/{quest.target} {unit(quest)}</Text>
          <ChalkBar value={questProgress(quest)} done={quest.status === 'completed'} height={16} />
          <Text style={styles.chalkText}>{quest.description}</Text>
          <Text style={[styles.chalkState, quest.status === 'completed' && styles.chalkDone]}>{deadline(quest)} · Mỗi người góp sức nhận {quest.reward_exp} EXP khi hoàn thành</Text>
        </>}>
          <Triumph play={party} size={300} style={styles.partyAt} />
        </StudyHallScene>
        <View style={styles.floor}>
          <Paper style={styles.door} tint={t.card}>
            {quest.joined ? (
              <Text style={styles.mine}>Bạn đã góp {quest.my_contribution} {unit(quest)}{quest.my_reward_exp ? ` · đã nhận ${quest.my_reward_exp} EXP` : ''}</Text>
            ) : quest.status === 'active' ? <Button title="Tham gia nhiệm vụ" icon="flag-outline" onPress={() => { void join(); }} loading={joining} />
              : <Text style={styles.sub}>Nhiệm vụ này đã kết thúc.</Text>}
            <Text style={styles.doorTitle}>Thành viên ({quest.members.length})</Text>
            {quest.members.map((m) => (
              <PersonRow key={m.user_id} user={m} subtitle={m.rewarded ? 'Đã nhận thưởng' : undefined}
                right={<Text style={styles.stat}>{m.contribution == null ? 'Ẩn' : `${m.contribution} ${unit(quest)}`}</Text>} />
            ))}
          </Paper>
        </View>
      </SceneIn>
    </View>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  bleed: { marginHorizontal: -20 },
  // The common room's ceiling, above the picture of the room: part of the scene.
  ceiling: { backgroundColor: '#B5DCF3' },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  goalLine: { gap: 3, paddingVertical: 3, minHeight: 44 },
  boardEmpty: { gap: 4, paddingVertical: 8 },
  chalkTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900', color: '#FBF7E8' },
  chalkBig: { fontSize: 24, lineHeight: 31, fontWeight: '900', color: '#FBF7E8', fontVariant: ['tabular-nums'] },
  chalkText: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#DCE9DF' },
  chalkState: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: '#FFE9A8' },
  chalkDone: { color: '#9FE3B4' },
  partyAt: { top: '46%' },
  floor: { backgroundColor: t.bg, padding: 14, gap: 12, minHeight: 460 },
  door: { gap: 6 },
  doorTitle: { fontSize: 15, lineHeight: 20, fontWeight: '900', color: t.ink },
  sub: { fontSize: 13, lineHeight: 18, color: t.muted },
  mine: { fontSize: 14, fontWeight: '800', color: t.success },
  stat: { fontSize: 13, fontWeight: '800', color: t.muted },
}));
