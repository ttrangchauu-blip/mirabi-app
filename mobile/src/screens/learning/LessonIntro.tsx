import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { learningApi } from '../../learning/api';
import { GAME_INFO, gameTitle, modeDetail } from '../../learning/labels';
import { LearningPrefs, speakEnglish } from '../../learning/prefs';
import type { Intro, LearningSession } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, ScreenHeader } from '../../ui/kit';

/** Knowledge shown before playing (and again from the pause menu): words, a grammar point, or a math method. */
export function IntroContent({ intro, prefs }: { intro: Intro; prefs: LearningPrefs }) {
  if (intro.kind === 'vocabulary') {
    return (
      <View>
        <Text style={styles.title}>{intro.title}</Text>
        {intro.tip ? <Text style={styles.muted}>{intro.tip}</Text> : null}
        {intro.words.map((w) => (
          <View key={`${w.word}|${w.meaning_vi}`} style={styles.word}>
            <View style={styles.wordHead}>
              <Text style={styles.wordText}>{w.word}</Text>
              {w.phonetic ? <Text style={styles.phonetic}>{w.phonetic}</Text> : null}
              <View style={styles.flex} />
              {w.pick ? <Text style={[styles.tag, w.pick === 'Cần ôn' ? styles.tagReview : null]}>{w.pick}</Text> : null}
              {w.level ? <Text style={styles.level}>{w.level}</Text> : null}
              <Pressable onPress={() => speakEnglish(w.word, prefs)} disabled={!prefs.sound} accessibilityRole="button"
                accessibilityLabel={`Nghe phát âm ${w.word}`} hitSlop={8} style={[styles.speak, !prefs.sound && styles.dimmed]}>
                <Ionicons name="volume-high-outline" size={18} color={t.accent} />
              </Pressable>
            </View>
            <Text style={styles.meaning}>
              {w.part_of_speech && w.level ? <Text style={styles.pos}>{w.part_of_speech} · </Text> : null}
              {w.meaning_vi}{w.context_vi ? ` (${w.context_vi})` : ''}
            </Text>
            {w.example_en ? <Text style={styles.example}>“{w.example_en}”{w.example_vi ? ` — ${w.example_vi}` : ''}</Text> : null}
          </View>
        ))}
      </View>
    );
  }
  if (intro.kind === 'grammar') {
    return (
      <View>
        <Text style={styles.title}>{intro.title}</Text>
        {intro.explanation.map((line, i) => <Text key={i} style={styles.body}>{line}</Text>)}
        {intro.rules.map((rule) => (
          <View key={rule.form} style={styles.rule}>
            <Text style={styles.ruleForm}>{rule.form}</Text>
            <Text style={styles.example}>{rule.example}</Text>
          </View>
        ))}
        {intro.examples.map((ex) => <Text key={ex.en} style={styles.example}>“{ex.en}” — {ex.vi}</Text>)}
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.title}>{intro.title}</Text>
      {intro.explanation.map((line, i) => <Text key={i} style={styles.body}>{line}</Text>)}
      {intro.examples.map((ex) => (
        <View key={ex.problem} style={styles.rule}>
          <Text style={styles.ruleForm}>Ví dụ: {ex.problem}</Text>
          {ex.steps.map((step, i) => <Text key={i} style={styles.example}>{i + 1}. {step}</Text>)}
          <Text style={styles.answer}>Kết quả: {ex.answer}</Text>
        </View>
      ))}
      {intro.tips.map((tip, i) => <Text key={i} style={styles.muted}>💡 {tip}</Text>)}
    </View>
  );
}

type Props = { session: LearningSession; prefs: LearningPrefs; onBack: () => void; onPlay: () => void };

/** "Giới thiệu kiến thức trước khi chơi": the words or rule drawn for this session (it is random every time).
 * The session waits paused; its clock starts with "Bắt đầu chơi". Going back drops the unplayed session. */
export function LessonIntro({ session, prefs, onBack, onPlay }: Props) {
  const [intro, setIntro] = useState<Intro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { setIntro(await learningApi.intro(session.id)); } catch (e) { setError(errorMessage(e)); }
  }, [session.id]);
  useEffect(() => { void load(); }, [load]);

  const back = async () => {
    setLeaving(true);
    try { await learningApi.abandon(session.id); } catch { /* the session expires on its own if this fails */ }
    onBack();
  };

  const game = GAME_INFO[session.game];
  return (
    <>
      <ScreenHeader title="Trước khi chơi" subtitle={`${session.subject.name} · ${session.topic.name} · ${session.level.name}`} right={
        <Pressable onPress={() => void back()} disabled={leaving} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8}>
          <Ionicons name="close" size={26} color={t.ink} />
        </Pressable>} />
      {!intro && !error ? <ActivityIndicator color={t.accent} /> : null}
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" onPress={() => void load()} /></Card> : null}
      {intro ? <Card><IntroContent intro={intro} prefs={prefs} /></Card> : null}
      <Card style={styles.howTo}>
        <Ionicons name={game.icon} size={22} color={t.accent} />
        <View style={styles.flex}>
          <Text style={styles.howToTitle}>{gameTitle(session.game)}</Text>
          <Text style={styles.muted}>{game.howTo} {modeDetail(session.game, session.mode)}</Text>
        </View>
      </Card>
      <Button title="Bắt đầu chơi" icon="play" disabled={!intro || leaving} onPress={onPlay} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontSize: 19, fontWeight: '900', color: t.ink, marginBottom: 6 },
  muted: { fontSize: 14, color: t.muted, lineHeight: 20, marginTop: 4 },
  body: { fontSize: 15, color: t.ink, lineHeight: 22, marginBottom: 6 },
  word: { borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 10 },
  wordHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordText: { fontSize: 20, fontWeight: '900', color: t.accent },
  phonetic: { fontSize: 14, color: t.muted },
  speak: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.4 },
  meaning: { fontSize: 16, fontWeight: '800', color: t.ink, marginTop: 2 },
  pos: { fontSize: 13, fontWeight: '700', color: t.muted, fontStyle: 'italic' },
  level: { fontSize: 11, fontWeight: '900', color: t.accent, backgroundColor: t.tint, borderRadius: 7, paddingHorizontal: 6,
    paddingVertical: 2, overflow: 'hidden' },
  tag: { fontSize: 11, fontWeight: '800', color: t.success, backgroundColor: t.successBg, borderRadius: 7, paddingHorizontal: 6,
    paddingVertical: 2, overflow: 'hidden' },
  tagReview: { color: '#8A5A00', backgroundColor: '#FFF1D6' },
  example: { fontSize: 14, color: t.muted, lineHeight: 20, marginTop: 2 },
  rule: { backgroundColor: t.tint, borderRadius: 14, padding: 10, marginTop: 8 },
  ruleForm: { fontSize: 15, fontWeight: '900', color: t.ink },
  answer: { fontSize: 14, fontWeight: '900', color: t.success, marginTop: 4 },
  howTo: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  howToTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  error: { color: t.danger, fontWeight: '700', marginTop: 8 },
});
