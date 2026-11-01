import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Draggable, DropArea, DropZone } from '../engine/drag';
import { Actions, NoteLine, SceneProps, styles as ui, useSolvedReaction, useWrongShake } from './common';
import { placeTile, removeTile } from './logic';

// Xây câu (Tiếng Anh): the sentence is a train at the station. Its wagons wait empty, one per word of the sentence; the
// word tiles are crates in the yard, some of which do not belong to it. A crate is dragged onto a wagon (or tapped:
// the first empty wagon), a loaded one tapped to unload it. Kiểm tra: the backend names the first wagon that is wrong;
// the wagons before it are right and lock (green), that one is outlined in red, the rest stays to be fixed. Right: the
// wagons light up one after the other, the train sounds and moves off a little, and the sentence is read aloud.

const SKY = '#E3F2FC';

export function SentenceTrain({ turn, disabled, feedback, solved, onSubmit, reduceMotion, speak, demo }: SceneProps & {
  /** Reads the finished sentence (English, when sound is on). */ speak?: (text: string) => void;
  demo?: { line: (string | null)[]; solved?: boolean };
}) {
  const p = turn.prompt;
  const tiles = p.tiles ?? [];
  const length = p.length ?? tiles.length;
  const [own, setOwn] = useState<(string | null)[]>(() => Array(length).fill(null));
  const [locked, setLocked] = useState(0);
  const [wrongAt, setWrongAt] = useState<number | null>(null);
  const line = demo?.line ?? own;
  const done = !!solved || !!demo?.solved;
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'sentence:done', 400 + 220 * length, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);
  const text = (id: string | null) => tiles.find((x) => x.id === id)?.text ?? '';

  // Right: read the sentence once.
  const spoken = useRef(false);
  useEffect(() => {
    if (!solved || spoken.current) return;
    spoken.current = true;
    speak?.(line.map(text).join(' '));
  }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrong: the right start (kept) locks, the first wrong wagon is pointed out.
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad' || feedback.final) return;
    const keep = feedback.kept ?? [];
    setLocked(keep.length);
    setWrongAt(keep.length < length ? keep.length : null);
  }, [feedback, length]);
  const shake = useWrongShake(feedback, 'sentence:wrong', reduceMotion);

  const yard = tiles.filter((x) => !line.includes(x.id));
  const load = (tile: string, at?: number) => {
    if (off) return false;
    setWrongAt(null);
    if (at === undefined) { setOwn((l) => placeTile(l, tile)); return true; }
    if (at < locked) return false;
    setOwn((l) => { const next = l.map((id) => (id === tile ? null : id)); next[at] = tile; return next; });
    return true;
  };
  const unload = (i: number) => { if (!off) { setOwn((l) => removeTile(l, i, locked)); setWrongAt(null); } };
  const full = line.every(Boolean);
  const chug = progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0, 0, 14] });

  return (
    <DropArea style={st.world}>
      {p.vi ? (
        <View style={st.ticket} accessibilityLabel={`Nghĩa của câu: ${p.vi}`}>
          <Ionicons name="ticket-outline" size={16} color="#136FA8" />
          <Text style={st.ticketText}>{p.vi}</Text>
        </View>
      ) : null}
      <Text style={ui.instruction}>{p.prompt}</Text>
      <Animated.View style={[st.train, { transform: [{ translateX: chug }] }]}
        accessibilityLabel={`Câu đang xây: ${line.map((id, i) => `${i + 1}. ${text(id) || 'trống'}`).join(', ')}`}>
        <View style={st.engine}>
          <Ionicons name="train" size={30} color="#FFFFFF" />
        </View>
        {line.map((id, i) => {
          const lit = progress.interpolate({ inputRange: [i / (length + 1), (i + 1) / (length + 1)], outputRange: [0, 1], extrapolate: 'clamp' });
          const fixed = i < locked || done;
          const wrong = wrongAt === i;
          const body = id ? (
            <Pressable onPress={() => unload(i)} disabled={off || fixed} accessibilityRole="button"
              accessibilityLabel={fixed ? `Toa ${i + 1}: ${text(id)}, đúng` : `Toa ${i + 1}: ${text(id)}. Chạm để dỡ xuống`} style={st.cargo}>
              <Text style={st.cargoText}>{text(id)}</Text>
              {i < locked && !done ? <Ionicons name="lock-closed" size={12} color={t.success} /> : null}
            </Pressable>
          ) : <Text style={st.emptyNumber}>{i + 1}</Text>;
          return (
            <Animated.View key={i} style={wrong ? { transform: [{ translateX: shake }] } : undefined}>
              <DropZone id={`w${i}`} accessibilityLabel={`Toa ${i + 1}`}
                style={(over) => [st.wagon, id && st.wagonLoaded, fixed && st.wagonFixed, wrong && st.wagonWrong, over && st.wagonOver]}>
                <Animated.View pointerEvents="none" style={[st.glow, { opacity: lit }]} />
                {body}
                <View style={st.wheels}><View style={st.wheel} /><View style={st.wheel} /></View>
              </DropZone>
            </Animated.View>
          );
        })}
      </Animated.View>
      <View style={st.rail} />
      {yard.length && !done ? (
        <View style={st.yard}>
          {yard.map((x) => (
            <Draggable key={x.id} disabled={off} onDrop={(zone) => load(x.id, Number(zone.slice(1)))}>
              <Pressable onPress={() => load(x.id)} disabled={off} accessibilityRole="button" accessibilityLabel={`Thẻ ${x.text}`}
                style={({ pressed }) => [st.crate, pressed && ui.pressed]}>
                <Text style={st.crateText}>{x.text}</Text>
              </Pressable>
            </Draggable>
          ))}
        </View>
      ) : null}
      {!done && yard.length > 0 && full ? <Text style={ui.hint}>Có thẻ không thuộc câu này: để nó lại bãi.</Text> : null}
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Đoàn tàu câu chữ khởi hành.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions onReset={() => { setOwn((l) => l.map((id, i) => (i < locked ? id : null))); setWrongAt(null); }}
          resetDisabled={off || line.every((id, i) => !id || i < locked)}
          onCheck={() => onSubmit(line as string[])} checkDisabled={off || !full} />
      )}
    </DropArea>
  );
}

