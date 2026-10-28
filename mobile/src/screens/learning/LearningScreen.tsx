import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { newIdempotencyKey } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { errorMessage } from '../../auth/messages';
import { learningApi } from '../../learning/api';
import { useLearningPrefs } from '../../learning/prefs';
import { groupOf, PLAY_MODE, QUICK_GAMES, QUICK_LESSONS } from '../../learning/labels';
import { useTutorials } from '../../learning/tutorials';
import type { Catalog, GameGroupId, GameId, LearningSession, StartOptions, SubjectCode } from '../../learning/types';
import { useConfirm } from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/Toast';
import { GamePicker } from './GamePicker';
import { GameScreen } from './GameScreen';
import { GameSetup, SetupPreset } from './GameSetup';
import { GameTutorial } from './GameTutorial';
import { LessonIntro } from './LessonIntro';
import { ResultScreen } from './ResultScreen';
import { ReviewScreen } from './ReviewScreen';
import { FIRST_VIEW, PractiseGame, VocabHistoryScreen, VocabView, VocabWordScreen } from './VocabHistoryScreen';
import { FocusInProgress, SubjectPicker } from './SubjectPicker';

type Route =
  | { name: 'subjects' }
  | { name: 'games'; subject: SubjectCode; group?: GameGroupId }
  | { name: 'setup'; subject: SubjectCode; game: GameId; preset?: SetupPreset }
  | { name: 'intro'; session: LearningSession }
  /** A game's guide ("Cách chơi"). "Bắt đầu" finishes it and runs `onStart`; closing runs `onClose`. */
  | { name: 'tutorial'; game: GameId; onStart: () => void; onClose: () => void }
  | { name: 'game'; session: LearningSession; autoStart: boolean }
  | { name: 'result'; sessionId: number }
  | { name: 'review' }
  | { name: 'vocab' }
  | { name: 'vocabWord'; entryKey: string };

type Props = {
  user: User;
  /** The focus timer's length, offered as the default session length. */
  defaultDuration: number;
  /** The "Học tự chọn" timer, while one is under way. */
  focus: FocusInProgress | null;
  /** "Học tự chọn": the personal focus space (timer, sounds, study tools). */
  onFreeStudy: () => void;
  /** EXP or level may have changed: reload the dashboard numbers. */
  onRewards: () => void;
  /** True while a game is on screen (the main tab bar steps aside). */
  onImmersiveChange?: (immersive: boolean) => void;
  /** Personal study / Study Together switch, shown on the subject screen. */
  modeSwitch?: React.ReactNode;
};

const subjectOf = (s: LearningSession) => s.subject.code as SubjectCode;

/** The game list a setup screen returns to: the game's group (e.g. "Từ vựng") or the subject's list. */
const gamesOf = (subject: SubjectCode, game: GameId): Route => ({ name: 'games', subject, group: groupOf(game) });

/** "Học tập": subject → game → play, every game in Học tập (there is no separate "Thử thách" any more). English games
 * start at once ("Chơi ngay": the backend picks the words or questions from the user's progress); Math games go through
 * their setup and lesson first. Then result → review. The first time a game is played, its guide comes first
 * ("Cách chơi"; before the session exists when the game is known in advance, or with the session still paused).
 * Only a tap on an English game or "Bắt đầu" creates a session, one at a time; the backend keeps it, so leaving and
 * coming back (or another device) offers to continue it. */
