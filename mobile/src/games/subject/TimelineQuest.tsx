import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Draggable, DropArea, DropZone } from '../engine/drag';
import { Actions, NoteLine, SceneProps, styles as ui, useSolvedReaction, useWrongShake } from './common';
import { keptPlacement, Marker, markerLoad, Placement, placeEvent, timelineAnswer, timelineFull } from './logic';

// Hành trình dòng thời gian (Lịch sử): a road through time drawn on parchment, its milestones in time order from the top.
// Each event is dragged onto its milestone (or tapped, then its milestone tapped). Events of the same year share one
// milestone with several places. Kiểm tra: the backend says which are right; those stay (a lock), the others shake and
// go back to the pile. Right: the road fills with gold from the oldest milestone to the newest, each lights up as it is
// reached (its date shows if it was hidden) and the pet travels the whole way.

const INK = '#5B3B12';
const PARCHMENT = '#F7ECD9';

export function TimelineQuest({ turn, disabled, feedback, solved, onSubmit, reduceMotion, petId = 'cat', petLevel = 1, demo }: SceneProps & {
  demo?: { placed: Placement; solved?: boolean };
}) {
  const p = turn.prompt;
  const markers: Marker[] = useMemo(() => p.markers ?? [], [p.markers]);
  const events = p.events ?? [];
  const [own, setOwn] = useState<Placement>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [bad, setBad] = useState<Set<string>>(new Set());
  const placed = demo?.placed ?? own;
  const done = !!solved || !!demo?.solved;
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'timeline:done', 500 + 320 * markers.length, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);

  // A wrong check: what is right stays (locked), the rest shakes, then goes back to the pile.
  const keep = useRef<Placement>({});
  useEffect(() => {
    if (!feedback || feedback.tone !== 'bad') return;
    keep.current = keptPlacement(feedback.kept);
    setLocked(new Set(Object.keys(keep.current)));
    setBad(new Set(Object.keys(own).filter((e) => !(e in keep.current))));
    setSelected(null);
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps
  const shake = useWrongShake(feedback, 'timeline:wrong', reduceMotion, () => {
    setOwn((now) => Object.fromEntries(Object.entries(now).filter(([e]) => e in keep.current)));
    setBad(new Set());
  });

  const text = (id: string) => events.find((e) => e.id === id)?.text ?? '';
  const on = (marker: string) => Object.keys(placed).filter((e) => placed[e] === marker);
  const pile = events.filter((e) => !(e.id in placed));
  const put = (event: string, marker: string) => {
    if (off || locked.has(event)) return false;
    const next = placeEvent(own, markers, event, marker);
    if (next === own) return false;
    setOwn(next); setSelected(null); setBad(new Set());
    return true;
  };
  const take = (event: string) => { if (!off && !locked.has(event)) setOwn(({ [event]: _gone, ...rest }) => rest); };
  const full = timelineFull(placed, markers);
  const hidden = p.years === 'hidden';
  const n = Math.max(1, markers.length);
  const [roadHeight, setRoadHeight] = useState(0);
  const petY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, roadHeight - 40)] });

  return (
    <DropArea style={st.world}>
      <View style={st.head}>
        <Ionicons name="hourglass-outline" size={20} color={INK} />
        <Text style={st.headText}>{p.prompt}</Text>
      </View>
      <View style={st.road} onLayout={(e) => setRoadHeight(e.nativeEvent.layout.height)} accessibilityLabel="Dòng thời gian, sớm nhất ở trên">
        <View style={st.line} />
        <Animated.View style={[st.lineFill, { height: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        <Animated.View style={[st.pet, { transform: [{ translateY: petY }] }]} pointerEvents="none">
          <PetArt pet={petId} size={36} stage={petLevel} still={reduceMotion || !done} />
        </Animated.View>
        <Text style={st.end}>Sớm hơn</Text>
        {markers.map((m, i) => {
          const lit = progress.interpolate({ inputRange: [i / n, (i + 0.6) / n], outputRange: [0, 1], extrapolate: 'clamp' });
          const here = on(m.id);
          return (
            <View key={m.id} style={st.stop}>
              <View style={st.stone}>
                <View style={st.dot}><Animated.View style={[st.dotLit, { opacity: lit }]} /></View>
                <View style={st.label}>
                  {hidden ? (
                    <>
                      <Animated.Text style={[st.labelText, { opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>?</Animated.Text>
                      <Animated.Text style={[st.labelText, st.labelOver, { opacity: lit }]}>{m.label}</Animated.Text>
                    </>
                  ) : <Text style={st.labelText}>{m.label}</Text>}
                </View>
              </View>
              <View style={st.places}>
                {Array.from({ length: m.slots }, (_, k) => {
                  const event = here[k];
                  if (event) {
                    const fixed = locked.has(event) || done;
                    const wrong = bad.has(event);
                    return (
                      <Animated.View key={`${m.id}#${k}`} style={wrong ? { transform: [{ translateX: shake }] } : undefined}>
                        <Pressable onPress={() => take(event)} disabled={off || fixed} accessibilityRole="button"
                          accessibilityLabel={fixed ? `${text(event)}, đúng mốc ${m.label}` : `Gỡ ${text(event)} khỏi mốc`}
                          style={[st.card, st.cardPlaced, fixed && st.cardFixed, wrong && st.cardWrong]}>
                          <Text style={st.cardText}>{text(event)}</Text>
                          {fixed ? <Ionicons name="lock-closed" size={13} color={t.success} /> : null}
                        </Pressable>
                      </Animated.View>
                    );
                  }
                  return (
                    <DropZone key={`${m.id}#${k}`} id={`${m.id}#${k}`} accessibilityLabel={`Chỗ trống ở mốc ${hidden ? 'thứ ' + (i + 1) : m.label}`}
                      style={(over) => [st.empty, over && st.emptyOver]}>
                      <Pressable onPress={() => { if (selected) put(selected, m.id); }} disabled={off || !selected} accessibilityRole="button"
                        accessibilityLabel={selected ? `Đặt “${text(selected)}” vào mốc ${hidden ? `thứ ${i + 1}` : m.label}` : 'Chỗ trống'}
                        style={st.emptyTap}>
                        <Text style={st.emptyText}>{selected ? 'Chạm để đặt vào đây' : 'Thả sự kiện vào đây'}</Text>
                      </Pressable>
                    </DropZone>
                  );
                })}
              </View>
            </View>
          );
        })}
        <Text style={st.end}>Muộn hơn</Text>
      </View>
      {pile.length ? (
        <>
          <Text style={st.pileHint}>{selected ? `Chạm một mốc để đặt “${text(selected)}”` : 'Kéo sự kiện lên mốc của nó, hoặc chạm sự kiện rồi chạm mốc'}</Text>
          <View style={st.pile}>
            {pile.map((e) => (
              <Draggable key={e.id} disabled={off} onDrop={(zone) => put(e.id, zone.split('#')[0])}>
                <Pressable onPress={() => setSelected((s) => (s === e.id ? null : e.id))} disabled={off} accessibilityRole="button"
                  accessibilityState={{ selected: selected === e.id }} accessibilityLabel={`Sự kiện: ${e.text}`}
                  style={({ pressed }) => [st.card, selected === e.id && st.cardChosen, pressed && ui.pressed]}>
                  <Ionicons name="document-text-outline" size={14} color={INK} />
                  <Text style={st.cardText}>{e.text}</Text>
                </Pressable>
              </Draggable>
            ))}
          </View>
        </>
      ) : null}
      <NoteLine note={demo?.solved ? { text: 'Chính xác! Dòng thời gian đã hoàn thành.', tone: 'good' } : done ? null : feedback} />
      {done ? null : (
        <Actions onReset={() => { setOwn((x) => Object.fromEntries(Object.entries(x).filter(([e]) => locked.has(e)))); setSelected(null); }}
          resetDisabled={off || Object.keys(placed).every((e) => locked.has(e))}
          onCheck={() => onSubmit(timelineAnswer(placed))} checkDisabled={off || !full} />
      )}
    </DropArea>
  );
}

/** How many events still wait for a place (the guide shows it). */
export const eventsLeft = (placed: Placement, markers: Marker[]) =>
  markers.reduce((sum, m) => sum + m.slots - markerLoad(placed, m.id), 0);

const st = StyleSheet.create({
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: PARCHMENT, borderWidth: 2, borderColor: '#E3CDA4' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1, fontSize: 15, fontWeight: '800', color: INK },
  road: { gap: 8, paddingVertical: 4 },
  line: { position: 'absolute', left: 45, top: 18, bottom: 18, width: 6, borderRadius: 3, backgroundColor: '#E3CDA4' },
  lineFill: { position: 'absolute', left: 45, top: 18, width: 6, borderRadius: 3, backgroundColor: '#E9A23B' },
  pet: { position: 'absolute', left: 30, top: 0, zIndex: 2 },
  end: { marginLeft: 6, fontSize: 11, fontWeight: '800', color: '#A07A45' },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stone: { width: 96, alignItems: 'flex-start', flexDirection: 'row', gap: 4 },
  dot: { marginLeft: 40, marginTop: 10, width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: '#B8894A',
    overflow: 'hidden' },
  dotLit: { ...StyleSheet.absoluteFillObject, backgroundColor: '#F4C14F' },
  label: { position: 'absolute', left: 0, top: 30, width: 92 },
  labelText: { fontSize: 12, fontWeight: '900', color: INK },
  labelOver: { position: 'absolute', left: 0, top: 0 },
  places: { flex: 1, gap: 6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
    backgroundColor: '#FFFDF8', borderWidth: 2, borderColor: '#D9B77E' },
  cardPlaced: { borderColor: '#B8894A' },
  cardFixed: { borderColor: t.success, backgroundColor: t.successBg },
  cardWrong: { borderColor: t.danger, backgroundColor: t.dangerBg },
  cardChosen: { borderColor: t.accent, borderWidth: 3 },
  cardText: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: INK },
  empty: { minHeight: 44, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#D9B77E', justifyContent: 'center' },
  emptyOver: { borderColor: t.accent, backgroundColor: '#FFF4DC' },
  emptyTap: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  emptyText: { fontSize: 12, fontWeight: '700', color: '#A07A45' },
  pileHint: { fontSize: 12, fontWeight: '700', color: '#8A6A3A', textAlign: 'center' },
  pile: { gap: 6 },
});
