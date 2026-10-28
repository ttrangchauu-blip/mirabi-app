import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_INFO, gameTitle } from '../../learning/labels';
import type { Catalog, LearningSession, SubjectCode } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, IconName, SectionHeader } from '../../ui/kit';

export type SubjectChoice = SubjectCode | 'free';

// Vector icons, not emoji: flag emoji (🇬🇧) show as letters ("GB") on Windows and some Android devices.
export const SUBJECT_CARDS: { id: SubjectChoice; icon: IconName; name: string; detail: string; bg: string; color: string }[] = [
  { id: 'english', icon: 'language-outline', name: 'Tiếng Anh', detail: 'Học từ vựng và ngữ pháp qua trò chơi.', bg: '#DDF0FA', color: '#136FA8' },
  { id: 'math', icon: 'calculator-outline', name: 'Toán', detail: 'Luyện tính toán và giải bài qua trò chơi.', bg: '#FFF1D6', color: '#B86A00' },
  { id: 'free', icon: 'book-outline', name: 'Học tự chọn', detail: 'Không gian tập trung cho nội dung học cá nhân.', bg: '#E6F5E8', color: '#1F8A63' },
];

/** The focus timer of "Học tự chọn" while a session is under way (running or paused). */
export type FocusInProgress = { status: string; clock: string };

type Props = {
  catalog: Catalog | null;
  error: string | null;
  onRetry: () => void;
  /** An English/Math session left open (also on another device). */
  current: LearningSession | null;
  focus: FocusInProgress | null;
  onResume: (session: LearningSession) => void;
  onDiscard: () => void;
  onChoose: (choice: SubjectChoice) => void;
  onOpenReview: () => void;
  /** Personal study / Study Together. */
  modeSwitch?: React.ReactNode;
};

/** "Học tập" opens here: pick English, Math or free study. Nothing is created on the backend until "Bắt đầu". */
export function SubjectPicker({ catalog, error, onRetry, current, focus, onResume, onDiscard, onChoose, onOpenReview, modeSwitch }: Props) {
  const reviewTotal = catalog?.subjects.reduce((n, s) => n + s.topics.reduce((m, x) => m + x.review_count, 0), 0) ?? 0;
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>Học tập</Text>
      {modeSwitch}
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
      {!catalog && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
      {SUBJECT_CARDS.map((s) => (
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
  resume: { borderWidth: 2, borderColor: '#F2C46D', gap: 8 },
  resumeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resumeTitle: { fontSize: 17, fontWeight: '900', color: t.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 12,
    shadowColor: '#0B4F75', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '900', color: t.ink },
  detail: { fontSize: 14, color: t.muted, lineHeight: 20, marginTop: 2 },
});
