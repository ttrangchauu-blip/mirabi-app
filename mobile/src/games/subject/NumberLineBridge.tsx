import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { usePetCheer } from '../engine/rig';
import { Text } from '../../components/Typography';
import { makeStyles, useTheme } from '../../ui/theme';
import { Actions, NoteLine, SceneProps, useCommonStyles, useSolvedReaction, useWrongShake } from './common';
import { keptTicks, numberLineAnswer, tickAt, Ticks } from './logic';

// Cầu trục số (Toán): the number line is a bridge over a river, its ticks the planks. The numbers to place wait on the
// bank as flags; one is in hand (picked by a tap). Touching or sliding along the bridge plants it on the plank under the
// finger; ◀ ▶ move it one plank (ticks can be close together on a phone). Kiểm tra: the backend reads the tick of each
// flag. Wrong: the flags on their right plank lock (green), the others stay to be moved. Right: every flag turns green
// and the pet crosses the bridge, stopping at each number. Only the line's own labels are shown: reading the scale is
// the learner's work.

const PAD = 18;
const HEIGHT = 128;
const DECK = 78;
const TEAL = '#16707F';

export function NumberLineBridge({ turn, disabled, feedback, solved, onSubmit, reduceMotion, petId, petLevel, demo }: SceneProps & {
  demo?: { placed: Ticks; active?: string | null; solved?: boolean };
}) {
  const { t, tones, dark } = useTheme();
  const ui = useCommonStyles();
  const st = useStyles();
  const teal = dark ? tones.sea.ink : TEAL;
  const p = turn.prompt;
  const ticks = p.ticks ?? 10;
  const major = p.major ?? 1;
  const points = p.points ?? [];
  const [own, setOwn] = useState<Ticks>({});
  const [locked, setLocked] = useState<Ticks>({});
  const [active, setActive] = useState<string | null>(points[0]?.id ?? null);
  const [width, setWidth] = useState(0);
  const placed = demo?.placed ?? own;
  const hand = demo ? demo.active ?? null : active;
  const done = !!solved || !!demo?.solved;
  const cheer = usePetCheer(petId, petLevel ?? 1, done, reduceMotion);
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'number_line:done', 700 + 300 * points.length, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);

  const span = Math.max(width - 2 * PAD, 1);
  const xOf = (tick: number) => PAD + (tick / ticks) * span;

  // Wrong: the flags on their right plank lock; the hand goes to the first one still to move.
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad' || feedback.final) return;
    const keep = keptTicks(feedback.kept);
    setLocked(keep);
    setActive(points.find((x) => keep[x.id] === undefined)?.id ?? null);
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps
  const shake = useWrongShake(feedback, 'number_line:wrong', reduceMotion);

  const live = useRef({ off, hand, span, ticks, locked, placed, points });
  live.current = { off, hand, span, ticks, locked, placed, points };
  const plant = (x: number) => {
    const { off: o, hand: h, span: s, ticks: n, locked: l } = live.current;
    if (o || !h || l[h] !== undefined) return;
    const tick = tickAt(x - PAD, s, n);
    setOwn((m) => ({ ...m, [h]: tick }));
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.off && !!live.current.hand,
    onMoveShouldSetPanResponder: () => !live.current.off && !!live.current.hand,
    onPanResponderGrant: (e) => plant(e.nativeEvent.locationX),
    onPanResponderMove: (e) => plant(e.nativeEvent.locationX),
    // Planted: the hand moves on to the next number still on the bank (if any).
    onPanResponderRelease: () => {
      const { hand: h, placed: m, points: all, locked: l } = live.current;
      const next = all.find((x) => x.id !== h && m[x.id] === undefined && l[x.id] === undefined);
      if (next) setActive(next.id);
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const nudge = (by: number) => {
    if (off || !hand || locked[hand] !== undefined) return;
    // A number still on the bank goes on the first plank (◀ ▶ alone place it: no dragging needed, e.g. with a screen reader).
    setOwn((m) => ({ ...m, [hand]: m[hand] === undefined ? Math.max(0, by) : Math.max(0, Math.min(ticks, m[hand] + by)) }));
  };
  const pick = (id: string) => { if (!off && locked[id] === undefined) setActive(id); };
  const full = points.every((x) => placed[x.id] !== undefined);
  const label = (id: string) => points.find((x) => x.id === id)?.label ?? '';
  const order = points.filter((x) => placed[x.id] !== undefined).sort((a, b) => placed[a.id] - placed[b.id]);
  const lastX = order.length ? xOf(placed[order[order.length - 1].id]) : PAD;
  const walk = progress.interpolate({ inputRange: [0, 1], outputRange: [PAD - 16, Math.max(PAD - 16, lastX - 16)] });
  const handLabel = hand ? label(hand) : null;

  return (
    <View style={st.world}>
      <Text style={ui.instruction}>{p.prompt}</Text>
      <View style={st.bank} accessibilityLabel="Các số cần đặt">
        {points.map((x) => {
          const isLocked = locked[x.id] !== undefined || done;
          const on = placed[x.id] !== undefined;
          const inHand = hand === x.id && !done;
          return (
            <Pressable key={x.id} onPress={() => pick(x.id)} disabled={off || isLocked} accessibilityRole="button"
              accessibilityState={{ selected: inHand, disabled: off || isLocked }}
              accessibilityLabel={isLocked ? `${x.label}, đã đúng chỗ` : `${x.label}${on ? ', đã đặt' : ''}. ${inHand ? 'Đang cầm' : 'Chạm để cầm'}`}
              style={({ pressed }) => [st.flagChip, on && st.flagChipOn, inHand && st.flagChipHand, isLocked && st.flagChipLocked, pressed && ui.pressed]}>
              <Ionicons name={isLocked ? 'lock-closed' : on ? 'flag' : 'flag-outline'} size={14} color={isLocked ? t.success : teal} />
              <Text style={st.flagChipText}>{x.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Animated.View style={[st.bridge, { transform: [{ translateX: shake }] }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Cầu trục số ${ticks} khoảng, ${p.labels?.length ? `ghi số ${p.labels.map((l) => l.text).join(', ')}` : ''}. ${
          handLabel ? `Chạm hoặc kéo trên cầu để đặt ${handLabel}` : 'Chọn một số để đặt'}`}>
        {width ? (
          <Svg width={width} height={HEIGHT} pointerEvents="none">
            <Rect x={0} y={DECK + 14} width={width} height={HEIGHT - DECK - 14} fill="#BDE7F2" />
            <Rect x={PAD - 6} y={DECK - 3} width={span + 12} height={8} rx={4} fill="#A6763C" />
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const long = i % major === 0;
              return <Line key={i} x1={xOf(i)} x2={xOf(i)} y1={DECK - (long ? 12 : 6)} y2={DECK + (long ? 10 : 5)}
                stroke={long ? '#5B3A12' : '#8A6A3E'} strokeWidth={long ? 2.5 : 1.2} />;
            })}
            {(p.labels ?? []).map((l) => (
              <SvgText key={l.at} x={xOf(l.at)} y={DECK + 28} fontSize={12} fontWeight="bold" fill="#0E4C57" textAnchor="middle">{l.text}</SvgText>
            ))}
            {(p.marks ?? []).map((m) => (
              <SvgText key={m.text} x={PAD + m.at * span} y={DECK - 18} fontSize={12} fontWeight="bold" fill="#7A5AB8" textAnchor="middle">{`▼ ${m.text}`}</SvgText>
            ))}
          </Svg>
        ) : <View style={{ height: HEIGHT }} />}
        {width ? points.filter((x) => placed[x.id] !== undefined).map((x) => {
          const right = done || locked[x.id] !== undefined;
          return (
            <Pressable key={x.id} onPress={() => pick(x.id)} disabled={off || right} accessibilityRole="button"
              accessibilityLabel={`${x.label} đặt ở vạch ${placed[x.id]}${right ? ', đúng' : ''}`}
              style={[st.flag, { left: xOf(placed[x.id]) - 1 }, { zIndex: hand === x.id ? 3 : 2 }]}>
              <View style={[st.flagCloth, right && st.flagRight, hand === x.id && !right && st.flagHand]}>
                <Text style={[st.flagText, right && { color: '#FFFFFF' }]} numberOfLines={1}>{x.label}</Text>
              </View>
              <View style={[st.pole, right && st.poleRight]} />
            </Pressable>
          );
        }) : null}
        <View style={[StyleSheet.absoluteFill, { top: 18 }]} {...pan.panHandlers} />
        <Animated.View pointerEvents="none" style={[st.pet, { transform: [{ translateX: walk }] }]}>
          <PetArt pet={petId} size={30} stage={petLevel} still={reduceMotion || !done} cheer={cheer} />
        </Animated.View>
      </Animated.View>
      {!done ? (
        <View style={st.nudges}>
          {major > 1 ? <Nudge icon="play-back" label="Lùi một khoảng lớn" off={off || !hand} onPress={() => nudge(-major)} /> : null}
          <Nudge icon="caret-back" label="Lùi một vạch" off={off || !hand} onPress={() => nudge(-1)} />
          <Text style={st.handText}>{handLabel ? `Đang cầm: ${handLabel}` : 'Chọn một số trên bờ'}</Text>
          <Nudge icon="caret-forward" label="Tiến một vạch" off={off || !hand} onPress={() => nudge(1)} />
          {major > 1 ? <Nudge icon="play-forward" label="Tiến một khoảng lớn" off={off || !hand} onPress={() => nudge(major)} /> : null}
        </View>
      ) : null}
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Pet đã qua cầu.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Đặt lại" onReset={() => { setOwn((m) => Object.fromEntries(Object.entries(m).filter(([id]) => locked[id] !== undefined))); }}
          resetDisabled={off || Object.keys(placed).every((id) => locked[id] !== undefined)}
          onCheck={() => onSubmit(numberLineAnswer(placed))} checkDisabled={off || !full} />
      )}
    </View>
  );
}

function Nudge({ icon, label, off, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; off: boolean;
  onPress: () => void }) {
  const { tones, dark } = useTheme();
  const ui = useCommonStyles();
  const st = useStyles();
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={[st.nudge, off && ui.dimmed]}>
      <Ionicons name={icon} size={18} color={dark ? tones.sea.ink : TEAL} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  // The panel round the game (its text and buttons follow the theme); the bridge itself (Svg, flags) stays as drawn.
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: dark ? tones.sea.from : '#EAF7F2', borderWidth: 2,
    borderColor: dark ? tones.sea.to : '#BFE3D3' },
  bank: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  flagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: t.card,
    borderWidth: 2, borderColor: '#9AD3DC' },
  flagChipOn: { borderStyle: 'dashed' },
  flagChipHand: { borderColor: t.accent, backgroundColor: dark ? tones.sun.from : '#FFF4DC' },
  flagChipLocked: { borderColor: t.success, backgroundColor: t.successBg },
  flagChipText: { fontSize: 16, fontWeight: '900', color: dark ? tones.sea.ink : '#0E4C57' },
  bridge: { height: HEIGHT, borderRadius: 14, overflow: 'hidden', backgroundColor: '#F4FBF8' },
  flag: { position: 'absolute', top: 6, alignItems: 'flex-start' },
  flagCloth: { minWidth: 30, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderBottomLeftRadius: 0, backgroundColor: '#FFFFFF',
    borderWidth: 2, borderColor: '#16707F' },
  flagHand: { borderColor: '#136FA8', backgroundColor: '#FFF4DC' }, // on the drawn bridge: as drawn
  // The flags stand on the drawn bridge (light on both themes): a right one is the light success green.
  flagRight: { backgroundColor: '#17704F', borderColor: '#17704F' },
  flagText: { fontSize: 12, fontWeight: '900', color: '#0E4C57' },
  pole: { width: 2, height: DECK - 30, backgroundColor: '#16707F' },
  poleRight: { backgroundColor: '#17704F' },
  pet: { position: 'absolute', top: DECK - 40, left: 0 },
  nudges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  nudge: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.card, borderWidth: 2, borderColor: '#9AD3DC', alignItems: 'center',
    justifyContent: 'center' },
  handText: { flexShrink: 1, minWidth: 96, textAlign: 'center', fontSize: 14, fontWeight: '800', color: dark ? tones.sea.ink : '#0E4C57' },
}));
