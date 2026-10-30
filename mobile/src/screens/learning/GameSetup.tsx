import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_INFO, gameTitle, lessonsForGame, PLAY_MODE } from '../../learning/labels';
import type { Catalog, GameId, LearningSession, Level, StartOptions, SubjectCode, Topic } from '../../learning/types';
import type { StudyRecommendations } from '../../studyProfile';
import { appTheme as t } from '../../theme';
import { Button, Card, Chip, SectionHeader } from '../../ui/kit';
import { BackHeader } from './GamePicker';

const DURATIONS = [15, 25, 40];

/** Choices to show again, e.g. after closing the lesson intro. */
export type SetupPreset = { topicId?: number; levelId?: number; durationMinutes?: number };

type Props = {
  subject: SubjectCode;
  game: GameId;
  catalog: Catalog | null;
  error: string | null;
  onRetry: () => void;
  defaultDuration: number;
  preset?: SetupPreset;
  /** A session already open: it has to be continued or dropped before starting another. */
  current: LearningSession | null;
  starting: boolean;
  onBack: () => void;
  onStart: (options: StartOptions) => void;
  onResume: (session: LearningSession) => void;
  /** Suggestions for the user's grade: the suggested grade is chosen first and its topics are marked. */
  recommended?: StudyRecommendations | null;
  /** The grade being studied decides the Math grade (level code, e.g. grade3); null outside school: every grade. */
  onlyLevel?: string | null;
};

/** One game's setup: English picks the topic then the level, Math the grade then the topic; then the duration.
 * "Bắt đầu" is the only thing that creates a session on the backend. */
