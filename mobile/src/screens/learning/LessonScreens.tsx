import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, LayoutAnimation, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { learningApi } from '../../learning/api';
import { GAME_INFO } from '../../learning/labels';
import { currentLesson, filterLessons, focusLesson, GROUP_LABEL, journey, LessonCard, lessonCards, LessonFilter, newlyUnlocked, orderChanged,
  subjectProgress, unlockHint } from '../../learning/lessonOrder';
import type { CatalogLesson, GameId, LessonExplore, LessonGame, LessonProgramme, SubjectLessons, UnlockedContent, UnlockRequirement } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';
import { Button, Card, IconName, ProgressBar, Segmented } from '../../ui/kit';
import { useAtmosphere } from '../../world/atmosphere';
import { useWeather } from '../../world/weather';
import { BackHeader } from './GamePicker';
import { JourneySectionView, TrailBackdrop, TRAIL_SKY } from './JourneyMap';
import { gameLook, HeaderIcon, IconBadge, Look, themedLook } from './LearningUI';

// Học tập theo bài (backend lesson_api.py): Học tập → môn → bài → trò chơi → Cách chơi (lần đầu) → 3-2-1 → Chơi → Kết quả.
// A subject shows its lessons as a journey map (JourneyMap.tsx) or a list sorted by the learner's state
// (learning/lessonOrder.ts); a lesson shows its short content
// and its games. Every state comes from the backend; nothing is created there until a game starts.

function Failed({ error, onRetry }: { error: string; onRetry: () => void }) {
  const styles = useStyles();
  return <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} /></Card>;
}

// --- Môn học: một danh sách bài, sắp theo trạng thái ---------------------------------------------------------------------

/** What a subject screen leaves behind for the next visit: its last list and where it was scrolled, so coming back
 * from a lesson shows the list at once and moves only the cards whose state changed. */
export type SubjectSnapshot = { data: SubjectLessons; offset: number; view?: SubjectView };

/** The same lessons on a journey map (the curriculum's order) or as a list sorted by state. */
export type SubjectView = 'map' | 'list';

type LessonsProps = { code: string; onBack: () => void; onOpen: (key: string) => void;
  /** The subject's free-practice games (not by lesson), when it has some. */ onPractice?: () => void;
  /** The list of the last visit (this grade and school year). */ snapshot?: SubjectSnapshot | null;
  onLeave?: (snapshot: SubjectSnapshot) => void; reduceMotion?: boolean;
  /** The pet that walks the map. */ petId?: string; petLevel?: number;
  /** Chapters or lessons opened and not celebrated yet: the small notice. */ onUnlocked?: (news: UnlockedContent[]) => void };

