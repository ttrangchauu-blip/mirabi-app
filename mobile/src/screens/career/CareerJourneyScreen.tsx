import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { PetArt } from '../../components/PetArt';
import { Text, TextInput } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { careerApi, type CareerDetail, type CareerSkill, type CareerSummary, type SkillStatus } from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { Button, Chip, ProgressBar } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { BackHeader, ErrorState, OptionSheet } from '../together/ui';
import { StarBurst, useLoop } from '../work/workArt';

type Props = { user: User; onBack: () => void; onRewards?: () => void };

const STATUS: Record<SkillStatus, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  locked: { label: 'Chưa mở', color: '#8C99A6', bg: '#E9EEF2', icon: 'lock-closed' },
  available: { label: 'Sẵn sàng học', color: '#2E9AD6', bg: '#FFFFFF', icon: 'sparkles-outline' },
  in_progress: { label: 'Tự đánh giá', color: '#2E9AD6', bg: '#E1F2FC', icon: 'trending-up' },
  practiced: { label: 'Đã thực hành', color: '#22A06B', bg: '#E1F6EC', icon: 'checkmark-circle' },
  assessed: { label: 'Đã qua bài kiểm tra', color: '#C98A00', bg: '#FFF4CC', icon: 'star' },
};

/**
 * Hành trình sự nghiệp: choose a career, then grow its skill tree. Each branch is a group of skills; a skill opens once
 * its prerequisites are practised. Progress says exactly what it is: the user's own estimate, a practice they did, or
 * a short check they passed. Nothing is presented as verified mastery. Careers come from the server (data/careers.json).
 */
