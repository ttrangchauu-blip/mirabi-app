import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_INFO, gameTitle } from '../../learning/labels';
import type { Catalog, FreeLevel, LearningSession, SubjectCode } from '../../learning/types';
import { GRADES } from '../../studyProfile';
import { appTheme as t } from '../../theme';
import { Button, Card, IconName, SectionHeader } from '../../ui/kit';

export type SubjectChoice = SubjectCode | 'free';

// Vector icons, not emoji: flag emoji (🇬🇧) show as letters ("GB") on Windows and some Android devices. The names
// here are the defaults; a grade's programme names its subjects as at school (Tiếng Việt / Ngữ văn, Khoa học…).
export const SUBJECT_CARDS: { id: SubjectChoice; icon: IconName; name: string; detail: string; bg: string; color: string }[] = [
  { id: 'vietnamese', icon: 'reader-outline', name: 'Tiếng Việt', detail: 'Ghép chữ, chính tả qua trò chơi.', bg: '#FCE4F0', color: '#A3326B' },
  { id: 'english', icon: 'language-outline', name: 'Tiếng Anh', detail: 'Học từ vựng và ngữ pháp qua trò chơi.', bg: '#DDF0FA', color: '#136FA8' },
  { id: 'math', icon: 'calculator-outline', name: 'Toán', detail: 'Luyện tính toán và giải bài qua trò chơi.', bg: '#FFF1D6', color: '#B86A00' },
  { id: 'science', icon: 'leaf-outline', name: 'Tự nhiên và Xã hội', detail: 'Quan sát, phân loại thế giới quanh em.', bg: '#E3F5E6', color: '#22703A' },
  { id: 'informatics', icon: 'code-slash-outline', name: 'Tin học', detail: 'Tư duy lập trình qua trò chơi.', bg: '#EEEAFF', color: '#5141A8' },
  { id: 'free', icon: 'book-outline', name: 'Học tự chọn', detail: 'Không gian tập trung cho nội dung học cá nhân.', bg: '#E6F5E8', color: '#1F8A63' },
];
const LEGACY: SubjectChoice[] = ['english', 'math'];

/** The focus timer of "Học tự chọn" while a session is under way (running or paused). */
export type FocusInProgress = { status: string; clock: string };

type Props = {
  catalog: Catalog | null;
  error: string | null;
  onRetry: () => void;
  /** A game session left open (also on another device). */
  current: LearningSession | null;
  focus: FocusInProgress | null;
  onResume: (session: LearningSession) => void;
  onDiscard: () => void;
  onChoose: (choice: SubjectChoice) => void;
  onOpenReview: () => void;
  /** Personal study / Study Together. */
  modeSwitch?: React.ReactNode;
  /** The confirmed grade (profile): another one can be studied for a while without changing it. */
  mainGrade?: string | null;
  onPickGrade?: (grade: string | null) => void;
  onPickLevel?: (level: FreeLevel) => void;
  /** Where the confirmed grade is changed. */
  onEditProfile?: () => void;
  /** Asks for age and grade when the account has none yet. */
  profilePrompt?: React.ReactNode;
  /** Học tập theo bài: every subject of the grade, with its lessons (LessonScreens.ProgrammeSubjects). The subject cards
   * below then become the free-practice games, not by lesson. */
  lessons?: React.ReactNode;
};

/** "Học tập" opens here: the subjects the grade being studied has games for, and free study. Nothing is created on
 * the backend until a game starts. */
