import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { PetArt } from '../../components/PetArt';
import { learningApi } from '../../learning/api';
import { ERROR_TYPE_LABEL, gameTitle, MODE_INFO, OUTCOME_LABEL, rewardMessage, STATUS_TITLE } from '../../learning/labels';
import type { LearningSession, Outcome, SessionResult } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, SectionHeader } from '../../ui/kit';
import { showNumber } from './games/NumberPad';

type Props = {
  sessionId: number; petId: string; petLevel: number;
  onReplay: (session: LearningSession) => void; onReview: (topicId: number) => void; onHome: () => void;
  /** EXP may have changed: the main app reloads the pet's numbers. */
  onRewards: () => void;
};

const SHOWN: (Outcome | 'unanswered')[] = ['first_try', 'hinted', 'corrected', 'wrong', 'revealed', 'missed', 'unanswered'];
const CORRECT = new Set<string>(['first_try', 'hinted', 'corrected']);

export function ResultScreen({ sessionId, petId, petLevel, onReplay, onReview, onHome, onRewards }: Props) {
  const [result, setResult] = useState<SessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setResult(await learningApi.result(sessionId)); onRewards(); } catch (e) { setError(errorMessage(e)); }
  }, [sessionId, onRewards]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" onPress={() => void load()} /></Card>;
  if (!result) return <ActivityIndicator color={t.accent} />;
  const s = result.session;
  const reward = rewardMessage(s.reward, s.kind);
  const total = s.required_count || 1;
  return (
    <>
      <Card style={styles.hero}>
        <PetArt pet={petId} size={96} stage={petLevel} still />
        <Text style={styles.title} accessibilityRole="header">{STATUS_TITLE[s.status]}</Text>
        <Text style={[styles.muted, styles.center]}>{s.lesson.name} · {gameTitle(s.game)} · {MODE_INFO[s.mode].name}</Text>
        {s.end_reason === 'time_up' ? <Text style={styles.muted}>Bạn đã kết thúc khi hết thời lượng. Hết giờ không phải là thua!</Text> : null}
        {s.mode === 'challenge' ? <Text style={styles.score}>⭐ {s.score} điểm · Combo cao nhất x{s.max_combo}</Text> : null}
        <Text style={styles.accuracy}>Đúng ngay {result.counts.first_try}/{total} câu</Text>
        {reward ? <Text style={[styles.reward, s.reward?.exp ? styles.rewardOn : null]} accessibilityRole="text">{reward}</Text> : null}
      </Card>
      <Card>
        {SHOWN.filter((k) => result.counts[k]).map((k) => (
          <View key={k} style={styles.countRow}><Text style={styles.countLabel}>{OUTCOME_LABEL[k]}</Text><Text style={styles.countValue}>{result.counts[k]}</Text></View>
        ))}
      </Card>
      <View style={styles.actions}>
        {result.open_review_count ? <Button title={`Ôn lại (${result.open_review_count})`} icon="refresh-circle-outline" onPress={() => onReview(s.topic.id)} /> : null}
        <Button title="Chơi lại" icon="play" variant={result.open_review_count ? 'secondary' : 'primary'} onPress={() => onReplay(s)} />
        <Button title="Về màn chọn môn" variant="ghost" onPress={onHome} />
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
  muted: { fontSize: 14, color: t.muted, lineHeight: 20, textAlign: 'left' },
  score: { fontSize: 16, fontWeight: '900', color: t.ink, marginTop: 6 },
  accuracy: { fontSize: 15, fontWeight: '800', color: t.accent },
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
