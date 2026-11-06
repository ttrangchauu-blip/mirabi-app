import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import type { User } from '../../auth/AuthContext';
import { Text, TextInput } from '../../components/Typography';
import { careerApi, type CareerDetail, type CareerSkill, type CareerSummary, type SkillStatus } from '../../life/worlds';
import { Button, Chip } from '../../ui/kit';
import { makeStyles, useTheme } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { ErrorState, OptionSheet } from '../together/ui';
import { Knob, SceneHeader, SceneIn, Triumph, useSize } from '../../world/diorama';
import { finished, layoutMap, Milestone, RegionSign, RoadMap, RoadPet } from './JourneyMap';

type Props = { user: User; onBack: () => void; onRewards?: () => void };

const STATUS: Record<SkillStatus, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  locked: { label: 'Chưa mở', icon: 'lock-closed' },
  available: { label: 'Sẵn sàng học', icon: 'sparkles-outline' },
  in_progress: { label: 'Tự đánh giá', icon: 'trending-up' },
  practiced: { label: 'Đã thực hành', icon: 'checkmark-circle' },
  assessed: { label: 'Đã qua bài kiểm tra', icon: 'star' },
};
/** Each status's ink and pale fill: the drawn ones in light, the theme's status pairs in dark. */
const useStatusColors = makeStyles(({ t, dark }): Record<SkillStatus, { color: string; bg: string }> => (dark ? {
  locked: { color: t.muted, bg: t.surfaceSecondary },
  available: { color: t.info, bg: t.card },
  in_progress: { color: t.info, bg: t.infoBg },
  practiced: { color: t.success, bg: t.successBg },
  assessed: { color: t.warning, bg: t.warningBg },
} : {
  locked: { color: '#8C99A6', bg: '#E9EEF2' },
  available: { color: '#2E9AD6', bg: '#FFFFFF' },
  in_progress: { color: '#2E9AD6', bg: '#E1F2FC' },
  practiced: { color: '#22A06B', bg: '#E1F6EC' },
  assessed: { color: '#C98A00', bg: '#FFF4CC' },
}));

/**
 * Hành trình sự nghiệp: choose a career, then walk its road. Each region is a group of skills, each milestone a skill; a
 * skill opens once its prerequisites are practised (the server's rule). Progress says exactly what it is: the user's own estimate, a practice they did, or
 * a short check they passed. Nothing is presented as verified mastery. Careers come from the server (data/careers.json).
 */
