import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { newIdempotencyKey } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { errorMessage } from '../../auth/messages';
import { learningApi } from '../../learning/api';
import { educationApi, useEducation } from '../../learning/education';
import { useLearningPrefs } from '../../learning/prefs';
import { groupOf, isCurriculumGame, PLAY_MODE, QUICK_GAMES, QUICK_LESSONS, subjectOfGame } from '../../learning/labels';
import { useTutorialProgress } from '../../learning/tutorial/progress';
import type { Band, Catalog, CatalogLesson, FreeLevel, GameGroupId, GameId, LearningSession, LessonGame, LessonProgramme, StartOptions,
  SubjectCode, UnlockedContent, VocabCelebrationInfo, VocabGame, VocabPlay, VocabProgress } from '../../learning/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfirm } from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/Toast';
import { GamePicker } from './GamePicker';
import { GameScreen } from './GameScreen';
import { GameSetup, SetupPreset } from './GameSetup';
import { InteractiveTutorial } from './tutorial/InteractiveTutorial';
import { LessonIntro } from './LessonIntro';
import { ResultScreen } from './ResultScreen';
import { ReviewScreen } from './ReviewScreen';
import { FIRST_VIEW, PractiseGame, VocabHistoryScreen, VocabView, VocabWordScreen } from './VocabHistoryScreen';
import { FocusInProgress, PRACTICE_ALIAS, SubjectPicker } from './SubjectPicker';
import { ElectivesScreen, LessonScreen, SubjectLessonsScreen, type SubjectSnapshot } from './LessonScreens';
import { PageIn } from './LearningUI';
import { ArchiveLessonScreen, ArchiveListScreen, ArchiveYearScreen, NotebookScreen } from './ArchiveScreens';
import type { NoteDraft } from './NotesScreen';
import { PromotionCelebration } from './PromotionCelebration';
import { UnlockNotice } from './UnlockNotice';
import { VocabCelebration } from './VocabExtras';
import { StudyProfileForm } from '../main/StudyProfileScreen';
import { request } from '../main/shared';

type Route =
  | { name: 'subjects' }
  /** Học tập theo bài: a subject's lessons at the learner's grade, then one lesson (`back`: where it was opened from). */
  | { name: 'lessons'; subject: string }
  | { name: 'lesson'; key: string; back: Route }
  /** THPT: the elective subjects studied. */
  | { name: 'electives' }
  /** A subject's free-practice games (`back`: the subject's lessons when opened from there). */
  | { name: 'games'; subject: SubjectCode; group?: GameGroupId; back?: Route }
  | { name: 'setup'; subject: SubjectCode; game: GameId; preset?: SetupPreset }
  | { name: 'intro'; session: LearningSession }
  /** A game's interactive tutorial, played in the game itself. "Bắt đầu chơi" (or "Bỏ qua") runs `onStart`; leaving runs
   * `onClose`. The tutorial records itself (completed or skipped). */
  | { name: 'tutorial'; game: GameId; onStart: () => void; onClose: () => void }
  | { name: 'game'; session: LearningSession; autoStart: boolean }
  | { name: 'result'; sessionId: number; game?: GameId }
  | { name: 'review' }
  | { name: 'vocab' }
  | { name: 'vocabWord'; entryKey: string }
  /** Kho lưu trữ học tập: the finished school years, one of them, and one of its lessons (read and review only). */
  | { name: 'archive' }
  | { name: 'archiveYear'; year: number }
  | { name: 'archiveLesson'; year: number; key: string }
  /** Sổ tay kiến thức of the current school year. */
  | { name: 'notebook'; draft?: NoteDraft & { lessonTitle?: string } };

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
  /** Age and grade were saved (asked here once when the account has none; the grade is then locked). */
  onUserUpdated?: (user: User) => void;
};

const subjectOf = (s: LearningSession) => s.subject.code as SubjectCode;
const VOCAB_GAMES: VocabGame[] = ['meteor', 'word_shooter'];
const isVocabGame = (game: GameId | undefined): game is VocabGame => game === 'meteor' || game === 'word_shooter';
/** A stage of the vocabulary bank (Khám phá or Ôn tập from the game list), not a lesson's own words nor "Luyện lại". */
const isBankStage = (s: LearningSession) => isVocabGame(s.game) && !s.catalog && s.kind !== 'archive' && s.lesson.code.startsWith('en.');