export function SubjectPicker({ catalog, error, onRetry, current, focus, onResume, onDiscard, onChoose, onOpenReview, modeSwitch,
  mainGrade, onPickGrade, onPickLevel, onEditProfile, profilePrompt, lessons }: Props) {
  const reviewTotal = catalog?.subjects.reduce((n, s) => n + s.topics.reduce((m, x) => m + x.review_count, 0), 0) ?? 0;
  const programme = catalog?.programme ?? null;
  const [choosing, setChoosing] = useState(false);
  // With a programme: only its subjects, named as at that grade. Without one (no grade yet, older server): as before.
  const cards = programme
    ? [...programme.subjects.map((s) => ({ ...SUBJECT_CARDS.find((c) => c.id === s.code)!, name: s.name })), SUBJECT_CARDS.find((c) => c.id === 'free')!]
    : SUBJECT_CARDS.filter((c) => LEGACY.includes(c.id) || c.id === 'free');
  const otherGrade = !!programme && !programme.outside_school && !!mainGrade && programme.grade !== mainGrade;
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>Học tập</Text>
      {modeSwitch}
      {profilePrompt}
      {programme ? (
        <View style={styles.grade}>
          <View style={styles.gradeRow}>
            <Ionicons name="school-outline" size={18} color={t.accent} />
            <Text style={styles.gradeText} numberOfLines={2} accessibilityLabel={otherGrade ? `Đang học ${programme.label}, lớp chính không đổi` : `Đang học ${programme.label}`}>
              {otherGrade ? `Đang ôn / học trước: ${programme.label}` : programme.label}
            </Text>
            {otherGrade && onPickGrade ? (
              <Pressable onPress={() => { onPickGrade(null); setChoosing(false); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Về lớp chính">
                <Text style={styles.link}>Về lớp chính</Text>
              </Pressable>
            ) : null}
            {!programme.outside_school && onPickGrade ? (
              <Pressable onPress={() => setChoosing((c) => !c)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Chọn lớp khác để ôn hoặc học trước"
                accessibilityState={{ expanded: choosing }}>
                <Text style={styles.link}>{choosing ? 'Đóng' : 'Lớp khác'}</Text>
              </Pressable>
            ) : null}
          </View>
          {programme.outside_school && programme.levels.length && onPickLevel ? (
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Trình độ">
              {programme.levels.map((lv) => (
                <Pressable key={lv.id} onPress={() => onPickLevel(lv.id)} accessibilityRole="radio" accessibilityState={{ checked: lv.id === programme.level }}
                  accessibilityLabel={`Trình độ ${lv.label}`} style={[styles.chip, lv.id === programme.level && styles.chipOn]}>
                  <Text style={[styles.chipText, lv.id === programme.level && styles.chipTextOn]}>{lv.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {choosing && onPickGrade ? (
            <>
              <Text style={styles.gradeHint}>Ôn lớp dưới hoặc học trước lớp trên. Lớp chính trong hồ sơ không đổi.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {GRADES.filter((g) => g.id !== 'university' && g.id !== 'adult').map((g) => {
                  const on = g.id === programme.grade;
                  return (
                    <Pressable key={g.id} onPress={() => { onPickGrade(g.id === mainGrade ? null : g.id); setChoosing(false); }}
                      accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={g.id === mainGrade ? `${g.label}, lớp chính` : g.label}
                      style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.label}{g.id === mainGrade ? ' ★' : ''}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
          {onEditProfile && !otherGrade ? (
            <Pressable onPress={onEditProfile} hitSlop={8} accessibilityRole="button" accessibilityLabel="Sửa độ tuổi và lớp chính" style={styles.edit}>
              <Text style={styles.editText}>Sửa độ tuổi và lớp chính</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {current ? (
        <Card style={styles.resume}>
          <View style={styles.resumeHead}>
            <Ionicons name={GAME_INFO[current.game].icon} size={22} color={t.accent} />
            <Text style={styles.resumeTitle}>Tiếp tục phiên học</Text>
          </View>
          <Text style={styles.muted}>
            {current.subject.name} · {gameTitle(current.game)} · {current.topic.name} · {current.resolved_count}/{current.required_count} lượt
          </Text>
          <View style={styles.row}>
            <Button title="Tiếp tục" icon="play" style={styles.flex} onPress={() => onResume(current)} />
            <Button title="Bỏ phiên" variant="secondary" style={styles.flex} onPress={onDiscard} />
          </View>
        </Card>
      ) : null}
      {focus ? (
        <Card style={styles.resume}>
          <View style={styles.resumeHead}>
            <Ionicons name="book-outline" size={22} color={t.accent} />
            <Text style={styles.resumeTitle}>Tiếp tục phiên học</Text>
          </View>
          <Text style={styles.muted}>Học tự chọn · {focus.status} · còn {focus.clock}</Text>
          <Button title="Mở Học tự chọn" icon="timer-outline" onPress={() => onChoose('free')} />
        </Card>
      ) : null}
      <SectionHeader title="Chọn môn học" action={reviewTotal ? { label: `Cần ôn (${reviewTotal})`, onPress: onOpenReview } : undefined} />
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} /></Card> : null}
      {!catalog && !error && !lessons ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {lessons ?? null}
      {lessons ? (
        <>
          <SectionHeader title="Trò chơi luyện tập tự do" />
          <Text style={[styles.muted, styles.freeNote]}>Không theo bài: trò chơi chọn nội dung theo lớp và tiến độ của bạn.</Text>
        </>
      ) : null}
      {programme?.note ? <Card><Text style={styles.muted} accessibilityRole="alert">{programme.note}</Text></Card> : null}
      {cards.map((s) => (
        <Pressable key={s.id} onPress={() => onChoose(s.id)} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.detail}`}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={[styles.iconWrap, { backgroundColor: s.bg }]}><Ionicons name={s.icon} size={28} color={s.color} /></View>
          <View style={styles.flex}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.detail}>{s.detail}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={t.muted} />
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: 23, fontWeight: '900', color: t.ink, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { color: t.danger, fontWeight: '700' },
  loading: { marginVertical: 8 },
  freeNote: { marginTop: -6, marginBottom: 10 },
  resume: { borderWidth: 2, borderColor: '#F2C46D', gap: 8 },
  resumeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resumeTitle: { fontSize: 17, fontWeight: '900', color: t.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 12,
    shadowColor: '#0B4F75', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '900', color: t.ink },
  detail: { fontSize: 14, color: t.muted, lineHeight: 20, marginTop: 2 },
  grade: { backgroundColor: t.tint, borderRadius: 16, padding: 12, marginBottom: 12, gap: 8 },
  gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gradeText: { flex: 1, fontSize: 15, fontWeight: '900', color: t.ink },
  gradeHint: { fontSize: 13, color: t.muted, lineHeight: 18 },
  link: { fontSize: 14, fontWeight: '900', color: t.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 14, fontWeight: '800', color: t.ink },
  chipTextOn: { color: '#FFFFFF' },
  edit: { alignSelf: 'flex-start' },
  editText: { fontSize: 13, fontWeight: '800', color: t.muted, textDecorationLine: 'underline' },
});