const st = StyleSheet.create({
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: SKY, borderWidth: 2, borderColor: '#BFE0F5' },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#9CCDEB', borderStyle: 'dashed' },
  ticketText: { fontSize: 14, fontWeight: '800', color: '#136FA8' },
  train: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 6 },
  engine: { width: 54, height: 52, borderRadius: 12, borderTopRightRadius: 22, backgroundColor: '#E8534A', alignItems: 'center',
    justifyContent: 'center' },
  wagon: { minWidth: 58, minHeight: 52, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 12, borderRadius: 10, backgroundColor: '#FFFFFF',
    borderWidth: 2, borderColor: '#9CCDEB', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  wagonLoaded: { borderStyle: 'solid', borderColor: '#136FA8' },
  wagonFixed: { borderColor: t.success, backgroundColor: t.successBg },
  wagonWrong: { borderColor: t.danger, borderWidth: 3, backgroundColor: t.dangerBg },
  wagonOver: { borderColor: t.accent, backgroundColor: '#FFF4DC' },
  glow: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FFE38A' },
  cargo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cargoText: { fontSize: 15, fontWeight: '900', color: t.ink },
  emptyNumber: { fontSize: 13, fontWeight: '800', color: '#9CCDEB' },
  wheels: { position: 'absolute', bottom: 2, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between' },
  wheel: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#3F3654' },
  rail: { height: 4, borderRadius: 2, backgroundColor: '#8A7F99', marginTop: -6 },
  yard: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingTop: 4 },
  crate: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F6D9A8', borderWidth: 2,
    borderColor: '#C98E3E', justifyContent: 'center' },
  crateText: { fontSize: 15, fontWeight: '900', color: '#6B4210' },
});
