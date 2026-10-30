import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { learningApi } from '../../learning/api';
import { GAME_INFO } from '../../learning/labels';
import type { CatalogLesson, GameId, LessonGame, LessonListItem, LessonProgramme, ProgrammeSubject, SubjectLessons } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, IconName, ProgressBar, SectionHeader, SoftInput } from '../../ui/kit';
import { BackHeader } from './GamePicker';

// Học tập theo bài (backend lesson_api.py): Học tập → Chọn môn → Chọn bài → Chọn trò → Cách chơi → 3-2-1 → Chơi → Kết
// quả. The programme lists every subject of the grade, the lessons of a subject come by chapter, and a lesson shows what
// is learned before its games. Nothing is created on the backend until a game starts.

/** Accent- and case-insensitive, so "phan biet" finds "Phân biệt" and "dong" finds "đồng". */
export const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();

const STATUS_STYLE = {
  not_started: { color: t.muted, bg: '#EEF2F5', icon: 'ellipse-outline' as IconName },
  in_progress: { color: '#9A5B00', bg: '#FFF1D6', icon: 'time-outline' as IconName },
  completed: { color: t.success, bg: t.successBg, icon: 'checkmark-circle' as IconName },
};

function supportLine(s: ProgrammeSubject): string {
  if (s.status === 'unsupported') return s.unsupported ?? 'Mirabi chưa có bài học cho môn này.';
  if (s.status === 'empty') return 'Đang biên soạn: chưa có bài học.';
  if (!s.ready) return `${s.lessons} bài trong danh mục · đang biên soạn`;
  const done = s.completed ? ` · ${s.completed} đã hoàn thành` : '';
  return `${s.ready}/${s.lessons} bài sẵn sàng · ${s.chapters} chương${done}`;
}

// --- Chọn môn ----------------------------------------------------------------------------------------------------------

type ProgrammeProps = {
  programme: LessonProgramme | null;
  error: string | null;
  onRetry: () => void;
  onOpenSubject: (code: string) => void;
  /** No school grade (Sinh viên, Người đi làm), or another one to look at. */
  onPickGrade: (grade: string) => void;
  /** "Tiếp tục học": the lesson last practised. */
  onOpenLesson: (key: string) => void;
  /** An open session is offered elsewhere (Tiếp tục phiên học): the lesson card is not shown twice. */
  hideResume?: boolean;
  onSelectionChange: (chosen: string[]) => void;
};

/** Every subject and educational activity of the grade, in the order of the curriculum, each saying what Mirabi has
 * for it. THPT learners choose the elective subjects they study (shown first); every subject stays open. */