export function GameSetup({ subject, game, catalog, error, onRetry, defaultDuration, preset, current, starting, onBack, onStart, onResume,
  recommended, onlyLevel }: Props) {
  const info = GAME_INFO[game];
  const data = catalog?.subjects.find((s) => s.code === subject);
  const lessons = useMemo(() => (data ? lessonsForGame(data.lessons, game) : []), [data, game]);
  const [topicId, setTopicId] = useState<number | null>(preset?.topicId ?? null);
  const [levelId, setLevelId] = useState<number | null>(preset?.levelId ?? null);
  const durations = useMemo(() => [...new Set([...DURATIONS, defaultDuration])].filter((d) => d >= 5 && d <= 60).sort((a, b) => a - b), [defaultDuration]);
  const [duration, setDuration] = useState(preset?.durationMinutes && durations.includes(preset.durationMinutes) ? preset.durationMinutes
    : durations.includes(defaultDuration) ? defaultDuration : 25);

  const has = (topic?: Topic, level?: Level) => lessons.some((l) => (!topic || l.topic_id === topic.id) && (!level || l.level_id === level.id));
  const topics = data?.topics.filter((x) => has(x)) ?? [];
  const levels = data?.levels.filter((lv) => has(undefined, lv) && (!onlyLevel || lv.code === onlyLevel)) ?? [];
  const gradeFirst = subject === 'math';
  // Vocabulary: "Tổng hợp" (all topics, the level follows the user) is chosen already, so "Bắt đầu" is one tap away;
  // a topic is an optional filter, shown as small chips.
  const vocabulary = info.gameType === 'meteor';
  let topic: Topic | undefined;
  let level: Level | undefined;
  let topicChoices = topics;
  let levelChoices = levels;
  const suggestedTopic = (x: Topic) => !!recommended?.topics[subject]?.includes(x.code);
  if (gradeFirst) {
    level = levels.find((lv) => lv.id === levelId) ?? levels.find((lv) => lv.code === recommended?.math_level) ?? levels[0];
    topicChoices = topics.filter((x) => has(x, level));
    topic = topicChoices.find((x) => x.id === topicId);
  } else {
    topic = topics.find((x) => x.id === topicId) ?? (vocabulary ? topics[0] : undefined);
    levelChoices = topic ? levels.filter((lv) => has(topic, lv)) : [];
    level = levelChoices.find((lv) => lv.id === levelId) ?? levelChoices[0];
  }
  const lesson = lessons.find((l) => l.topic_id === topic?.id && l.level_id === level?.id);

  const topicSection = vocabulary ? (
    <>
      <SectionHeader title="Chủ đề" />
      {/* One scrolling row: "Bắt đầu" stays on the first screen however many topics there are. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
        {topicChoices.map((x) => {
          const selected = x.id === topic?.id;
          return (
            <Pressable key={x.id} onPress={() => setTopicId(x.id)} accessibilityRole="radio" accessibilityState={{ selected }}
              accessibilityLabel={x.name} style={[styles.topicChip, selected && styles.optionOn]}>
              <Text style={[styles.topicChipText, selected && styles.onText]}>{x.name}</Text>
              {x.review_count ? <Text style={[styles.topicBadge, selected && styles.topicBadgeOn]}>{x.review_count}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {topic?.description ? <Text style={styles.muted}>{topic.description}</Text> : null}
    </>
  ) : (
    <>
      <SectionHeader title="Chủ đề" />
      {topicChoices.map((x) => {
        const selected = x.id === topic?.id;
        return (
          <Pressable key={x.id} onPress={() => setTopicId(x.id)} accessibilityRole="radio" accessibilityState={{ selected }}
            accessibilityLabel={suggestedTopic(x) ? `${x.name} (gợi ý)` : x.name} style={[styles.option, selected && styles.optionOn]}>
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Text style={[styles.optionName, selected && styles.onText]}>{x.name}</Text>
                {suggestedTopic(x) ? <Text style={[styles.suggested, selected && styles.suggestedOn]}>Gợi ý</Text> : null}
              </View>
              {x.description ? <Text style={[styles.optionDesc, selected && styles.onText]}>{x.description}</Text> : null}
            </View>
            {x.review_count ? <Text style={styles.badge}>{x.review_count} cần ôn</Text> : null}
            {selected ? <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" /> : null}
          </Pressable>
        );
      })}
    </>
  );
  const levelSection = vocabulary && levelChoices.length === 1 && level ? (
    // Nothing to choose: say what the level is (e.g. "Tự điều chỉnh: bắt đầu từ A1...") without asking for a tap.
    <View style={styles.levelInfo}>
      <Ionicons name="trending-up-outline" size={18} color={t.accent} />
      <Text style={styles.levelInfoText}><Text style={styles.levelInfoName}>{gradeFirst ? 'Lớp' : 'Trình độ'}: {level.name}</Text>
        {level.description ? ` · ${level.description}` : ''}</Text>
    </View>
  ) : levelChoices.length ? (
    <>
      <SectionHeader title={gradeFirst ? 'Lớp' : 'Trình độ'} />
      <View style={styles.chips}>
        {levelChoices.map((lv) => <Chip key={lv.id} label={lv.name} selected={lv.id === level?.id} onPress={() => setLevelId(lv.id)} />)}
      </View>
      {level?.description ? <Text style={styles.muted}>{level.description}</Text> : null}
      {gradeFirst && recommended && levelChoices.some((lv) => lv.code === recommended.math_level) ? (
        <Text style={styles.muted}>Gợi ý cho {recommended.grade_label}: {levelChoices.find((lv) => lv.code === recommended.math_level)!.name}</Text>
      ) : null}
    </>
  ) : null;

  return (
    <>
      <BackHeader title={info.direction ? `${info.direction} · ${info.name}` : info.name}
        subtitle={`${catalog?.subjects.find((s) => s.code === subject)?.name ?? ''} · ${info.detail}`} onBack={onBack} />
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} /></Card> : null}
      {!catalog && !error ? <ActivityIndicator color={t.accent} /> : null}
      {data ? (
        <>
          {gradeFirst ? <>{levelSection}{topicSection}</> : <>{topicSection}{levelSection}</>}
          {lesson ? (
            <>
              <SectionHeader title="Thời lượng" />
              <View style={styles.chips}>
                {durations.map((d) => <Chip key={d} label={`${d} phút`} selected={d === duration} onPress={() => setDuration(d)} />)}
              </View>
              {current ? (
                <Card style={styles.resume}>
                  <Text style={styles.muted}>Bạn đang có một phiên học chưa hoàn thành ({current.subject.name} · {gameTitle(current.game)}). Hãy tiếp tục hoặc bỏ phiên đó trước khi bắt đầu phiên mới.</Text>
                  <Button title="Tiếp tục phiên học" icon="play" variant="secondary" onPress={() => onResume(current)} />
                </Card>
              ) : null}
              <Button title="Bắt đầu" icon="play" loading={starting} disabled={!!current} style={styles.start}
                onPress={() => onStart({ lessonId: lesson.id, mode: PLAY_MODE, durationMinutes: duration, variant: lesson.variants.length ? info.variant : null })} />
            </>
          ) : <Text style={styles.muted}>{gradeFirst ? 'Chọn một chủ đề để tiếp tục.' : 'Chọn một chủ đề để chọn trình độ.'}</Text>}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { color: t.danger, fontWeight: '700' },
  resume: { borderWidth: 2, borderColor: '#F2C46D', gap: 8, marginTop: 12 },
  start: { marginTop: 16 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 8 },
  optionOn: { backgroundColor: t.accent },
  optionName: { fontSize: 16, fontWeight: '900', color: t.ink },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  suggested: { fontSize: 11, fontWeight: '900', color: t.success, backgroundColor: t.successBg, borderRadius: 8, paddingHorizontal: 7,
    paddingVertical: 2, overflow: 'hidden' },
  suggestedOn: { color: t.accent, backgroundColor: '#FFFFFF' },
  optionDesc: { fontSize: 13, color: t.muted, marginTop: 2 },
  onText: { color: '#FFFFFF' },
  badge: { fontSize: 12, fontWeight: '800', color: t.danger, backgroundColor: t.dangerBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipScroll: { marginHorizontal: -20, flexGrow: 0 },
  chipRow: { gap: 8, paddingHorizontal: 20 },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 8, minHeight: 38 },
  topicChipText: { fontSize: 14, fontWeight: '800', color: t.ink },
  topicBadge: { fontSize: 11, fontWeight: '900', color: t.danger, backgroundColor: t.dangerBg, borderRadius: 8, paddingHorizontal: 6,
    paddingVertical: 1, overflow: 'hidden' },
  topicBadgeOn: { color: t.accent, backgroundColor: '#FFFFFF' },
  levelInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.tint, borderRadius: 14, padding: 10, marginTop: 12 },
  levelInfoText: { flex: 1, fontSize: 13, color: t.muted, lineHeight: 18 },
  levelInfoName: { fontWeight: '900', color: t.ink },
});
