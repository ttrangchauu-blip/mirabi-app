import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { usePetCheer } from '../engine/rig';
import { Text } from '../../components/Typography';
import { makeStyles, useTheme } from '../../ui/theme';
import { Actions, NoteLine, SceneProps, Stepper, useSolvedReaction, useWrongShake } from './common';
import { atomColor, atomCounts, balanced, formulaParts, Species, tilt } from './logic';

// Cân bằng phương trình (Hoá học, KHTN): a balance on the lab bench. The equation is written above it, a coefficient
// before each substance (− / +, every one starting at 1). Each pan holds its side's molecules as atom models (one per
// coefficient), so 2H₂ is two pairs of white atoms; the beam leans to the side with more atoms and is level only when
// every element has as many atoms on both sides. The table under it counts each element live. Kiểm tra: the backend
// counts again (and says when the numbers are not the smallest); right: the beam settles, bubbles rise, the pet
// cheers. A simulation for learning to write equations: nothing here is an experiment to try.

const MOLECULES_SHOWN = 4;

function Formula({ formula, size = 20, color: given }: { formula: string; size?: number; color?: string }) {
  const { t } = useTheme();
  const color = given ?? t.ink;
  return (
    <Text style={{ fontSize: size, fontWeight: '900', color }} accessibilityLabel={formula}>
      {formulaParts(formula).map((part, i) => (part.sub
        ? <Text key={i} style={{ fontSize: size * 0.62, fontWeight: '900', color }}>{part.text}</Text>
        : part.text))}
    </Text>
  );
}

/** One molecule: its atoms as small balls, one colour per element. */
function Molecule({ atoms }: { atoms: Record<string, number> }) {
  const st = useStyles();
  const balls = Object.entries(atoms).flatMap(([el, n]) => Array.from({ length: n }, () => el)).slice(0, 8);
  return (
    <View style={st.molecule}>
      {balls.map((el, i) => <View key={i} style={[st.atom, { backgroundColor: atomColor(el) }]} />)}
    </View>
  );
}

function Pan({ species, coefficients, side }: { species: Species[]; coefficients: number[]; side: 'left' | 'right' }) {
  const st = useStyles();
  return (
    <View style={st.pan} accessibilityLabel={side === 'left' ? 'Đĩa cân vế trái' : 'Đĩa cân vế phải'}>
      <View style={st.panLoad}>
        {species.map((s, i) => (s.side !== side ? null : (
          <View key={s.id} style={st.group}>
            {Array.from({ length: Math.min(coefficients[i], MOLECULES_SHOWN) }, (_, k) => <Molecule key={k} atoms={s.atoms} />)}
            {coefficients[i] > MOLECULES_SHOWN ? <Text style={st.more}>×{coefficients[i]}</Text> : null}
          </View>
        )))}
      </View>
      <View style={st.panDish} />
    </View>
  );
}

