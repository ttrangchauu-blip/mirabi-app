import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_GROUPS, GAME_INFO, gameTitle, isGroup, lessonsForGame, QUICK_GAMES, SUBJECT_GAMES } from '../../learning/labels';
import type { Catalog, GameGroupId, GameId, LearningSession, SubjectCode, VocabGame, VocabProgress } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { gameLook, IconBadge, Look } from './LearningUI';
import { SUBJECT_LOOK } from './SubjectPicker';
import { TopicSheet, VocabStrip } from './VocabExtras';

/** "Chơi ngay" for the English games: the game being started and why it could not start. */
export type QuickPlay = {
  onPlay: (game: GameId) => void;
  starting: GameId | null;
  error: { game: GameId; message: string; code?: string } | null;
  /** A session already open: it has to be continued or dropped before another one starts. */
  current: LearningSession | null;
  onResume: (session: LearningSession) => void;
  onDiscard: () => void;
};

/** The two vocabulary games: one tap plays "Khám phá từ mới" (new words only); under each, its level, the topic and
 * "Ôn tập". Unknown (an older server) until `progress` loads: the games then play as before. */
export type VocabChoice = {
  progress: Partial<Record<VocabGame, VocabProgress>>;
  topic: Partial<Record<VocabGame, string | null>>;
  onTopic: (game: VocabGame, topic: string | null) => void;
  onReview: (game: VocabGame) => void;
  reviewing: VocabGame | null;
};
const isVocabGame = (id: GameId): id is VocabGame => id === 'meteor' || id === 'word_shooter';

type Props = {
  subject: SubjectCode;
  /** Show the games of this group instead of the subject's list. */
  group?: GameGroupId;
  catalog: Catalog | null;
  onBack: () => void;
  onPick: (game: GameId) => void;
  onOpenGroup: (group: GameGroupId) => void;
  quick?: QuickPlay;
  /** "Cách chơi": read a game's guide again. */
  onHowTo: (game: GameId) => void;
  /** "Sổ tay từ vựng": the English word history, offered next to the title. */
  onOpenHistory?: () => void;
  vocab?: VocabChoice;
};

/** The games of one subject (free practice, not by lesson): each with its picture, name and one line on how it plays.
 * English and the curriculum games start right away (the backend picks the content); Math games open their setup.
 * Each game offers its "Cách chơi". */