export function CareerJourneyScreen({ user, onBack, onRewards }: Props) {
  const toast = useToast();
  const { t } = useTheme();
  const s = useStyles();
  const tint = useStatusColors();
  const [careers, setCareers] = useState<CareerSummary[] | null>(null);
  const [detail, setDetail] = useState<CareerDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState(false);
  const [skill, setSkill] = useState<CareerSkill | null>(null);
  const [burst, setBurst] = useState(0);
  const [badges, setBadges] = useState<{ title: string }[] | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [lookBack, setLookBack] = useState(false);
  const [size, onLayout] = useSize({ width: 390, height: 700 });
  const map = useMemo(() => (detail ? layoutMap(detail.groups, size.width) : null), [detail, size.width]);
  const allSkills = useMemo(() => detail?.groups.flatMap((g) => g.skills) ?? [], [detail]);
  // The pet stands by the next milestone to take; at the last one when all are done.
  const nextNode = useMemo(() => map?.nodes.find((n) => n.skill.status === 'available' || n.skill.status === 'in_progress') ?? map?.nodes.filter((n) => finished(n.skill.status)).pop() ?? map?.nodes[0] ?? null, [map]);
  const scroll = useRef<ScrollView>(null);
  // Opens on where the owner has got to, once.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !nextNode) return;
    placed.current = true;
    const id = setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, nextNode.y - 170), animated: true }), 360);
    return () => clearTimeout(id);
  }, [nextNode]);

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
        <SceneHeader title="Hành trình sự nghiệp" subtitle="Bản đồ kỹ năng cho nghề bạn chọn" onBack={onBack} />
        {error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <View style={s.skeleton} accessibilityLabel="Đang tải" />}
      </View>
    );
  }
  const done = allSkills.filter((x) => finished(x.status));
  return (
    <View style={s.fill} testID="career-journey" onLayout={onLayout}>
      <SceneHeader title="Hành trình sự nghiệp" subtitle={detail ? detail.name : 'Chọn nghề để bắt đầu'} onBack={onBack}
        right={detail ? <><Knob icon="albums" label="Nhìn lại hành trình" onPress={() => setLookBack(true)} /><Knob icon="swap-horizontal" label="Đổi nghề" onPress={() => setPicking(true)} /></> : undefined} />
      {!detail || !map ? <CareerPicker careers={careers} onChoose={(c, g) => { void choose(c, g); }} /> : (
        <ScrollView ref={scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <SceneIn>
            <View style={s.summit}>
              <Text style={s.heroTitle}>{detail.icon} {detail.name}</Text>
              {detail.current_goal ? <Text style={s.heroGoal} numberOfLines={2}>Mục tiêu: {detail.current_goal}</Text> : null}
              <Text style={s.heroCount}>{detail.skills_done}/{detail.skills_total} kỹ năng đã thực hành</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.medals}>
                {detail.milestones.map((m) => <Medal key={m.code} title={m.title} earned={m.earned} />)}
              </ScrollView>
            </View>
            <View style={[s.road, { height: map.height }]}>
              <RoadMap map={map} width={size.width} />
              {map.regions.map((r, i) => {
                const skills = detail.groups[i]?.skills ?? [];
                return <RegionSign key={r.name} region={r} total={skills.length} done={skills.filter((x) => finished(x.status)).length} />;
              })}
              {map.nodes.map((n) => <Milestone key={n.skill.id} node={n} justOpened={opened.has(n.skill.code)} onPress={() => setSkill(n.skill)} />)}
              <RoadPet pet={user.pet} level={user.level} to={nextNode ? { x: Math.max(40, Math.min(size.width - 40, nextNode.x + (nextNode.side > 0 ? -62 : 62))), y: nextNode.y + 30 } : null} />
              <Triumph play={burst} size={300} style={nextNode ? { left: nextNode.x, top: nextNode.y } : undefined} />
            </View>
          </SceneIn>
          <View style={s.legalWrap}><Text style={s.legal}>Tiến độ là do bạn tự ghi nhận hoặc qua bài kiểm tra ngắn trong ứng dụng, không phải chứng nhận năng lực chính thức.</Text></View>
        </ScrollView>
      )}
      <OptionSheet visible={picking} title="Chọn nghề nghiệp" onClose={() => setPicking(false)}>
        <CareerPicker careers={careers} compact onChoose={(c, g) => { void choose(c, g); }} />
      </OptionSheet>
      <OptionSheet visible={lookBack} title="Nhìn lại hành trình" onClose={() => setLookBack(false)}>
        <ScrollView contentContainerStyle={s.sheetBody}>
          {done.length ? <Text style={s.note}>{done.length} kỹ năng bạn đã đi qua, theo thứ tự trên đường. Chạm để xem lại.</Text>
            : <Text style={s.note}>Chưa có kỹ năng nào hoàn thành. Thực hành kỹ năng đầu tiên để bắt đầu hành trình nhé.</Text>}
          {done.map((x, i) => (
            <Pressable key={x.id} onPress={() => { setLookBack(false); setSkill(x); }} style={s.pastRow} accessibilityRole="button" accessibilityLabel={`Xem lại ${x.name}, ${STATUS[x.status].label}`}>
              <View style={[s.pastDot, { backgroundColor: tint[x.status].bg, borderColor: tint[x.status].color }]}><Text style={[s.pastNumber, { color: tint[x.status].color }]}>{i + 1}</Text></View>
              <View style={s.flex}><Text style={s.pastName}>{x.name}</Text><Text style={[s.small, { color: tint[x.status].color }]}>{x.group} · {STATUS[x.status].label}</Text></View>
              <Ionicons name="chevron-forward" size={16} color={t.muted} />
            </Pressable>
          ))}
          {detail?.milestones.some((m) => m.earned) ? <Text style={s.label}>Huy hiệu đã đạt</Text> : null}
          {detail?.milestones.filter((m) => m.earned).map((m) => <Text key={m.code} style={s.badgeNew}>{m.title}</Text>)}
        </ScrollView>
      </OptionSheet>
      <SkillSheet skill={skill} all={allSkills} onClose={() => setSkill(null)}
        onReport={(x, body) => { void report(x, body); }} onAssess={assess} />
      <OptionSheet visible={!!badges} title="Huy hiệu mới!" onClose={() => setBadges(null)}>
        <View style={s.sheetBody}>
          <View style={s.medalBig}>{badges?.map((b) => <Medal key={b.title} title={b.title} earned />)}<Triumph play={badges ? 1 : 0} size={220} /></View>
          <Button title="Tuyệt vời!" onPress={() => setBadges(null)} /></View>
      </OptionSheet>
    </View>
  );
}

