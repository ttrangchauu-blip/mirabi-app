import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { usePetCheer } from '../engine/rig';
import { Text } from '../../components/Typography';
import { makeStyles, useTheme } from '../../ui/theme';
import { Actions, NoteLine, SceneProps, useCommonStyles, useSolvedReaction, useWrongShake } from './common';
import { Calc, calcReady, OPERATORS, pickChip, stepAnswer, typedNumber } from './logic';

// Giải toán từng bước (Toán): a word problem climbed like a staircase, one stair per step. Each step asks one question;
// the learner builds its calculation from the problem's numbers (chips: tap two, and an operator) and types the result
// on the keypad. Kiểm tra: the backend confirms the step (the pet climbs a stair, the result becomes a new chip) and
// only then the next question appears — the plan is never shown ahead. Wrong operation: the calculation is shaken and
// can be rebuilt; right operation but wrong result: the calculation stays, only the result is typed again.

const OP_NAME: Record<string, string> = { '+': 'cộng', '−': 'trừ', '×': 'nhân', ':': 'chia' };
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '/'];
const EMPTY: Calc = { left: null, op: null, right: null };

export function StepSolver({ turn, disabled, feedback, solved, onSubmit, reduceMotion, petId, petLevel, demo }: SceneProps & {
  demo?: { calc: Calc; result: string; solved?: boolean };
}) {
  const { t } = useTheme();
  const ui = useCommonStyles();
  const st = useStyles();
  const amber = st.amber.color;
  const p = turn.prompt;
  const chips = p.chips ?? [];
  const steps = p.steps ?? 1;
  const at = p.at_step ?? 1;
  const doneSteps = p.done ?? [];
  const [own, setOwn] = useState<Calc>(EMPTY);
  const [ownResult, setOwnResult] = useState('');
  const calc = demo?.calc ?? own;
  const result = demo?.result ?? ownResult;
  const done = !!solved || !!demo?.solved;
  const cheer = usePetCheer(petId, petLevel ?? 1, done, reduceMotion);
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'step_solver:done', 900, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);

  // A step confirmed: the next one starts empty, the pet climbs a stair.
  const climb = useRef(new Animated.Value(at - 1)).current;
  useEffect(() => {
    setOwn(EMPTY);
    setOwnResult('');
    if (reduceMotion) climb.setValue(at - 1);
    else Animated.spring(climb, { toValue: at - 1, useNativeDriver: false, friction: 6 }).start();
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrong: a right calculation stays (kept), only the result is typed again; a wrong one is shaken and rebuilt.
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad' || feedback.final) return;
    setOwnResult('');
    if (!feedback.kept?.length) setOwn((c) => ({ ...c, op: null }));
  }, [feedback]);
  const shake = useWrongShake(feedback, 'step_solver:wrong', reduceMotion);

  const text = (id: string | null) => chips.find((c) => c.id === id)?.text ?? '';
  const ready = calcReady(calc, result);
  const stair = 34;
  const topY = (steps) * stair;
  const petY = Animated.add(climb, progress).interpolate({ inputRange: [0, steps], outputRange: [0, -topY], extrapolate: 'clamp' });
  const key = (k: string) => { if (!off) setOwnResult((r) => typedNumber(r + k)); };

  return (
    <View style={st.world}>
      <View style={st.top}>
        <View style={st.paper} accessibilityLabel={`Đề bài: ${p.problem ?? ''}`}>
          <Text style={st.problem}>{p.problem}</Text>
        </View>
        <View style={[st.stairs, { height: topY + 40 }]} accessibilityLabel={`Bước ${Math.min(at, steps)} trên ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <View key={i} style={[st.stair, { bottom: i * stair, left: i * 12, width: 64 - i * 12 },
              (i < at - 1 || done) && st.stairDone]}>
              <Text style={st.stairText}>{i + 1}</Text>
            </View>
          ))}
          <Ionicons name="flag" size={18} color={done ? t.success : amber} style={[st.goal, { bottom: topY }]} />
          <Animated.View pointerEvents="none" style={[st.pet, { transform: [{ translateY: petY }] }]}>
            <PetArt pet={petId} size={30} stage={petLevel} still={reduceMotion || !done} cheer={cheer} />
          </Animated.View>
        </View>
      </View>
      {doneSteps.map((d) => (
        <View key={d.step} style={st.doneRow} accessibilityLabel={`Bước ${d.step}: ${d.ask} ${d.work}, đúng`}>
          <Ionicons name="checkmark-circle" size={18} color={t.success} />
          <View style={{ flex: 1 }}>
            <Text style={st.doneAsk}>{`Bước ${d.step}: ${d.ask}`}</Text>
            <Text style={st.doneWork}>{d.work.replace(/ = .*/, '')} = {d.result}</Text>
          </View>
        </View>
      ))}
      {done ? null : (
        <>
          <Text style={st.ask}>{`Bước ${at}: ${p.ask ?? ''}`}</Text>
          <Animated.View style={[st.calc, { transform: [{ translateX: shake }] }]}
            accessibilityLabel={`Phép tính: ${text(calc.left) || 'trống'} ${calc.op ? OP_NAME[calc.op] : 'chưa có dấu'} ${text(calc.right) || 'trống'} bằng ${result || 'chưa điền'}`}>
            {(['left', 'right'] as const).map((side, i) => (
              <React.Fragment key={side}>
                {i === 1 ? <View style={[st.opSlot, calc.op && st.slotOn]}><Text style={st.opText}>{calc.op ?? '?'}</Text></View> : null}
                <Pressable onPress={() => !off && setOwn((c) => ({ ...c, [side]: null }))} disabled={off || !calc[side]} accessibilityRole="button"
                  accessibilityLabel={calc[side] ? `Số ${text(calc[side])}. Chạm để bỏ ra` : `Ô số ${i + 1}, trống`}
                  style={[st.slot, calc[side] && st.slotOn]}>
                  <Text style={st.slotText}>{text(calc[side]) || '…'}</Text>
                </Pressable>
              </React.Fragment>
            ))}
            <Text style={st.equals}>=</Text>
            <View style={[st.result, result && st.slotOn]}>
              <Text style={st.slotText}>{result || '?'}</Text>
              {p.ask_unit ? <Text style={st.unit}>{p.ask_unit}</Text> : null}
            </View>
          </Animated.View>
          <View style={st.chips}>
            {chips.map((c) => {
              const used = calc.left === c.id || calc.right === c.id;
              return (
                <Pressable key={c.id} onPress={() => !off && setOwn((x) => pickChip(x, c.id))} disabled={off} accessibilityRole="button"
                  accessibilityState={{ selected: used }} accessibilityLabel={`Thẻ số ${c.text}${c.step ? `, kết quả bước ${c.step}` : ''}`}
                  style={({ pressed }) => [st.chip, c.step ? st.chipResult : null, used && st.chipUsed, pressed && ui.pressed]}>
                  <Text style={[st.chipText, c.step ? st.chipTextResult : null]}>{c.text}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={st.ops}>
            {OPERATORS.map((o) => (
              <Pressable key={o} onPress={() => !off && setOwn((c) => ({ ...c, op: c.op === o ? null : o }))} disabled={off} accessibilityRole="button"
                accessibilityState={{ selected: calc.op === o }} accessibilityLabel={`Dấu ${OP_NAME[o]}`}
                style={({ pressed }) => [st.op, calc.op === o && st.opOn, pressed && ui.pressed]}>
                <Text style={[st.opKey, calc.op === o && st.opKeyOn]}>{o}</Text>
              </Pressable>
            ))}
          </View>
          <View style={st.keypad}>
            {KEYS.map((k) => (
              <Pressable key={k} onPress={() => key(k)} disabled={off} accessibilityRole="button"
                accessibilityLabel={k === ',' ? 'Dấu phẩy' : k === '/' ? 'Gạch phân số' : `Số ${k}`}
                style={({ pressed }) => [st.key, pressed && ui.pressed]}>
                <Text style={st.keyText}>{k}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => !off && setOwnResult((r) => r.slice(0, -1))} disabled={off || !result} accessibilityRole="button"
              accessibilityLabel="Xoá một chữ số" style={({ pressed }) => [st.key, st.keyWide, pressed && ui.pressed]}>
              <Ionicons name="backspace-outline" size={20} color={amber} />
            </Pressable>
          </View>
        </>
      )}
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Pet đã lên tới đích.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Làm lại bước" onReset={() => { setOwn(EMPTY); setOwnResult(''); }}
          resetDisabled={off || (!calc.left && !calc.right && !calc.op && !result)}
          onCheck={() => onSubmit(stepAnswer(calc, result))} checkDisabled={off || !ready} />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  amber: { color: dark ? tones.sun.ink : '#B86A00' },
  // The panel and its cards follow the theme; the stairs are drawn the same on both.
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: dark ? tones.sun.from : '#FFF7E8', borderWidth: 2,
    borderColor: dark ? tones.sun.to : '#F3D9A6' },
  top: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  paper: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: t.card, borderWidth: 1, borderColor: dark ? t.border : '#EAD5AE' },
  problem: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: t.ink },
  stairs: { width: 70 },
  stair: { position: 'absolute', height: 30, borderRadius: 6, backgroundColor: '#F1D3A0', alignItems: 'flex-end', justifyContent: 'center',
    paddingRight: 6 },
  stairDone: { backgroundColor: '#BFE5C7' },
  stairText: { fontSize: 11, fontWeight: '900', color: '#7A5520' },
  goal: { position: 'absolute', right: 2 },
  pet: { position: 'absolute', bottom: 26, left: 4 },
  doneRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 8, borderRadius: 12, backgroundColor: t.successBg },
  doneAsk: { fontSize: 13, fontWeight: '700', color: t.muted },
  doneWork: { fontSize: 16, fontWeight: '900', color: dark ? t.success : '#22703A' },
  ask: { fontSize: 16, fontWeight: '900', color: t.ink },
  calc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  slot: { minWidth: 60, minHeight: 48, paddingHorizontal: 8, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E0B970',
    backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  slotOn: { borderStyle: 'solid', borderColor: '#B86A00' },
  slotText: { fontSize: 18, fontWeight: '900', color: t.ink },
  opSlot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E0B970', alignItems: 'center',
    justifyContent: 'center', backgroundColor: t.card },
  opText: { fontSize: 20, fontWeight: '900', color: dark ? tones.sun.ink : '#B86A00' },
  equals: { fontSize: 22, fontWeight: '900', color: t.ink },
  result: { minWidth: 74, minHeight: 48, paddingHorizontal: 8, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E0B970',
    backgroundColor: t.card, alignItems: 'center', justifyContent: 'center' },
  unit: { fontSize: 11, fontWeight: '700', color: t.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: { minWidth: 52, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: t.card, borderWidth: 2, borderColor: '#E0B970',
    alignItems: 'center', justifyContent: 'center' },
  chipResult: { borderColor: '#7CC48D', backgroundColor: dark ? t.successBg : '#F1FBF3' },
  chipUsed: { opacity: 0.4 },
  chipText: { fontSize: 17, fontWeight: '900', color: dark ? tones.sun.ink : '#7A4A00' },
  chipTextResult: { color: dark ? t.success : '#22703A' },
  ops: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  op: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.card, borderWidth: 2, borderColor: '#B86A00', alignItems: 'center', justifyContent: 'center' },
  opOn: { backgroundColor: '#B86A00' },
  opKey: { fontSize: 22, fontWeight: '900', color: dark ? tones.sun.ink : '#B86A00' },
  opKeyOn: { color: t.onPrimary },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  key: { width: 52, height: 42, borderRadius: 10, backgroundColor: t.card, borderWidth: 1, borderColor: dark ? t.border : '#EAD5AE', alignItems: 'center', justifyContent: 'center' },
  keyWide: { width: 110 },
  keyText: { fontSize: 18, fontWeight: '900', color: t.ink },
}));