export function GamePicker({ subject, group, catalog, onBack, onPick, onOpenGroup, quick, onHowTo, onOpenHistory, vocab }: Props) {
  const [topicFor, setTopicFor] = React.useState<VocabGame | null>(null);
  // The grade being studied decides the games (only those with content for it), and names the subject as at school.
  const offered = catalog?.programme?.subjects.find((s) => s.code === subject);
  const card = { ...SUBJECT_LOOK[subject], ...(offered ? { name: offered.name } : {}) };
  const lessons = catalog?.subjects.find((s) => s.code === subject)?.lessons;
  // Unknown until the catalog loads; a game with no lessons yet is shown but cannot be opened.
  const empty = (game: GameId) => !QUICK_GAMES.has(game) && !!lessons && lessonsForGame(lessons, game).length === 0;
  const entries: (GameId | GameGroupId)[] = group ? GAME_GROUPS[group].games
    : catalog?.programme ? (offered?.games.map((g) => g.id) ?? []) : SUBJECT_GAMES[subject];
  const quickHere = !!quick && entries.some((id) => !isGroup(id) && QUICK_GAMES.has(id));
  const blocked = !!quick?.current || !!quick?.starting;
  return (
    <>
      <BackHeader title={group ? GAME_GROUPS[group].name : card.name} subtitle={group ? `${card.name} · Chọn trò chơi` : 'Chọn trò chơi'} onBack={onBack}
        right={onOpenHistory ? (
          <Pressable onPress={onOpenHistory} accessibilityRole="button" accessibilityLabel="Sổ tay từ vựng" hitSlop={6}
            style={({ pressed }) => [styles.history, pressed && styles.pressed]}>
            <Ionicons name="book-outline" size={18} color={t.accent} />
            <Text style={styles.historyText}>Sổ tay từ vựng</Text>
          </Pressable>
        ) : null} />
      {/* Nothing to choose before playing: one tap on a game starts it. */}
      {quick && quickHere && quick.current ? (
        <Card style={styles.resume}>
          <Text style={styles.muted}>Bạn đang có một phiên chưa xong ({quick.current.subject.name} · {gameTitle(quick.current.game)}). Tiếp tục hoặc bỏ phiên đó để chơi trò khác.</Text>
          <View style={styles.resumeRow}>
            <Button title="Tiếp tục" icon="play" variant="secondary" style={styles.flex} onPress={() => quick.onResume(quick.current!)} />
            <Button title="Bỏ phiên" icon="trash-outline" variant="secondary" style={styles.flex} onPress={quick.onDiscard} />
          </View>
        </Card>
      ) : null}
      {entries.map((id) => {
        if (isGroup(id)) {
          const g = GAME_GROUPS[id];
          const none = g.games.every(empty);
          return (
            <Entry key={id} look={{ icon: g.icon, bg: card.bg, color: card.color }} title={g.name} detail={none ? 'Sắp có' : g.detail} disabled={none}
              label={`${g.name}. ${g.detail}`} onPress={() => onOpenGroup(id)} />
          );
        }
        const game = GAME_INFO[id];
        const label = `${game.name}${game.direction ? ` (${game.direction})` : ''}. ${game.detail}`;
        if (quick && QUICK_GAMES.has(id)) {
          const failed = quick.error?.game === id ? quick.error : null;
          const words = vocab && isVocabGame(id) ? vocab.progress[id] : undefined;
          // Every new word of this scope was discovered: a topic with new words, or Ôn tập (never the old words again).
          const exhausted = failed?.code === 'vocabulary_exhausted' && words && isVocabGame(id);
          return (
            <View key={id}>
              <Entry look={gameLook(id)} title={game.name} tag={game.direction} detail={words ? `Khám phá từ mới · ${game.detail}` : game.detail}
                disabled={blocked} busy={quick.starting === id} label={label} onPress={() => quick.onPlay(id)} onHowTo={() => onHowTo(id)} howToLabel={game.name} />
              {words && vocab && isVocabGame(id) ? (
                <VocabStrip progress={words} topic={vocab.topic[id] ?? null} disabled={blocked} reviewing={vocab.reviewing === id}
                  onTopic={() => setTopicFor(id)} onReview={() => vocab.onReview(id)} />
              ) : null}
              {exhausted ? (
                <View style={styles.error} accessibilityRole="alert">
                  <Text style={styles.errorText}>{failed!.message}</Text>
                  <Pressable onPress={() => setTopicFor(id)} accessibilityRole="button" accessibilityLabel="Chọn chủ đề khác" style={styles.retry}>
                    <Text style={styles.retryText}>Chủ đề khác</Text>
                  </Pressable>
                  <Pressable onPress={() => vocab!.onReview(id)} accessibilityRole="button" accessibilityLabel="Ôn tập từ đã học" style={styles.retry}>
                    <Text style={styles.retryText}>Ôn tập</Text>
                  </Pressable>
                </View>
              ) : failed ? (
                <View style={styles.error} accessibilityRole="alert">
                  <Text style={styles.errorText}>{failed.message}</Text>
                  <Pressable onPress={() => quick.onPlay(id)} accessibilityRole="button" accessibilityLabel={`Thử lại ${game.name}`} style={styles.retry}>
                    <Text style={styles.retryText}>Thử lại</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }
        return (
          <Entry key={id} look={gameLook(id)} title={game.direction ?? game.name} tag={game.direction ? game.name : undefined}
            detail={empty(id) ? 'Sắp có' : game.detail} disabled={empty(id)} label={label} onPress={() => onPick(id)}
            onHowTo={empty(id) ? undefined : () => onHowTo(id)} howToLabel={game.name} />
        );
      })}
      {vocab ? (
        <TopicSheet visible={topicFor !== null} progress={topicFor ? vocab.progress[topicFor] ?? null : null}
          topic={topicFor ? vocab.topic[topicFor] ?? null : null} onClose={() => setTopicFor(null)}
          onPick={(topic) => { const g = topicFor!; setTopicFor(null); vocab.onTopic(g, topic); }} />
      ) : null}
    </>
  );
}

type EntryProps = { look: Look; title: string; tag?: string; detail: string;
  disabled: boolean; busy?: boolean; label: string; onPress: () => void;
  /** "Cách chơi" of this game: a small button of its own beside the card (it never starts the game). */
  onHowTo?: () => void; howToLabel?: string };

function Entry({ look, title, tag, detail, disabled, busy, label, onPress, onHowTo, howToLabel }: EntryProps) {
  return (
    <View style={[styles.card, disabled && !busy && styles.dimmed]}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled, busy }}
        accessibilityLabel={label} style={({ pressed }) => [styles.entryMain, pressed && styles.pressed]}>
        <IconBadge look={look} size={48} />
        <View style={styles.flex}>
          <Text style={styles.name}>{title}{tag ? <Text style={styles.tag}>  {tag}</Text> : null}</Text>
          <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
        </View>
        {busy ? <ActivityIndicator color={t.accent} accessibilityLabel="Đang tải" />
          : onHowTo ? null : <Ionicons name="chevron-forward" size={20} color={t.muted} />}
      </Pressable>
      {onHowTo ? (
        <Pressable onPress={onHowTo} accessibilityRole="button" accessibilityLabel={`Cách chơi ${howToLabel ?? title}`} hitSlop={6}
          style={({ pressed }) => [styles.howTo, pressed && styles.pressed]}>
          <Ionicons name="help-circle-outline" size={22} color={t.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Title row of the screens inside "Học tập": "Quay lại" on the left, then the title. */
export function BackHeader({ title, subtitle, onBack, disabled, right }: {
  title: string; subtitle?: string; onBack: () => void; disabled?: boolean; right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} disabled={disabled} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8} style={styles.back}>
        <Ionicons name="chevron-back" size={24} color={t.ink} />
      </Pressable>
      <View style={styles.flex}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, marginBottom: 10,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  dimmed: { opacity: 0.5 },
  name: { fontSize: 16, fontWeight: '900', color: t.ink },
  tag: { fontSize: 13, fontWeight: '800', color: t.accent },
  detail: { fontSize: 13, color: t.muted, lineHeight: 18, marginTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 14, color: t.muted, marginTop: 2 },
  history: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: '#FFFFFF' },
  historyText: { fontSize: 13, fontWeight: '800', color: t.accent },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  entryMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 72 },
  howTo: { width: 48, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  resume: { gap: 8, marginBottom: 12, padding: 14 },
  resumeRow: { flexDirection: 'row', gap: 8 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20 },
  error: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, backgroundColor: t.dangerBg, borderRadius: 14, padding: 10, marginTop: -4, marginBottom: 12 },
  errorText: { flex: 1, color: t.danger, fontSize: 13, fontWeight: '700' },
  retry: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: t.danger, fontWeight: '900' },
});