export function ProgrammeSubjects({ programme, error, onRetry, onOpenSubject, onPickGrade, onOpenLesson, hideResume, onSelectionChange }: ProgrammeProps) {
  if (error) return <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} /></Card>;
  if (!programme) return <ActivityIndicator color={t.accent} style={styles.loading} />;
  const resume = programme.resume;
  const selection = programme.selection;
  const chosen = new Set(selection?.chosen ?? []);
  const groups: { title: string; items: ProgrammeSubject[] }[] = [];
  const core = programme.subjects.filter((s) => s.type === 'compulsory' || s.type === 'activity');
  const electives = programme.subjects.filter((s) => s.type === 'elective');
  const optional = programme.subjects.filter((s) => s.type === 'optional');
  if (core.length) groups.push({ title: 'Môn bắt buộc và hoạt động giáo dục', items: core });
  if (selection && chosen.size) {
    groups.push({ title: 'Môn lựa chọn bạn học', items: electives.filter((s) => chosen.has(s.code)) });
    groups.push({ title: 'Môn lựa chọn khác', items: electives.filter((s) => !chosen.has(s.code)) });
  } else if (electives.length) groups.push({ title: 'Môn lựa chọn', items: electives });
  if (optional.length) groups.push({ title: 'Môn tự chọn', items: optional });
  const toggle = (code: string) => {
    if (!selection) return;
    const next = chosen.has(code) ? [...chosen].filter((c) => c !== code) : chosen.size < selection.count ? [...chosen, code] : null;
    if (next) onSelectionChange(next);
  };
  return (
    <>
      {resume && !hideResume ? (
        <Card style={styles.resume}>
          <View style={styles.row}>
            <Ionicons name="bookmark-outline" size={22} color={t.accent} />
            <Text style={styles.resumeTitle}>Tiếp tục học</Text>
          </View>
          <Text style={styles.muted}>Lớp {resume.grade} · {resume.subject_name} · {resume.title}{resume.game_title ? ` · ${resume.game_title}` : ''}</Text>
          <Button title="Mở bài học" icon="arrow-forward" onPress={() => onOpenLesson(resume.lesson)} />
        </Card>
      ) : null}
      {programme.grade === null ? (
        <Card>
          <Text style={styles.muted}>{programme.note}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {programme.grades.map((g) => (
              <Pressable key={g.id} onPress={() => onPickGrade(g.id)} accessibilityRole="button" accessibilityLabel={`Xem bài học ${g.label}`} style={styles.chip}>
                <Text style={styles.chipText}>{g.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Card>
      ) : null}
      {selection ? (
        <Card style={styles.selection}>
          <Text style={styles.selectionTitle}>Môn lựa chọn của bạn ({chosen.size}/{selection.count})</Text>
          <Text style={styles.muted}>{selection.note}</Text>
          <View style={styles.chips}>
            {electives.filter((s) => selection.available.includes(s.code)).map((s) => {
              const on = chosen.has(s.code);
              const full = !on && chosen.size >= selection.count;
              return (
                <Pressable key={s.code} onPress={() => toggle(s.code)} disabled={full} accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full }} accessibilityLabel={`${s.name}${on ? ', đang học' : ''}`}
                  style={[styles.chip, on && styles.chipOn, full && styles.dimmed]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}
      {groups.filter((g) => g.items.length).map((g) => (
        <View key={g.title}>
          <SectionHeader title={g.title} />
          {g.items.map((s) => {
            const open = s.status !== 'unsupported' && s.status !== 'empty';
            return (
              <Pressable key={s.code} onPress={() => onOpenSubject(s.code)} disabled={!open} accessibilityRole="button"
                accessibilityState={{ disabled: !open }} accessibilityLabel={`${s.name}. ${s.type_label}. ${supportLine(s)}`}
                style={({ pressed }) => [styles.subject, pressed && styles.pressed, !open && styles.subjectOff]}>
                <View style={[styles.iconWrap, { backgroundColor: s.bg }]}><Ionicons name={s.icon as IconName} size={26} color={s.color} /></View>
                <View style={styles.flex}>
                  <Text style={styles.subjectName}>{s.name}</Text>
                  <Text style={styles.typeTag}>{s.type_label}{s.note ? ` · ${s.note}` : ''}</Text>
                  <Text style={[styles.support, !open && styles.supportOff]}>{supportLine(s)}</Text>
                  {s.ready ? <View style={styles.bar}><ProgressBar value={s.completed / Math.max(1, s.ready)} color={t.success} /></View> : null}
                </View>
                {open ? <Ionicons name="chevron-forward" size={22} color={t.muted} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={styles.source}>{programme.curriculum}. Danh mục môn theo {programme.legal_basis.map((b) => b.split(' (')[0]).join('; ')}.</Text>
    </>
  );
}

// --- Chọn bài ----------------------------------------------------------------------------------------------------------

type LessonsProps = { code: string; grade: string | null; onBack: () => void; onOpen: (key: string) => void;
  /** The subject's free-practice games (not by lesson), when it has some. */ onPractice?: () => void };

/** The lessons of a subject by chapter, in the order of the curriculum, each with its status and progress. A planned
 * lesson is listed without a play button; a lesson locked by a prerequisite says why. */
export function SubjectLessonsScreen({ code, grade, onBack, onOpen, onPractice }: LessonsProps) {
  const [data, setData] = useState<SubjectLessons | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setError(null);
    try { setData(await learningApi.subjectLessons(code, grade)); } catch (e) { setError(errorMessage(e)); }
  }, [code, grade]);
  useEffect(() => { void load(); }, [load]);
  const needle = fold(query);
  const chapters = useMemo(() => (data?.chapters ?? []).map((c) => ({
    ...c, lessons: needle ? c.lessons.filter((l) => fold(`${l.title} ${l.description}`).includes(needle)) : c.lessons,
  })).filter((c) => !needle || c.lessons.length), [data, needle]);
  const count = chapters.reduce((n, c) => n + c.lessons.length, 0);
  return (
    <>
      <BackHeader title={data?.subject.name ?? 'Bài học'} subtitle={data ? `${data.label} · Chọn bài` : 'Chọn bài'} onBack={onBack}
        right={onPractice ? (
          <Pressable onPress={onPractice} accessibilityRole="button" accessibilityLabel="Luyện trò chơi tổng hợp" hitSlop={6} style={styles.practice}>
            <Ionicons name="game-controller-outline" size={18} color={t.accent} />
            <Text style={styles.practiceText}>Luyện tự do</Text>
          </Pressable>
        ) : null} />
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={() => void load()} /></Card> : null}
      {!data && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {data ? (
        <>
          {data.subject.practice_note ? <Text style={styles.note}>{data.subject.practice_note}</Text> : null}
          <SoftInput value={query} onChangeText={setQuery} placeholder="Tìm bài học" accessibilityLabel="Tìm bài học" returnKeyType="search" />
          {needle ? <Text style={styles.muted} accessibilityLiveRegion="polite">{count ? `${count} bài phù hợp` : 'Không tìm thấy bài nào.'}</Text> : null}
          {chapters.map((c, i) => (
            <View key={c.key}>
              <SectionHeader title={`${i + 1}. ${c.title}`} />
              {c.lessons.map((l) => <LessonRow key={l.key} lesson={l} onOpen={() => onOpen(l.key)} />)}
            </View>
          ))}
          <Text style={styles.source}>{data.organization === 'textbook' && data.textbook
            ? `Theo bộ sách ${data.textbook.series}${data.textbook.edition ? ` (${data.textbook.edition})` : ''}.` : data.source_note}</Text>
        </>
      ) : null}
    </>
  );
}

function LessonRow({ lesson, onOpen }: { lesson: LessonListItem; onOpen: () => void }) {
  const planned = lesson.status === 'planned';
  const progress = lesson.progress;
  const look = progress ? STATUS_STYLE[progress.status] : null;
  const label = planned ? 'Đang biên soạn' : lesson.locked ? 'Cần học bài trước' : progress?.label ?? '';
  return (
    <Pressable onPress={onOpen} disabled={planned} accessibilityRole="button" accessibilityState={{ disabled: planned }}
      accessibilityLabel={`${lesson.title}. ${lesson.description}. ${label}`}
      style={({ pressed }) => [styles.lesson, pressed && styles.pressed, planned && styles.lessonPlanned]}>
      <View style={styles.flex}>
        <Text style={styles.lessonTitle}>{lesson.title}</Text>
        <Text style={styles.lessonDetail}>{lesson.description}</Text>
        {lesson.games.length ? <Text style={styles.lessonGames}>{lesson.games.map((g) => g.title).join(' · ')}</Text> : null}
        {lesson.locked && lesson.requires_note ? <Text style={styles.locked}>🔒 {lesson.requires_note}</Text> : null}
        {progress && progress.status !== 'not_started' ? (
          <View style={styles.bar}><ProgressBar value={progress.percent / 100} color={progress.status === 'completed' ? t.success : '#F2A93B'} /></View>
        ) : null}
      </View>
      <View style={[styles.status, { backgroundColor: planned ? '#EEF2F5' : look?.bg ?? '#EEF2F5' }]}>
        <Ionicons name={planned ? 'construct-outline' : lesson.locked ? 'lock-closed-outline' : look?.icon ?? 'ellipse-outline'} size={14}
          color={planned ? t.muted : look?.color ?? t.muted} />
        <Text style={[styles.statusText, { color: planned ? t.muted : look?.color ?? t.muted }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// --- Màn bài học ---------------------------------------------------------------------------------------------------------

type LessonProps = { lessonKey: string; onBack: () => void; onPlay: (lesson: CatalogLesson, game: LessonGame) => void;
  onResume: (sessionId: number) => void; onHowTo: (game: GameId) => void; onOpenLesson: (key: string) => void;
  /** A game is being started (its id): the buttons wait. */ starting: GameId | null };

/** One lesson: its grade and subject, "Bạn sẽ học gì?", the summary and examples (collapsible), and the games that
 * practise it, each with its progress and Bắt đầu / Tiếp tục. */
export function LessonScreen({ lessonKey, onBack, onPlay, onResume, onHowTo, onOpenLesson, starting }: LessonProps) {
  const [lesson, setLesson] = useState<CatalogLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { setLesson(await learningApi.lessonDetail(lessonKey)); } catch (e) { setError(errorMessage(e)); }
  }, [lessonKey]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <><BackHeader title="Bài học" onBack={onBack} /><Card><Text style={styles.error}>{error}</Text>
    <Button title="Thử lại" icon="refresh" variant="secondary" onPress={() => void load()} /></Card></>;
  if (!lesson) return <><BackHeader title="Bài học" onBack={onBack} /><ActivityIndicator color={t.accent} style={styles.loading} /></>;
  const progress = lesson.progress;
  const need = Math.round(lesson.completion.min_first_try * 100);
  return (
    <>
      <BackHeader title={lesson.title} subtitle={`${lesson.grade_label} · ${lesson.subject.name} · ${lesson.chapter.title}`} onBack={onBack} />
      {progress ? (
        <Card style={styles.progressCard}>
          <View style={styles.row}>
            <Ionicons name={STATUS_STYLE[progress.status].icon} size={20} color={STATUS_STYLE[progress.status].color} />
            <Text style={[styles.progressLabel, { color: STATUS_STYLE[progress.status].color }]}>{progress.label}</Text>
            <Text style={styles.muted}>{progress.games_passed}/{progress.games_total} trò đạt</Text>
          </View>
          <ProgressBar value={progress.percent / 100} color={progress.status === 'completed' ? t.success : '#F2A93B'} />
          <Text style={styles.small}>Hoàn thành bài: {lesson.completion.games === 'all' ? 'mỗi trò' : 'một trò'} có một chặng xong với ít nhất {need}% câu đúng ngay lần đầu.</Text>
        </Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>Bạn sẽ học gì?</Text>
        {lesson.objectives.map((o) => <Text key={o} style={styles.bullet}>• {o}</Text>)}
      </Card>
      <Card>
        <Pressable onPress={() => setSummaryOpen((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: summaryOpen }} style={styles.toggleRow}>
          <Text style={[styles.cardTitle, styles.flex]}>Kiến thức tóm tắt</Text>
          <Ionicons name={summaryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
        </Pressable>
        {summaryOpen ? lesson.summary.map((line) => <Text key={line} style={styles.body}>{line}</Text>) : null}
        {lesson.examples.length ? (
          <>
            <Pressable onPress={() => setExamplesOpen((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: examplesOpen }} style={styles.toggleRow}>
              <Text style={[styles.subTitle, styles.flex]}>Ví dụ ({lesson.examples.length})</Text>
              <Ionicons name={examplesOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
            </Pressable>
            {examplesOpen ? lesson.examples.map((ex) => (
              <View key={ex.title} style={styles.example}>
                <Text style={styles.exampleTitle}>{ex.title}</Text>
                {ex.lines.map((line, i) => <Text key={i} style={styles.body}>{line}</Text>)}
              </View>
            )) : null}
          </>
        ) : null}
      </Card>
      {lesson.practice_note ? <Text style={styles.note}>{lesson.practice_note}</Text> : null}
      {lesson.locked ? (
        <Card style={styles.lockedCard}>
          <Text style={styles.cardTitle}>🔒 Cần học bài trước</Text>
          {lesson.requires_note ? <Text style={styles.body}>{lesson.requires_note}</Text> : null}
          {lesson.requires.filter((r) => !r.done).map((r) => (
            <Button key={r.key} title={`Mở bài: ${r.title}`} variant="secondary" icon="arrow-forward" onPress={() => onOpenLesson(r.key)} />
          ))}
        </Card>
      ) : null}
      <SectionHeader title="Trò chơi của bài" />
      {lesson.games.map((g) => <GameRow key={g.game} game={g} locked={lesson.locked} need={need} busy={starting === g.game} blocked={!!starting}
        onPlay={() => onPlay(lesson, g)} onResume={onResume} onHowTo={() => onHowTo(g.game)} />)}
      {lesson.next ? (
        <Button title={`Bài tiếp theo: ${lesson.next.title}`} icon="arrow-forward" variant="ghost" disabled={!lesson.next.ready}
          onPress={() => onOpenLesson(lesson.next!.key)} />
      ) : null}
      <Text style={styles.source}>{lesson.review.label}. {lesson.source_note} · Phiên bản nội dung {lesson.content_version}</Text>
    </>
  );
}

function GameRow({ game, locked, need, busy, blocked, onPlay, onResume, onHowTo }: { game: LessonGame; locked: boolean; need: number; busy: boolean;
  blocked: boolean; onPlay: () => void; onResume: (id: number) => void; onHowTo: () => void }) {
  const info = GAME_INFO[game.game];
  const p = game.progress;
  const count = game.short_stage ? `Bài ngắn · ${game.turns} từ` : `${game.turns} ${game.game === 'code_path' ? 'màn' : 'câu'} mỗi chặng`;
  return (
    <Card style={styles.game}>
      <View style={styles.row}>
        <View style={styles.gameIcon}><Ionicons name={info?.icon ?? 'game-controller-outline'} size={24} color={t.accent} /></View>
        <View style={styles.flex}>
          <Text style={styles.gameTitle}>{game.title}</Text>
          <Text style={styles.small}>{game.gameplay} · {count}</Text>
        </View>
        {p.passed ? <Ionicons name="checkmark-circle" size={22} color={t.success} accessibilityLabel="Đã đạt" /> : null}
      </View>
      {p.stages ? (
        <Text style={styles.small}>
          {p.completed} chặng xong{p.best !== null ? ` · tốt nhất ${p.best}% đúng ngay (cần ${need}%)` : ''}
          {p.last ? ` · lần gần nhất: đúng ngay ${p.last.first_try}/${p.last.total}, ${p.last.attempts} lượt thử, ${p.last.hints} gợi ý` : ''}
        </Text>
      ) : <Text style={styles.small}>Chưa chơi</Text>}
      {game.review_count ? <Text style={styles.review}>{game.review_count} câu cần ôn (xem ở Cần ôn)</Text> : null}
      {!game.playable ? <Text style={styles.small}>Trò này đang được cập nhật, chưa chơi được.</Text> : null}
      <View style={styles.row}>
        {p.open_session ? (
          <Button title="Tiếp tục" icon="play" style={styles.flex} disabled={blocked} onPress={() => onResume(p.open_session!)} />
        ) : (
          <Button title={p.stages ? 'Chơi lại' : 'Bắt đầu'} icon="play" style={styles.flex} loading={busy} disabled={locked || !game.playable || blocked}
            onPress={onPlay} />
        )}
        <Button title="Cách chơi" icon="help-circle-outline" variant="secondary" style={styles.flex} onPress={onHowTo} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loading: { marginVertical: 12 },
  error: { color: t.danger, fontWeight: '700', marginBottom: 8 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20 },
  small: { color: t.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  note: { color: '#8A5A00', backgroundColor: '#FFF6E5', borderRadius: 12, padding: 10, fontSize: 13, lineHeight: 18, marginBottom: 10, fontWeight: '700' },
  source: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 10, marginBottom: 6 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  dimmed: { opacity: 0.45 },
  resume: { borderWidth: 2, borderColor: '#F2C46D', gap: 8 },
  resumeTitle: { fontSize: 17, fontWeight: '900', color: t.ink },
  selection: { gap: 6 },
  selectionTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, backgroundColor: t.tint, justifyContent: 'center' },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 14, fontWeight: '800', color: t.ink },
  chipTextOn: { color: '#FFFFFF' },
  subject: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginBottom: 10,
    shadowColor: '#0B4F75', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  subjectOff: { backgroundColor: '#F6F8FA', shadowOpacity: 0, elevation: 0 },
  iconWrap: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  subjectName: { fontSize: 17, fontWeight: '900', color: t.ink },
  typeTag: { fontSize: 12, fontWeight: '800', color: t.accent, marginTop: 1 },
  support: { fontSize: 13, color: t.muted, marginTop: 3, lineHeight: 18 },
  supportOff: { fontStyle: 'italic' },
  bar: { marginTop: 6 },
  practice: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#FFFFFF' },
  practiceText: { fontSize: 13, fontWeight: '800', color: t.accent },
  lesson: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 10,
    shadowColor: '#0B4F75', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  lessonPlanned: { backgroundColor: '#F6F8FA', shadowOpacity: 0, elevation: 0 },
  lessonTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  lessonDetail: { fontSize: 13, color: t.muted, lineHeight: 18, marginTop: 2 },
  lessonGames: { fontSize: 12, fontWeight: '800', color: t.accent, marginTop: 4 },
  locked: { fontSize: 12, color: '#8A5A00', marginTop: 4, lineHeight: 17 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 130 },
  statusText: { fontSize: 11, fontWeight: '900' },
  progressCard: { gap: 6 },
  progressLabel: { flex: 1, fontSize: 15, fontWeight: '900' },
  cardTitle: { fontSize: 16, fontWeight: '900', color: t.ink, marginBottom: 6 },
  subTitle: { fontSize: 14, fontWeight: '900', color: t.accent },
  toggleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
  bullet: { fontSize: 15, color: t.ink, lineHeight: 22 },
  body: { fontSize: 15, color: t.ink, lineHeight: 22, marginBottom: 4 },
  example: { backgroundColor: t.tint, borderRadius: 12, padding: 10, marginTop: 6 },
  exampleTitle: { fontSize: 13, fontWeight: '900', color: t.accent, marginBottom: 2 },
  lockedCard: { borderWidth: 2, borderColor: '#F2C46D', gap: 6 },
  game: { gap: 6 },
  gameIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  gameTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  review: { fontSize: 13, fontWeight: '800', color: t.danger },
});
