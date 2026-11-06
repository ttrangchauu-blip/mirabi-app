import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { errorMessage } from '../../auth/messages';
import { Text, TextInput } from '../../components/Typography';
import { educationApi, type ArchiveCard, type EducationState, type Note, type Notebook } from '../../learning/education';
import { GAME_INFO } from '../../learning/labels';
import type { GameId } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';
import { Button, Card, IconName, ProgressBar, SectionHeader } from '../../ui/kit';
import { SceneHeader, SceneIn } from '../../world/diorama';
import { BackHeader } from './GamePicker';
import { type Look, themedLook } from './LearningUI';
import { type Book, BookReader, buildShelves, EmptyLibrary, filterShelves, ShelfWall, useBookmarks } from './KnowledgeLibrary';
import { NotesPanel, type NoteDraft, type NoteSubject } from './NotesScreen';

// Kho lưu trữ học tập (backend education.py): the finished school years, read-only. A year can be reread and its
// lessons reviewed with their games; a review is stored apart and never changes the year's results nor the current grade.
// There is no way to switch to an old grade from here.

/** One colour per grade, so the years are told apart at a glance (Mirabi's pastel cards). */
const PALETTE: Look[] = [
  { bg: '#FFF1D6', color: '#B86A00', icon: 'sunny-outline', tone: 'sun' }, { bg: '#DDF0FA', color: '#136FA8', icon: 'planet-outline', tone: 'sky' },
  { bg: '#E3F5E6', color: '#22703A', icon: 'leaf-outline', tone: 'leaf' }, { bg: '#FCE4F0', color: '#A3326B', icon: 'heart-outline', tone: 'rose' },
  { bg: '#EEEAFF', color: '#5141A8', icon: 'rocket-outline', tone: 'lilac' }, { bg: '#E6F5F2', color: '#1F7A6B', icon: 'flower-outline', tone: 'sea' },
];
const look = (grade: string) => PALETTE[(Number(grade.replace('grade', '')) || 0) % PALETTE.length];

function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  const styles = useStyles();
  return <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} /></Card>;
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setError(null);
    try { setData(await load()); } catch (e) { setError(errorMessage(e)); }
  }, [load]);
  useEffect(() => { void run(); }, [run]);
  return { data, error, retry: run };
}

// --- Kho lưu trữ ---------------------------------------------------------------------------------------------------------

const dateLabel = (iso: string) => iso.split('-').reverse().join('/');

/** The current school year in one line or two: how far it has got and when the next grade starts. */
function CurrentYear({ education: e }: { education: EducationState }) {
  const { t } = useTheme();
  const styles = useStyles();
  const p = e.progress;
  const next = e.next_promotion;
  return (
    <View style={styles.current}>
      <Text style={styles.currentTitle}>Đang học {e.grade_label}{e.academic_year_label ? ` · Năm học ${e.academic_year_label}` : ''}</Text>
      {p && p.lessons_ready ? (
        <View accessible accessibilityLabel={`Tiến độ năm học: ${p.lessons_completed} trên ${p.lessons_ready} bài hoàn thành`} style={styles.currentBar}>
          <ProgressBar value={p.percent / 100} color={t.success} />
          <Text style={styles.small}>{p.lessons_completed}/{p.lessons_ready} bài hoàn thành · {p.percent}% năm học</Text>
        </View>
      ) : null}
      {e.promotion_pending ? (
        <Text style={styles.small} accessibilityLiveRegion="polite">Năm học mới đã bắt đầu: hoàn thành chặng đang chơi để lên lớp.</Text>
      ) : e.awaiting_calendar ? (
        <Text style={styles.small}>Năm học mới đã bắt đầu: bạn sẽ lên lớp khi lịch năm học được xác nhận.</Text>
      ) : e.status === 'completed' ? (
        <Text style={styles.small}>Bạn đã hoàn thành chương trình. Ôn lại các năm học gần nhất ở đây.</Text>
      ) : next?.to_grade_label && next.date ? (
        <Text style={styles.small}>Tự động lên {next.to_grade_label.replace('Lớp', 'lớp')} vào ngày {dateLabel(next.date)} (năm học {next.academic_year_label}).</Text>
      ) : next?.to_grade_label ? (
        <Text style={styles.small}>Ngày lên {next.to_grade_label.replace('Lớp', 'lớp')} sẽ có khi lịch năm học được xác nhận.</Text>
      ) : null}
    </View>
  );
}