export function EquationBalance({ turn, disabled, feedback, solved, onSubmit, reduceMotion, petId = 'cat', petLevel = 1, demo }: SceneProps & {
  demo?: { coefficients: number[]; solved?: boolean };
}) {
  const { t } = useTheme();
  const st = useStyles();
  const p = turn.prompt;
  const species: Species[] = useMemo(() => p.species ?? [], [p.species]);
  const max = p.max ?? 12;
  const [own, setOwn] = useState<number[]>(() => species.map(() => 1));
  const coefficients = demo?.coefficients ?? own;
  const done = !!solved || !!demo?.solved;
  const cheer = usePetCheer(petId, petLevel ?? 1, done, reduceMotion);
  const off = disabled || done || !!demo;
  const counts = atomCounts(species, coefficients);
  const level = balanced(counts);
  const progress = useSolvedReaction(!demo && solved, 'balance:done', 1400, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);
  const shake = useWrongShake(feedback, 'balance:wrong', reduceMotion);

  // The beam follows the atoms: springs to its new lean (at once with reduced motion).
  const lean = useRef(new Animated.Value(tilt(counts))).current;
  const leanTo = tilt(counts);
  useEffect(() => {
    if (reduceMotion) { lean.setValue(leanTo); return; }
    const anim = Animated.spring(lean, { toValue: leanTo, friction: 5, tension: 60, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [leanTo, reduceMotion, lean]);
  const rotate = lean.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] });
  const counter = lean.interpolate({ inputRange: [-1, 1], outputRange: ['12deg', '-12deg'] });
  const bubble = (delay: number) => progress.interpolate({ inputRange: [0, delay, 1], outputRange: [0, 0, -60], extrapolate: 'clamp' });

  const set = (i: number, v: number) => { if (!off) setOwn((c) => c.map((x, j) => (j === i ? v : x))); };
  const cells: React.ReactNode[] = [];
  species.forEach((s, i) => {
    if (i > 0) {
      const arrow = species[i - 1].side === 'left' && s.side === 'right';
      cells.push(arrow ? (
        <View key={`a${i}`} style={st.arrow}>
          {p.condition ? <Text style={st.condition}>{p.condition}</Text> : null}
          <Ionicons name="arrow-forward" size={22} color={t.ink} />
        </View>
      ) : <Text key={`p${i}`} style={st.plus}>+</Text>);
    }
    cells.push(
      <View key={s.id} style={st.term}>
        <Stepper value={coefficients[i]} onChange={(v) => set(i, v)} min={1} max={max} disabled={off} label={`hệ số của ${s.formula}`} />
        <Formula formula={s.formula} />
      </View>,
    );
  });

  return (
    <View style={st.world}>
      <Text style={st.task}>{p.prompt}</Text>
      <View style={st.equation} accessibilityLabel="Phương trình">{cells}</View>
      <Animated.View style={[st.scale, { transform: [{ translateX: shake }] }]}
        accessibilityLabel={level ? 'Cân thăng bằng: hai vế có số nguyên tử bằng nhau' : 'Cân đang lệch: số nguyên tử hai vế chưa bằng nhau'}>
        <Animated.View style={[st.beamWrap, { transform: [{ rotate }] }]}>
          <View style={st.beam} />
          <Animated.View style={[st.hang, st.hangLeft, { transform: [{ rotate: counter }] }]}>
            <Pan species={species} coefficients={coefficients} side="left" />
          </Animated.View>
          <Animated.View style={[st.hang, st.hangRight, { transform: [{ rotate: counter }] }]}>
            <Pan species={species} coefficients={coefficients} side="right" />
          </Animated.View>
        </Animated.View>
        <View style={st.post} />
        <View style={st.foot} />
        {[0.15, 0.35, 0.55].map((d, i) => (
          <Animated.View key={i} pointerEvents="none" style={[st.bubble, { left: `${30 + i * 20}%`, opacity: progress.interpolate({
            inputRange: [0, d, 0.95, 1], outputRange: [0, 0.9, 0.6, 0] }), transform: [{ translateY: bubble(d) }] }]} />
        ))}
        <View style={st.pet} pointerEvents="none"><PetArt pet={petId} size={34} stage={petLevel} still={reduceMotion || !done} cheer={cheer} /></View>
      </Animated.View>
      <View style={st.table} accessibilityLabel="Số nguyên tử mỗi nguyên tố ở hai vế">
        <View style={st.tableRow}>
          <Text style={[st.cell, st.cellHead]}>Nguyên tố</Text>
          <Text style={[st.cell, st.cellHead]}>Vế trái</Text>
          <Text style={[st.cell, st.cellHead]}>Vế phải</Text>
          <View style={st.mark} />
        </View>
        {Object.entries(counts).map(([el, [a, b]]) => (
          <View key={el} style={st.tableRow} accessibilityLabel={`${el}: vế trái ${a}, vế phải ${b}`}>
            <View style={[st.cell, st.elCell]}><View style={[st.atom, { backgroundColor: atomColor(el) }]} /><Text style={st.el}>{el}</Text></View>
            <Text style={st.cell}>{a}</Text>
            <Text style={st.cell}>{b}</Text>
            <Ionicons style={st.mark} name={a === b ? 'checkmark-circle' : 'close-circle'} size={18} color={a === b ? t.success : t.danger} />
          </View>
        ))}
      </View>
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Hai vế đã cân bằng.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Đặt lại" onReset={() => setOwn(species.map(() => 1))} resetDisabled={off || own.every((c) => c === 1)}
          onCheck={() => onSubmit(coefficients.map(String))} checkDisabled={off} />
      )}
    </View>
  );
}


const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  // The lab bench holds the equation, the table and the buttons: pale teal on light, deep sea on dark.
  world: { gap: 10, padding: 12, borderRadius: 20,
    backgroundColor: dark ? tones.sea.from : '#E6F5F2', borderWidth: 2, borderColor: dark ? tones.sea.to : '#BFE3DA' },
  task: { fontSize: 15, fontWeight: '800', color: dark ? tones.sea.ink : '#1F5F54', textAlign: 'center' },
  equation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  term: { alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  plus: { fontSize: 22, fontWeight: '900', color: t.ink },
  arrow: { alignItems: 'center' },
  condition: { fontSize: 11, fontWeight: '800', color: t.muted },
  scale: { height: 170, alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  beamWrap: { width: '92%', height: 118, marginTop: 6 },
  beam: { height: 8, borderRadius: 4, backgroundColor: '#8A7F99' },
  hang: { position: 'absolute', top: 4, width: '46%', alignItems: 'center' },
  hangLeft: { left: 0 },
  hangRight: { right: 0 },
  pan: { alignItems: 'center', width: '100%' },
  panLoad: { minHeight: 64, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'center', gap: 4, paddingTop: 8 },
  panDish: { width: '90%', height: 10, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, backgroundColor: '#B9AFC9' },
  group: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2, maxWidth: '100%' },
  molecule: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 34, gap: 1, padding: 2, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.7)' },
  atom: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(63,54,84,0.45)' },
  more: { fontSize: 12, fontWeight: '900', color: t.ink },
  post: { position: 'absolute', top: 10, bottom: 14, width: 8, borderRadius: 4, backgroundColor: '#8A7F99' },
  foot: { position: 'absolute', bottom: 6, width: 90, height: 10, borderRadius: 5, backgroundColor: '#8A7F99' },
  bubble: { position: 'absolute', bottom: 20, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#4CC3A6',
    backgroundColor: 'rgba(76,195,166,0.15)' },
  pet: { position: 'absolute', right: 2, bottom: 0 },
  table: { borderRadius: 12, backgroundColor: t.card, padding: 8, gap: 4 },
  tableRow: { flexDirection: 'row', alignItems: 'center' },
  cell: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800', color: t.ink },
  cellHead: { fontSize: 12, color: t.muted },
  elCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  el: { fontSize: 15, fontWeight: '900', color: t.ink },
  mark: { width: 24 },
}));
