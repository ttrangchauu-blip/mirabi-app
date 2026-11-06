import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../../api/client';
import { Text } from '../../../components/Typography';
import { errorMessage } from '../../../auth/messages';
import { gameTitle } from '../../../learning/labels';
import type { LearningPrefs } from '../../../learning/prefs';
import { tutorialApi } from '../../../learning/tutorial/api';
import { DemoSession } from '../../../learning/tutorial/demoSession';
import type { TutorialProgressApi } from '../../../learning/tutorial/progress';
import { TutorialDefinition, unsupported } from '../../../learning/tutorial/registry';
import { useTutorialController } from '../../../learning/tutorial/useTutorialController';
import type { GameId } from '../../../learning/types';
import { makeStyles, useTheme } from '../../../ui/theme';
import { Button } from '../../../ui/kit';
import { GameScreen } from '../GameScreen';

type Props = {
  game: GameId;
  petId: string;
  petLevel: number;
  prefs: LearningPrefs;
  /** "Bắt đầu chơi" (first time, before a game) or "Tiếp tục chơi" (watched again during one). */
  startLabel?: string;
  /** The ready card's button: the real game starts (or goes on). */
  onStart: () => void;
  /** Left without finishing: it is asked for again next time. */
  onClose: () => void;
  /** Saves the progress (first time before a game). Watched again during a game, nothing is saved. */
  progress?: TutorialProgressApi;
  /** "Bỏ qua hướng dẫn" was chosen (recorded as skipped): the real game starts. Without it, there is no "Bỏ qua". */
  onSkip?: () => void;
  /** The real game is being prepared after "Bắt đầu chơi". */
  busy?: boolean;
};

type Load = { state: 'loading' } | { state: 'ready'; def: TutorialDefinition } | { state: 'missing' } | { state: 'error'; message: string };

/**
 * A game's interactive tutorial: the real game screen in Tutorial Mode, with this game's own tutorial (by game id, never
 * another game's). A game without one (or one this app cannot play) says so and is logged, rather than showing a
 * wrong one.
 */
export function InteractiveTutorial({ game, petId, petLevel, prefs, startLabel = 'Bắt đầu chơi', onStart, onClose, progress, onSkip, busy }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setLoad({ state: 'loading' });
    tutorialApi.definition(game).then((def) => {
      if (!active) return;
      const problems = def && Array.isArray(def.steps) && Array.isArray(def.demo) && def.game_id === game ? unsupported(def) : ['not a tutorial of this game'];
      if (problems.length) {
        console.warn(`[tutorial] ${game}: the tutorial cannot be played here (${problems.join('; ')})`);
        setLoad({ state: 'missing' });
        return;
      }
      setLoad({ state: 'ready', def });
    }).catch((e) => {
      if (!active) return;
      if (e instanceof ApiError && (e.code === 'tutorial_missing' || e.code === 'game_not_found')) {
        console.warn(`[tutorial] ${game}: no tutorial is set up (${e.code})`);
        setLoad({ state: 'missing' });
      } else setLoad({ state: 'error', message: errorMessage(e) });
    });
    return () => { active = false; };
  }, [game, attempt]);

  // Until the game screen is up (it pauses on back itself), back leaves.
  const waiting = load.state !== 'ready';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!waiting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => sub.remove();
  }, [waiting]);

  if (load.state === 'loading') {
    return <View style={styles.center}><ActivityIndicator color={t.accent} /><Text style={styles.muted}>Đang chuẩn bị hướng dẫn…</Text></View>;
  }
  if (load.state !== 'ready') {
    const missing = load.state === 'missing';
    return (
      <View style={styles.center} accessibilityRole="alert">
        <Ionicons name={missing ? 'construct-outline' : 'cloud-offline-outline'} size={38} color={t.accent} />
        <Text style={styles.title}>{missing ? 'Hướng dẫn chưa sẵn sàng' : 'Chưa tải được hướng dẫn'}</Text>
        <Text style={styles.muted}>
          {missing ? `Hướng dẫn của “${gameTitle(game)}” chưa được cấu hình xong. Mirabi đã ghi nhận để hoàn thiện.` : load.message}
        </Text>
        {missing ? null : <Button title="Thử lại" icon="refresh" onPress={reload} />}
        {/* Never another game's tutorial: the game itself can still be played. */}
        {missing && onSkip ? <Button title="Chơi luôn" icon="play" onPress={() => { progress?.dismiss(game); onStart(); }} /> : null}
        <Button title="Quay lại" variant="secondary" onPress={onClose} />
      </View>
    );
  }
  return <Played key={`${load.def.tutorial_version}.${attempt}`} def={load.def} petId={petId} petLevel={petLevel} prefs={prefs} startLabel={startLabel}
    onStart={onStart} onClose={onClose} progress={progress} onSkip={onSkip} busy={busy} onOutdated={reload} />;
}

