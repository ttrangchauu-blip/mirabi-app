import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../components/Typography';
import { NATIVE } from '../../../games/quests/worlds';
import type { TutorialSnapshot } from '../../../learning/tutorial/machine';
import type { DemoAnimation, TutorialDefinition, TutorialStep, TutorialTarget } from '../../../learning/tutorial/registry';
import { appTheme as t } from '../../../theme';
import { Button } from '../../../ui/kit';

export type Rect = { x: number; y: number; width: number; height: number };
/** Where the game screen's regions are, in the coordinates of the layer drawn over it. */
export type Regions = Partial<Record<Exclude<TutorialTarget, 'aimed' | 'none'>, Rect>>;

const RING = 6; // the ring stands this far outside its target, so it never covers what is tapped
const AIM_EVERY_MS = 120; // a falling word is followed this often

/** The instruction of the step, its feedback, and "Tiếp" for a step that only asks to watch. Above the game: it covers
 * nothing that is played. */
export function TutorialCoach({ def, snap, step, onNext }: { def: TutorialDefinition; snap: TutorialSnapshot; step: TutorialStep | undefined;
  onNext: () => void }) {
  if (!step || snap.state === 'TUTORIAL_COMPLETED' || snap.state === 'SKIPPED') return null;
  const feedback = snap.feedback;
  const checking = snap.state === 'VALIDATING_ACTION';
  return (
    <View style={styles.coach} testID="tutorial-coach">
      <View style={styles.coachIcon}><Ionicons name="paw" size={18} color="#FFFFFF" /></View>
      <View style={styles.flex}>
        <Text style={styles.coachStep}>Hướng dẫn · Bước {snap.index + 1}/{def.steps.length}</Text>
        <Text style={styles.coachText} accessibilityLiveRegion="polite" accessibilityRole="header">{step.instruction}</Text>
        {checking ? <Text style={styles.coachNote}>Đang kiểm tra…</Text> : feedback ? (
          <Text style={[styles.coachNote, feedback.tone === 'good' ? styles.good : styles.bad]} accessibilityLiveRegion="assertive">
            {feedback.tone === 'good' ? '✓ ' : ''}{feedback.text}
          </Text>
        ) : null}
      </View>
      {step.expected_action === 'next' && snap.state !== 'STEP_COMPLETED' ? (
        <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel="Tiếp" hitSlop={6} style={styles.next}>
          <Text style={styles.nextText}>Tiếp</Text>
          <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Under the game: how far the tutorial is, and "Bỏ qua" when the game allows it. */
export function TutorialProgressBar({ def, snap, onSkip }: { def: TutorialDefinition; snap: TutorialSnapshot; onSkip?: () => void }) {
  if (snap.state === 'TUTORIAL_COMPLETED' || snap.state === 'SKIPPED') return null;
  return (
    <View style={styles.progress} testID="tutorial-progress">
      <View style={styles.dots} accessible accessibilityLabel={`Bước ${snap.index + 1} trên ${def.steps.length}`}>
        {def.steps.map((s, i) => (
          <View key={s.id} style={[styles.dot, (i < snap.index || snap.done.includes(s.id)) && styles.dotDone, i === snap.index && styles.dotOn]} />
        ))}
      </View>
      <Text style={styles.progressText}>Bước {snap.index + 1}/{def.steps.length}</Text>
      <View style={styles.flex} />
      {onSkip ? (
        <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel="Bỏ qua hướng dẫn" hitSlop={8} style={styles.skip}>
          <Text style={styles.skipText}>Bỏ qua</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The tutorial is done: a small card over the bottom of the game (the game stays in sight). */
export function TutorialReady({ def, startLabel, onStart, onReplay, busy }: { def: TutorialDefinition; startLabel: string; onStart: () => void;
  onReplay: () => void; busy?: boolean }) {
  // One tap starts one game.
  const [started, setStarted] = useState(false);
  return (
    <View style={styles.readyDock} pointerEvents="box-none">
      <View style={styles.ready} accessibilityRole="alert" testID="tutorial-ready">
        <View style={styles.readyHead}>
          <Ionicons name="sparkles" size={22} color="#F2A93B" />
          <Text style={styles.readyTitle}>Bạn đã sẵn sàng!</Text>
        </View>
        <Text style={styles.readyLine}>{def.done_title}</Text>
        {def.ready.map((line) => (
          <View key={line} style={styles.readyRow}>
            <Ionicons name="information-circle-outline" size={16} color={t.accent} />
            <Text style={styles.readyNote}>{line}</Text>
          </View>
        ))}
        <Button title={startLabel} icon="play" loading={busy} disabled={started} onPress={() => { if (started) return; setStarted(true); onStart(); }} />
        <Pressable onPress={onReplay} accessibilityRole="button" accessibilityLabel="Xem lại hướng dẫn" hitSlop={6} style={styles.replay}>
          <Ionicons name="refresh" size={15} color={t.accent} />
          <Text style={styles.replayText}>Xem lại hướng dẫn</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Points at what the step is about: a ring around the target (outside it), and the step's demo animation: an arrow,
 * a hand tapping, dragging or typing. Never takes a touch (pointerEvents none). With reduced motion everything stays
 * still. Only one animation plays at a time, and it stops with its step.
 */
export function TutorialSpotlight({ step, demonstrating, regions, aimed, reduceMotion }: { step: TutorialStep | undefined; demonstrating: boolean;
  regions: Regions; aimed: () => Rect | null; reduceMotion: boolean }) {
  const target = step?.target ?? 'none';
  const [aim, setAim] = useState<Rect | null>(null);
  // A falling word moves: it is followed (and the ring goes where it is now, never where it was).
  useEffect(() => {
    if (target !== 'aimed') { setAim(null); return; }
    const look = () => setAim((was) => {
      const now = aimed();
      if (!now) return null;
      return was && Math.abs(was.x - now.x) < 1 && Math.abs(was.y - now.y) < 1 ? was : now;
    });
    look();
    const timer = setInterval(look, AIM_EVERY_MS);
    return () => clearInterval(timer);
  }, [target, aimed]);
  const rect = target === 'aimed' ? aim : target === 'none' ? null : regions[target] ?? null;
  if (!step || !rect) return null;
  const animation: DemoAnimation = demonstrating ? step.demo_animation : step.demo_animation === 'arrow' ? 'arrow' : 'pulse';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="tutorial-spotlight">
      <Ring rect={rect} reduceMotion={reduceMotion} soft={step.demo_animation === 'watch'} />
      {animation === 'arrow' ? <Arrow rect={rect} reduceMotion={reduceMotion} /> : null}
      {animation === 'hand_tap' || animation === 'hand_drag' || animation === 'hand_type'
        ? <Hand key={`${step.id}.${animation}`} rect={rect} kind={animation} reduceMotion={reduceMotion} /> : null}
    </View>
  );
}

function useLoop(reduceMotion: boolean, duration: number, deps: unknown[] = []) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { value.setValue(0.5); return; }
    value.setValue(0);
    const loop = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, duration, value, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

function Ring({ rect, reduceMotion, soft }: { rect: Rect; reduceMotion: boolean; soft: boolean }) {
  const pulse = useLoop(reduceMotion, 1400);
  const opacity = reduceMotion ? 0.9 : pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.95, 0.45, 0.95] });
  const scale = reduceMotion ? 1 : pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.02, 1] });
  return (
    <Animated.View testID="tutorial-ring" style={[styles.ring, soft && styles.ringSoft, {
      left: rect.x - RING, top: rect.y - RING, width: rect.width + RING * 2, height: rect.height + RING * 2, opacity, transform: [{ scale }],
    }]} />
  );
}

function Arrow({ rect, reduceMotion }: { rect: Rect; reduceMotion: boolean }) {
  const bob = useLoop(reduceMotion, 900);
  const above = rect.y > 44; // room above the target: point down at it; else point up from under it
  const shift = reduceMotion ? 0 : bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, above ? 8 : -8, 0] });
  return (
    <Animated.View testID="tutorial-arrow" style={[styles.arrow, {
      left: rect.x + rect.width / 2 - 16, top: above ? rect.y - RING - 34 : rect.y + rect.height + RING + 2, transform: [{ translateY: shift }],
    }]}>
      <Ionicons name={above ? 'caret-down' : 'caret-up'} size={32} color="#F2A93B" />
    </Animated.View>
  );
}

