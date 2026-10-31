import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { PetArt } from '../../components/PetArt';
import { learningApi } from '../../learning/api';
import { ERROR_TYPE_LABEL, gameTitle, MODE_INFO, OUTCOME_LABEL, rewardMessage, STATUS_TITLE } from '../../learning/labels';
import type { LearningSession, LessonExplore, Outcome, SessionResult } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, SectionHeader } from '../../ui/kit';
import { showNumber } from './games/NumberPad';

type Props = {
  sessionId: number; petId: string; petLevel: number;
  onReplay: (session: LearningSession) => void; onReview: (topicId: number) => void; onHome: () => void;
  /** A stage of a lesson: open a lesson ("Trò khác trong bài": this one; "Bài tiếp theo": the next). */
  onLesson?: (key: string) => void;
  /** EXP may have changed: the main app reloads the pet's numbers. */
  onRewards: () => void;
  /** No victory hop or popping stars. */
  reduceMotion?: boolean;
};

/** The victory: a completed stage makes the pet hop twice for joy (squash, up, land), once, as the result comes in. */
export const VICTORY_MS = 1100;
function Victory({ won, reduceMotion, children }: { won: boolean; reduceMotion: boolean; children: React.ReactNode }) {
  const k = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!won || reduceMotion) return;
    const hop = (ms: number) => Animated.sequence([
      Animated.timing(k, { toValue: 0.15, duration: ms * 0.18, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(k, { toValue: 0.6, duration: ms * 0.4, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(k, { toValue: 1, duration: ms * 0.42, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(k, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]);
    const run = Animated.sequence([Animated.delay(150), hop(VICTORY_MS * 0.52), hop(VICTORY_MS * 0.34)]);
    run.start();
    return () => run.stop();
  }, [won, reduceMotion, k]);
  // 0 → 0.15: squat; → 0.6: up; → 1: down and a little squash on landing.
  return (
    <Animated.View style={{ transformOrigin: '50% 100%', transform: [
      { translateY: k.interpolate({ inputRange: [0, 0.15, 0.6, 0.95, 1], outputRange: [0, 0, -22, -2, 0] }) },
      { scaleX: k.interpolate({ inputRange: [0, 0.15, 0.3, 0.95, 1], outputRange: [1, 1.08, 0.95, 1.06, 1] }) },
      { scaleY: k.interpolate({ inputRange: [0, 0.15, 0.3, 0.95, 1], outputRange: [1, 0.88, 1.08, 0.92, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** The stars of a stage pop in one after the other, each overshooting a little before it settles; the ones not won
 * stay grey. */
export const STAR_STAGGER_MS = 160;
function Stars({ stars, reduceMotion }: { stars: number; reduceMotion: boolean }) {
  const pops = useRef([0, 1, 2].map(() => new Animated.Value(reduceMotion ? 1 : 0))).current;
  useEffect(() => {
    if (reduceMotion) return;
    const run = Animated.stagger(STAR_STAGGER_MS, pops.map((v) => Animated.spring(v, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true })));
    const all = Animated.sequence([Animated.delay(350), run]);
    all.start();
    return () => all.stop();
  }, [pops, reduceMotion]);
  return (
    <View style={styles.starRow} accessible accessibilityLabel={`${stars} trên 3 sao`}>
      {pops.map((v, i) => (
        <Animated.Text key={i} style={[styles.stars, i >= stars && styles.starsOff, { opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }]}>★</Animated.Text>
      ))}
    </View>
  );
}

const SHOWN: (Outcome | 'unanswered')[] = ['first_try', 'hinted', 'corrected', 'wrong', 'revealed', 'missed', 'unanswered'];
const CORRECT = new Set<string>(['first_try', 'hinted', 'corrected']);

/** Stars for a finished stage, from the share right at the first try: 3 from 90%, 2 from 70%, else 1. A stage not
 * completed has none (it is never a loss: the lesson can be played again). Shown only: EXP is the backend's. */
export function stageStars(status: LearningSession['status'], firstTry: number, total: number): 0 | 1 | 2 | 3 {
  if (status !== 'completed') return 0;
  const share = total > 0 ? firstTry / total : 0;
  return share >= 0.9 ? 3 : share >= 0.7 ? 2 : 1;
}

export function ResultScreen({ sessionId, petId, petLevel, onReplay, onReview, onHome, onRewards, onLesson, reduceMotion = false }: Props) {
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setResult(await learningApi.result(sessionId)); onRewards(); } catch (e) { setError(errorMessage(e)); }
  }, [sessionId, onRewards]);
  useEffect(() => { void load(); }, [load]);
  // A lesson's vocabulary stage: whether it discovered the lesson's last own word (Khám phá từ mới, vocab_lesson.py).
  const [explore, setExplore] = useState<LessonExplore | null>(null);
  const stage = result?.session;
  const lessonKey = stage?.kind === 'lesson' && (stage.game === 'meteor' || stage.game === 'word_shooter') ? stage.catalog?.lesson : undefined;
  useEffect(() => {
    if (!lessonKey || !stage) return;
    let live = true;
    void learningApi.lessonDetail(lessonKey).then((l) => {
      if (live) setExplore(l.games.find((g) => g.game === stage.game)?.explore ?? null);
    }).catch(() => {});
    return () => { live = false; };
  }, [lessonKey, stage]);

  if (error) return <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" onPress={() => void load()} /></Card>;
  if (!result) return <ActivityIndicator color={t.accent} />;
  const s = result.session;
  const reward = rewardMessage(s.reward, s.kind);
  const total = s.required_count || 1;
  const lesson = s.catalog ?? null;
  const stars = stageStars(s.status, result.counts.first_try, total);
  return (
    <>
      <Card style={styles.hero}>
        <Victory won={s.status === 'completed'} reduceMotion={reduceMotion}>
          <PetArt pet={petId} size={96} stage={petLevel} still />
        </Victory>
        <Text style={styles.title} accessibilityRole="header">{STATUS_TITLE[s.status]}</Text>
        {stars ? <Stars stars={stars} reduceMotion={reduceMotion} /> : null}
        {lesson?.title ? (
          <Text style={[styles.muted, styles.center]}>Lớp {lesson.grade} · {lesson.subject_name} · {lesson.title} · {lesson.game_title ?? gameTitle(s.game)}</Text>
        ) : <Text style={[styles.muted, styles.center]}>{s.lesson.name} · {gameTitle(s.game)} · {MODE_INFO[s.mode].name}</Text>}
        {s.end_reason === 'time_up' ? <Text style={styles.muted}>Bạn đã kết thúc khi hết thời lượng. Hết giờ không phải là thua!</Text> : null}
        {s.mode === 'challenge' ? <Text style={styles.score}>⭐ {s.score} điểm · Combo cao nhất x{s.max_combo}</Text>
          : s.max_combo >= 3 ? <Text style={styles.score}>🔥 Combo cao nhất x{s.max_combo}</Text> : null}
        <Text style={styles.accuracy}>Đúng ngay {result.counts.first_try}/{total} câu</Text>
        {reward ? <Text style={[styles.reward, s.reward?.exp ? styles.rewardOn : null]} accessibilityRole="text">{reward}</Text> : null}
        {explore && s.status === 'completed' && explore.core_completed_session === s.id ? (
          <Text style={styles.explore} accessibilityRole="text">
            {explore.exhausted ? 'Bạn đã hoàn thành từ vựng của bài này!'
              : 'Bạn đã hoàn thành từ vựng của bài này! Hãy tiếp tục khám phá những từ mới cùng chủ đề nhé!'}
          </Text>
        ) : null}
        {explore?.exhausted && s.status === 'completed' ? (
          <Text style={styles.explore} accessibilityRole="text">Bạn đã khám phá hết từ mới phù hợp trong trò này. Hãy Ôn tập để nhớ thật lâu nhé!</Text>
        ) : null}
      </Card>
      <Card>
        {SHOWN.filter((k) => result.counts[k]).map((k) => (
          <View key={k} style={styles.countRow}><Text style={styles.countLabel}>{OUTCOME_LABEL[k]}</Text><Text style={styles.countValue}>{result.counts[k]}</Text></View>
        ))}
      </Card>
      <View style={styles.actions}>
        {result.open_review_count ? <Button title={`Ôn lại (${result.open_review_count})`} icon="refresh-circle-outline" onPress={() => onReview(s.topic.id)} /> : null}
        <Button title="Chơi lại" icon="play" variant={result.open_review_count ? 'secondary' : 'primary'} onPress={() => onReplay(s)} />
        {lesson?.title && onLesson && lesson.other_games.length ? (
          <Button title="Trò khác trong bài" icon="game-controller-outline" variant="secondary" onPress={() => onLesson(lesson.lesson)} />
        ) : null}
        {lesson?.next && onLesson ? (
          <Button title={`Bài tiếp theo: ${lesson.next.title}`} icon="arrow-forward" variant="secondary" onPress={() => onLesson(lesson.next!.key)} />
        ) : null}
        {lesson?.title && onLesson ? (
          <Button title="Về bài học" variant="ghost" onPress={() => onLesson(lesson.lesson)} />
        ) : <Button title="Về màn chọn môn" variant="ghost" onPress={onHome} />}
      </View>
      <SectionHeader title="Xem lại từng câu" />
      {result.items.map((item) => item.word ? (
        // A vocabulary turn: the word, its pronunciation and meaning once, and how it went.
        <Card key={item.turn_id} style={[styles.item, styles.wordItem]}>
          <View style={styles.flex}>
            <Text style={styles.wordEn}>{item.word.en}{item.word.phonetic ? <Text style={styles.phonetic}>  {item.word.phonetic}</Text> : null}</Text>
            <Text style={styles.wordVi}>{item.word.vi}</Text>
            {item.practice ? <Text style={styles.wordTag}>Luyện lại</Text> : null}
          </View>
          <Text style={[styles.outcomeChip, CORRECT.has(item.outcome ?? '') ? styles.chipGood : styles.chipBad]}>{OUTCOME_LABEL[item.outcome ?? 'unanswered']}</Text>
        </Card>
      ) : (
        <Card key={item.turn_id} style={styles.item}>
          <Text style={styles.itemHead}>{item.practice ? 'Luyện lại · ' : ''}{item.skill_label}</Text>
          <Text style={styles.itemPrompt}>{promptText(item.prompt)}</Text>
          <Text style={styles.itemAnswer}>Đáp án: {showNumber(item.correct_answer)}</Text>
          <Text style={[styles.outcome, CORRECT.has(item.outcome ?? '') ? styles.good : styles.bad]}>
            {OUTCOME_LABEL[item.outcome ?? 'unanswered']}{item.error_type && ERROR_TYPE_LABEL[item.error_type] ? ` · ${ERROR_TYPE_LABEL[item.error_type]}` : ''}
          </Text>
          {item.explanation && item.outcome !== 'first_try' ? <Text style={styles.muted}>{item.explanation}</Text> : null}
        </Card>
      ))}
    </>
  );
}

function promptText(p: SessionResult['items'][number]['prompt']) {
  if (p.tiles) return `${p.picture ?? ''}  ${p.tiles.map((x) => x.text).join(' · ')}`; // Ghép chữ
  if (p.step && p.tokens) return p.tokens.map((x) => x.text).join(' '); // Thám tử chính tả: the sentence as shown
  if (p.card) return `${p.card.picture} ${p.card.text}`.trim(); // Phân loại cùng pet
  if (p.cards) return p.prompt ?? ''; // Sắp xếp thứ tự
  if (p.lefts) return p.prompt ?? ''; // Ghép cặp
  if (p.question) return p.question; // Chọn đáp án có giải thích
  if (p.max_blocks) return `Màn ${p.number ?? ''}: đưa pet tới đích, tối đa ${p.max_blocks} lệnh`; // Lập trình đường đi
  if (p.word) return p.word;
  if (p.meaning_vi && !p.tokens) return p.meaning_vi + (p.context_vi ? ` (${p.context_vi})` : '');
  if (p.sentence) return p.sentence;
  if (p.tokens) return p.meaning_vi ?? '';
  if (p.expression) return `${p.expression} = ?`;
  if (p.equation) return p.equation.replace('__', '▢');
  return `${p.left} ▢ ${p.right}`;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4 },
  title: { fontSize: 26, fontWeight: '900', color: t.ink, marginTop: 6 },
  stars: { fontSize: 34, color: '#F2A93B', marginHorizontal: 2 },
  starRow: { flexDirection: 'row', justifyContent: 'center' },
  starsOff: { color: '#E3E8ED' },
  muted: { fontSize: 14, color: t.muted, lineHeight: 20, textAlign: 'left' },
  score: { fontSize: 16, fontWeight: '900', color: t.ink, marginTop: 6 },
  accuracy: { fontSize: 15, fontWeight: '800', color: t.accent },
  explore: { marginTop: 8, fontSize: 15, fontWeight: '800', color: t.success, textAlign: 'center' },
  reward: { marginTop: 8, fontSize: 15, fontWeight: '800', color: t.muted, textAlign: 'center' },
  rewardOn: { color: t.success },
  error: { color: t.danger, fontWeight: '700' },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  countLabel: { fontSize: 15, color: t.ink },
  countValue: { fontSize: 15, fontWeight: '900', color: t.ink },
  actions: { marginBottom: 8 },
  item: { padding: 14 },
  itemHead: { fontSize: 12, fontWeight: '800', color: t.muted, textTransform: 'uppercase' },
  itemPrompt: { fontSize: 16, fontWeight: '800', color: t.ink, marginTop: 2 },
  itemAnswer: { fontSize: 15, fontWeight: '800', color: t.success, marginTop: 4 },
  outcome: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  good: { color: t.success },
  bad: { color: t.danger },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  wordItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  wordEn: { fontSize: 17, fontWeight: '900', color: t.accent },
  phonetic: { fontSize: 13, fontWeight: '600', color: t.muted },
  wordVi: { fontSize: 15, fontWeight: '700', color: t.ink, marginTop: 1 },
  wordTag: { fontSize: 12, fontWeight: '700', color: t.muted, marginTop: 2 },
  outcomeChip: { fontSize: 12, fontWeight: '900', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, overflow: 'hidden' },
  chipGood: { color: t.success, backgroundColor: t.successBg },
  chipBad: { color: t.danger, backgroundColor: t.dangerBg },
});