/** A badge: a gold medal once it is earned, an empty mould until then. */
function Medal({ title, earned }: { title: string; earned: boolean }) {
  const s = useStyles();
  const id = earned ? 'medal-gold' : 'medal-empty';
  return (
    <View style={s.medal} accessible accessibilityLabel={`Huy hiệu ${title}${earned ? ', đã đạt' : ''}`}>
      <Svg width={46} height={54} viewBox="0 0 46 54">
        <Defs><RadialGradient id={id} cx="36%" cy="30%" r="80%"><Stop offset="0" stopColor={earned ? '#FFF2B8' : '#E4DCCB'} /><Stop offset="0.6" stopColor={earned ? '#EDB84A' : '#BDB3A0'} /><Stop offset="1" stopColor={earned ? '#A86F1B' : '#8E8675'} /></RadialGradient></Defs>
        <Path d="M12 0 L20 20 L12 24 L4 4 Z" fill={earned ? '#D9534F' : '#A69E8F'} /><Path d="M34 0 L26 20 L34 24 L42 4 Z" fill={earned ? '#3D84C6' : '#958D7F'} />
        <Circle cx="23" cy="33" r="19" fill={`url(#${id})`} />
        <Circle cx="23" cy="33" r="13.5" fill="none" stroke={earned ? '#A86F1B' : '#8E8675'} strokeWidth="1.2" opacity={0.7} />
        {earned ? <Path d="M23 24 L25.8 30 L32 30.7 L27.4 35 L28.7 41.2 L23 38 L17.3 41.2 L18.6 35 L14 30.7 L20.2 30 Z" fill="#FFF6CF" /> : null}
      </Svg>
      <Text style={[s.medalText, earned && s.medalTextOn]} numberOfLines={3}>{title}</Text>
    </View>
  );
}

function CareerPicker({ careers, onChoose, compact = false }: { careers: CareerSummary[]; onChoose: (code: string, goal: string | null) => void; compact?: boolean }) {
  const { t } = useTheme();
  const s = useStyles();
  const [picked, setPicked] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  return (
    <ScrollView contentContainerStyle={[s.content, s.picker]} showsVerticalScrollIndicator={false}>
      {!compact ? <Text style={s.pickerIntro}>Chọn một nghề để mở bản đồ kỹ năng. Bạn có thể đổi nghề bất cứ lúc nào, tiến độ của các nghề khác vẫn được giữ.</Text> : null}
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
        <TextInput value={goal} onChangeText={setGoal} placeholder="Mục tiêu của bạn (không bắt buộc), ví dụ: Lên Senior trong 1 năm" placeholderTextColor={t.placeholder}
          maxLength={200} style={s.input} accessibilityLabel="Mục tiêu nghề nghiệp" />
        <Button title="Bắt đầu hành trình" icon="rocket-outline" onPress={() => onChoose(picked, goal.trim() || null)} />
      </> : null}
    </ScrollView>
  );
}

