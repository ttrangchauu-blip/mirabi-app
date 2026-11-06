import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../components/Typography';
import { ERROR_TYPE_LABEL } from '../../../learning/labels';
import type { Turn, TurnResult } from '../../../learning/types';
import { makeStyles, useTheme, type Theme } from '../../../ui/theme';
import { Button } from '../../../ui/kit';
import { showNumber } from './NumberPad';

// The answer's feedback, shared by every game that answers one question at a time. Nothing pops up: the question answered
// stays on screen, locked (multiple choice: marked, the option chosen green or red, the right one green), and one card
// under it says right or wrong, gives the answer and the explanation, and waits for "Tiếp theo".

/** After an answer: the option chosen, the right ones (from the backend, only once answered) and whether it was right. */
export type ChoiceResult = { chosen: string | null; correct: string[]; right: boolean };
/** right: chosen and right; wrong: chosen and wrong; answer: the right one, not chosen; other: neither. */
export type ChoiceMark = 'right' | 'wrong' | 'answer' | 'other';

export function markOf(result: ChoiceResult | null | undefined, id: string): ChoiceMark | null {
  if (!result) return null;
  if (id === result.chosen) return result.right ? 'right' : 'wrong';
  return result.correct.includes(id) ? 'answer' : 'other';
}

/** The options' colours fade in this long (150–250 ms), and the card slides in this long (200–300 ms). */
const MARK_MS = 200;
const CARD_MS = 260;
/** The marked options' colours and icons, per theme (right/answer: success, wrong: danger). */
const useMarks = makeStyles(({ t }: Theme) => ({
  colors: {
    right: { bg: t.successBg, border: t.success },
    answer: { bg: t.successBg, border: t.success },
    wrong: { bg: t.dangerBg, border: t.danger },
    other: null,
  } as Record<ChoiceMark, { bg: string; border: string } | null>,
  icons: {
    right: { name: 'checkmark-circle', color: t.success },
    answer: { name: 'checkmark-circle', color: t.success },
    wrong: { name: 'close-circle', color: t.danger },
    other: null,
  } as Record<ChoiceMark, { name: 'checkmark-circle' | 'close-circle'; color: string } | null>,
}));
const MARK_LABEL: Record<ChoiceMark, string> = { right: ', đúng', wrong: ', chưa đúng', answer: ', đáp án đúng', other: '' };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** One option of a multiple-choice question: a light press, then (once answered) its colour and a ✓ / ✕ that pops in. */
export function ChoiceOption({ label, onPress, disabled, mark, idle, style, reduceMotion, children }: {
  label: string; onPress: () => void; disabled: boolean; mark: ChoiceMark | null;
  /** The option's own colours before it is marked. */ idle: { bg: string; border: string };
  style?: StyleProp<ViewStyle>; reduceMotion?: boolean; children: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors: MARK_COLORS, icons: MARK_ICON } = useMarks();
  const press = useRef(new Animated.Value(1)).current;
  const tone = useRef(new Animated.Value(mark ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(mark ? 1 : 0)).current;
  useEffect(() => {
    const to = mark && mark !== 'other' ? 1 : 0;
    if (reduceMotion || !to) { tone.setValue(to); pop.setValue(to); return; }
    // Colours on the JS driver (the native one cannot animate them); the icon's scale on the native one.
    const colour = Animated.timing(tone, { toValue: 1, duration: MARK_MS, easing: Easing.out(Easing.quad), useNativeDriver: false });
    const icon = Animated.timing(pop, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(2)), useNativeDriver: true });
    colour.start(); icon.start();
    return () => { colour.stop(); icon.stop(); };
  }, [mark, reduceMotion, tone, pop]);
  const pressTo = (toValue: number) => {
    if (reduceMotion) return;
    Animated.timing(press, { toValue, duration: 90, useNativeDriver: false }).start();
  };
  const target = (mark && MARK_COLORS[mark]) || idle;
  const icon = mark ? MARK_ICON[mark] : null;
  return (
    <AnimatedPressable onPress={onPress} onPressIn={() => pressTo(0.97)} onPressOut={() => pressTo(1)} disabled={disabled}
      accessibilityRole="button" accessibilityState={{ disabled, selected: mark === 'right' || mark === 'wrong' }}
      accessibilityLabel={`${label}${mark ? MARK_LABEL[mark] : ''}`}
      style={[style, {
        backgroundColor: tone.interpolate({ inputRange: [0, 1], outputRange: [idle.bg, target.bg] }),
        borderColor: tone.interpolate({ inputRange: [0, 1], outputRange: [idle.border, target.border] }),
        transform: [{ scale: press }],
      }, mark === 'other' && styles.other]}>
      {children}
      {icon ? (
        <Animated.View style={[styles.markIcon, { transform: [{ scale: pop }] }]} pointerEvents="none">
          <Ionicons name={icon.name} size={22} color={icon.color} />
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
}

const ANSWER_LABEL: Partial<Record<Turn['kind'], string>> = { order_steps: 'Thứ tự đúng', match_pairs: 'Các cặp đúng', spell_fix: 'Câu viết đúng',
  timeline_place: 'Dòng thời gian', sentence_build: 'Câu đúng', equation_balance: 'Phương trình đã cân bằng',
  number_line_place: 'Vị trí đúng', step_solve: 'Lời giải', story_evidence: 'Câu trả lời', sentence_paint: 'Các từ đúng màu' };

/** The card under the question: right or wrong, the answer, why, and "Tiếp theo" (never moves on by itself). */
export function AnswerFeedback({ result, kind, graded = true, nextLabel, onNext, reduceMotion, onLayout }: {
  result: TurnResult; kind?: Turn['kind'] | null;
  /** false: a self-assessment (tự đánh giá), which has no right answer to show. */ graded?: boolean;
  nextLabel: string; onNext: () => void; reduceMotion?: boolean; onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const { t } = useTheme();
  const styles = useStyles();
  const right = result.correct === true;
  const revealed = result.outcome === 'revealed';
  const tone = right || !graded ? 'right' : 'wrong';
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const pop = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { enter.setValue(1); pop.setValue(1); return; }
    const a = Animated.parallel([
      Animated.timing(enter, { toValue: 1, duration: CARD_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pop, { toValue: 1, duration: 240, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [enter, pop, reduceMotion]);
  // One press moves on: a second tap (or a double tap) never skips the next question.
  const [left, setLeft] = useState(false);
  const next = () => { if (left) return; setLeft(true); onNext(); };
  const title = !graded ? 'Đã ghi nhận câu trả lời' : right ? 'Chính xác!' : revealed ? 'Đáp án' : 'Chưa chính xác!';
  const hearts = result.hearts_delta < 0 ? ' · −1 tim' : '';
  const answer = result.correct_answer ? showNumber(result.correct_answer) : '';
  const label = (kind && ANSWER_LABEL[kind]) ?? (right ? (kind === 'geometry_build' ? 'Đã tạo' : 'Đáp án') : 'Đáp án đúng');
  // Why the answer given is not right (Chọn đáp án: why the option chosen is or is not), then the lesson's explanation.
  const why = (!right || kind === 'choice_explain') && result.feedback && result.feedback !== result.explanation ? result.feedback : null;
  const good = tone === 'right';
  return (
    <Animated.View testID="answer-feedback" onLayout={onLayout}
      style={[styles.card, good ? styles.cardGood : styles.cardBad,
        { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <View style={styles.head} accessibilityLiveRegion="polite" accessible accessibilityLabel={`${title}${hearts}`}>
        <Animated.View style={[styles.badge, good ? styles.badgeGood : styles.badgeBad, { transform: [{ scale: pop }] }]}>
          <Ionicons name={good ? 'checkmark' : revealed ? 'eye' : 'close'} size={18} color={t.onPrimary} />
        </Animated.View>
        <Text style={[styles.title, { color: good ? t.success : t.danger }]}>{title}{hearts}</Text>
      </View>
      {graded && answer ? (
        <Text style={styles.answerLine}>
          <Text style={styles.answerLabel}>{label}: </Text>
          <Text style={styles.answer}>{answer}</Text>
        </Text>
      ) : null}
      {why ? <Text style={styles.body}>{why}</Text> : null}
      {result.explanation ? (
        <View style={styles.explain}>
          <Text style={styles.explainLabel}>Giải thích:</Text>
          <Text style={styles.body}>{result.explanation}</Text>
        </View>
      ) : null}
      {result.error_type && ERROR_TYPE_LABEL[result.error_type] ? <Text style={styles.errorType}>Lỗi thường gặp: {ERROR_TYPE_LABEL[result.error_type]}</Text> : null}
      {result.practice_added ? <Text style={styles.muted}>Câu này sẽ quay lại để bạn luyện thêm một lần.</Text> : null}
      <Button title={nextLabel} icon="arrow-forward" onPress={next} disabled={left} style={styles.next} />
    </Animated.View>
  );
}

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  other: { opacity: 0.55 },
  markIcon: { position: 'absolute', top: 6, right: 6 },
  card: { borderRadius: 18, borderWidth: 1.5, padding: 14, gap: 8, marginTop: 12, marginBottom: 8 },
  // Paler than successBg/dangerBg in light; the tokens themselves (with a matching deep border) in dark.
  cardGood: { backgroundColor: dark ? t.successBg : '#F0FAF5', borderColor: dark ? '#2B5E4C' : '#BFE5D1' },
  cardBad: { backgroundColor: dark ? t.dangerBg : '#FFF4F1', borderColor: dark ? '#5E3047' : '#F5CDC2' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeGood: { backgroundColor: t.success },
  badgeBad: { backgroundColor: t.danger },
  title: { flex: 1, fontSize: 18, fontWeight: '900' },
  answerLine: { fontSize: 15, lineHeight: 22, color: t.ink },
  answerLabel: { fontWeight: '700', color: t.muted },
  answer: { fontWeight: '900', color: t.ink },
  explain: { gap: 2 },
  explainLabel: { fontSize: 14, fontWeight: '900', color: t.ink },
  body: { fontSize: 15, lineHeight: 22, color: t.ink },
  errorType: { fontSize: 13, color: t.danger, fontWeight: '800' },
  muted: { color: t.muted, fontSize: 13, lineHeight: 19 },
  next: { marginTop: 4 },
}));