function Played({ def, petId, petLevel, prefs, startLabel, onStart, onClose, progress, onSkip, busy, onOutdated }: Omit<Props, 'game'> & {
  def: TutorialDefinition; startLabel: string; onOutdated: () => void }) {
  // "Xem lại": a fresh demo (the demo turns, hearts and steps from the start), the same definition.
  const [round, setRound] = useState(0);
  return <Round key={round} def={def} petId={petId} petLevel={petLevel} prefs={prefs} startLabel={startLabel} onStart={onStart} onClose={onClose}
    progress={progress} onSkip={onSkip} busy={busy} onOutdated={onOutdated} onReplay={() => setRound((n) => n + 1)} />;
}

function Round({ def, petId, petLevel, prefs, startLabel, onStart, onClose, progress, onSkip, busy, onOutdated, onReplay }: Omit<Props, 'game'> & {
  def: TutorialDefinition; startLabel: string; onOutdated: () => void; onReplay: () => void }) {
  const styles = useStyles();
  const outdated = useRef(onOutdated);
  outdated.current = onOutdated;
  const demo = useMemo(() => new DemoSession(def, (turnId, answer, event) =>
    tutorialApi.check(def.game_id, { tutorial_version: def.tutorial_version, turn_id: turnId, answer, ...(event ? { event } : {}) }).catch((e) => {
      if (e instanceof ApiError && e.code === 'tutorial_outdated') outdated.current(); // a newer tutorial: start it instead
      throw e;
    })), [def]);
  useEffect(() => () => demo.close(), [demo]); // left: nothing still running answers into it
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const controller = useTutorialController(def, demo, prefs.reduceMotion, (index) => progressRef.current?.left(def, index));
  const { snap } = controller;

  // Completed (every hands-on step done): saved once.
  const saved = useRef(false);
  useEffect(() => {
    if (snap.state !== 'TUTORIAL_COMPLETED' || saved.current) return;
    saved.current = true;
    progressRef.current?.finish(def, snap.done);
  }, [snap.state, snap.done, def]);

  const skip = useMemo(() => (onSkip && def.skippable ? () => {
    controller.skip();
    progressRef.current?.skip(def);
    onSkip();
  } : undefined), [onSkip, def, controller]);

  const host = useMemo(() => ({ def, controller, startLabel, onStart, onReplay, onExit: onClose, onSkip: skip, busy }),
    [def, controller, startLabel, onStart, onReplay, onClose, skip, busy]);
  return (
    <View style={styles.fill} testID="interactive-tutorial">
      <GameScreen initial={demo.snapshot} backend={demo} tutorial={host} petId={petId} petLevel={petLevel} prefs={prefs} onEnded={() => {}} />
    </View>
  );
}

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 20, fontWeight: '900', color: t.ink, textAlign: 'center' },
  muted: { fontSize: 14, color: t.muted, textAlign: 'center', lineHeight: 20 },
}));