function SkillSheet({ skill, all, onClose, onReport, onAssess }: { skill: CareerSkill | null; all: CareerSkill[]; onClose: () => void;
  onReport: (s: CareerSkill, body: { progress_percent?: number; practiced?: boolean }) => void; onAssess: (s: CareerSkill, answers: number[]) => Promise<boolean> }) {
  const s = useStyles();
  const tint = useStatusColors();
  const [quiz, setQuiz] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => { setQuiz(false); setAnswers([]); }, [skill?.id]);
  if (!skill) return null;
  const names = (codes: string[]) => codes.map((c) => all.find((x) => x.code === c)?.name ?? c).join(', ');
  const st = { ...STATUS[skill.status], ...tint[skill.status] };
  return (
    <OptionSheet visible={!!skill} title={skill.name} onClose={onClose}>
      <ScrollView contentContainerStyle={s.sheetBody}>
        <View style={[s.statusPill, { backgroundColor: st.bg }]}><Ionicons name={st.icon} size={14} color={st.color} /><Text style={[s.statusText, { color: st.color }]}>{st.label}</Text></View>
        <Text style={s.body}>{skill.description}</Text>
        {skill.goal ? <Text style={s.body}>Mục tiêu: {skill.goal}</Text> : null}
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

// The selected outline keeps its drawn blue in light; in dark the theme's accent.
const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: t.bg },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingBottom: 120 },
  road: { position: 'relative', overflow: 'hidden' },
  summit: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 2 },
  heroGoal: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: t.muted },
  medals: { gap: 10, paddingTop: 10, paddingRight: 16 },
  medal: { width: 84, alignItems: 'center', gap: 3 },
  medalText: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: t.muted, textAlign: 'center' },
  medalTextOn: { color: t.accent },
  medalBig: { alignItems: 'center', paddingVertical: 16, backgroundColor: t.bg, borderRadius: 16 },
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 },
  pastDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pastNumber: { fontSize: 13, fontWeight: '900' },
  pastName: { fontSize: 15, fontWeight: '800', color: t.ink },
  legalWrap: { paddingHorizontal: 20, paddingTop: 12 },
  skeleton: { height: 300, margin: 16, borderRadius: 24, backgroundColor: t.bg, opacity: 0.6 },
  heroTitle: { fontSize: 17, lineHeight: 23, fontWeight: '900', color: t.ink },
  heroCount: { fontSize: 13, fontWeight: '800', color: t.accent },
  legal: { fontSize: 11, lineHeight: 15, color: t.muted, textAlign: 'center' },
  picker: { paddingTop: 4, paddingHorizontal: 16, gap: 12 },
  pickerIntro: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: t.muted },
  careerCard: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: t.card, borderRadius: 18, padding: 12, borderWidth: 2, borderColor: 'transparent' },
  careerOn: { borderColor: dark ? t.accent : '#2E9AD6', backgroundColor: t.surfaceSecondary },
  careerIcon: { fontSize: 32 },
  careerName: { fontSize: 15, fontWeight: '900', color: t.ink },
  note: { fontSize: 13, lineHeight: 18, color: t.muted },
  small: { fontSize: 11, color: t.muted },
  input: { backgroundColor: t.inputBg, borderRadius: 14, borderWidth: 1.5, borderColor: t.inputBorder, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink },
  sheetBody: { gap: 10, paddingBottom: 8 },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '900' },
  body: { fontSize: 14, color: t.ink, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '900', color: t.ink },
  chips: { flexDirection: 'row', gap: 8 },
  question: { gap: 6 },
  option: { borderRadius: 12, padding: 10, backgroundColor: t.surfaceSecondary, borderWidth: 2, borderColor: 'transparent', minHeight: 44, justifyContent: 'center' },
  optionOn: { borderColor: dark ? t.accent : '#2E9AD6', backgroundColor: t.infoBg },
  badgeNew: { fontSize: 16, fontWeight: '900', color: t.warning },
}));
