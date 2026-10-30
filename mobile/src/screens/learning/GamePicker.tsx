import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_GROUPS, GAME_INFO, gameTitle, isGroup, lessonsForGame, QUICK_GAMES, SUBJECT_GAMES } from '../../learning/labels';
import type { Catalog, GameGroupId, GameId, LearningSession, SubjectCode } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { SUBJECT_CARDS } from './SubjectPicker';

/** "Chơi ngay" for the English games: the game being started and why it could not start. */
export type QuickPlay = {
  onPlay: (game: GameId) => void;
  starting: GameId | null;
  error: { game: GameId; message: string } | null;
  /** A session already open: it has to be continued or dropped before another one starts. */
  current: LearningSession | null;
  onResume: (session: LearningSession) => void;
  onDiscard: () => void;
};

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
  /** "Từ đã học": the English word history, offered next to the title. */
  onOpenHistory?: () => void;
};

/** The games of one subject. English games start right away (the backend picks the content); Math games open their
 * setup (grade, topic). Each game offers its "Cách chơi". */
export function GamePicker({ subject, group, catalog, onBack, onPick, onOpenGroup, quick, onHowTo, onOpenHistory }: Props) {
  // The grade being studied decides the games (only those with content for it), and names the subject as at school.
  const offered = catalog?.programme?.subjects.find((s) => s.code === subject);
  const grades = (game: GameId) => offered?.games.find((g) => g.id === game)?.grades;
  const card = { ...SUBJECT_CARDS.find((s) => s.id === subject)!, ...(offered ? { name: offered.name } : {}) };
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
          <Pressable onPress={onOpenHistory} accessibilityRole="button" accessibilityLabel="Từ đã học" hitSlop={6}
            style={({ pressed }) => [styles.history, pressed && styles.pressed]}>
            <Ionicons name="book-outline" size={18} color={t.accent} />
            <Text style={styles.historyText}>Từ đã học</Text>
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
            <Entry key={id} icon={g.icon} bg={card.bg} color={card.color} title={g.name} detail={none ? 'Sắp có' : g.detail} disabled={none}
              label={`${g.name}. ${g.detail}`} onPress={() => onOpenGroup(id)} />
          );
        }
        const game = GAME_INFO[id];
        const label = `${game.name}${game.direction ? ` (${game.direction})` : ''}. ${game.detail}`;
        if (quick && QUICK_GAMES.has(id)) {
          const failed = quick.error?.game === id ? quick.error.message : null;
          return (
            <View key={id}>
              <Entry icon={game.icon} bg={card.bg} color={card.color} title={game.name} tag={game.direction} detail={game.detail}
                disabled={blocked} busy={quick.starting === id} label={label} onPress={() => quick.onPlay(id)} onHowTo={() => onHowTo(id)} howToLabel={game.name}
                grades={grades(id)} />
              {failed ? (
                <View style={styles.error} accessibilityRole="alert">
                  <Text style={styles.errorText}>{failed}</Text>
                  <Pressable onPress={() => quick.onPlay(id)} accessibilityRole="button" accessibilityLabel={`Thử lại ${game.name}`} style={styles.retry}>
                    <Text style={styles.retryText}>Thử lại</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        }
        return (
          <Entry key={id} icon={game.icon} bg={card.bg} color={card.color} title={game.direction ?? game.name} tag={game.direction ? game.name : undefined}
            detail={empty(id) ? 'Sắp có' : game.detail} disabled={empty(id)} label={label} onPress={() => onPick(id)}
            onHowTo={empty(id) ? undefined : () => onHowTo(id)} howToLabel={game.name} grades={grades(id)} />
        );
      })}
    </>
  );
}

type EntryProps = { icon: React.ComponentProps<typeof Ionicons>['name']; bg: string; color: string; title: string; tag?: string; detail: string;
  disabled: boolean; busy?: boolean; label: string; onPress: () => void;
  /** "Cách chơi" of this game: a button of its own beside the card (it never starts the game). */
  onHowTo?: () => void; howToLabel?: string;
  /** The grades the game supports ("Lớp 1–2"). */
  grades?: string };

function Entry({ icon, bg, color, title, tag, detail, disabled, busy, label, onPress, onHowTo, howToLabel, grades }: EntryProps) {
  const main = (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled, busy }}
      accessibilityLabel={label} style={({ pressed }) => [styles.entryMain, !onHowTo && styles.card, pressed && styles.pressed, disabled && !busy && styles.dimmed]}>
      <View style={[styles.iconWrap, { backgroundColor: bg }]}><Ionicons name={icon} size={28} color={color} /></View>
      <View style={styles.flex}>
        <Text style={styles.name}>{title}</Text>
        {tag ? <Text style={styles.tag}>{tag}</Text> : null}
        <Text style={styles.detail}>{detail}</Text>
        {grades ? <Text style={styles.grades}>{grades}</Text> : null}
      </View>
      {busy ? <ActivityIndicator color={t.accent} accessibilityLabel="Đang tải" />
        : onHowTo ? null : <Ionicons name="chevron-forward" size={22} color={t.muted} />}
    </Pressable>
  );
  if (!onHowTo) return main;
  return (
    <View style={[styles.card, styles.entryRow]}>
      {main}
      <Pressable onPress={onHowTo} accessibilityRole="button" accessibilityLabel={`Cách chơi ${howToLabel ?? title}`} hitSlop={4}
        style={({ pressed }) => [styles.howTo, pressed && styles.pressed]}>
        <Ionicons name="help-circle-outline" size={20} color={t.accent} />
        <Text style={styles.howToText}>Cách chơi</Text>
      </Pressable>
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 12,
    shadowColor: '#0B4F75', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  dimmed: { opacity: 0.5 },
  iconWrap: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '900', color: t.ink },
  grades: { fontSize: 12, fontWeight: '800', color: t.muted, marginTop: 4 },
  tag: { fontSize: 13, fontWeight: '800', color: t.accent, marginTop: 1 },
  detail: { fontSize: 14, color: t.muted, lineHeight: 20, marginTop: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  title: { fontSize: 23, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 14, color: t.muted, marginTop: 2 },
  history: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#FFFFFF' },
  historyText: { fontSize: 14, fontWeight: '800', color: t.accent },
  back: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  entryRow: { padding: 0, gap: 0, alignItems: 'stretch' },
  entryMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  howTo: { width: 66, alignItems: 'center', justifyContent: 'center', gap: 2, borderLeftWidth: 1, borderLeftColor: t.border, paddingHorizontal: 6 },
  howToText: { fontSize: 11, fontWeight: '800', color: t.accent, textAlign: 'center' },
  resume: { borderWidth: 2, borderColor: '#F2C46D', gap: 8, marginBottom: 12 },
  resumeRow: { flexDirection: 'row', gap: 8 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.dangerBg, borderRadius: 14, padding: 10, marginTop: -4, marginBottom: 12 },
  errorText: { flex: 1, color: t.danger, fontSize: 13, fontWeight: '700' },
  retry: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  retryText: { color: t.danger, fontWeight: '900' },
});