export function CareerJourneyScreen({ user, onBack, onRewards }: Props) {
  const toast = useToast();
  const [careers, setCareers] = useState<CareerSummary[] | null>(null);
  const [detail, setDetail] = useState<CareerDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const [skill, setSkill] = useState<CareerSkill | null>(null);
  const [burst, setBurst] = useState(0);
  const [badges, setBadges] = useState<{ title: string }[] | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await careerApi.list();
      setCareers(list);
      const active = list.find((c) => c.active);
      setDetail(active ? await careerApi.detail(active.code) : null);
      setError(null);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** A new tree from the server: celebrate what changed (newly open skills glow, new badges pop up). */
  function apply(next: CareerDetail & { awarded_exp?: number }) {
    const before = new Set(detail?.groups.flatMap((g) => g.skills.filter((x) => x.unlocked).map((x) => x.code)) ?? []);
    const now = next.groups.flatMap((g) => g.skills.filter((x) => x.unlocked).map((x) => x.code));
    setOpened(new Set(now.filter((c) => !before.has(c))));
    setDetail(next);
    setSkill((cur) => (cur ? next.groups.flatMap((g) => g.skills).find((x) => x.id === cur.id) ?? null : null));
    if (next.new_badges.length) setBadges(next.new_badges);
    if (next.awarded_exp) onRewards?.();
  }
  async function choose(code: string, goal: string | null) {
    try { const d = await careerApi.choose(code, goal); setPicking(false); setDetail(d); setCareers(await careerApi.list()); toast(`Bắt đầu hành trình ${d.name}!`, 'success'); }
    catch (e) { showError('Chưa chọn được nghề', e); }
  }
  async function report(s: CareerSkill, body: { progress_percent?: number; practiced?: boolean }) {
    try {
      const next = await careerApi.progress(s.id, body);
      apply(next);
      if (body.practiced) { setBurst((b) => b + 1); toast(next.awarded_exp ? `Đã thực hành! +${next.awarded_exp} EXP` : 'Đã ghi nhận thực hành', 'success'); }
    } catch (e) { showError('Chưa lưu được tiến độ', e); }
  }
  async function assess(s: CareerSkill, answers: number[]) {
    try {
      const result = await careerApi.assess(s.id, answers);
      apply(result);
      if (result.passed) { setBurst((b) => b + 1); toast(`Chính xác ${result.correct}/${result.total}! Kỹ năng đã qua bài kiểm tra.`, 'success'); }
      else toast(`Đúng ${result.correct}/${result.total}. Ôn lại rồi thử lần nữa nhé!`, 'info');
      return result.passed;
    } catch (e) { showError('Chưa nộp được bài', e); return false; }
  }

  if (!careers) {
    return (
      <View style={s.fill}>
        <BackHeader title="Hành trình sự nghiệp" subtitle="Cây kỹ năng cho nghề bạn chọn" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={s.skeleton} accessibilityLabel="Đang tải" />}
      </View>
    );
  }
  return (
    <View style={s.fill} testID="career-journey">
      <BackHeader title="Hành trình sự nghiệp" subtitle={detail ? detail.name : 'Chọn nghề để bắt đầu'} onBack={onBack}
        right={detail ? <Pressable onPress={() => setPicking(true)} style={s.switch} accessibilityRole="button" accessibilityLabel="Đổi nghề">
          <Ionicons name="swap-horizontal" size={18} color={t.accent} /></Pressable> : undefined} />
      {!detail ? <CareerPicker careers={careers} onChoose={(c, g) => { void choose(c, g); }} /> : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.hero}>
            <PetArt pet={user.pet} stage={user.level} size={84} />
            <View style={s.flex}>
              <Text style={s.heroTitle}>{detail.icon} {detail.name}</Text>
              {detail.current_goal ? <Text style={s.note}>🎯 {detail.current_goal}</Text> : null}
              <Text style={s.heroCount}>{detail.skills_done}/{detail.skills_total} kỹ năng đã thực hành</Text>
              <ProgressBar value={detail.skills_total ? detail.skills_done / detail.skills_total : 0} color="#22A06B" animated />
            </View>
            <StarBurst burstKey={burst} />
          </View>
          <View style={s.badges}>
            {detail.milestones.map((m) => (
              <View key={m.code} style={[s.badge, m.earned && s.badgeOn]} accessible accessibilityLabel={`Huy hiệu ${m.title}${m.earned ? ', đã đạt' : ''}`}>
                <Text style={s.badgeIcon}>{m.earned ? '🏅' : '⚪'}</Text><Text style={[s.badgeText, m.earned && s.badgeTextOn]} numberOfLines={2}>{m.title}</Text>
              </View>
            ))}
          </View>
          {detail.groups.map((g) => <Branch key={g.name} name={g.name} skills={g.skills} opened={opened} onOpen={setSkill} />)}
          <Text style={s.legal}>Tiến độ là do bạn tự ghi nhận hoặc qua bài kiểm tra ngắn trong ứng dụng, không phải chứng nhận năng lực chính thức.</Text>
        </ScrollView>
      )}
      <OptionSheet visible={picking} title="Chọn nghề nghiệp" onClose={() => setPicking(false)}>
        <CareerPicker careers={careers} compact onChoose={(c, g) => { void choose(c, g); }} />
      </OptionSheet>
      <SkillSheet skill={skill} all={detail?.groups.flatMap((g) => g.skills) ?? []} onClose={() => setSkill(null)}
        onReport={(x, body) => { void report(x, body); }} onAssess={assess} />
      <OptionSheet visible={!!badges} title="🏅 Huy hiệu mới!" onClose={() => setBadges(null)}>
        <View style={s.sheetBody}>{badges?.map((b) => <Text key={b.title} style={s.badgeNew}>🏅 {b.title}</Text>)}
          <Button title="Tuyệt vời!" onPress={() => setBadges(null)} /></View>
      </OptionSheet>
    </View>
  );
}