export function ArchiveListScreen({ education, onBack, onOpen }: { education?: EducationState | null; onBack: () => void; onOpen: (year: number) => void }) {
  const { t } = useTheme();
  const styles = useStyles();
  const { data, error, retry } = useLoad(useCallback(() => educationApi.archives(), []));
  const atSchool = !!education?.enrolled && !!education.grade && education.status !== 'outside_school';
  return (
    <>
      <BackHeader title="Kho lưu trữ học tập" subtitle={`${data?.visible_years ?? 3} năm học gần nhất · chỉ xem và ôn tập`} onBack={onBack} />
      {atSchool ? <CurrentYear education={education!} /> : null}
      {error ? <Failed error={error} onRetry={() => void retry()} /> : null}
      {!data && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {data && !data.items.length ? (
        <View style={styles.empty}>
          <Ionicons name="archive-outline" size={30} color={t.muted} />
          <Text style={[styles.muted, styles.center]}>Chưa có năm học nào kết thúc. Khi bạn lên lớp, năm học vừa xong sẽ được lưu ở đây.</Text>
        </View>
      ) : null}
      {data?.items.map((a) => <YearRow key={a.academic_year} archive={a} onOpen={() => onOpen(a.academic_year)} />)}
    </>
  );
}

function YearRow({ archive: a, onOpen }: { archive: ArchiveCard; onOpen: () => void }) {
  const theme = useTheme();
  const { t } = theme;
  const styles = useStyles();
  const style = themedLook(look(a.grade), theme);
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={
      `${a.grade_label}, năm học ${a.academic_year_label}. ${a.subjects} môn, ${a.lessons_completed} bài hoàn thành, tiến độ ${a.percent}%`}
      style={({ pressed }) => [styles.year, pressed && styles.pressed]}>
      <View style={[styles.yearIcon, { backgroundColor: style.bg }]}><Ionicons name={style.icon} size={24} color={style.color} /></View>
      <View style={styles.flex}>
        <Text style={styles.yearGrade}>{a.grade_label}</Text>
        <Text style={styles.small}>Năm học {a.academic_year_label} · {a.percent}%</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.muted} />
    </Pressable>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  const styles = useStyles();
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

// --- Một năm học --------------------------------------------------------------------------------------------------------

type YearProps = { year: number; onBack: () => void; onOpenLesson: (key: string) => void };

export function ArchiveYearScreen({ year, onBack, onOpenLesson }: YearProps) {
  const theme = useTheme();
  const { t } = theme;
  const styles = useStyles();
  const { data, error, retry } = useLoad(useCallback(() => educationApi.archive(year), [year]));
  const [tab, setTab] = useState<'subjects' | 'words' | 'mistakes' | 'notes'>('subjects');
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <><BackHeader title="Kho lưu trữ" onBack={onBack} /><Failed error={error} onRetry={() => void retry()} /></>;
  if (!data) return <><BackHeader title="Kho lưu trữ" onBack={onBack} /><ActivityIndicator color={t.accent} style={styles.loading} /></>;
  const s = data.stats;
  const results = (key: string) => data.lesson_results.filter((r) => r.lesson === key);
  return (
    <>
      <BackHeader title={data.grade_label} subtitle={`Năm học ${data.academic_year_label} · Chỉ xem và ôn tập`} onBack={onBack} />
      <Card style={styles.summary}>
        <View style={styles.stats}>
          <Stat value={s.lessons_completed} label="bài hoàn thành" />
          <Stat value={s.stages_completed} label="chặng xong" />
          <Stat value={s.accuracy === null ? '–' : `${s.accuracy}%`} label="đúng ngay" />
        </View>
        <ProgressBar value={s.percent / 100} color={t.success} />
        {data.reviews.stages ? <Text style={styles.small}>Đã ôn lại {data.reviews.completed}/{data.reviews.stages} lượt (lưu riêng, không đổi kết quả năm học).</Text> : null}
      </Card>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['subjects', 'Môn học'], ['words', `Từ vựng (${data.vocabulary.length})`], ['mistakes', `Câu sai (${data.mistakes.length})`],
          ['notes', `Ghi chú (${data.notes?.length ?? 0})`]] as const).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
            style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'subjects' ? (
        <>
          {data.subjects.map((sub) => {
            const expanded = open === sub.code;
            const subLook = themedLook({ icon: sub.icon as IconName, bg: sub.bg, color: sub.color }, theme);
            return (
              <View key={sub.code} style={styles.subject}>
                <Pressable onPress={() => setOpen(expanded ? null : sub.code)} accessibilityRole="button" accessibilityState={{ expanded }}
                  accessibilityLabel={`${sub.name}. ${sub.completed} trên ${sub.ready} bài hoàn thành`} style={styles.row}>
                  <View style={[styles.subjectIcon, { backgroundColor: subLook.bg }]}><Ionicons name={subLook.icon} size={22} color={subLook.color} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.subjectName}>{sub.name}</Text>
                    <Text style={styles.small}>{sub.ready ? `${sub.completed}/${sub.ready} bài hoàn thành · ${sub.started} bài đã học` : 'Chưa có bài học trên Mirabi'}</Text>
                  </View>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
                </Pressable>
                {expanded ? sub.chapters.map((c) => (
                  <View key={c.key}>
                    <Text style={styles.chapter}>{c.title}</Text>
                    {c.lessons.map((l) => {
                      const done = l.progress?.status === 'completed';
                      const games = results(l.key);
                      return (
                        <Pressable key={l.key} onPress={() => onOpenLesson(l.key)} disabled={l.status !== 'ready'} accessibilityRole="button"
                          accessibilityLabel={`${l.title}. ${l.progress?.label ?? 'Đang biên soạn'}`} style={({ pressed }) => [styles.lesson, pressed && styles.pressed]}>
                          <Ionicons name={done ? 'checkmark-circle' : l.progress?.status === 'in_progress' ? 'time-outline' : 'ellipse-outline'} size={18}
                            color={done ? t.success : t.muted} />
                          <View style={styles.flex}>
                            <Text style={styles.lessonTitle}>{l.title}</Text>
                            {games.length ? <Text style={styles.small}>{games.map((g) => `${GAME_INFO[g.game as GameId]?.name ?? g.game}: ${g.best ?? 0}%`).join(' · ')}</Text> : null}
                          </View>
                          {l.status === 'ready' ? <Ionicons name="chevron-forward" size={18} color={t.muted} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )) : null}
              </View>
            );
          })}
          {data.free_practice.length ? (
            <>
              <SectionHeader title="Trò chơi luyện tập tự do" />
              {data.free_practice.map((g) => (
                <Text key={g.game} style={styles.line}>{GAME_INFO[g.game as GameId]?.name ?? g.game}: {g.completed}/{g.stages} chặng · điểm cao nhất {g.best_score}</Text>
              ))}
            </>
          ) : null}
        </>
      ) : null}
      {tab === 'words' ? (
        data.vocabulary.length ? data.vocabulary.map((w) => (
          <View key={w.key} style={styles.word}>
            <Text style={styles.wordEn}>{w.word}{w.phonetic ? <Text style={styles.small}>  {w.phonetic}</Text> : null}</Text>
            <Text style={styles.muted}>{w.meaning_vi}</Text>
          </View>
        )) : <Text style={styles.muted}>Năm này chưa có từ vựng nào.</Text>
      ) : null}
      {tab === 'mistakes' ? (
        data.mistakes.length ? data.mistakes.map((m) => (
          <View key={m.key} style={styles.word}>
            <Text style={styles.lessonTitle}>{m.label}</Text>
            {m.answer ? <Text style={styles.answer}>Đáp án: {m.answer}</Text> : null}
          </View>
        )) : <Text style={styles.muted}>Năm này không có câu trả lời sai nào.</Text>
      ) : null}
      {tab === 'notes' ? (
        data.notes?.length ? data.notes.map((n) => (
          <View key={n.id} style={styles.word}>
            {n.title ? <Text style={styles.lessonTitle}>{n.title}</Text> : null}
            <Text style={styles.small}>{[n.subject_name, n.lesson_title].filter(Boolean).join(' · ')}</Text>
            <Text style={styles.noteBody}>{n.body}</Text>
          </View>
        )) : <Text style={styles.muted}>Năm này bạn chưa viết ghi chú nào.</Text>
      ) : null}
    </>
  );
}

// --- Một bài của năm cũ ---------------------------------------------------------------------------------------------------

type LessonProps = { year: number; lessonKey: string; onBack: () => void; starting: GameId | null;
  onPlay: (game: GameId) => void; onResume: (sessionId: number) => void };

export function ArchiveLessonScreen({ year, lessonKey, onBack, starting, onPlay, onResume }: LessonProps) {
  const { t } = useTheme();
  const styles = useStyles();
  const { data, error, retry } = useLoad(useCallback(() => educationApi.archiveLesson(year, lessonKey), [year, lessonKey]));
  if (error) return <><BackHeader title="Bài học" onBack={onBack} /><Failed error={error} onRetry={() => void retry()} /></>;
  if (!data) return <><BackHeader title="Bài học" onBack={onBack} /><ActivityIndicator color={t.accent} style={styles.loading} /></>;
  return (
    <>
      <BackHeader title={data.title} subtitle={`${data.grade_label} · ${data.academic_year_label} · ${data.subject_name ?? ''}`} onBack={onBack} />
      <View style={styles.badge}><Ionicons name="archive-outline" size={14} color={t.accent} /><Text style={styles.badgeText}>Bài của năm học cũ · chỉ xem và ôn tập</Text></View>
      <Knowledge entry={data} />
      {data.results.length ? (
        <Card>
          <Text style={styles.cardTitle}>Kết quả năm {data.academic_year_label}</Text>
          {data.results.map((r) => (
            <Text key={r.game} style={styles.line}>{GAME_INFO[r.game as GameId]?.name ?? r.game}: {r.completed} chặng xong · tốt nhất {r.best ?? 0}% đúng ngay{r.passed ? ' · Đã đạt' : ''}</Text>
          ))}
        </Card>
      ) : null}
      {data.games.length ? <SectionHeader title="Ôn tập bằng trò chơi" /> : null}
      {data.games.map((g) => (
        <Card key={g.game} style={styles.game}>
          <View style={styles.row}>
            <Ionicons name={GAME_INFO[g.game]?.icon ?? 'game-controller-outline'} size={22} color={t.accent} />
            <View style={styles.flex}>
              <Text style={styles.lessonTitle}>{g.title}</Text>
              <Text style={styles.small}>{g.gameplay}{g.review.stages ? ` · đã ôn ${g.review.completed} lượt` : ''}</Text>
            </View>
          </View>
          {g.review.open_session ? <Button title="Tiếp tục ôn" icon="play" onPress={() => onResume(g.review.open_session!)} />
            : <Button title="Ôn tập" icon="refresh" loading={starting === g.game} disabled={!g.playable || !!starting} onPress={() => onPlay(g.game)} />}
        </Card>
      ))}
      <Text style={styles.source}>Phiên bản nội dung {data.content_version}{data.frozen ? ' (đã lưu khi kết thúc năm học)' : ''}. Lượt ôn tập được lưu riêng, không thay đổi kết quả năm học và lớp hiện tại.</Text>
    </>
  );
}

function Knowledge({ entry }: { entry: { objectives: string[]; summary: string[]; examples: { title: string; lines: string[] }[] } }) {
  const styles = useStyles();
  return (
    <Card>
      {entry.objectives.length ? <Text style={styles.cardTitle}>Bạn đã học gì?</Text> : null}
      {entry.objectives.map((o) => <Text key={o} style={styles.body}>• {o}</Text>)}
      {entry.summary.length ? <Text style={[styles.cardTitle, styles.spaced]}>Kiến thức tóm tắt</Text> : null}
      {entry.summary.map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
      {entry.examples.map((ex) => (
        <View key={ex.title} style={styles.example}>
          <Text style={styles.exampleTitle}>{ex.title}</Text>
          {ex.lines.map((line, i) => <Text key={i} style={styles.body}>{line}</Text>)}
        </View>
      ))}
    </Card>
  );
}

// --- Sổ tay kiến thức (năm học hiện tại) ----------------------------------------------------------------------------------

type NotebookProps = { onBack: () => void; onOpenLesson: (key: string) => void;
  /** The subjects of the learner's grade, for personal notes. */ subjects: NoteSubject[];
  /** Opened from a lesson's "Ghi chú": the notes tab, with that lesson's note started. */ draft?: (NoteDraft & { lessonTitle?: string }) | null;
  /** Whose bookmarks; and the pet reading in the corner of the library. */ userId?: number; pet?: { id: string; level: number } | null };

/** Sổ tay kiến thức: the library ("Kệ sách": what the lessons studied this year teach, written by Mirabi, and the owner's
 * notes, as books) and "Ghi chú của tôi" (writing the learner's own notes, per school year). */
export function NotebookScreen({ onBack, onOpenLesson, subjects, draft, userId, pet }: NotebookProps) {
  const { t } = useTheme();
  const styles = useStyles();
  const { data, error, retry } = useLoad(useCallback((): Promise<Notebook> => educationApi.notebook(), []));
  const [tab, setTab] = useState<'summary' | 'notes'>(draft ? 'notes' : 'summary');
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [openBook, setOpenBook] = useState<Book | null>(null);
  const [marked, toggleMark] = useBookmarks(userId);
  // The shelf follows what the notes tab wrote: reloaded each time the library is back.
  useEffect(() => {
    if (tab !== 'summary' || !data) return;
    let live = true;
    educationApi.notes({ academic_year: data.academic_year ?? null }).then((r) => { if (live) setNotes(r.items); }).catch(() => {});
    return () => { live = false; };
  }, [tab, data]);
  const shelves = useMemo(() => buildShelves(data?.entries ?? [], notes), [data, notes]);
  const shown = useMemo(() => filterShelves(shelves, { query, subject, marked: onlyMarked ? marked : null }), [shelves, query, subject, onlyMarked, marked]);
  const total = shelves.reduce((sum, sh) => sum + sh.books.length, 0);
  const lessons = (data?.entries ?? []).map((e) => ({ key: e.key, title: e.title, subject: e.subject }));
  if (draft?.lessonKey && draft.lessonTitle && !lessons.some((l) => l.key === draft.lessonKey)) {
    lessons.unshift({ key: draft.lessonKey, title: draft.lessonTitle, subject: draft.subject });
  }
  return (
    <View style={styles.bleed}>
      <View style={styles.beam}>
        <LinearGradient colors={[t.bg, t.bg]} style={StyleSheet.absoluteFill} />
        <SceneHeader title="Sổ tay kiến thức" subtitle={data ? `${data.grade_label}${data.academic_year_label ? ` · Năm học ${data.academic_year_label}` : ''}` : undefined} onBack={onBack} />
        <View style={styles.tabs} accessibilityRole="tablist">
          {([['summary', 'Kệ sách'], ['notes', 'Ghi chú của tôi']] as const).map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}
              style={[styles.tab, tab === id && styles.tabOn]}>
              <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === 'notes' ? (
        <View style={styles.notesDesk}>
          {data || error ? <NotesPanel subjects={subjects} lessons={lessons} academicYear={data?.academic_year ?? null} draft={draft} />
            : <ActivityIndicator color={t.accent} style={styles.loading} />}
        </View>
      ) : <>
        <View style={styles.finder}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={t.accent} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Tìm trong thư viện" placeholderTextColor={t.placeholder} accessibilityLabel="Tìm trong thư viện" returnKeyType="search" style={styles.searchInput} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Pressable onPress={() => setOnlyMarked((v) => !v)} accessibilityRole="checkbox" accessibilityLabel="Chỉ sách đã đánh dấu" accessibilityState={{ checked: onlyMarked }} style={[styles.filter, onlyMarked && styles.filterOn]}>
              <Ionicons name={onlyMarked ? 'bookmark' : 'bookmark-outline'} size={14} color={onlyMarked ? t.onPrimary : t.ink} /><Text style={[styles.filterText, onlyMarked && styles.filterTextOn]}>Đã đánh dấu</Text>
            </Pressable>
            {[{ subject: null as string | null, name: 'Tất cả' }, ...shelves].map((sh) => (
              <Pressable key={sh.subject ?? 'all'} onPress={() => setSubject(sh.subject)} accessibilityRole="radio" accessibilityLabel={`Môn ${sh.name}`} accessibilityState={{ checked: subject === sh.subject }} style={[styles.filter, subject === sh.subject && styles.filterOn]}>
                <Text style={[styles.filterText, subject === sh.subject && styles.filterTextOn]}>{sh.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        {error ? <Failed error={error} onRetry={() => void retry()} /> : null}
        {!data && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
        {data ? (
          <SceneIn>
            <ShelfWall shelves={shown} marked={marked} onOpen={setOpenBook} pet={pet} total={total} />
            {!total ? <EmptyLibrary message="Học một bài để kiến thức của bài xuất hiện trong sổ tay nhé." />
              : !shown.length ? <EmptyLibrary message={onlyMarked && !query ? 'Chưa có sách nào được đánh dấu.' : 'Không tìm thấy sách nào.'} /> : null}
            <View style={styles.markNote}><Text style={styles.markNoteText}>Dấu trang được lưu trên thiết bị này.</Text></View>
          </SceneIn>
        ) : null}
      </>}
      <BookReader book={openBook} marked={!!openBook && marked.has(openBook.id)} onToggleMark={() => { if (openBook) toggleMark(openBook.id); }} onClose={() => setOpenBook(null)}
        onOpenLesson={onOpenLesson} onEditNotes={() => setTab('notes')} />
    </View>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  flex: { flex: 1 },
  noteBody: { fontSize: 15, color: t.ink, lineHeight: 22, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loading: { marginVertical: 12 },
  error: { color: t.danger, fontWeight: '700', marginBottom: 8 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20 },
  small: { color: t.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  source: { color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 10, marginBottom: 6 },
  pressed: { opacity: 0.85 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20, paddingHorizontal: 12 },
  current: { backgroundColor: t.card, borderRadius: 18, padding: 14, marginBottom: 16, gap: 6 },
  currentTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  currentBar: { gap: 4 },
  year: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 18, padding: 12, marginBottom: 10,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  yearIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  yearGrade: { fontSize: 16, fontWeight: '900', color: t.ink },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: t.surfaceSecondary, borderRadius: 14, paddingVertical: 8, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900', color: t.ink },
  statLabel: { fontSize: 11, fontWeight: '800', color: t.muted },
  summary: { gap: 8 },
  bleed: { marginHorizontal: -20 },
  beam: { overflow: 'hidden' },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingTop: 2 },
  tab: { flex: 1, minHeight: 44, borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tabOn: { backgroundColor: t.card },
  tabText: { fontSize: 13, fontWeight: '800', color: t.ink, textAlign: 'center' },
  tabTextOn: { color: t.ink },
  notesDesk: { backgroundColor: t.bg, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 30, minHeight: 420 },
  finder: { backgroundColor: t.bg, paddingTop: 10, paddingBottom: 8, gap: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, paddingHorizontal: 12, minHeight: 44, borderRadius: 12, backgroundColor: t.inputBg, borderWidth: 1, borderColor: t.inputBorder },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: t.ink, paddingVertical: 8 },
  filters: { gap: 6, paddingHorizontal: 14 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, borderRadius: 18, paddingHorizontal: 12, backgroundColor: t.card, borderWidth: 1, borderColor: t.inputBorder },
  filterOn: { backgroundColor: t.accentFill, borderColor: t.inputBorder },
  filterText: { fontSize: 12, fontWeight: '800', color: t.ink },
  filterTextOn: { color: t.onPrimary },
  markNote: { backgroundColor: t.bg, paddingVertical: 8 },
  markNoteText: { fontSize: 11, lineHeight: 15, fontWeight: '700', color: t.muted, textAlign: 'center' },
  subject: { backgroundColor: t.card, borderRadius: 18, padding: 12, marginBottom: 10, gap: 6 },
  subjectIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  subjectName: { fontSize: 16, fontWeight: '900', color: t.ink },
  chapter: { fontSize: 13, fontWeight: '900', color: t.accent, marginTop: 8, marginBottom: 2 },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, minHeight: 44 },
  lessonTitle: { fontSize: 15, fontWeight: '800', color: t.ink },
  line: { fontSize: 14, color: t.ink, lineHeight: 21 },
  word: { backgroundColor: t.card, borderRadius: 14, padding: 12, marginBottom: 8 },
  wordEn: { fontSize: 16, fontWeight: '900', color: t.ink },
  answer: { fontSize: 13, fontWeight: '800', color: t.success, marginTop: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: t.tint, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  badgeText: { fontSize: 12, fontWeight: '800', color: t.accent },
  cardTitle: { fontSize: 16, fontWeight: '900', color: t.ink, marginBottom: 6 },
  spaced: { marginTop: 8 },
  body: { fontSize: 15, color: t.ink, lineHeight: 22, marginBottom: 4 },
  example: { backgroundColor: t.tint, borderRadius: 12, padding: 10, marginTop: 6 },
  exampleTitle: { fontSize: 13, fontWeight: '900', color: t.accent, marginBottom: 2 },
  game: { gap: 8 },
}));