/** Room left above a point brought into view, so it sits clear of the top and of the small notice at the bottom. */
const MAP_TOP_MARGIN = 150;
const VIEWS: { value: SubjectView; label: string }[] = [{ value: 'map', label: 'Bản đồ' }, { value: 'list', label: 'Danh sách' }];
const FILTERS: { value: LessonFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' }, { value: 'open', label: 'Đã mở' }, { value: 'locked', label: 'Chưa mở' }];

/** Cards that changed group slide to their new place (about 0.25 s) instead of the list being drawn again. */
function moveCards(reduceMotion?: boolean) {
  if (reduceMotion) return;
  try {
    LayoutAnimation.configureNext({ duration: 260, update: { type: 'easeInEaseOut' },
      create: { type: 'easeInEaseOut', property: 'opacity' }, delete: { type: 'easeInEaseOut', property: 'opacity' } });
  } catch { /* no layout animation here: the cards just take their place */ }
}

/** A subject: a small header (its icon, name and the learner's grade), its progress, then every lesson once: on the
 * journey map, or as a list with a filter, sorted by the learner's state (Đang học → Đã mở → Đã hoàn thành → Chưa mở, each
 * in the curriculum's order). */
export function SubjectLessonsScreen({ code, onBack, onOpen, onPractice, snapshot, onLeave, reduceMotion, petId, petLevel, onUnlocked }: LessonsProps) {
  const theme = useTheme();
  const { t } = theme;
  const styles = useStyles();
  const [data, setData] = useState<SubjectLessons | null>(snapshot?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LessonFilter>('all');
  const [view, setViewState] = useState<SubjectView>(snapshot?.view ?? 'map');
  const [hint, setHint] = useState<string | null>(null);
  const [glowing, setGlowing] = useState<Set<string>>(new Set());
  // The cards rise in only on a first visit, never when coming back or as the list scrolls.
  const [entering, setEntering] = useState(!snapshot);
  const latest = useRef<{ data: SubjectLessons | null; offset: number; view: SubjectView }>({ data: snapshot?.data ?? null, offset: snapshot?.offset ?? 0, view: snapshot?.view ?? 'map' });
  const restore = useRef(snapshot?.offset ?? 0);
  const list = useRef<FlatList<LessonCard>>(null);
  const map = useRef<ScrollView>(null);
  const { reading } = useWeather();
  const { night } = useAtmosphere(reading);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [headerHeight, setHeaderHeight] = useState(0);
  // Bringing a point of the map into view: its area's place in the map and its own place in the area.
  const placed = useRef({ areas: new Map<string, number>(), points: new Map<string, { area: string; y: number }>() });
  const focus = useRef<string | null>(null);
  const bringIntoView = useCallback(() => {
    const point = focus.current ? placed.current.points.get(focus.current) : undefined;
    const area = point ? placed.current.areas.get(point.area) : undefined;
    if (!point || area === undefined) return;
    focus.current = null;
    map.current?.scrollTo({ y: Math.max(0, area + point.y - MAP_TOP_MARGIN), animated: !reduceMotion });
  }, [reduceMotion]);
  const setView = (next: SubjectView) => {
    latest.current.view = next; latest.current.offset = 0;
    if (next === 'map' && latest.current.data) focus.current = currentLesson(journey(latest.current.data));
    setViewState(next);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const fresh = await learningApi.subjectLessons(code);
      const before = latest.current.data ? lessonCards(latest.current.data) : null;
      const after = lessonCards(fresh);
      if (before && orderChanged(before, after)) moveCards(reduceMotion);
      // What opened since the last list, or what the backend says has not been celebrated yet (a result lost on the way).
      const opened = [...(before ? newlyUnlocked(before, after) : []), ...after.filter((c) => c.celebrate).map((c) => c.id),
        ...fresh.chapters.filter((c) => c.celebrate).map((c) => c.key)];
      if (opened.length) setGlowing(new Set(opened));
      // What has just opened is brought into view, so its unlock is seen; a first visit starts where the learner is. Coming
      // back with nothing new, the map stays where it was left.
      if (opened.length || !before) focus.current = focusLesson(journey(fresh), opened);
      latest.current.data = fresh;
      setData(fresh);
      if (fresh.unlocked?.length) onUnlocked?.(fresh.unlocked);
    } catch (e) { setError(errorMessage(e)); }
  }, [code, reduceMotion, onUnlocked]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bringIntoView(); }, [data, bringIntoView]);
  useEffect(() => {
    if (!entering || !data) return;
    const done = setTimeout(() => setEntering(false), 700);
    return () => clearTimeout(done);
  }, [entering, data]);
  useEffect(() => () => { if (latest.current.data) onLeave?.({ data: latest.current.data, offset: latest.current.offset, view: latest.current.view }); }, [onLeave]);

  const cards = useMemo(() => (data ? lessonCards(data) : []), [data]);
  const shown = useMemo(() => filterLessons(cards, filter), [cards, filter]);
  const sections = useMemo(() => (data ? journey(data) : []), [data]);
  const current = useMemo(() => currentLesson(sections), [sections]);
  // Each area's first place on the path, which winds on across the chapters.
  const places = useMemo(() => {
    const out = new Map<string, number>();
    sections.reduce((place, s) => { out.set(s.key, place); return place + s.nodes.length; }, 0);
    return out;
  }, [sections]);
  const progress = data ? subjectProgress(data, cards) : null;
  const look: Look | null = data ? { icon: data.subject.icon as IconName, bg: data.subject.bg, color: data.subject.color } : null;

  const header = (
    <>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </Pressable>
        {look ? <IconBadge look={look} size={42} /> : null}
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>{data?.subject.name ?? 'Môn học'}</Text>
          {data ? <Text style={styles.small} numberOfLines={1}>{data.label}{data.academic_year_label ? ` · Năm học ${data.academic_year_label}` : ''}</Text> : null}
        </View>
        {onPractice ? <HeaderIcon icon="game-controller-outline" label="Trò chơi luyện tập" onPress={onPractice} /> : null}
      </View>
      {progress && progress.ready ? (
        <View style={styles.progress} accessible accessibilityLabel={`Tiến độ môn: ${progress.completed} trên ${progress.ready} bài hoàn thành`}>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{progress.completed}/{progress.ready} bài hoàn thành</Text>
            <Text style={styles.progressPercent}>{progress.percent}%</Text>
          </View>
          <ProgressBar value={progress.percent / 100} color={look ? themedLook(look, theme).color : t.success} />
        </View>
      ) : null}
      {data && cards.length ? <Segmented<SubjectView> options={VIEWS} value={view} onChange={setView} compact /> : null}
      {data && view === 'list' ? <Segmented<LessonFilter> options={FILTERS} value={filter} onChange={setFilter} compact /> : null}
      {data?.subject.practice_note ? <Text style={styles.note}>{data.subject.practice_note}</Text> : null}
      {error ? <Failed error={error} onRetry={() => void load()} /> : null}
      {!data && !error ? <ActivityIndicator color={t.accent} style={styles.loading} /> : null}
    </>
  );

  const restoreScroll = (to: { scrollToOffset: (o: { offset: number; animated: boolean }) => void } | null) => {
    // Back from a lesson: the map or list is where it was left, not at the top.
    if (!restore.current) return;
    to?.scrollToOffset({ offset: restore.current, animated: false });
    restore.current = 0;
  };
  const press = (card: LessonCard) => (card.unlocked ? onOpen(card.id) : setHint(hint === card.id ? null : card.id));

  if (view === 'map') {
    const toOffset = { scrollToOffset: ({ offset, animated }: { offset: number; animated: boolean }) => map.current?.scrollTo({ y: offset, animated }) };
    return (
      <ScrollView ref={map} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}
        onScroll={(e) => { latest.current.offset = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={64}
        onContentSizeChange={(width, height) => { setMapSize({ width, height }); restoreScroll(toOffset); }}>
        {/* The hillside the lessons stand on, behind everything under the header. */}
        {data && sections.length && mapSize.width ? <TrailBackdrop width={mapSize.width} top={headerHeight} height={mapSize.height - headerHeight} /> : null}
        <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>{header}</View>
        {data && sections.length ? <View style={{ height: TRAIL_SKY }} /> : null}
        {data && !sections.length ? <Text style={styles.empty}>Môn này đang được biên soạn bài học.</Text> : null}
        {sections.map((section) => (
          <View key={section.key} onLayout={(e) => { placed.current.areas.set(section.key, e.nativeEvent.layout.y); bringIntoView(); }}>
            <JourneySectionView section={section} firstPlace={places.get(section.key) ?? 0} look={look} current={current} opening={glowing} hint={hint}
              petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} night={night} onPress={press} onOpenRequirement={onOpen}
              onNodeLayout={(id, y) => { placed.current.points.set(id, { area: section.key, y }); bringIntoView(); }} />
          </View>
        ))}
      </ScrollView>
    );
  }
  return (
    <FlatList ref={list} data={shown} keyExtractor={(c) => c.id} ListHeaderComponent={header}
      contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} initialNumToRender={12} windowSize={9}
      ListEmptyComponent={data ? <Text style={styles.empty}>{filter === 'locked' ? 'Bạn đã mở mọi bài của môn này.'
        : filter === 'open' ? 'Chưa có bài nào được mở.' : 'Môn này đang được biên soạn bài học.'}</Text> : null}
      onScroll={(e) => { latest.current.offset = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={64}
      onContentSizeChange={() => restoreScroll(list.current)}
      renderItem={({ item, index }) => (
        <LessonCardView card={item} index={index} entering={entering} reduceMotion={reduceMotion} glow={glowing.has(item.id)}
          hint={hint === item.id} onPress={() => press(item)}
          onOpenRequirement={onOpen} />
      )} />
  );
}

