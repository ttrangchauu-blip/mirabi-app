import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import type { Turn } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';
import { useReactions } from '../engine/feedback';
import { useSfx } from '../engine/sfx';

// What the subject gameplays share (Dòng thời gian, Xây câu, Xưởng hình học, Cân bằng phương trình): the props the
// game screen gives them, the line saying what a step of the answer did, the two buttons, a − / + stepper, and the two
// reactions: the success one holds the explanation and the next question until it is over (the learning result shown
// in the world: the timeline completes, the train leaves, the shape fills, the balance levels), the wrong one never
// holds anything.

export type Note = { text: string; tone: 'good' | 'bad'; kept?: string[] | null;
  /** A wrong answer that ends the question: what was placed stays on screen, nothing goes back to be fixed. */ final?: boolean } | null;
export type SceneProps = {
  turn: Turn;
  disabled: boolean;
  /** What the last answer did (from the backend). */
  feedback?: Note;
  /** The question was answered right: the world plays the result, then the explanation shows under it. */
  solved?: boolean;
  onSubmit: (answer: string[]) => void;
  reduceMotion?: boolean;
  petId?: string;
  petLevel?: number;
};

export function NoteLine({ note }: { note?: Note }) {
  const { t } = useTheme();
  const styles = useCommonStyles();
  if (!note || !note.text) return null;
  const good = note.tone === 'good';
  return (
    <View style={[styles.note, good ? styles.noteGood : styles.noteBad]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name={good ? 'checkmark-circle' : 'information-circle'} size={18} color={good ? t.success : t.danger} />
      <Text style={[styles.noteText, { color: good ? t.success : t.danger }]}>{note.text}</Text>
    </View>
  );
}

export function Actions({ onReset, resetDisabled, onCheck, checkDisabled, resetLabel = 'Xếp lại' }: {
  onReset: () => void; resetDisabled: boolean; onCheck: () => void; checkDisabled: boolean; resetLabel?: string;
}) {
  const styles = useCommonStyles();
  return (
    <View style={styles.actions}>
      <Pressable onPress={onReset} disabled={resetDisabled} accessibilityRole="button" accessibilityLabel={resetLabel}
        style={[styles.secondary, resetDisabled && styles.dimmed]}><Text style={styles.secondaryText}>{resetLabel}</Text></Pressable>
      <Pressable onPress={onCheck} disabled={checkDisabled} accessibilityRole="button" accessibilityLabel="Kiểm tra"
        accessibilityState={{ disabled: checkDisabled }} style={[styles.primary, checkDisabled && styles.dimmed]}>
        <Text style={styles.primaryText}>Kiểm tra</Text>
      </Pressable>
    </View>
  );
}

export function Stepper({ value, onChange, min, max, step = 1, disabled, label, unit = '', light }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; disabled?: boolean; label: string; unit?: string;
  light?: boolean;
}) {
  const { t } = useTheme();
  const styles = useCommonStyles();
  const ink = light ? '#FFFFFF' : t.ink; // light: the value is drawn on the dark scene (art), white on both themes
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}${unit}`}>
      <Pressable onPress={() => onChange(Math.max(min, value - step))} disabled={disabled || value <= min} accessibilityRole="button"
        accessibilityLabel={`Giảm ${label}`} hitSlop={6} style={[styles.stepBtn, (disabled || value <= min) && styles.dimmed]}>
        <Ionicons name="remove" size={18} color={t.accent} />
      </Pressable>
      <Text style={[styles.stepValue, { color: ink }]}>{value}{unit}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + step))} disabled={disabled || value >= max} accessibilityRole="button"
        accessibilityLabel={`Tăng ${label}`} hitSlop={6} style={[styles.stepBtn, (disabled || value >= max) && styles.dimmed]}>
        <Ionicons name="add" size={18} color={t.accent} />
      </Pressable>
    </View>
  );
}

/** The result of a right answer, played in the world: `progress` goes 0 → 1 once `solved` (at once with reduced
 * motion), as a critical reaction of the feedback loop (the explanation and the next question wait; "Bỏ qua" jumps to
 * the end). Returns the value to draw the result with. */
export function useSolvedReaction(solved: boolean | undefined, name: string, durationMs: number, reduceMotion?: boolean) {
  const progress = useRef(new Animated.Value(solved ? 1 : 0)).current;
  const react = useReactions();
  const sound = useSfx();
  const live = useRef(true);
  useLayoutEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!solved) { progress.setValue(0); return; }
    sound('unlock');
    const toEnd = () => { progress.stopAnimation(); progress.setValue(1); };
    const end = react.begin(name, { maxMs: durationMs + 1500, finish: toEnd });
    const anim = Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 1 : durationMs, easing: Easing.inOut(Easing.quad),
      useNativeDriver: false });
    anim.start(() => { end(); if (live.current) sound('complete'); });
    return () => { anim.stop(); end(); };
  }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps
  return progress;
}

/** A wrong answer: a short shake (0 → 1 → 0) felt in the world; never holds the game. Calls `after` once it is over. */
export function useWrongShake(feedback: Note | undefined, name: string, reduceMotion?: boolean, after?: () => void) {
  const shake = useRef(new Animated.Value(0)).current;
  const react = useReactions();
  const sound = useSfx();
  const last = useRef(feedback);
  const done = useRef(after);
  done.current = after;
  useEffect(() => {
    if (feedback === last.current) return;
    last.current = feedback;
    if (!feedback || feedback.tone !== 'bad') return;
    sound('wrong');
    const finish = () => { shake.stopAnimation(); shake.setValue(0); done.current?.(); };
    const end = react.begin(name, { critical: false, maxMs: 1200, finish });
    if (reduceMotion) { finish(); end(); return; }
    const anim = Animated.sequence([-1, 1, -1, 1, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 80, useNativeDriver: false })));
    anim.start(() => { done.current?.(); end(); });
    return () => { anim.stop(); end(); };
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps
  return shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] });
}

/** The shared styles, per theme: `const ui = useCommonStyles();` in each component. */
export const useCommonStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  scene: { gap: 12, paddingVertical: 4 },
  instruction: { fontSize: 16, fontWeight: '800', color: t.ink, textAlign: 'center' },
  hint: { fontSize: 13, fontWeight: '700', color: t.muted, textAlign: 'center' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 10 },
  noteGood: { backgroundColor: t.successBg },
  noteBad: { backgroundColor: t.dangerBg },
  noteText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.accentFill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: t.onPrimary, fontWeight: '900', fontSize: 16 },
  secondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontWeight: '900', fontSize: 15 },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.card, borderWidth: 2, borderColor: t.accent, alignItems: 'center',
    justifyContent: 'center' },
  stepValue: { minWidth: 40, textAlign: 'center', fontSize: 18, fontWeight: '900' },
}));