export function LearningScreen({ user, defaultDuration, focus, onFreeStudy, onRewards, onImmersiveChange, modeSwitch }: Props) {
  const [route, setRoute] = useState<Route>({ name: 'subjects' });
  const [busy, setBusy] = useState<'start' | number | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<LearningSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const prefs = useLearningPrefs(user.id);
  const tutorials = useTutorials(user.id);
  const toast = useToast();
  const confirm = useConfirm();
  const startKey = useRef<string | null>(null);
  const playKey = useRef<{ game: GameId; key: string } | null>(null);
  const [starting, setStarting] = useState<GameId | null>(null);
  const [playError, setPlayError] = useState<{ game: GameId; message: string } | null>(null);
  // A session is being created: further taps (a game, "Bắt đầu", "Luyện lại") wait, so one tap makes one session.
  const launching = useRef(false);
  const home = useCallback(() => setRoute({ name: 'subjects' }), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c, open] = await Promise.all([learningApi.catalog(), learningApi.current()]);
      setCatalog(c); setCurrent(open);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, []);
  // Fresh review counts and open session whenever the subject screen is shown.
  useEffect(() => { if (route.name === 'subjects') void load(); }, [route.name, load]);

  useEffect(() => {
    onImmersiveChange?.(route.name === 'game');
    return () => onImmersiveChange?.(false);
  }, [route.name, onImmersiveChange]);

  // Android back steps back one screen. The game handles it itself (pause, then continue or end), the intro has its
  // own close, and the subject screen is the root of the tab.
  useEffect(() => {
    if (route.name === 'game' || route.name === 'intro' || route.name === 'subjects') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'tutorial') route.onClose();
      else if (route.name === 'setup') setRoute(gamesOf(route.subject, route.game));
      else if (route.name === 'vocabWord') setRoute({ name: 'vocab' });
      else if (route.name === 'vocab') setRoute({ name: 'games', subject: 'english' });
      else if (route.name === 'games' && route.group) setRoute({ name: 'games', subject: route.subject });
      else setRoute({ name: 'subjects' });
      return true;
    });
    return () => sub.remove();
  }, [route]);

  /** Runs one session-creating request at a time: a second tap while one is on its way does nothing. */
  const launch = useCallback(async <T,>(create: () => Promise<T>): Promise<T | null> => {
    if (launching.current) return null;
    launching.current = true;
    try { return await create(); } finally { launching.current = false; }
  }, []);

  /** The first time a game is played, its guide comes first: "Bắt đầu" finishes it and runs `begin`, closing it goes
   * `back`. Afterwards `begin` runs at once. */
  const withGuide = useCallback((game: GameId, begin: () => void, back: () => void) => {
    if (!tutorials.needs(game)) { begin(); return; }
    setRoute({ name: 'tutorial', game, onStart: () => { tutorials.finish(game); begin(); }, onClose: back });
  }, [tutorials]);

  const start = useCallback(async (options: StartOptions) => {
    // One key per "Bắt đầu" tap: a retry after a timeout returns the same session instead of creating another.
    startKey.current ??= newIdempotencyKey();
    setBusy('start');
    try {
      const s = await launch(() => learningApi.start({ ...options, mode: PLAY_MODE }, startKey.current!));
      if (s) { setRoute({ name: 'intro', session: s }); startKey.current = null; }
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  }, [toast, launch]);

  /** "Chơi ngay": one tap on an English game starts it (countdown, then play). False if it could not start. */
  const play = useCallback(async (game: GameId): Promise<boolean> => {
    if (launching.current) return false;
    // One key per tap on a game: a retry after a timeout returns the same session instead of creating another.
    if (playKey.current?.game !== game) playKey.current = { game, key: newIdempotencyKey() };
    const key = playKey.current.key;
    setStarting(game); setPlayError(null);
    try {
      const s = await launch(() => learningApi.play(game, PLAY_MODE, key));
      if (!s) return false;
      playKey.current = null;
      setRoute({ name: 'game', session: s, autoStart: true });
      return true;
    } catch (e) { setPlayError({ game, message: errorMessage(e) }); return false; }
    finally { setStarting(null); }
  }, [launch]);

  /** An English game from its list: the guide first time, then "Chơi ngay". A failed start shows why on the list. */
  const quickPlay = useCallback((game: GameId) => {
    const list = gamesOf('english', game);
    withGuide(game, () => { void play(game).then((ok) => { if (!ok) setRoute(list); }); }, () => setRoute(list));
  }, [withGuide, play]);

  /** A paused session ready to play: the guide first if this game's was never finished, then the countdown. */
  const playSession = useCallback((s: LearningSession, back: () => void) => {
    withGuide(s.game, () => setRoute({ name: 'game', session: s, autoStart: true }), back);
  }, [withGuide]);

  const practise = useCallback(async (topicId: number) => {
    setBusy(topicId);
    try {
      // Created paused: its game is only known now, so a first-time guide is shown with nothing running behind it.
      const s = await launch(() => learningApi.startReview(topicId, PLAY_MODE));
      if (s) playSession(s, () => { void learningApi.abandon(s.id).catch(() => {}); setRoute({ name: 'review' }); });
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(null); }
  }, [toast, launch, playSession]);

  // "Luyện lại" from "Từ đã học": a review stage of the chosen words (or every "Cần ôn" word) in an existing game.
  const [practisingWords, setPractisingWords] = useState(false);
  const [vocabView, setVocabView] = useState<VocabView>(FIRST_VIEW); // page, filter and search, kept while a word is open
  const scroll = useRef<ScrollView>(null);
  const wordStages = useRef(new Set<number>());
  const practiseWordsNow = useCallback(async (game: PractiseGame, entryKeys: string[] | null): Promise<boolean> => {
    setPractisingWords(true);
    try {
      const s = await launch(() => learningApi.practiseWords(game, entryKeys));
      if (!s) return false;
      wordStages.current.add(s.id);
      setRoute({ name: 'game', session: s, autoStart: true });
      return true;
    } catch (e) { toast(errorMessage(e), 'error'); return false; }
    finally { setPractisingWords(false); }
  }, [toast, launch]);
  const practiseWords = (game: PractiseGame, entryKeys: string[] | null) => {
    const here = route;
    withGuide(game, () => { void practiseWordsNow(game, entryKeys).then((ok) => { if (!ok) setRoute(here); }); }, () => setRoute(here));
  };

  const replay = (s: LearningSession) => {
    if (wordStages.current.has(s.id)) { setRoute({ name: 'vocab' }); return; } // pick the words again, with fresh results
    if (s.kind === 'review') { void practise(s.topic.id); return; }
    if (QUICK_GAMES.has(s.game) && QUICK_LESSONS.has(s.lesson.code)) { setRoute(gamesOf('english', s.game)); quickPlay(s.game); return; }
    // A stage first played as "Thử thách" is played again in Học tập (start() always sends it).
    void start({ lessonId: s.lesson.id, mode: PLAY_MODE, durationMinutes: Math.min(60, Math.round(s.duration_seconds / 60)), variant: s.variant });
  };

  /** "Cách chơi" from a game list: the guide again; "Bắt đầu" plays (or opens the setup) as a tap on the game does. */
  const howTo = (game: GameId) => {
    const here = route;
    const begin = QUICK_GAMES.has(game)
      ? () => { void play(game).then((ok) => { if (!ok) setRoute(here); }); }
      : () => setRoute({ name: 'setup', subject: here.name === 'games' ? here.subject : 'math', game });
    setRoute({ name: 'tutorial', game, onStart: () => { tutorials.finish(game); begin(); }, onClose: () => setRoute(here) });
  };

  const discard = async () => {
    if (!current) return;
    const ok = await confirm({ title: 'Bỏ phiên đang dở?', message: 'Tiến độ đã làm vẫn được lưu, nhưng phiên này sẽ không nhận thưởng.',
      confirmLabel: 'Bỏ phiên', cancelLabel: 'Giữ lại', destructive: true, icon: 'trash-outline' });
    if (!ok) return;
    try { await learningApi.abandon(current.id); setCurrent(null); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  // Choosing a subject loads the open session too, so the game list knows whether one has to be finished first.
  useEffect(() => { if (route.name === 'games') void learningApi.current().then(setCurrent).catch(() => {}); }, [route.name]);

  if (route.name === 'game') {
    return (
      <View style={styles.game}>
        <GameScreen key={route.session.id} initial={route.session} autoStart={route.autoStart} petId={user.pet} petLevel={user.level}
          prefs={prefs} onEnded={(s) => setRoute({ name: 'result', sessionId: s.id })} />
      </View>
    );
  }
  const resume = (session: LearningSession) => setRoute({ name: 'game', session, autoStart: false });
  return (
    <ScrollView ref={scroll} key={route.name} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {route.name === 'subjects' ? (
        <SubjectPicker catalog={catalog} error={loadError} onRetry={() => void load()} current={current} focus={focus}
          onResume={resume} onDiscard={() => void discard()} onOpenReview={() => setRoute({ name: 'review' })} modeSwitch={modeSwitch}
          onChoose={(choice) => (choice === 'free' ? onFreeStudy() : setRoute({ name: 'games', subject: choice }))} />
      ) : null}
      {route.name === 'games' ? (
        <GamePicker key={route.group ?? route.subject} subject={route.subject} group={route.group} catalog={catalog}
          onBack={route.group ? () => setRoute({ name: 'games', subject: route.subject }) : home}
          onOpenGroup={(group) => setRoute({ name: 'games', subject: route.subject, group })}
          onPick={(game) => setRoute({ name: 'setup', subject: route.subject, game })} onHowTo={howTo}
          onOpenHistory={route.subject === 'english' && !route.group ? () => { setVocabView(FIRST_VIEW); setRoute({ name: 'vocab' }); } : undefined}
          quick={{ onPlay: quickPlay, starting, error: playError, current, onResume: resume, onDiscard: () => void discard() }} />
      ) : null}
      {route.name === 'setup' ? (
        <GameSetup key={`${route.subject}.${route.game}`} subject={route.subject} game={route.game} catalog={catalog} error={loadError}
          onRetry={() => void load()} defaultDuration={defaultDuration} preset={route.preset} current={current} starting={busy === 'start'}
          onBack={() => setRoute(gamesOf(route.subject, route.game))} onStart={(o) => void start(o)} onResume={resume} />
      ) : null}
      {route.name === 'intro' ? (
        <LessonIntro session={route.session} prefs={prefs}
          onBack={() => {
            const s = route.session;
            setRoute({ name: 'setup', subject: subjectOf(s), game: s.game,
              preset: { topicId: s.topic.id, levelId: s.level.id, durationMinutes: Math.round(s.duration_seconds / 60) } });
          }}
          onPlay={() => { const s = route.session; playSession(s, () => setRoute({ name: 'intro', session: s })); }} />
      ) : null}
      {route.name === 'tutorial' ? (
        <GameTutorial key={route.game} game={route.game} petId={user.pet} petLevel={user.level} reduceMotion={prefs.reduceMotion}
          busy={starting === route.game || practisingWords || busy !== null} onFinish={route.onStart} onClose={route.onClose} />
      ) : null}
      {route.name === 'result' ? (
        <ResultScreen sessionId={route.sessionId} petId={user.pet} petLevel={user.level} onReplay={replay}
          onReview={(topicId) => void practise(topicId)} onHome={home} onRewards={onRewards} />
      ) : null}
      {route.name === 'vocab' ? (
        <VocabHistoryScreen view={vocabView} onViewChange={setVocabView} onPageChange={() => scroll.current?.scrollTo({ y: 0, animated: false })}
          onBack={() => setRoute({ name: 'games', subject: 'english' })} onOpen={(entryKey) => setRoute({ name: 'vocabWord', entryKey })}
          onPractise={(game, keys) => void practiseWords(game, keys)} practising={practisingWords} />
      ) : null}
      {route.name === 'vocabWord' ? (
        <VocabWordScreen key={route.entryKey} entryKey={route.entryKey} onBack={() => setRoute({ name: 'vocab' })}
          onPractise={(game, keys) => void practiseWords(game, keys)} practising={practisingWords} />
      ) : null}
      {route.name === 'review' ? <ReviewScreen onBack={home} onPractice={(id) => void practise(id)} busyTopicId={typeof busy === 'number' ? busy : null} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 760, alignSelf: 'center' },
  game: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
});