const CARD_LOOK: Record<LessonCard['group'], Look> = {
  in_progress: { icon: 'play', color: '#B86A00', bg: '#FFF1D6', tone: 'sun' },
  unlocked: { icon: 'book-outline', color: '#136FA8', bg: '#DDF0FA', tone: 'sky' },
  completed: { icon: 'checkmark', color: '#17704F', bg: '#E1F6EC', tone: 'leaf' },
  locked: { icon: 'lock-closed', color: '#7A8D9E', bg: '#EEF2F5', tone: 'neutral' },
};

type CardProps = { card: LessonCard; index: number; entering: boolean; reduceMotion?: boolean; glow: boolean; hint: boolean;
  onPress: () => void; onOpenRequirement: (key: string) => void };

/** One lesson: its state as an icon, its title, its chapter and its state in words (a bar while being studied). A
 * locked one is neutral and, when tapped, says how it opens. Rises in on a first visit; glows once when it opens. */
function LessonCardView({ card, index, entering, reduceMotion, glow, hint, onPress, onOpenRequirement }: CardProps) {
  const theme = useTheme();
  const { t } = theme;
  const styles = useStyles();
  const style = themedLook(card.planned ? { ...CARD_LOOK.locked, icon: 'time-outline' as IconName } : CARD_LOOK[card.group], theme);
  const label = card.planned ? 'Sắp có' : GROUP_LABEL[card.group];
  const animate = entering && !reduceMotion;
  const shown = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const light = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const a = Animated.timing(shown, { toValue: 1, duration: 240, delay: Math.min(index, 8) * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the card first appears
  useEffect(() => {
    if (!glow || reduceMotion) return;
    const a = Animated.sequence([Animated.timing(light, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(light, { toValue: 0, duration: 900, delay: 150, useNativeDriver: true })]);
    a.start();
    return () => a.stop();
  }, [glow, reduceMotion, light]);
  const pending = card.requirements.filter((r): r is Extract<UnlockRequirement, { type: 'lesson' }> => r.type === 'lesson' && !r.done);
  return (
    <Animated.View style={[styles.card, { opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, { opacity: light }]} />
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: card.unlocked ? undefined : hint }}
        accessibilityLabel={`${card.title}. ${card.chapterTitle}. ${label}${card.progress === 'in_progress' ? `, ${card.percent}%` : ''}`}
        accessibilityHint={card.unlocked ? (card.group === 'completed' ? 'Mở lại để ôn tập' : 'Mở bài học') : 'Xem điều kiện mở bài'}
        style={({ pressed }) => [styles.cardMain, pressed && styles.rowPressed]}>
        <View style={[styles.state, { backgroundColor: style.bg }]}><Ionicons name={style.icon} size={18} color={style.color} /></View>
        <View style={styles.flex}>
          <Text style={[styles.cardTitle, !card.unlocked && styles.lockedText]} numberOfLines={2}>{card.title}</Text>
          <Text style={styles.chapter} numberOfLines={1}>{card.chapterTitle}</Text>
          {card.group === 'in_progress' ? (
            <View style={styles.cardBar}><ProgressBar value={card.percent / 100} color="#E39A2D" /></View>
          ) : null}
        </View>
        <Text style={[styles.cardState, { color: style.color }]}>{label}</Text>
      </Pressable>
      {hint && !card.unlocked ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Text style={styles.hintText}>{unlockHint(card)}</Text>
          {pending.map((r) => (
            <Pressable key={r.lesson_id} onPress={() => onOpenRequirement(r.lesson_id)} accessibilityRole="button"
              accessibilityLabel={`Mở bài ${r.title}`} hitSlop={6} style={styles.hintLink}>
              <Text style={styles.hintLinkText}>Mở bài “{r.title}”</Text>
              <Ionicons name="arrow-forward" size={14} color={t.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

// --- Bài học: nội dung ngắn → chọn trò chơi → Bắt đầu --------------------------------------------------------------------

type LessonProps = { lessonKey: string; onBack: () => void; onPlay: (lesson: CatalogLesson, game: LessonGame) => void;
  onResume: (sessionId: number) => void; onHowTo: (game: GameId) => void; onOpenLesson: (key: string) => void;
  /** A game is being started (its id): the buttons wait. */ starting: GameId | null;
  /** Personal notes on this lesson ("Ghi chú"), when offered: a small icon beside the title. */ onNote?: () => void;
  /** A vocabulary game with no new word left: "Ôn tập từ đã học" instead of "Chơi lại". */ onReview?: (game: LessonGame) => void };

/** The game picked first: one left open, else the first not passed yet, else the first that can be played. */
function firstGame(games: LessonGame[]): LessonGame | undefined {
  const playable = games.filter((g) => g.playable);
  return games.find((g) => g.progress.open_session) ?? playable.find((g) => !g.progress.passed) ?? playable[0] ?? games[0];
}

/** One lesson: its short content (examples folded), the games that practise it, and one button to play the game picked. */
export function LessonScreen({ lessonKey, onBack, onPlay, onResume, onHowTo, onOpenLesson, starting, onNote, onReview }: LessonProps) {
  const { t } = useTheme();
  const styles = useStyles();
  const [lesson, setLesson] = useState<CatalogLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [picked, setPicked] = useState<GameId | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setLesson(await learningApi.lessonDetail(lessonKey)); } catch (e) { setError(errorMessage(e)); }
  }, [lessonKey]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <><BackHeader title="Bài học" onBack={onBack} /><Failed error={error} onRetry={() => void load()} /></>;
  if (!lesson) return <><BackHeader title="Bài học" onBack={onBack} /><ActivityIndicator color={t.accent} style={styles.loading} /></>;
  const game = lesson.games.find((g) => g.game === picked) ?? firstGame(lesson.games);
  const open = game?.progress.open_session ?? null;
  return (
    <>
      <BackHeader title={lesson.title} subtitle={lesson.subject.name} onBack={onBack}
        right={onNote ? <HeaderIcon icon="create-outline" label="Ghi chú" onPress={onNote} /> : null} />
      {lesson.summary.length || lesson.examples.length ? (
        <Card style={styles.content}>
          {lesson.summary.map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
          {lesson.examples.length ? (
            <Pressable onPress={() => setExamplesOpen((x) => !x)} accessibilityRole="button" accessibilityState={{ expanded: examplesOpen }}
              hitSlop={6} style={styles.examplesToggle}>
              <Text style={styles.examplesToggleText}>{examplesOpen ? 'Ẩn ví dụ' : `Xem ví dụ (${lesson.examples.length})`}</Text>
              <Ionicons name={examplesOpen ? 'chevron-up' : 'chevron-down'} size={16} color={t.accent} />
            </Pressable>
          ) : null}
          {examplesOpen ? lesson.examples.map((ex) => (
            <View key={ex.title} style={styles.example}>
              <Text style={styles.exampleTitle}>{ex.title}</Text>
              {ex.lines.map((line, i) => <Text key={i} style={styles.body}>{line}</Text>)}
            </View>
          )) : null}
        </Card>
      ) : null}
      {lesson.practice_note ? <Text style={styles.note}>{lesson.practice_note}</Text> : null}
      {lesson.locked ? (
        <View style={styles.locked}>
          <Text style={styles.lockedTitle}>🔒 {lesson.requires_note ?? 'Cần học bài trước'}</Text>
          {lesson.requires.filter((r) => !r.done).map((r) => (
            <Button key={r.key} title={`Mở bài: ${r.title}`} variant="secondary" icon="arrow-forward" onPress={() => onOpenLesson(r.key)} />
          ))}
        </View>
      ) : null}
      {lesson.games.length ? <Text style={styles.section} accessibilityRole="header">Chọn trò chơi</Text>
        : <Text style={styles.muted}>Bài này chưa có trò chơi.</Text>}
      <View accessibilityRole="radiogroup" style={styles.games}>
        {lesson.games.map((g) => (
          <View key={g.game} style={styles.gameCell}>
            <GameOption game={g} selected={g.game === game?.game} onPress={() => setPicked(g.game)} />
          </View>
        ))}
      </View>
      {game ? <Text style={styles.gameDetail} numberOfLines={2}>{gameDetail(game)}</Text> : null}
      {game?.explore ? <Text style={styles.explore}>{exploreLine(game.explore)}</Text> : null}
      {game ? (
        <View style={styles.actions}>
          {open ? (
            <Button title="Tiếp tục" icon="play" style={styles.flex} disabled={!!starting} onPress={() => onResume(open)} />
          ) : game.explore?.exhausted && game.progress.passed && onReview ? (
            <Button title="Ôn tập từ đã học" icon="refresh-circle-outline" style={styles.flex} loading={starting === game.game}
              disabled={lesson.locked || !!starting} onPress={() => onReview(game)} />
          ) : (
            // Not passed yet with no new word left: the backend plays the lesson's own words, which can still pass the game.
            <Button title={game.explore?.exhausted ? 'Ôn tập từ của bài' : game.progress.stages ? 'Chơi lại' : 'Bắt đầu'} icon="play" style={styles.flex} loading={starting === game.game}
              disabled={lesson.locked || !game.playable || !!starting} onPress={() => onPlay(lesson, game)} />
          )}
          <Pressable onPress={() => onHowTo(game.game)} accessibilityRole="button" accessibilityLabel={`Cách chơi ${game.title}`} hitSlop={6}
            style={({ pressed }) => [styles.howTo, pressed && styles.pressed]}>
            <Ionicons name="help-circle-outline" size={24} color={t.accent} />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const gameDetail = (game: LessonGame) => (game.playable ? GAME_INFO[game.game]?.detail ?? game.gameplay : 'Đang cập nhật, chưa chơi được.');

/** One line on Khám phá từ mới: the lesson's own words, then how many new words its game can still bring. */
export function exploreLine(e: LessonExplore): string {
  if (e.exhausted) return 'Bạn đã khám phá hết từ mới phù hợp trong trò này. Ôn tập để nhớ thật lâu nhé!';
  const beyond = Math.max(0, e.new_words_left - (e.core_total - e.core_discovered));
  if (!e.core_completed) return `Từ của bài: ${e.core_discovered}/${e.core_total} · sau đó còn ${beyond} từ mới cùng chủ đề`;
  return `Đã khám phá hết ${e.core_total} từ của bài · còn ${beyond} từ mới cùng chủ đề để khám phá`;
}

/** A game of the lesson as a small card: its picture and name (a tick once passed). Its one line on how it plays is
 * shown under the cards for the game picked. */
function GameOption({ game, selected, onPress }: { game: LessonGame; selected: boolean; onPress: () => void }) {
  const { t } = useTheme();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }}
      accessibilityLabel={`${game.title}. ${gameDetail(game)}${game.progress.passed ? ' Đã đạt.' : ''}`}
      style={({ pressed }) => [styles.option, selected && styles.optionOn, !game.playable && styles.faded, pressed && styles.pressed]}>
      <IconBadge look={gameLook(game.game)} size={48} />
      <Text style={styles.optionTitle} numberOfLines={2}>{game.title}</Text>
      {game.progress.passed ? <Ionicons name="checkmark-circle" size={18} color={t.success} style={styles.passed} /> : null}
    </Pressable>
  );
}

// --- Môn lựa chọn (THPT) ---------------------------------------------------------------------------------------------------

/** THPT: the elective subjects the learner studies, chosen here (they then appear among the subjects of Học tập). */
export function ElectivesScreen({ programme, onBack, onChange }: { programme: LessonProgramme | null; onBack: () => void;
  onChange: (chosen: string[]) => void }) {
  const { t } = useTheme();
  const styles = useStyles();
  const selection = programme?.selection ?? null;
  const chosen = new Set(selection?.chosen ?? []);
  const toggle = (code: string) => {
    if (!selection) return;
    const next = chosen.has(code) ? [...chosen].filter((c) => c !== code) : chosen.size < selection.count ? [...chosen, code] : null;
    if (next) onChange(next);
  };
  return (
    <>
      <BackHeader title="Môn lựa chọn" subtitle={selection ? `Đã chọn ${chosen.size}/${selection.count}` : undefined} onBack={onBack} />
      {selection ? <Text style={styles.note}>{selection.note}</Text> : <ActivityIndicator color={t.accent} style={styles.loading} />}
      <View style={styles.chips}>
        {programme?.subjects.filter((s) => selection?.available.includes(s.code)).map((s) => {
          const on = chosen.has(s.code);
          const full = !on && chosen.size >= (selection?.count ?? 0);
          return (
            <Pressable key={s.code} onPress={() => toggle(s.code)} disabled={full} accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: full }} accessibilityLabel={s.name}
              style={[styles.chip, on && styles.chipOn, full && styles.faded]}>
              {on ? <Ionicons name="checkmark" size={16} color={t.onPrimary} /> : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  flex: { flex: 1 },
  loading: { marginVertical: 12 },
  error: { color: t.danger, fontWeight: '700', marginBottom: 8 },
  muted: { color: t.muted, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  small: { color: t.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  note: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  rowPressed: { backgroundColor: t.bg },
  faded: { opacity: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, fontWeight: '900', color: t.ink },
  progress: { gap: 6, marginBottom: 14 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressText: { fontSize: 13, fontWeight: '700', color: t.muted },
  progressPercent: { fontSize: 13, fontWeight: '900', color: t.ink },
  listContent: { paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 760, alignSelf: 'center' },
  empty: { color: t.muted, fontSize: 14, textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: t.card, borderRadius: 16, marginBottom: 8, overflow: 'hidden',
    shadowColor: t.shadow, shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  glow: { backgroundColor: dark ? 'rgba(255,214,102,0.22)' : '#FFF2B8', borderRadius: 16 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10 },
  state: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: t.ink, lineHeight: 20 },
  lockedText: { color: t.placeholder },
  chapter: { fontSize: 12, color: t.muted, marginTop: 1 },
  cardBar: { marginTop: 6, maxWidth: 160 },
  cardState: { fontSize: 12, fontWeight: '800', maxWidth: 92, textAlign: 'right' },
  hint: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2, marginLeft: 46, gap: 6 },
  hintText: { fontSize: 13, color: t.muted, lineHeight: 18 },
  hintLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 28 },
  hintLinkText: { fontSize: 13, fontWeight: '800', color: t.accent },
  content: { gap: 4, padding: 16 },
  body: { fontSize: 15, color: t.ink, lineHeight: 22 },
  examplesToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32, marginTop: 4 },
  examplesToggleText: { fontSize: 14, fontWeight: '800', color: t.accent },
  example: { borderLeftWidth: 3, borderLeftColor: t.tint, paddingLeft: 10, marginTop: 6 },
  exampleTitle: { fontSize: 13, fontWeight: '900', color: t.accent, marginBottom: 2 },
  locked: { backgroundColor: t.warningBg, borderRadius: 16, padding: 14, marginBottom: 14 },
  lockedTitle: { fontSize: 14, fontWeight: '800', color: t.warning, lineHeight: 20 },
  section: { fontSize: 17, fontWeight: '900', color: t.ink, marginTop: 4, marginBottom: 10 },
  games: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  gameCell: { width: '50%', padding: 5 },
  option: { alignItems: 'center', gap: 8, backgroundColor: t.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 10, minHeight: 112,
    borderWidth: 2, borderColor: 'transparent' },
  optionOn: { borderColor: t.inputFocus, backgroundColor: t.surfaceSecondary },
  optionTitle: { fontSize: 14, fontWeight: '900', color: t.ink, textAlign: 'center', lineHeight: 18 },
  passed: { position: 'absolute', top: 8, right: 8 },
  gameDetail: { fontSize: 13, color: t.muted, lineHeight: 18, marginTop: 6 },
  explore: { fontSize: 13, fontWeight: '700', color: t.accent, lineHeight: 18, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 4 },
  howTo: { width: 50, height: 50, borderRadius: 16, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.card },
  chipOn: { backgroundColor: t.accentFill },
  chipText: { fontSize: 14, fontWeight: '800', color: t.ink },
  chipTextOn: { color: t.onPrimary },
}));
