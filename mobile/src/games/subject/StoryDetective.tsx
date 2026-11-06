import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { usePetCheer } from '../engine/rig';
import { Text } from '../../components/Typography';
import { makeStyles, useTheme } from '../../ui/theme';
import { Actions, NoteLine, SceneProps, useCommonStyles, useSolvedReaction, useWrongShake } from './common';

// Thám tử đọc hiểu (Tiếng Việt / Tiếng Anh): a case file. The question is the case; the text is read sentence by
// sentence, each a clue card. First the learner picks the sentence that proves the answer and presses "Kiểm tra" (the
// evidence); the backend confirms it, and only then do the answers come (before, there is nothing to guess among). A wrong
// clue is crossed out with the backend's hint; a wrong answer is crossed out with why. Right: the clue glows and the
// file is stamped "Đã phá án".

export function StoryDetective({ turn, disabled, feedback, solved, onSubmit, reduceMotion, petId, petLevel, demo }: SceneProps & {
  demo?: { picked?: string | null; found?: string | null; option?: string | null; solved?: boolean };
}) {
  const { t } = useTheme();
  const ui = useCommonStyles();
  const st = useStyles();
  const purple = st.purple.color;
  const p = turn.prompt;
  const sentences = p.sentences ?? [];
  const answering = p.phase === 'answer' || !!demo?.found;
  const found = demo?.found ?? p.found ?? null;
  const options = p.options ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [crossed, setCrossed] = useState<string[]>([]);
  const choice = demo ? (answering ? demo.option ?? null : demo.picked ?? null) : picked;
  const done = !!solved || !!demo?.solved;
  const cheer = usePetCheer(petId, petLevel ?? 1, done, reduceMotion);
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'story:done', 900, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);

  // The clue confirmed: on to the answers, with nothing picked or crossed yet.
  useEffect(() => { setPicked(null); setCrossed([]); }, [p.phase]);
  // Wrong: what was picked is crossed out (it cannot be picked again by mistake).
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad' || !picked) return;
    setCrossed((c) => [...c, picked]);
    setPicked(null);
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps
  const shake = useWrongShake(feedback, 'story:wrong', reduceMotion);

  const stamp = progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [2.2, 0.9, 1] });
  const en = p.lang === 'en';

  return (
    <View style={st.world}>
      <View style={st.caseCard} accessibilityLabel={`Câu hỏi: ${p.question ?? ''}`}>
        <Ionicons name="search" size={20} color={purple} />
        <Text style={st.question}>{p.question}</Text>
      </View>
      <Text style={ui.hint}>{answering ? 'Dựa vào manh mối, chọn câu trả lời.' : 'Chạm vào câu chứng minh câu trả lời, rồi nhấn Kiểm tra.'}</Text>
      <Animated.View style={[st.file, { transform: [{ translateX: answering ? 0 : shake }] }]} accessibilityLabel={en ? 'Bài đọc tiếng Anh' : 'Bài đọc'}>
        {sentences.map((s, i) => {
          const isFound = found === s.id;
          const isPicked = !answering && choice === s.id;
          const isCrossed = !answering && crossed.includes(s.id);
          return (
            <Pressable key={s.id} onPress={() => setPicked(s.id)} disabled={off || answering || isCrossed} accessibilityRole="button"
              accessibilityState={{ selected: isPicked, disabled: off || answering || isCrossed }}
              accessibilityLabel={`Câu ${i + 1}: ${s.text}${isFound ? '. Manh mối' : isCrossed ? '. Không phải bằng chứng' : ''}`}
              style={[st.sentence, isPicked && st.sentencePicked, isFound && st.sentenceFound, isCrossed && st.sentenceCrossed]}>
              <Text style={[st.number, isFound && { color: '#FFFFFF', backgroundColor: '#C98A00' }]}>{i + 1}</Text>
              <Text style={[st.sentenceText, isCrossed && st.crossedText]}>{s.text}</Text>
              {isFound ? <Ionicons name="key" size={16} color="#C98A00" /> : null}
            </Pressable>
          );
        })}
        {done ? (
          <Animated.View pointerEvents="none" style={[st.stamp, { opacity: progress, transform: [{ scale: stamp }, { rotate: '-12deg' }] }]}>
            <Text style={st.stampText}>ĐÃ PHÁ ÁN</Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      {answering ? (
        <Animated.View style={[st.options, { transform: [{ translateX: shake }] }]}>
          {options.map((o) => {
            const isCrossed = crossed.includes(o.id);
            const isPicked = choice === o.id;
            return (
              <Pressable key={o.id} onPress={() => setPicked(o.id)} disabled={off || isCrossed} accessibilityRole="radio"
                accessibilityState={{ checked: isPicked, disabled: off || isCrossed }} accessibilityLabel={`${o.text}${isCrossed ? ', đã loại' : ''}`}
                style={({ pressed }) => [st.option, isPicked && st.optionPicked, isCrossed && st.optionCrossed, done && isPicked && st.optionRight,
                  pressed && ui.pressed]}>
                <Ionicons name={done && isPicked ? 'checkmark-circle' : isCrossed ? 'close-circle' : isPicked ? 'radio-button-on' : 'radio-button-off'}
                  size={20} color={done && isPicked ? t.success : isCrossed ? t.danger : purple} />
                <Text style={[st.optionText, isCrossed && st.crossedText]}>{o.text}</Text>
              </Pressable>
            );
          })}
        </Animated.View>
      ) : null}
      <View style={st.petRow} pointerEvents="none">
        <PetArt pet={petId} size={32} stage={petLevel} still={reduceMotion || !done} cheer={cheer} />
        <Ionicons name="search-circle" size={26} color={purple} />
      </View>
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Vụ án đã được phá.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Bỏ chọn" onReset={() => setPicked(null)} resetDisabled={off || !choice}
          onCheck={() => choice && onSubmit([choice])} checkDisabled={off || !choice} />
      )}
    </View>
  );
}

