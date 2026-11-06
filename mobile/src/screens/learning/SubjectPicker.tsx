import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components/Typography';
import type { EducationState } from '../../learning/education';
import { GAME_INFO, gameTitle } from '../../learning/labels';
import type { Catalog, FreeLevel, LearningSession, LessonProgramme, ResumeLesson, SubjectCode } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';
import type { IconName } from '../../ui/kit';
import { HeaderIcon, IconBadge, Look, shortSubjectName } from './LearningUI';

// Vector icons, not emoji: flag emoji (🇬🇧) show as letters ("GB") on Windows and some Android devices. The names
// here are the defaults; a grade's programme names its subjects as at school (Tiếng Việt / Ngữ văn, Khoa học…).
export const SUBJECT_LOOK: Record<SubjectCode, Look & { name: string }> = {
  vietnamese: { icon: 'reader-outline', name: 'Tiếng Việt', bg: '#FCE4F0', color: '#A3326B', tone: 'rose' },
  english: { icon: 'language-outline', name: 'Tiếng Anh', bg: '#DDF0FA', color: '#136FA8', tone: 'sky' },
  math: { icon: 'calculator-outline', name: 'Toán', bg: '#FFF1D6', color: '#B86A00', tone: 'sun' },
  science: { icon: 'leaf-outline', name: 'Tự nhiên và Xã hội', bg: '#E3F5E6', color: '#22703A', tone: 'leaf' },
  informatics: { icon: 'code-slash-outline', name: 'Tin học', bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' },
};
const FREE_STUDY: Look = { icon: 'book-outline', bg: '#E6F5E8', color: '#1F8A63', tone: 'leaf' };
const ELECTIVES: Look = { icon: 'options-outline', bg: '#EEF2F5', color: '#4F6C86', tone: 'neutral' };
/** Before a grade has a programme (or on an older server): the subjects that always had games. */
const LEGACY: SubjectCode[] = ['english', 'math'];
/** A lesson subject whose free-practice games are listed under another code (Tin học và Công nghệ, lớp 3–5). */
export const PRACTICE_ALIAS: Record<string, SubjectCode> = { info_tech: 'informatics' };

/** The focus timer of "Học tự chọn" while a session is under way (running or paused). */
export type FocusInProgress = { status: string; clock: string };

/** Where a subject tile leads: its lessons by chapter, or (no lessons yet) its free-practice games. */
export type SubjectTarget = { code: string; to: 'lessons' | 'games' };

type Tile = { key: string; name: string; hint: string; look: Look; onPress: () => void };

type Props = {
  catalog: Catalog | null;
  /** Học tập theo bài: every subject of the grade with its lessons (null on an older server, or while loading). */
  lessons: LessonProgramme | null;
  error: string | null;
  onRetry: () => void;
  /** A game session left open (also on another device). */
  current: LearningSession | null;
  focus: FocusInProgress | null;
  onResume: (session: LearningSession) => void;
  onDiscard: () => void;
  /** "Tiếp tục học" without an open session: the lesson last practised. */
  onOpenLesson: (key: string) => void;
  onOpenSubject: (target: SubjectTarget) => void;
  onFreeStudy: () => void;
  /** THPT: choose the elective subjects. */
  onOpenElectives: () => void;
  onOpenReview: () => void;
  /** Personal study / Study Together. */
  modeSwitch?: React.ReactNode;
  /** The learner's locked grade and school year (backend education.py): shown, never chosen here. */
  education?: EducationState | null;
  /** Outside school (Sinh viên, Người đi làm): the level, which is not a grade. */
  onPickLevel?: (level: FreeLevel) => void;
  /** Sổ tay kiến thức of the current school year. */
  onOpenNotebook: () => void;
  /** Kho lưu trữ học tập: the finished school years. */
  onOpenArchive: () => void;
  /** Asks for age and grade when the account has none yet. */
  profilePrompt?: React.ReactNode;
};

/** "Học tập" opens here, kept short: the grade and school year (locked: there is no grade picker), at most one
 * "Tiếp tục học", then the subjects of that grade as a grid. Sổ tay, Kho lưu trữ and Cần ôn are icons of the header.
 * A subject leads to its lessons (or, with none yet, to its games). Nothing is created on the backend until a game starts. */
export function SubjectPicker({ catalog, lessons, error, onRetry, current, focus, onResume, onDiscard, onOpenLesson, onOpenSubject,
  onFreeStudy, onOpenElectives, onOpenReview, modeSwitch, education, onPickLevel, onOpenNotebook, onOpenArchive, profilePrompt }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const columns = Math.min(width, 760) - 40 >= 330 ? 3 : 2;
  const reviewTotal = catalog?.subjects.reduce((n, s) => n + s.topics.reduce((m, x) => m + x.review_count, 0), 0) ?? 0;
  const programme = catalog?.programme ?? null;
  const atSchool = !!education?.enrolled && !!education.grade && education.status !== 'outside_school';
  const year = education?.academic_year_label;
  const label = programme?.label ?? (lessons?.grade ? lessons.label : null);
  const note = programme?.note ?? (lessons && lessons.grade === null ? lessons.note : null);

  const tiles: Tile[] = subjectTiles(catalog, lessons).map((s) => ({
    key: s.code, name: s.name, look: s.look, hint: s.to === 'lessons' ? 'Bài học theo chương' : 'Trò chơi luyện tập',
    onPress: () => onOpenSubject({ code: s.code, to: s.to }),
  }));
  const selection = lessons?.selection;
  if (selection) {
    tiles.push({ key: 'electives', name: 'Môn lựa chọn', look: ELECTIVES, hint: `Đã chọn ${selection.chosen.length}/${selection.count}`,
      onPress: onOpenElectives });
  }
  tiles.push({ key: 'free', name: 'Học tự chọn', look: FREE_STUDY, hint: 'Không gian tập trung cho nội dung học cá nhân', onPress: onFreeStudy });
  const loading = !catalog && !lessons && !error;

  return (
    <>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.title}>Học tập</Text>
          {atSchool ? (
            <View style={styles.gradeRow} testID="grade-header">
              <Text style={styles.grade} numberOfLines={1}>{education!.grade_label}{year ? ` — Năm học ${year}` : ''}</Text>
              <Ionicons name="lock-closed" size={12} color={t.muted} accessibilityLabel="Lớp học cố định theo đăng ký" />
            </View>
          ) : label ? <Text style={styles.grade} numberOfLines={1}>{label}</Text> : null}
        </View>
        <View style={styles.actions}>
          {reviewTotal ? <HeaderIcon icon="refresh-outline" label={`Cần ôn (${reviewTotal})`} count={reviewTotal} onPress={onOpenReview} /> : null}
          {atSchool ? <HeaderIcon icon="journal-outline" label={`Sổ tay kiến thức ${education!.grade_label}`} onPress={onOpenNotebook} /> : null}
          {atSchool ? <HeaderIcon icon="archive-outline" label="Kho lưu trữ học tập" onPress={onOpenArchive} testID="open-archive" /> : null}
        </View>
      </View>
      {modeSwitch}
      {profilePrompt}
      {!atSchool && programme?.outside_school && programme.levels.length && onPickLevel ? (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Trình độ">
          {programme.levels.map((lv) => (
            <Pressable key={lv.id} onPress={() => onPickLevel(lv.id)} accessibilityRole="radio" accessibilityState={{ checked: lv.id === programme.level }}
              accessibilityLabel={`Trình độ ${lv.label}`} style={[styles.chip, lv.id === programme.level && styles.chipOn]}>
              <Text style={[styles.chipText, lv.id === programme.level && styles.chipTextOn]}>{lv.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {note ? <Text style={styles.note} accessibilityRole="alert">{note}</Text> : null}
      <ContinueCard current={current} focus={focus} resume={lessons?.resume ?? null} onResume={onResume} onDiscard={onDiscard}
        onFreeStudy={onFreeStudy} onOpenLesson={onOpenLesson} />
      {error ? (
        <View style={styles.error} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Thử lại" hitSlop={6} style={styles.retry}>
            <Text style={styles.retryText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.section} accessibilityRole="header">Chọn môn học</Text>
      {loading ? <ActivityIndicator color={t.accent} style={styles.loading} /> : (
        <View style={styles.grid}>
          {tiles.map((tile) => (
            <View key={tile.key} style={[styles.cell, { width: `${100 / columns}%` }]}>
              <Pressable onPress={tile.onPress} accessibilityRole="button" accessibilityLabel={`${tile.name}. ${tile.hint}`}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                <IconBadge look={tile.look} size={52} />
                <Text style={styles.tileName} numberOfLines={2}>{shortSubjectName(tile.name)}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

/** The subjects of the grid, each once: the grade's lesson subjects (THPT: the electives chosen), then any subject that
 * only has free-practice games. Subjects with nothing on Mirabi (decided by the school or the region) are left out. */
function subjectTiles(catalog: Catalog | null, lessons: LessonProgramme | null): { code: string; name: string; look: Look; to: SubjectTarget['to'] }[] {
  const practice = catalog?.programme?.subjects ?? null;
  const hasGames = (code: string) => !!practice?.some((p) => p.code === (PRACTICE_ALIAS[code] ?? code));
  const out: { code: string; name: string; look: Look; to: SubjectTarget['to'] }[] = [];
  const covered = new Set<string>();
  if (lessons) {
    const chosen = lessons.selection ? new Set(lessons.selection.chosen) : null;
    for (const s of lessons.subjects) {
      if (s.type === 'elective' && chosen && !chosen.has(s.code)) continue;
      const withLessons = s.status !== 'unsupported' && s.status !== 'empty';
      if (!withLessons && !hasGames(s.code)) continue;
      covered.add(PRACTICE_ALIAS[s.code] ?? s.code);
      out.push({ code: s.code, name: s.name, look: { icon: s.icon as IconName, bg: s.bg, color: s.color }, to: withLessons ? 'lessons' : 'games' });
    }
  }
  const games = practice ?? (lessons ? [] : LEGACY.map((code) => ({ code, name: SUBJECT_LOOK[code].name })));
  for (const g of games) {
    if (covered.has(g.code) || !SUBJECT_LOOK[g.code]) continue;
    out.push({ code: g.code, name: g.name, look: SUBJECT_LOOK[g.code], to: 'games' });
  }
  return out;
}

type ContinueProps = { current: LearningSession | null; focus: FocusInProgress | null; resume: ResumeLesson | null;
  onResume: (session: LearningSession) => void; onDiscard: () => void; onFreeStudy: () => void; onOpenLesson: (key: string) => void };

/** "Tiếp tục học": one small card, for the stage left open, else the focus timer running, else the lesson last practised.
 * Hidden when there is none. */
function ContinueCard({ current, focus, resume, onResume, onDiscard, onFreeStudy, onOpenLesson }: ContinueProps) {
  const { t } = useTheme();
  const styles = useStyles();
  const item = current ? {
    icon: GAME_INFO[current.game]?.icon ?? 'game-controller-outline',
    detail: `${current.catalog?.subject_name ?? current.subject.name} · ${current.catalog?.title ?? gameTitle(current.game)}`,
    onPress: () => onResume(current), onDismiss: onDiscard,
  } : focus ? {
    icon: 'timer-outline' as IconName, detail: `Học tự chọn · ${focus.status} · còn ${focus.clock}`, onPress: onFreeStudy, onDismiss: undefined,
  } : resume ? {
    icon: 'bookmark-outline' as IconName, detail: `${resume.subject_name} · ${resume.title}`, onPress: () => onOpenLesson(resume.lesson), onDismiss: undefined,
  } : null;
  if (!item) return null;
  return (
    <View style={styles.continue}>
      <IconBadge look={{ icon: item.icon, bg: t.tint, color: t.accent }} size={42} />
      <View style={styles.flex}>
        <Text style={styles.continueLabel}>Tiếp tục học</Text>
        <Text style={styles.continueDetail} numberOfLines={1}>{item.detail}</Text>
      </View>
      <Pressable onPress={item.onPress} accessibilityRole="button" accessibilityLabel="Tiếp tục" style={({ pressed }) => [pressed && styles.pressed]}>
        <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.continueButton}>
          <Ionicons name="play" size={14} color={t.onPrimary} />
          <Text style={styles.continueButtonText}>Tiếp tục</Text>
        </LinearGradient>
      </Pressable>
      {item.onDismiss ? (
        <Pressable onPress={item.onDismiss} accessibilityRole="button" accessibilityLabel="Bỏ phiên" hitSlop={8} style={styles.dismiss}>
          <Ionicons name="close" size={18} color={t.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '900', color: t.ink },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  grade: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: t.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  note: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: t.card, justifyContent: 'center' },
  chipOn: { backgroundColor: t.accentFill },
  chipText: { fontSize: 14, fontWeight: '800', color: t.ink },
  chipTextOn: { color: t.onPrimary },
  continue: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 18, paddingVertical: 10,
    paddingLeft: 10, paddingRight: 12, marginBottom: 18, shadowColor: t.shadow, shadowOpacity: 0.07, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  continueLabel: { fontSize: 12, fontWeight: '800', color: t.muted },
  continueDetail: { fontSize: 15, fontWeight: '900', color: t.ink, marginTop: 1 },
  continueButton: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 12, borderRadius: 12 },
  continueButtonText: { fontSize: 14, fontWeight: '800', color: t.onPrimary },
  dismiss: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.dangerBg, borderRadius: 14, padding: 10, marginBottom: 14 },
  errorText: { flex: 1, color: t.danger, fontSize: 13, fontWeight: '700' },
  retry: { backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: t.danger, fontWeight: '900' },
  section: { fontSize: 17, fontWeight: '900', color: t.ink, marginBottom: 10 },
  loading: { marginVertical: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  cell: { padding: 6 },
  tile: { alignItems: 'center', gap: 8, backgroundColor: t.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8, minHeight: 116,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  tileName: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: t.ink, textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
}));