/** The game list a setup screen returns to: the game's group (e.g. "Từ vựng") or the subject's list. */
const gamesOf = (subject: SubjectCode, game: GameId): Route => ({ name: 'games', subject, group: groupOf(game) });

/** "Học tập": subject → lesson → game → play (a subject without lessons yet: subject → game → play), every game in
 * Học tập (there is no separate "Thử thách" any more). English games start at once ("Chơi ngay": the backend picks the
 * words or questions from the user's progress); Math games go through their setup and lesson first. Then result →
 * review. The first time a game is played, its interactive tutorial comes first, in the game itself (before the session
 * exists when the game is known in advance, or with the session still paused).
 * Only a tap on an English game or "Bắt đầu" creates a session, one at a time; the backend keeps it, so leaving and
 * coming back (or another device) offers to continue it. */
export function LearningScreen({ user, defaultDuration, focus, onFreeStudy, onRewards, onImmersiveChange, modeSwitch, onUserUpdated }: Props) {
  const [route, setRoute] = useState<Route>({ name: 'subjects' });
  const [busy, setBusy] = useState<'start' | number | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<LearningSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const prefs = useLearningPrefs(user.id);
  const tutorials = useTutorialProgress(user.id);
  const toast = useToast();
  const confirm = useConfirm();
  const startKey = useRef<string | null>(null);
  const playKey = useRef<{ game: string; key: string } | null>(null);
  const [starting, setStarting] = useState<GameId | null>(null);
  const [playError, setPlayError] = useState<{ game: GameId; message: string; code?: string } | null>(null);
  // A session is being created: further taps (a game, "Bắt đầu", "Luyện lại") wait, so one tap makes one session.
  const launching = useRef(false);
  const home = useCallback(() => setRoute({ name: 'subjects' }), []);
  // Accounts from before registration asked for age and grade are asked here, once per visit ("Để sau" waits for the next).
  const [askLater, setAskLater] = useState(false);
  const needsProfile = user.age == null || !user.school_grade;
  const recommended = catalog?.study_profile ?? null;
  // The grade and school year are the backend's (locked at registration, moved on with the school calendar): nothing
  // here chooses one. Outside school, the level chosen (kept on the device).
  const { education, reload: reloadEducation, celebrated } = useEducation(user.id);
  // A promotion moved the grade on: the signed-in user (Cài đặt, the profile) follows the backend's.
  useEffect(() => {
    if (!education?.grade || education.grade === user.school_grade || !onUserUpdated) return;
    void request('/api/auth/me').then((me: User) => onUserUpdated(me)).catch(() => {});
  }, [education?.grade, user.school_grade, onUserUpdated]);
  const [band, setBand] = useState<Band>({});
  const levelKey = `mirabi.learning.level:${user.id}`;
  useEffect(() => {
    void AsyncStorage.getItem(levelKey).then((level) => {
      if (level === 'basic' || level === 'intermediate' || level === 'advanced') setBand((b) => (b.level ? b : { ...b, level }));
    }).catch(() => {});
  }, [levelKey]);
  const pickLevel = useCallback((level: FreeLevel) => {
    setBand((b) => ({ ...b, level }));
    void AsyncStorage.setItem(levelKey, level).catch(() => {});
  }, [levelKey]);
  /** Outside school, the level a game is started for (a school grade is never sent: the backend uses the learner's). */
  const playBand = useCallback((): Band => {
    const programme = catalog?.programme;
    return programme?.outside_school ? { level: programme.level } : {};
  }, [catalog]);

  // Học tập theo bài: every subject of the learner's grade.
  const [lessons, setLessons] = useState<LessonProgramme | null>(null);
  const [lessonsError, setLessonsError] = useState<string | null>(null);
  const loadLessons = useCallback(async () => {
    setLessonsError(null);
    try {
      const body = await learningApi.programme();
      // An older backend has no lessons yet: the subject screen then shows the games as before.
      setLessons(body && Array.isArray(body.subjects) ? body : null);
    } catch (e) {
      setLessons(null);
      if ((e as { status?: number })?.status !== 404) setLessonsError(errorMessage(e));
    }
  }, []);
  const load = useCallback(async () => {
    setLoadError(null);
    // The school year first: a promotion due (a new school year, a stage that just ended) happens before the content loads.
    await reloadEducation();
    void loadLessons();
    try {
      const [c, open] = await Promise.all([learningApi.catalog(band), learningApi.current()]);
      setCatalog(c); setCurrent(open);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, [band, loadLessons, reloadEducation]);
  // Fresh review counts and open session whenever the subject screen is shown.
  useEffect(() => { if (route.name === 'subjects') void load(); }, [route.name, load]);
  // Back online / back in the foreground on the subject screen: the school year may have moved on meanwhile. (A game
  // handles the app going to the background itself.)
  const onSubjects = route.name === 'subjects';
  useEffect(() => {
    if (!onSubjects) return;
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => sub.remove();
  }, [onSubjects, load]);

  useEffect(() => {
    onImmersiveChange?.(route.name === 'game' || route.name === 'tutorial');
    return () => onImmersiveChange?.(false);
  }, [route.name, onImmersiveChange]);

  // Android back steps back one screen. The game and its tutorial handle it themselves (pause, then continue or leave),
  // the intro has its own close, and the subject screen is the root of the tab.
  useEffect(() => {
    if (route.name === 'game' || route.name === 'tutorial' || route.name === 'intro' || route.name === 'subjects') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'lesson') setRoute(route.back);
      else if (route.name === 'setup') setRoute(gamesOf(route.subject, route.game));
      else if (route.name === 'vocabWord') setRoute({ name: 'vocab' });
      else if (route.name === 'vocab') setRoute({ name: 'games', subject: 'english' });
      else if (route.name === 'archiveLesson') setRoute({ name: 'archiveYear', year: route.year });
      else if (route.name === 'archiveYear') setRoute({ name: 'archive' });
      else if (route.name === 'games' && route.group) setRoute({ name: 'games', subject: route.subject, back: route.back });
      else if (route.name === 'games' && route.back) setRoute(route.back);
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

  /** The first time a game is played (or when its tutorial or gameplay changed), its tutorial comes first: "Bắt đầu chơi"
   * or "Bỏ qua" runs `begin`, leaving it goes `back`. Afterwards `begin` runs at once. */
  const withGuide = useCallback((game: GameId, begin: () => void, back: () => void) => {
    if (!tutorials.needs(game)) { begin(); return; }
    setRoute({ name: 'tutorial', game, onStart: begin, onClose: back });
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

  // Khám phá từ mới / Ôn tập of the two vocabulary games: their levels and words left, the topic chosen for each.
  const [vocabProgress, setVocabProgress] = useState<Partial<Record<VocabGame, VocabProgress>>>({});
  const [vocabTopic, setVocabTopic] = useState<Partial<Record<VocabGame, string | null>>>({});
  const [reviewing, setReviewing] = useState<VocabGame | null>(null);
  const [vocabParty, setVocabParty] = useState<{ game: VocabGame; info: VocabCelebrationInfo } | null>(null);
  const loadVocab = useCallback(async (games: VocabGame[] = VOCAB_GAMES) => {
    await Promise.all(games.map(async (game) => {
      try {
        const p = await learningApi.vocabProgress(game);
        if (!p || !Array.isArray(p.levels)) return; // an older server: the games play as before
        setVocabProgress((all) => ({ ...all, [game]: p }));
        if (p.celebration) setVocabParty((now) => now ?? { game, info: p.celebration! });
      } catch { /* the strip is extra: the game still plays without it */ }
    }));
  }, []);

  /** "Chơi ngay": one tap on an English game starts it (countdown, then play). A vocabulary game plays "Khám phá từ mới"
   * (of the topic chosen) unless `vocab` says otherwise. False if it could not start. */
  const play = useCallback(async (game: GameId, vocab?: VocabPlay): Promise<boolean> => {
    if (launching.current) return false;
    const options = isVocabGame(game) ? vocab ?? { vocab: 'discover' as const, topic: vocabTopic[game] ?? null } : undefined;
    // One key per tap on a game (and way of playing it): a retry after a timeout returns the same session.
    const id = `${game}|${options?.vocab ?? ''}|${options?.topic ?? ''}`;
    if (playKey.current?.game !== id) playKey.current = { game: id, key: newIdempotencyKey() };
    const key = playKey.current.key;
    setStarting(game); setPlayError(null);
    try {
      const s = await launch(() => learningApi.play(game, PLAY_MODE, key, playBand(), options));
      if (!s) return false;
      playKey.current = null;
      setRoute({ name: 'game', session: s, autoStart: true });
      return true;
    } catch (e) {
      setPlayError({ game, message: errorMessage(e), code: (e as { code?: string })?.code });
      if (isVocabGame(game)) void loadVocab([game]);
      return false;
    }
    finally { setStarting(null); }
  }, [launch, playBand, vocabTopic, loadVocab]);

  /** An English game from its list: the guide first time, then "Chơi ngay". A failed start shows why on the list. */
  const quickPlay = useCallback((game: GameId) => {
    const list = gamesOf(subjectOfGame(game), game);
    withGuide(game, () => { void play(game).then((ok) => { if (!ok) setRoute(list); }); }, () => setRoute(list));
  }, [withGuide, play]);

  /** "Ôn tập" of a vocabulary game: words met before, wrong and due ones first (never a discovery). `back`: where a
   * failed start returns (a lesson's own screen when started from it; the English games list otherwise). */
  const reviewVocab = useCallback((game: VocabGame, back?: Route) => {
    const list = back ?? gamesOf('english', game);
    setRoute(list);
    withGuide(game, () => {
      setReviewing(game);
      void play(game, { vocab: 'review' }).then((ok) => { if (!ok) setRoute(list); }).finally(() => setReviewing(null));
    }, () => setRoute(list));
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

  /** A game of a lesson: the guide the first time, then the stage (created paused; the countdown resumes it). */
  const lessonKey = useRef<{ id: string; key: string } | null>(null);
  const playLesson = useCallback((lessonId: string, game: GameId, back: Route) => {
    withGuide(game, () => {
      const id = `${lessonId}|${game}`;
      if (lessonKey.current?.id !== id) lessonKey.current = { id, key: newIdempotencyKey() };
      setStarting(game);
      void launch(() => learningApi.playLesson(lessonId, game, lessonKey.current!.key)).then((s) => {
        if (!s) return;
        lessonKey.current = null;
        setRoute({ name: 'game', session: s, autoStart: true });
      }).catch(async (e) => {
        setRoute(back);
        if ((e as { code?: string })?.code === 'vocabulary_exhausted' && isVocabGame(game)) {
          // Khám phá từ mới: every new word of this lesson's game is discovered; old words are never served as new.
          const review = await confirm({ title: 'Đã khám phá hết từ mới!',
            message: 'Bạn đã khám phá hết từ mới phù hợp với lớp của bạn trong trò này. Ôn tập các từ đã học để nhớ thật lâu nhé!',
            confirmLabel: 'Ôn tập từ đã học', cancelLabel: 'Để sau', icon: 'trophy-outline' });
          if (review) reviewVocab(game, back);
          return;
        }
        toast(errorMessage(e), 'error');
      }).finally(() => setStarting(null));
    }, () => setRoute(back));
  }, [withGuide, launch, toast, confirm, reviewVocab]);
  // The subject list the learner came from (cleared on Học tập): a lesson opened after a game goes back to it, and that
  // list is shown at once from its snapshot, moving only the lessons whose state changed.
  const subjectRoute = useRef<Route | null>(null);
  useEffect(() => {
    if (route.name === 'lessons') subjectRoute.current = route;
    else if (route.name === 'subjects') subjectRoute.current = null;
  }, [route]);
  const snapshots = useRef(new Map<string, SubjectSnapshot>());
  const keepSnapshot = useCallback((snap: SubjectSnapshot) => { snapshots.current.set(snap.data.subject.code, snap); }, []);
  /** The last list of a subject, only for the learner's grade and school year as they are now. */
  const snapshotOf = (code: string): SubjectSnapshot | null => {
    const snap = snapshots.current.get(code);
    if (!snap || snap.data.grade !== (education?.grade ?? user.school_grade)) return null;
    const year = education?.academic_year;
    return year != null && snap.data.academic_year != null && snap.data.academic_year !== year ? null : snap;
  };
  const openLesson = useCallback((key: string, back?: Route) =>
    setRoute({ name: 'lesson', key, back: back ?? subjectRoute.current ?? { name: 'subjects' } }), []);
  /** A finished year's lesson reviewed with one of its games (kind 'archive': kept apart from that year's results). */
  const archiveStages = useRef(new Map<number, number>());
  const archiveKey = useRef<{ id: string; key: string } | null>(null);
  const playArchive = useCallback((year: number, lessonId: string, game: GameId) => {
    const back: Route = { name: 'archiveLesson', year, key: lessonId };
    withGuide(game, () => {
      const id = `${year}|${lessonId}|${game}`;
      if (archiveKey.current?.id !== id) archiveKey.current = { id, key: newIdempotencyKey() };
      setStarting(game);
      void launch(() => educationApi.playArchive(year, lessonId, game, archiveKey.current!.key)).then((s) => {
        if (!s) return;
        archiveKey.current = null;
        archiveStages.current.set(s.id, year);
        setRoute({ name: 'game', session: s, autoStart: true });
      }).catch(async (e) => {
        setRoute(back);
        if ((e as { code?: string })?.code === 'vocabulary_exhausted' && isVocabGame(game)) {
          // Khám phá từ mới: every new word of this lesson's game is discovered; old words are never served as new.
          const review = await confirm({ title: 'Đã khám phá hết từ mới!',
            message: 'Bạn đã khám phá hết từ mới phù hợp với lớp của bạn trong trò này. Ôn tập các từ đã học để nhớ thật lâu nhé!',
            confirmLabel: 'Ôn tập từ đã học', cancelLabel: 'Để sau', icon: 'trophy-outline' });
          if (review) reviewVocab(game, back);
          return;
        }
        toast(errorMessage(e), 'error');
      }).finally(() => setStarting(null));
    }, () => setRoute(back));
  }, [withGuide, launch, toast, confirm, reviewVocab]);
  const resumeById = useCallback(async (id: number) => {
    try { setRoute({ name: 'game', session: await learningApi.session(id), autoStart: false }); } catch (e) { toast(errorMessage(e), 'error'); }
  }, [toast]);
  const saveSelection = useCallback(async (chosen: string[]) => {
    try { await learningApi.saveSelection(chosen); void loadLessons(); } catch (e) { toast(errorMessage(e), 'error'); }
  }, [loadLessons, toast]);
  /** The subjects that also have free-practice games (the game lists of before lessons). */
  /** Subjects a personal note can be on: the grade's (outside school, those with games). */
  const noteSubjects = (lessons?.subjects.length ? lessons.subjects : catalog?.programme?.subjects ?? []).map((x) => ({ code: x.code, name: x.name }));
  const practiceOf = (code: string): SubjectCode | null => {
    const games = PRACTICE_ALIAS[code] ?? code;
    return catalog?.programme?.subjects.some((x) => x.code === games) ? games as SubjectCode : null;
  };

  const replay = (s: LearningSession) => {
    if (s.kind === 'archive' && s.archive_year && s.catalog) { // a finished year's review: back to that lesson of the archive
      setRoute({ name: 'archiveLesson', year: s.archive_year, key: s.catalog.lesson }); return;
    }
    if (s.catalog?.title && s.kind === 'lesson') { // a lesson's game: the same game of the same lesson, its own content
      playLesson(s.catalog.lesson, s.game, { name: 'lesson', key: s.catalog.lesson, back: subjectRoute.current ?? { name: 'subjects' } }); return;
    }
    if (wordStages.current.has(s.id)) { setRoute({ name: 'vocab' }); return; } // pick the words again, with fresh results
    if (isBankStage(s) && isVocabGame(s.game)) { // "Chơi lại": the same way of playing, with new words (or a fresh review)
      const game = s.game;
      if (s.kind === 'review') { reviewVocab(game); return; }
      const topic = s.lesson.code === 'en.vocab.mix' ? null : s.topic.code;
      setVocabTopic((all) => ({ ...all, [game]: topic }));
      setRoute(gamesOf('english', game));
      withGuide(game, () => { void play(game, { vocab: 'discover', topic }); }, () => setRoute(gamesOf('english', game)));
      return;
    }
    if (s.kind === 'review') { void practise(s.topic.id); return; }
    if (QUICK_GAMES.has(s.game) && (QUICK_LESSONS.has(s.lesson.code) || isCurriculumGame(s.game))) {
      setRoute(gamesOf(subjectOfGame(s.game), s.game)); quickPlay(s.game); return;
    }
    // A stage first played as "Thử thách" is played again in Học tập (start() always sends it).
    void start({ lessonId: s.lesson.id, mode: PLAY_MODE, durationMinutes: Math.min(60, Math.round(s.duration_seconds / 60)), variant: s.variant });
  };

  /** "Cách chơi" from a game list: the tutorial again; "Bắt đầu chơi" plays (or opens the setup) as a tap on the game does. */
  const howTo = (game: GameId) => {
    const here = route;
    const begin = QUICK_GAMES.has(game)
      ? () => { void play(game).then((ok) => { if (!ok) setRoute(here); }); }
      : () => setRoute({ name: 'setup', subject: here.name === 'games' ? here.subject : 'math', game });
    setRoute({ name: 'tutorial', game, onStart: begin, onClose: () => setRoute(here) });
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
  // The English games list shows each vocabulary game's level and words left; after a vocabulary stage, a level it
  // completed is celebrated (once: the backend keeps that it was shown).
  const englishGames = route.name === 'games' && route.subject === 'english';
  const resultGame = route.name === 'result' ? route.game : undefined;
  useEffect(() => { if (englishGames) void loadVocab(); }, [englishGames, loadVocab]);
  useEffect(() => { if (isVocabGame(resultGame)) void loadVocab([resultGame]); }, [resultGame, loadVocab]);
  // Tự động mở khóa: what a stage opened (also one whose result was lost on the way) is told by a small notice. The
  // backend decides it; the app only asks once a result is on screen, and says when the notice was shown.
  const [unlockNews, setUnlockNews] = useState<UnlockedContent[]>([]);
  const resultSession = route.name === 'result' ? route.sessionId : undefined;
  useEffect(() => {
    if (resultSession === undefined) return;
    void learningApi.syncProgress().then((r) => { if (r.unlocked?.length) setUnlockNews(r.unlocked); }).catch(() => {});
  }, [resultSession]);
  const inGame = route.name === 'game';
  useEffect(() => { if (inGame) setUnlockNews([]); }, [inGame]);

  if (route.name === 'tutorial') {
    // The tutorial is played in the game screen itself (Tutorial Mode), full screen like the game.
    return (
      <View style={styles.game}>
        <InteractiveTutorial key={route.game} game={route.game} petId={user.pet} petLevel={user.level} prefs={prefs} progress={tutorials}
          busy={starting === route.game || practisingWords || busy !== null} onStart={route.onStart} onSkip={route.onStart} onClose={route.onClose} />
      </View>
    );
  }
  if (route.name === 'game') {
    return (
      <View style={styles.game}>
        <GameScreen key={route.session.id} initial={route.session} autoStart={route.autoStart} petId={user.pet} petLevel={user.level}
          prefs={prefs} onEnded={(s) => setRoute({ name: 'result', sessionId: s.id, game: isBankStage(s) || s.catalog ? s.game : undefined })} />
      </View>
    );
  }
  const resume = (session: LearningSession) => setRoute({ name: 'game', session, autoStart: false });
  const celebration = education?.celebration ?? null;
  return (
    <View style={styles.fill}>
    {route.name === 'lessons' ? (
      // A subject's lessons scroll in their own list (long subjects stay smooth), outside the shared ScrollView.
      <PageIn key={route.subject} reduceMotion={prefs.reduceMotion} style={styles.fill}>
        <SubjectLessonsScreen key={route.subject} code={route.subject} onBack={home} reduceMotion={prefs.reduceMotion}
          snapshot={snapshotOf(route.subject)} onLeave={keepSnapshot} petId={user.pet} petLevel={user.level} onUnlocked={setUnlockNews}
          onOpen={(key) => openLesson(key, route)}
          onPractice={practiceOf(route.subject) ? () => setRoute({ name: 'games', subject: practiceOf(route.subject)!, back: route }) : undefined} />
      </PageIn>
    ) : (
    <ScrollView ref={scroll} key={route.name} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <PageIn reduceMotion={prefs.reduceMotion}>
      {route.name === 'subjects' ? (
        <SubjectPicker catalog={catalog} lessons={lessons} error={loadError ?? lessonsError} onRetry={() => void load()} current={current}
          focus={focus} onResume={resume} onDiscard={() => void discard()} onOpenReview={() => setRoute({ name: 'review' })} modeSwitch={modeSwitch}
          education={education} onPickLevel={pickLevel} onOpenLesson={(key) => openLesson(key)} onFreeStudy={onFreeStudy}
          onOpenNotebook={() => setRoute({ name: 'notebook' })} onOpenArchive={() => setRoute({ name: 'archive' })}
          onOpenElectives={() => setRoute({ name: 'electives' })}
          onOpenSubject={(s) => setRoute(s.to === 'lessons' ? { name: 'lessons', subject: s.code } : { name: 'games', subject: s.code as SubjectCode })}
          profilePrompt={needsProfile && !askLater ? (
            <StudyProfileForm user={user} title="Cho Mirabi biết thêm về bạn" onSkip={() => setAskLater(true)}
              onSaved={(saved) => { onUserUpdated?.(saved); setAskLater(true); void load(); }}
              description="Chọn độ tuổi và lớp bạn đang học trong năm học này. Lớp học sẽ được giữ cố định và tự lên lớp vào đầu mỗi năm học mới." />
          ) : null} />
      ) : null}
      {route.name === 'electives' ? <ElectivesScreen programme={lessons} onBack={home} onChange={(chosen) => void saveSelection(chosen)} /> : null}
      {route.name === 'lesson' ? (
        <LessonScreen key={route.key} lessonKey={route.key} onBack={() => setRoute(route.back)} starting={starting}
          onPlay={(lesson: CatalogLesson, game: LessonGame) => playLesson(lesson.key, game.game, route)}
          onReview={(game: LessonGame) => { if (isVocabGame(game.game)) reviewVocab(game.game, route); }}
          onResume={(id) => void resumeById(id)} onOpenLesson={(key) => openLesson(key, route)}
          onNote={() => {
            const key = route.key;
            void learningApi.lessonDetail(key).then((l) => setRoute({ name: 'notebook',
              draft: { subject: l.subject.code, lessonKey: l.key, lessonTitle: l.title } })).catch((e) => toast(errorMessage(e), 'error'));
          }}
          onHowTo={(game) => { const here = route; setRoute({ name: 'tutorial', game, onStart: () => playLesson(here.key, game, here), onClose: () => setRoute(here) }); }} />
      ) : null}
      {route.name === 'games' ? (
        <GamePicker key={route.group ?? route.subject} subject={route.subject} group={route.group} catalog={catalog}
          onBack={route.group ? () => setRoute({ name: 'games', subject: route.subject, back: route.back }) : route.back ? () => setRoute(route.back!) : home}
          onOpenGroup={(group) => setRoute({ name: 'games', subject: route.subject, group, back: route.back })}
          onPick={(game) => setRoute({ name: 'setup', subject: route.subject, game })} onHowTo={howTo}
          onOpenHistory={route.subject === 'english' && !route.group ? () => { setVocabView(FIRST_VIEW); setRoute({ name: 'vocab' }); } : undefined}
          quick={{ onPlay: quickPlay, starting, error: playError, current, onResume: resume, onDiscard: () => void discard() }}
          vocab={route.subject === 'english' ? { progress: vocabProgress, topic: vocabTopic, reviewing, onReview: reviewVocab,
            onTopic: (game, topic) => { setVocabTopic((all) => ({ ...all, [game]: topic })); setPlayError(null); } } : undefined} />
      ) : null}
      {route.name === 'setup' ? (
        <GameSetup key={`${route.subject}.${route.game}`} subject={route.subject} game={route.game} catalog={catalog} error={loadError}
          onRetry={() => void load()} defaultDuration={defaultDuration} preset={route.preset} current={current} starting={busy === 'start'}
          recommended={recommended} onlyLevel={catalog?.programme && !catalog.programme.outside_school ? catalog.programme.grade : null}
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
      {route.name === 'result' ? (
        <ResultScreen sessionId={route.sessionId} petId={user.pet} petLevel={user.level} onReplay={replay} reduceMotion={prefs.reduceMotion}
          onReview={(topicId) => void practise(topicId)} onHome={home} onRewards={onRewards}
          onLesson={(key) => {
            const year = archiveStages.current.get(route.sessionId);
            if (year) setRoute({ name: 'archiveLesson', year, key }); else openLesson(key);
          }} />
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
      {route.name === 'archive' ? <ArchiveListScreen education={education} onBack={home} onOpen={(year) => setRoute({ name: 'archiveYear', year })} /> : null}
      {route.name === 'archiveYear' ? (
        <ArchiveYearScreen key={route.year} year={route.year} onBack={() => setRoute({ name: 'archive' })}
          onOpenLesson={(key) => setRoute({ name: 'archiveLesson', year: route.year, key })} />
      ) : null}
      {route.name === 'archiveLesson' ? (
        <ArchiveLessonScreen key={`${route.year}.${route.key}`} year={route.year} lessonKey={route.key} starting={starting}
          onBack={() => setRoute({ name: 'archiveYear', year: route.year })} onPlay={(game) => playArchive(route.year, route.key, game)}
          onResume={(id) => void resumeById(id)} />
      ) : null}
      {route.name === 'notebook' ? (
        <NotebookScreen key={route.draft?.lessonKey ?? 'notebook'} onBack={home} onOpenLesson={(key) => openLesson(key, { name: 'notebook' })}
          subjects={noteSubjects} draft={route.draft} />
      ) : null}
      {route.name === 'review' ? <ReviewScreen onBack={home} onPractice={(id) => void practise(id)} busyTopicId={typeof busy === 'number' ? busy : null} /> : null}
      </PageIn>
    </ScrollView>
    )}
    {vocabParty && !celebration ? (
      <VocabCelebration key={`${vocabParty.game}.${vocabParty.info.level}`} info={vocabParty.info} petId={user.pet} petLevel={user.level}
        onSeen={() => { void learningApi.vocabCelebrated(vocabParty.game, vocabParty.info.level).catch(() => {}); }}
        onClose={() => setVocabParty(null)}
        onReview={() => { const game = vocabParty.game; setVocabParty(null); reviewVocab(game); }}
        onExplore={() => {
          const game = vocabParty.game;
          setVocabParty(null); setVocabTopic((all) => ({ ...all, [game]: null }));
          const list = gamesOf('english', game);
          setRoute(list);
          withGuide(game, () => { void play(game, { vocab: 'discover', topic: null }).then((ok) => { if (!ok) setRoute(list); }); }, () => setRoute(list));
        }} />
    ) : null}
    {unlockNews.length && !vocabParty && !celebration ? (
      <UnlockNotice news={unlockNews} petId={user.pet} petLevel={user.level} reduceMotion={prefs.reduceMotion}
        onSeen={(ids) => { void learningApi.unlocksCelebrated(ids).catch(() => {}); }}
        onClose={() => setUnlockNews([])}
        onExplore={(key) => { setUnlockNews([]); openLesson(key); }} />
    ) : null}
    {celebration ? (
      <PromotionCelebration celebration={celebration} petId={user.pet} petLevel={user.level}
        onExplore={() => { void celebrated(celebration.id); setRoute({ name: 'subjects' }); void load(); }} />
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 760, alignSelf: 'center' },
  game: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
});