function Hand({ rect, kind, reduceMotion }: { rect: Rect; kind: 'hand_tap' | 'hand_drag' | 'hand_type'; reduceMotion: boolean }) {
  const t1 = useLoop(reduceMotion, kind === 'hand_drag' ? 1600 : 1000, [kind]);
  const cx = rect.x + rect.width / 2 - 14;
  const top = kind === 'hand_type' ? rect.y + rect.height - 18 : kind === 'hand_drag' ? rect.y + rect.height * 0.7 : rect.y + rect.height / 2 - 10;
  const travel = Math.min(140, rect.height * 0.45);
  const transform = reduceMotion ? [] : kind === 'hand_drag'
    ? [{ translateY: t1.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0, -travel, -travel] }) }]
    : [{ scale: t1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.82, 1] }) }];
  const opacity = reduceMotion || kind !== 'hand_drag' ? 1 : t1.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View testID={`tutorial-${kind}`} style={[styles.hand, { left: cx, top, opacity, transform }]}>
      <Ionicons name="hand-left" size={30} color="#FFFFFF" style={styles.handIcon} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  coach: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12,
    marginBottom: 8, borderWidth: 2, borderColor: '#FFE1A8',
    shadowColor: t.shadow, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  coachIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2A93B', alignItems: 'center', justifyContent: 'center' },
  coachStep: { fontSize: 11, fontWeight: '900', color: t.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  coachText: { fontSize: 16, fontWeight: '900', color: t.ink, marginTop: 1 },
  coachNote: { fontSize: 13, fontWeight: '800', color: t.muted, marginTop: 3 },
  good: { color: t.success },
  bad: { color: t.danger },
  next: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 12, minHeight: 36 },
  nextText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C3DCEB' },
  dotDone: { backgroundColor: t.success },
  dotOn: { width: 20, backgroundColor: t.accent },
  progressText: { fontSize: 13, fontWeight: '900', color: t.muted },
  skip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: t.tint, justifyContent: 'center' },
  skipText: { color: t.accent, fontWeight: '900', fontSize: 13 },
  ring: { position: 'absolute', borderRadius: 18, borderWidth: 3, borderColor: '#F2A93B' },
  ringSoft: { borderColor: '#9FD3F2', borderStyle: 'dashed' },
  arrow: { position: 'absolute', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  hand: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(242,169,59,0.92)', alignItems: 'center', justifyContent: 'center' },
  handIcon: { transform: [{ rotate: '-20deg' }] },
  readyDock: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 9 },
  ready: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 8,
    shadowColor: '#0B2A4A', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: -2 }, elevation: 8 },
  readyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readyTitle: { fontSize: 20, fontWeight: '900', color: t.ink },
  readyLine: { fontSize: 15, fontWeight: '800', color: t.ink },
  readyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  readyNote: { flex: 1, fontSize: 13, color: t.muted, lineHeight: 18 },
  replay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36 },
  replayText: { color: t.accent, fontWeight: '800', fontSize: 14 },
});