function CareerPicker({ careers, onChoose, compact = false }: { careers: CareerSummary[]; onChoose: (code: string, goal: string | null) => void; compact?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  return (
    <ScrollView contentContainerStyle={[s.content, s.picker]} showsVerticalScrollIndicator={false}>
      {!compact ? <Text style={s.note}>Chọn một nghề để mở cây kỹ năng. Bạn có thể đổi nghề bất cứ lúc nào, tiến độ của các nghề khác vẫn được giữ.</Text> : null}
      {careers.map((c) => (
        <Pressable key={c.code} onPress={() => setPicked(c.code)} style={[s.careerCard, picked === c.code && s.careerOn]} accessibilityRole="radio"
          accessibilityState={{ selected: picked === c.code }} accessibilityLabel={`${c.name}: ${c.description}`} testID={`career-${c.code}`}>
          <Text style={s.careerIcon}>{c.icon}</Text>
          <View style={s.flex}>
            <Text style={s.careerName}>{c.name}{c.active ? ' · đang theo' : ''}</Text>
            <Text style={s.note} numberOfLines={2}>{c.description}</Text>
            <Text style={s.small}>{c.selected ? `${c.skills_done}/${c.skills_total} kỹ năng` : `${c.skills_total} kỹ năng`}</Text>
          </View>
        </Pressable>
      ))}
      {picked ? <>
        <TextInput value={goal} onChangeText={setGoal} placeholder="Mục tiêu của bạn (không bắt buộc), ví dụ: Lên Senior trong 1 năm" placeholderTextColor="#7F95A8"
          maxLength={200} style={s.input} accessibilityLabel="Mục tiêu nghề nghiệp" />
        <Button title="Bắt đầu hành trình" icon="rocket-outline" onPress={() => onChoose(picked, goal.trim() || null)} />
      </> : null}
    </ScrollView>
  );
}

/** One branch of the tree: its skills as glowing nodes along a vine. */
function Branch({ name, skills, opened, onOpen }: { name: string; skills: CareerSkill[]; opened: Set<string>; onOpen: (s: CareerSkill) => void }) {
  return (
    <View style={s.branch}>
      <Text style={s.branchName} accessibilityRole="header">🌿 {name}</Text>
      <View style={s.vine}>
        <View style={s.vineLine} />
        {skills.map((skill) => <SkillNode key={skill.id} skill={skill} justOpened={opened.has(skill.code)} onPress={() => onOpen(skill)} />)}
      </View>
    </View>
  );
}

function SkillNode({ skill, justOpened, onPress }: { skill: CareerSkill; justOpened: boolean; onPress: () => void }) {
  const st = STATUS[skill.status];
  const glow = useLoop(1400, skill.status === 'practiced' || skill.status === 'assessed' || skill.status === 'available');
  const reduce = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!justOpened || reduce) return;
    pop.setValue(0.6);
    const anim = Animated.sequence([Animated.timing(pop, { toValue: 1.25, duration: 260, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true })]);
    anim.start();
    return () => anim.stop();
  }, [justOpened, reduce, pop]);
  return (
    <Pressable onPress={onPress} style={s.nodeRow} accessibilityRole="button"
      accessibilityLabel={`${skill.name}, ${st.label}${skill.status === 'in_progress' ? ` ${skill.progress_percent}%` : ''}`} testID={`skill-${skill.code}`}>
      <Animated.View style={[s.node, { backgroundColor: st.bg, borderColor: st.color, transform: [{ scale: pop }] }]}>
        {glow ? <Animated.View style={[s.halo, { borderColor: st.color, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.6] }),
          transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }] }]} /> : null}
        <Ionicons name={st.icon} size={20} color={st.color} />
      </Animated.View>
      <View style={s.flex}>
        <Text style={[s.nodeName, skill.status === 'locked' && s.locked]}>{skill.name}</Text>
        <Text style={[s.small, { color: st.color }]}>{st.label}{skill.status === 'in_progress' ? ` · ${skill.progress_percent}%` : ''} · Cấp {skill.level}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.muted} />
    </Pressable>
  );
}

