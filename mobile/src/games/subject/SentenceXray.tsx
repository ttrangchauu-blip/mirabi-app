import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Actions, NoteLine, SceneProps, styles as ui, useSolvedReaction, useWrongShake } from './common';
import { HIGHLIGHTERS, keptPaint, Paint, paintAnswer, paintWord } from './logic';

// Soi câu (Tiếng Việt / Tiếng Anh): a sentence on a light box. Each role is a highlighter (sự vật, hoạt động, đặc
// điểm…); the learner takes one and taps the pieces of the sentence to paint them (the same colour again clears it).
// Pieces with no role stay unpainted. Kiểm tra: the backend compares every piece's colour; the pieces painted right lock,
// the first wrong one is named. Right: a scan line sweeps the box and every painted piece lights up.

export function SentenceXray({ turn, disabled, feedback, solved, onSubmit, reduceMotion, demo }: SceneProps & {
  demo?: { paint: Paint; pen?: string; solved?: boolean };
}) {
  const p = turn.prompt;
  const roles = p.roles ?? [];
  const words = p.words ?? [];
  const [own, setOwn] = useState<Paint>({});
  const [locked, setLocked] = useState<Paint>({});
  const [pen, setPen] = useState<string>(roles[0]?.id ?? 'c1');
  const paint = demo?.paint ?? own;
  const hand = demo?.pen ?? pen;
  const done = !!solved || !!demo?.solved;
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'xray:done', 900, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);
  const [boxWidth, setBoxWidth] = useState(0);

  // Wrong: the pieces painted right lock; the others keep their colour to be fixed.
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad' || feedback.final) return;
    setLocked(keptPaint(feedback.kept));
  }, [feedback]);
  const shake = useWrongShake(feedback, 'xray:wrong', reduceMotion);

  const colour = (id: string) => HIGHLIGHTERS[Math.max(0, roles.findIndex((r) => r.id === id))] ?? HIGHLIGHTERS[0];
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? '';
  const scan = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(boxWidth - 6, 0)] });
  const glow = progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] });

  return (
    <View style={st.world}>
      <Text style={ui.instruction}>{p.prompt}</Text>
      {!done ? (
        <View style={st.pens} accessibilityRole="radiogroup" accessibilityLabel="Bút màu">
          {roles.map((r) => {
            const c = colour(r.id);
            const on = hand === r.id;
            return (
              <Pressable key={r.id} onPress={() => !off && setPen(r.id)} disabled={off} accessibilityRole="radio"
                accessibilityState={{ checked: on }} accessibilityLabel={`Bút ${r.name}`}
                style={({ pressed }) => [st.pen, { backgroundColor: c.fill, borderColor: on ? c.ink : 'transparent' }, pressed && ui.pressed]}>
                <Ionicons name={on ? 'brush' : 'brush-outline'} size={16} color={c.ink} />
                <Text style={[st.penText, { color: c.ink }]}>{r.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Animated.View style={[st.box, { transform: [{ translateX: shake }] }]} onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Câu: ${words.map((w) => w.text).join(' ')}`}>
        <View style={st.words}>
          {words.map((w) => {
            if (w.fixed) return <Text key={w.id} style={st.punct}>{w.text}</Text>;
            const c = paint[w.id] ? colour(paint[w.id]) : null;
            const isLocked = !!locked[w.id] && locked[w.id] === paint[w.id];
            return (
              <Pressable key={w.id} onPress={() => !off && setOwn((m) => paintWord(m, w.id, hand, locked))} disabled={off || isLocked}
                accessibilityRole="button" accessibilityState={{ disabled: off || isLocked }}
                accessibilityLabel={`${w.text}${c ? `, tô ${roleName(paint[w.id])}` : ', chưa tô'}${isLocked ? ', đúng' : ''}`}
                style={({ pressed }) => [st.word, c && { backgroundColor: c.fill, borderColor: c.ink }, isLocked && st.wordLocked, pressed && ui.pressed]}>
                <Text style={[st.wordText, c && { color: c.ink }]}>{w.text}</Text>
                {isLocked && !done ? <Ionicons name="lock-closed" size={10} color={c?.ink ?? t.success} /> : null}
                {c && done ? <Animated.View pointerEvents="none" style={[st.glow, { opacity: glow }]} /> : null}
              </Pressable>
            );
          })}
        </View>
        {done ? <Animated.View pointerEvents="none" style={[st.scan, { transform: [{ translateX: scan }] }]} /> : null}
      </Animated.View>
      <View style={st.legend}>
        {roles.map((r) => {
          const c = colour(r.id);
          const count = Object.values(paint).filter((x) => x === r.id).length;
          return <Text key={r.id} style={[st.legendText, { color: c.ink }]}>{`${r.name}: ${count}`}</Text>;
        })}
      </View>
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Mỗi từ đã đúng màu.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Xoá màu" onReset={() => setOwn((m) => Object.fromEntries(Object.entries(m).filter(([id, c]) => locked[id] === c)))}
          resetDisabled={off || Object.entries(paint).every(([id, c]) => locked[id] === c)}
          onCheck={() => onSubmit(paintAnswer(paint))} checkDisabled={off || !Object.keys(paint).length} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: '#FFF2F6', borderWidth: 2, borderColor: '#F6CFDC' },
  pens: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  pen: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 3 },
  penText: { fontSize: 14, fontWeight: '900' },
  box: { padding: 14, borderRadius: 16, backgroundColor: '#1F2A44', overflow: 'hidden', minHeight: 96, justifyContent: 'center' },
  words: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  word: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#FFFFFF',
    borderWidth: 2, borderColor: '#FFFFFF', overflow: 'hidden' },
  wordLocked: { borderStyle: 'solid' },
  wordText: { fontSize: 17, fontWeight: '800', color: t.ink },
  punct: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  glow: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.45)' },
  scan: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 6, backgroundColor: 'rgba(120,230,255,0.85)' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  legendText: { fontSize: 13, fontWeight: '800' },
});