const PURPLE = '#5B3FA0';

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  purple: { color: dark ? tones.lilac.ink : PURPLE },
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: dark ? tones.lilac.from : '#F5F0FC', borderWidth: 2,
    borderColor: dark ? tones.lilac.to : '#DCCFF3' },
  caseCard: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: t.card,
    borderLeftWidth: 5, borderLeftColor: dark ? tones.lilac.ink : PURPLE },
  question: { flex: 1, fontSize: 16, fontWeight: '900', color: t.ink, lineHeight: 22 },
  file: { gap: 6, padding: 10, borderRadius: 14, backgroundColor: dark ? t.surfaceSecondary : '#FFFDF6', borderWidth: 1,
    borderColor: dark ? t.border : '#EADFC4' },
  sentence: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 8, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  sentencePicked: { borderColor: dark ? tones.lilac.ink : PURPLE, backgroundColor: dark ? tones.lilac.to : '#EFE8FA' },
  sentenceFound: { borderColor: '#E3B23C', backgroundColor: dark ? tones.sun.from : '#FFF3CF' },
  sentenceCrossed: { opacity: 0.55 },
  number: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', textAlign: 'center', fontSize: 12, fontWeight: '900',
    color: dark ? tones.lilac.ink : PURPLE, backgroundColor: dark ? tones.lilac.from : '#EFE8FA', lineHeight: 22 },
  sentenceText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: t.ink },
  crossedText: { textDecorationLine: 'line-through', color: t.muted },
  stamp: { position: 'absolute', right: 14, bottom: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 3, borderColor: '#C0392B',
    borderRadius: 8 },
  stampText: { fontSize: 18, fontWeight: '900', color: '#C0392B', letterSpacing: 2 },
  options: { gap: 8 },
  option: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    backgroundColor: t.card, borderWidth: 2, borderColor: dark ? tones.lilac.to : '#DCCFF3' },
  optionPicked: { borderColor: dark ? tones.lilac.ink : PURPLE },
  optionCrossed: { opacity: 0.55, borderColor: t.danger },
  optionRight: { borderColor: t.success, backgroundColor: t.successBg },
  optionText: { flex: 1, fontSize: 15, fontWeight: '700', color: t.ink },
  petRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
}));