function SkillSheet({ skill, all, onClose, onReport, onAssess }: { skill: CareerSkill | null; all: CareerSkill[]; onClose: () => void;
  onReport: (s: CareerSkill, body: { progress_percent?: number; practiced?: boolean }) => void; onAssess: (s: CareerSkill, answers: number[]) => Promise<boolean> }) {
  const [quiz, setQuiz] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => { setQuiz(false); setAnswers([]); }, [skill?.id]);
  if (!skill) return null;
  const names = (codes: string[]) => codes.map((c) => all.find((x) => x.code === c)?.name ?? c).join(', ');
  const st = STATUS[skill.status];
  return (
    <OptionSheet visible={!!skill} title={skill.name} onClose={onClose}>
      <ScrollView contentContainerStyle={s.sheetBody}>
        <View style={[s.statusPill, { backgroundColor: st.bg }]}><Ionicons name={st.icon} size={14} color={st.color} /><Text style={[s.statusText, { color: st.color }]}>{st.label}</Text></View>
        <Text style={s.body}>{skill.description}</Text>
        {skill.goal ? <Text style={s.body}>🎯 {skill.goal}</Text> : null}
        {skill.prerequisites.length ? <Text style={s.note}>Cần trước: {names(skill.prerequisites)}</Text> : null}
        {skill.activities.length ? <><Text style={s.label}>Hoạt động thực hành</Text>{skill.activities.map((a) => <Text key={a} style={s.body}>• {a}</Text>)}</> : null}
        {!skill.unlocked ? <Text style={s.note}>Hãy thực hành các kỹ năng cần trước để mở kỹ năng này.</Text> : quiz ? <>
          {skill.assessment.map((q, qi) => (
            <View key={qi} style={s.question}>
              <Text style={s.label}>{qi + 1}. {q.q}</Text>
              {q.options.map((o, oi) => (
                <Pressable key={oi} onPress={() => setAnswers((a) => { const n = [...a]; n[qi] = oi; return n; })} style={[s.option, answers[qi] === oi && s.optionOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: answers[qi] === oi }} accessibilityLabel={o}><Text style={s.body}>{o}</Text></Pressable>
              ))}
            </View>
          ))}
          <Button title="Nộp bài" loading={sending} disabled={skill.assessment.some((_, i) => answers[i] == null)} onPress={async () => {
            setSending(true); const passed = await onAssess(skill, answers); setSending(false); if (passed) setQuiz(false);
          }} />
        </> : <>
          {skill.status === 'available' || skill.status === 'in_progress' ? <>
            <Text style={s.label}>Bạn tự thấy mình đã đi được bao xa?</Text>
            <View style={s.chips}>{[25, 50, 75].map((p) => <Chip key={p} label={`${p}%`} selected={skill.progress_percent === p} onPress={() => onReport(skill, { progress_percent: p })} />)}</View>
          </> : null}
          {skill.status !== 'practiced' && skill.status !== 'assessed' ? <Button title="Tôi đã thực hành kỹ năng này" icon="hammer-outline" onPress={() => onReport(skill, { practiced: true })} /> : null}
          {skill.has_assessment && skill.status !== 'assessed' ? <Button title="Làm bài kiểm tra ngắn" icon="school-outline" variant="secondary" onPress={() => setQuiz(true)} />
            : !skill.has_assessment ? <Text style={s.small}>Kỹ năng này chưa có bài kiểm tra.</Text> : null}
        </>}
        <Text style={s.small}>"Đã thực hành" là do bạn tự ghi nhận. "Đã qua bài kiểm tra" là kết quả bài kiểm tra ngắn trong ứng dụng. Mirabi chưa có cơ chế xác minh chính thức.</Text>
      </ScrollView>
    </OptionSheet>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 16 },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingBottom: 120, gap: 12 },
  skeleton: { height: 300, borderRadius: 24, backgroundColor: '#DCEAF3', opacity: 0.6 },
  switch: { width: 40, height: 40, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 14 },
  heroTitle: { fontSize: 17, fontWeight: '900', color: t.ink },
  heroCount: { fontSize: 13, fontWeight: '800', color: '#22703A', marginVertical: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31%', alignItems: 'center', backgroundColor: '#F2F5F8', borderRadius: 14, padding: 8 },
  badgeOn: { backgroundColor: '#FFF4CC' },
  badgeIcon: { fontSize: 22 },
  badgeText: { fontSize: 10, fontWeight: '700', color: t.muted, textAlign: 'center' },
  badgeTextOn: { color: '#7A4D00' },
  branch: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 14 },
  branchName: { fontSize: 16, fontWeight: '900', color: '#22603F', marginBottom: 6 },
  vine: { paddingLeft: 4 },
  vineLine: { position: 'absolute', left: 25, top: 20, bottom: 20, width: 3, borderRadius: 2, backgroundColor: '#CDE8D4' },
  nodeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, minHeight: 56 },
  node: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 3 },
  nodeName: { fontSize: 15, fontWeight: '800', color: t.ink },
  locked: { color: t.muted },
  legal: { fontSize: 11, color: t.muted, textAlign: 'center' },
  picker: { paddingTop: 4 },
  careerCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, borderWidth: 2, borderColor: 'transparent' },
  careerOn: { borderColor: '#2E9AD6', backgroundColor: '#F2FAFF' },
  careerIcon: { fontSize: 32 },
  careerName: { fontSize: 15, fontWeight: '900', color: t.ink },
  note: { fontSize: 13, color: t.muted },
  small: { fontSize: 11, color: t.muted },
  input: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  sheetBody: { gap: 10, paddingBottom: 8 },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '900' },
  body: { fontSize: 14, color: t.ink, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '900', color: t.ink },
  chips: { flexDirection: 'row', gap: 8 },
  question: { gap: 6 },
  option: { borderRadius: 12, padding: 10, backgroundColor: '#F2F5F8', borderWidth: 2, borderColor: 'transparent', minHeight: 44, justifyContent: 'center' },
  optionOn: { borderColor: '#2E9AD6', backgroundColor: '#E1F2FC' },
  badgeNew: { fontSize: 16, fontWeight: '900', color: '#7A4D00' },
});
