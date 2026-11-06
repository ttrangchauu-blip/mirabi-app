import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../../components/PetArt';
import { drawnActions, hasSprite } from '../../../petSprites';
import { Text } from '../../../components/Typography';
import type { Turn } from '../../../learning/types';
import { makeStyles, useTheme } from '../../../ui/theme';
import { BROOK_TALL } from '../../../games/art/rendered';
import { BridgePost, ForestLayer, LetterStone, Plank, Stream } from '../../../games/art/wordForest';
import { Draggable, DropArea, DropZone } from '../../../games/engine/drag';
import { Layer, Parallax } from '../../../games/engine/Parallax';
import { useRig } from '../../../games/engine/rig';
import { useSfx } from '../../../games/engine/sfx';
import { useReactions } from '../../../games/engine/feedback';

// Word Forest (Tiếng Việt, Ghép chữ): the pet explores a magic forest. Each word is a brook to cross: the bridge is
// missing its planks, one plank per letter (lớp 1) or syllable (lớp 2). The pieces glow on the forest floor as stones:
// drag one onto a plank (or tap it: it goes to the first free plank; it drops into place), then "Xây cầu". Right: the
// planks light up one after another and the pet runs across and gets a book piece (a reaction of the feedback loop: the
// explanation waits for it, "Bỏ qua" jumps to the far bank); on "Tiếp theo" the forest scrolls on to the next brook. Wrong:
// the bridge wobbles and the pieces stay under the right answer. The backend checks every word.

type Note = { text: string; tone: 'good' | 'bad' } | null;
type Props = {
  turn: Turn; disabled: boolean; feedback?: Note; onSubmit: (ids: string[]) => void; collected: number; total: number;
  /** The word was built right: the pet crosses, and waits on the far bank for the next word. */ solved?: boolean;
  petId: string; petLevel: number; reduceMotion: boolean;
  /** The guide: what is placed, in order (nothing can be touched). */
  demo?: { placed: string[]; result?: 'ok' };
};

const TILE = 54;
const STEP = 200; // how far the near layer scrolls for one brook
const SCENE_H = 196;
const FLOOR_PAD = 10;

/** Puts a piece on a plank: the first free one, or `at` (the piece there goes back to the floor). A piece already on
 * another plank moves. */
export function placeTile(slots: (string | null)[], id: string, at?: number): (string | null)[] {
  const next = slots.map((s) => (s === id ? null : s));
  const i = at ?? next.indexOf(null);
  if (i < 0 || i >= next.length) return slots;
  next[i] = id;
  return next;
}

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Where the pieces lie on the floor: one per cell of a grid, shifted a little inside it (never touching another). */
export function scatter(ids: string[], width: number, seed: string): { id: string; x: number; y: number }[] {
  const cols = Math.max(1, Math.min(ids.length, Math.floor(width / (TILE + 18))));
  const cellW = width / cols;
  const cellH = TILE + 22;
  return ids.map((id, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const h = hash(`${seed}:${id}`);
    const jx = ((h % 1000) / 1000 - 0.5) * Math.max(0, cellW - TILE - 6);
    const jy = ((Math.floor(h / 1000) % 1000) / 1000 - 0.5) * 14;
    return { id, x: col * cellW + (cellW - TILE) / 2 + jx, y: FLOOR_PAD + row * cellH + 6 + jy };
  });
}
export const floorHeight = (count: number, width: number) =>
  FLOOR_PAD * 2 + Math.ceil(count / Math.max(1, Math.min(count, Math.floor(width / (TILE + 18))))) * (TILE + 22);

const FOREST: Layer[] = [
  { key: 'sky', speed: 0, render: (w, h) => <ForestLayer layer="sky" width={w} height={h} /> },
  { key: 'far', speed: 0.25, render: (w, h) => <ForestLayer layer="far" width={w} height={h} /> },
  { key: 'mid', speed: 0.55, render: (w, h) => <ForestLayer layer="mid" width={w} height={h} /> },
  { key: 'near', speed: 1, render: (w, h) => <ForestLayer layer="near" width={w} height={h} /> },
];

type Crossed = { pieces: string[]; picture: string; joiner: string };

export function WordForest({ turn, disabled, feedback, onSubmit, collected, total, solved, petId, petLevel, reduceMotion, demo }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const tiles = turn.prompt.tiles ?? [];
  const letters = turn.prompt.unit === 'letter';
  const [own, setOwn] = useState<(string | null)[]>(() => tiles.map(() => null));
  // A new word: empty planks, from its very first frame.
  const [ownFor, setOwnFor] = useState(turn.turn_id);
  if (ownFor !== turn.turn_id) { setOwnFor(turn.turn_id); setOwn(tiles.map(() => null)); }
  const slots = demo ? tiles.map((_, i) => demo.placed[i] ?? null) : own;
  const locked = disabled || !!demo;
  const text = (id: string | null) => (id ? tiles.find((x) => x.id === id)?.text ?? '' : '');
  const complete = slots.every(Boolean);
  const [width, setWidth] = useState(0);
  const W = width || 320;

  // Crossing: the bridge just built (with its word) stays while the pet runs over it, then the forest scrolls on.
  const travel = useRef(new Animated.Value(collected)).current;
  const run = useRef(new Animated.Value(0)).current; // the pet: 0 on this bank → 1 on the far bank
  const glow = useRef(new Animated.Value(0)).current;
  const lay = useRef(new Animated.Value(0)).current; // 0 → 1: the planks lighting up one after another
  const wobble = useRef(new Animated.Value(0)).current;
  const react = useReactions();
  const [crossing, setCrossing] = useState<Crossed | null>(null);
  const pet = useRig({ facing: 1, reduceMotion, ...drawnActions(petId, petLevel) });
  const sound = useSfx();
  const sent = useRef<(Crossed & { turnId: string }) | null>(null);
  const shownTurn = useRef(turn.turn_id);
  const ms = (n: number) => (reduceMotion ? 0 : n);
  // Built right: the planks light up, the pet runs across and waits on the far bank (the explanation comes then).
  useEffect(() => {
    if (!solved || demo) return;
    const before = sent.current?.turnId === turn.turn_id ? sent.current : null;
    if (!before) return;
    setCrossing({ pieces: before.pieces, picture: before.picture, joiner: before.joiner });
    glow.setValue(1); run.setValue(0); lay.setValue(0);
    pet.play('jump');
    sound('unlock');
    const toEnd = () => { anim.stop(); run.setValue(1); lay.setValue(1); };
    const end = react.begin('forest:cross', { maxMs: 3500, finish: toEnd });
    const anim = Animated.sequence([
      Animated.timing(lay, { toValue: 1, duration: ms(Math.min(900, 140 * before.pieces.length)), easing: Easing.linear, useNativeDriver: false }),
      Animated.timing(run, { toValue: 1, duration: ms(1100), easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]);
    anim.start(({ finished }) => { if (finished) pet.play('cheer'); end(); }); // across: it is glad on the far bank
    return () => { anim.stop(); end(); };
  }, [solved]); // eslint-disable-line react-hooks/exhaustive-deps
  // The next word ("Tiếp theo"): the forest scrolls on to its brook, the pet comes along to this bank.
  useEffect(() => {
    if (shownTurn.current === turn.turn_id) return;
    shownTurn.current = turn.turn_id;
    if (!crossing || demo) { travel.setValue(collected); run.setValue(0); return; }
    if (hasSprite(petId, petLevel, 'jump') || hasSprite(petId, petLevel, 'celebrate')) pet.stop(); // it comes along: no drawn jump or celebrating on the move
    const toEnd = () => { anim.stop(); travel.setValue(collected); run.setValue(0); glow.setValue(0); lay.setValue(0); setCrossing(null); };
    const end = react.begin('forest:scroll', { maxMs: 2000, finish: toEnd });
    const anim = Animated.parallel([
      Animated.timing(travel, { toValue: collected, duration: ms(900), easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(run, { toValue: 0, duration: ms(900), easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(glow, { toValue: 0, duration: ms(900), useNativeDriver: false }),
    ]);
    anim.start(() => { setCrossing(null); lay.setValue(0); end(); });
    return () => { anim.stop(); end(); };
  }, [turn.turn_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A wrong word: the bridge wobbles (the pieces stay).
  const lastNote = useRef(feedback);
  useEffect(() => {
    if (feedback === lastNote.current) return;
    lastNote.current = feedback;
    if (feedback?.tone === 'bad') sound('wrong');
    if (feedback?.tone !== 'bad' || reduceMotion) return;
    wobble.setValue(0);
    Animated.timing(wobble, { toValue: 1, duration: 520, easing: Easing.linear, useNativeDriver: false }).start();
  }, [feedback]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (id: string, at?: number) => { if (!locked && !crossing) setOwn((list) => placeTile(list, id, at)); return !locked; };
  const unplace = (i: number) => { if (!locked) setOwn((list) => list.map((s, j) => (j === i ? null : s))); };
  const check = () => {
    const ids = slots as string[];
    sent.current = { turnId: turn.turn_id, pieces: ids.map(text), picture: turn.prompt.picture ?? '', joiner: letters ? '' : ' ' };
    onSubmit(ids);
  };

  // The brook and the bridge: from this bank (left) to the far bank (right), one plank per piece.
  const bankL = W * 0.3;
  const bankR = W * 0.86;
  const picture = crossing ? crossing.picture : turn.prompt.picture ?? '';
  const n = Math.max(1, crossing ? crossing.pieces.length : tiles.length);
  const plankW = Math.min(64, (bankR - bankL) / n);
  const bridgeY = SCENE_H * 0.76; // the planks' middle, level with the banks
  // The brook is a little wider than the bridge, so that its banks meet the ground on either side of the posts.
  const brookW = (bankR - bankL) * 1.24;
  const brookH = brookW * BROOK_TALL;
  const plankAt = (i: number) => bankL + (bankR - bankL - plankW * n) / 2 + i * plankW;
  const floorTiles = tiles.filter((tile) => !slots.includes(tile.id));
  const spots = useMemo(() => scatter(tiles.map((x) => x.id), Math.max(TILE, W), turn.turn_id), [tiles, W, turn.turn_id]);
  const right = demo?.result === 'ok';
  const shake = wobble.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, 6, -6, 4, -2, 0] });
  const petX = run.interpolate({ inputRange: [0, 1], outputRange: [12, bankR + 6 - 70] });
  const leaving = crossing ? travel.interpolate({ inputRange: [collected - 1, collected], outputRange: [0, -STEP], extrapolate: 'clamp' }) : 0;
  const words = crossing ? crossing.pieces.join(crossing.joiner) : slots.map((s) => text(s) || '_').join(letters ? '' : ' ');

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.bookRow}>
        <View style={styles.bookChip} accessibilityLabel={`Pet đã nhận ${collected} trên ${total} mảnh sách`}>
          <Ionicons name="book" size={15} color={styles.bookText.color} />
          <Text style={styles.bookText}>Mảnh sách: {collected}/{total}</Text>
        </View>
        <View style={styles.trail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: total }).map((_, i) => <View key={i} style={[styles.trailDot, i < collected && styles.trailDone, i === collected && styles.trailNow]} />)}
        </View>
      </View>
      <DropArea style={styles.area}>
        <View style={[styles.scene, { height: SCENE_H }]}>
          {width ? <Parallax width={W} height={SCENE_H} layers={FOREST} travel={travel} step={STEP} drift={0.6} running={!locked} reduceMotion={reduceMotion} /> : null}
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: leaving }] }]} pointerEvents="box-none">
            <View pointerEvents="none" style={[styles.brook, { left: (bankL + bankR - brookW) / 2, width: brookW, top: bridgeY - brookH * 0.2 }]}>
              {width ? <Stream width={brookW} height={brookH} /> : null}
            </View>
            <View pointerEvents="none" style={[styles.post, { left: bankL - 16, top: bridgeY - 50 }]}><BridgePost size={70} /></View>
            <View pointerEvents="none" style={[styles.post, { left: bankR - 14, top: bridgeY - 50 }]}><BridgePost size={70} /></View>
            <View accessible accessibilityRole="image" accessibilityLabel="Hình gợi ý" style={[styles.sign, { left: 6, top: 8 }]}>
              <Text style={styles.signPicture}>{picture}</Text>
            </View>
            <Animated.View style={[styles.bridge, { transform: [{ translateY: shake }] }]} pointerEvents="box-none"
              accessibilityLabel={`Cây cầu: ${words}`}>
              {Array.from({ length: n }).map((_, i) => {
                const id = crossing ? null : slots[i];
                const piece = crossing ? crossing.pieces[i] : text(id);
                return (
                  <DropZone key={i} id={`plank-${i}`} style={(over) => [styles.plankSlot, { left: plankAt(i), top: bridgeY - 18, width: plankW - 2 },
                    !piece && styles.plankEmpty, over && styles.plankOver]}>
                    {piece ? (
                      <Pressable onPress={() => unplace(i)} disabled={locked || !!crossing} accessibilityRole="button" accessibilityLabel={`Gỡ ${piece}`} style={styles.plankFill}>
                        <LaidPlank piece={piece} size={plankW - 2} ok={right || !!crossing} lay={lay} index={i} count={n} reduceMotion={reduceMotion || !!demo} />
                      </Pressable>
                    ) : <Text style={styles.plankHole}>{i + 1}</Text>}
                  </DropZone>
                );
              })}
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.light, { opacity: glow }]} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.pet, { top: bridgeY - 50, transform: [{ translateX: petX }] }]}>
            <Animated.View style={pet.style}><PetArt pet={petId} size={68} stage={petLevel} walking={!!crossing && !reduceMotion} still={reduceMotion && !crossing} leap={pet.leap} cheer={pet.cheer} /></Animated.View>
          </Animated.View>
        </View>
        <View style={[styles.floor, { height: floorHeight(tiles.length, Math.max(TILE, W)) }]}>
          {(crossing ? [] : floorTiles).map((tile) => { // the next word's pieces come once the forest has scrolled on
            const spot = spots.find((s) => s.id === tile.id);
            return spot ? (
              <Draggable key={tile.id} disabled={locked || !!crossing} style={[styles.floorTile, { left: spot.x, top: spot.y }]}
                onDrop={(zone) => (zone.startsWith('plank-') ? place(tile.id, Number(zone.slice(6))) : false)}>
                <Pressable onPress={() => place(tile.id)} disabled={locked || !!crossing} accessibilityRole="button"
                  accessibilityLabel={`${letters ? 'Chữ' : 'Tiếng'} ${tile.text}`} accessibilityHint="Chạm để đặt lên tấm ván trống đầu tiên, hoặc kéo lên một tấm ván"
                  style={({ pressed }) => [styles.stone, pressed && styles.pressed]}>
                  <View style={StyleSheet.absoluteFill} pointerEvents="none"><LetterStone size={TILE} /></View>
                  <Text style={styles.stoneText}>{tile.text}</Text>
                </Pressable>
              </Draggable>
            ) : null;
          })}
        </View>
      </DropArea>
      {(right || feedback?.text) ? (
        <View style={[styles.note, (right || feedback?.tone === 'good') ? styles.noteGood : styles.noteBad]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Ionicons name={right || feedback?.tone === 'good' ? 'checkmark-circle' : 'information-circle'} size={18} color={right || feedback?.tone === 'good' ? t.success : t.danger} />
          <Text style={[styles.noteText, { color: right || feedback?.tone === 'good' ? t.success : t.danger }]}>
            {right ? 'Chính xác! Cầu đã xong, pet chạy qua suối và nhận một mảnh sách.' : feedback?.text}
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={() => setOwn(tiles.map(() => null))} disabled={locked || !slots.some(Boolean)} accessibilityRole="button" accessibilityLabel="Xếp lại"
          style={[styles.secondary, (locked || !slots.some(Boolean)) && styles.dimmed]}><Text style={styles.secondaryText}>Xếp lại</Text></Pressable>
        <Pressable onPress={check} disabled={locked || !complete || !!crossing} accessibilityRole="button" accessibilityLabel="Xây cầu"
          accessibilityState={{ disabled: locked || !complete || !!crossing }} style={[styles.primary, (locked || !complete || !!crossing) && styles.dimmed]}>
          <Ionicons name="hammer" size={17} color={t.onPrimary} />
          <Text style={styles.primaryText}>Xây cầu</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A plank laid on the bridge with its piece: it drops into place when the piece is put there, and lights up in its turn
 * (`lay` passing its index) when the word is right. */
function LaidPlank({ piece, size, ok, lay, index, count, reduceMotion }: {
  piece: string; size: number; ok: boolean; lay: Animated.Value; index: number; count: number; reduceMotion: boolean;
}) {
  const styles = useStyles();
  const drop = useRef(new Animated.Value(reduceMotion ? 0 : 1)).current;
  useEffect(() => {
    if (reduceMotion) { drop.setValue(0); return; }
    drop.setValue(1);
    const anim = Animated.timing(drop, { toValue: 0, duration: 360, easing: Easing.out(Easing.bounce), useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [piece]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = index / count;
  const to = (index + 1) / count;
  const mid = (from + to) / 2;
  const shine = lay.interpolate({ inputRange: [from, mid, to], outputRange: [0, 1, 0.55], extrapolate: 'clamp' });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.center, { transform: [
      { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) },
      { scale: lay.interpolate({ inputRange: [from, mid, to], outputRange: [1, 1.14, 1], extrapolate: 'clamp' }) }] }]}>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none"><Plank size={size} /></View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.plankShine, { opacity: shine }]} />
      <Text style={[styles.plankText, ok && styles.plankTextOk]}>{piece}</Text>
    </Animated.View>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 4 },
  area: { gap: 10 },
  bookRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bookChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bookText: { fontSize: 14, fontWeight: '900', color: dark ? tones.sun.ink : '#8A5A00' },
  trail: { flexDirection: 'row', gap: 4, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  trailDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: dark ? t.track : '#D9E6D2' },
  trailDone: { backgroundColor: '#3E8E4F' },
  trailNow: { backgroundColor: '#F2C46D' },
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#CFEBC8' },
  brook: { position: 'absolute', bottom: 0, overflow: 'hidden' },
  post: { position: 'absolute' },
  sign: { position: 'absolute', width: 70, height: 62, borderRadius: 14, backgroundColor: '#FFF8EC', borderWidth: 3, borderColor: '#9B6B35',
    alignItems: 'center', justifyContent: 'center' },
  signPicture: { fontSize: 38, lineHeight: 46 },
  bridge: { ...StyleSheet.absoluteFillObject },
  plankSlot: { position: 'absolute', height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  plankEmpty: { borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(80,60,30,0.25)' },
  plankOver: { borderColor: '#FFE9A8', backgroundColor: 'rgba(255,233,168,0.45)', transform: [{ scale: 1.08 }] },
  plankFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  plankText: { fontSize: 22, fontWeight: '900', color: '#4A2E10' },
  plankTextOk: { color: '#1F6B33' },
  plankShine: { borderRadius: 8, backgroundColor: 'rgba(255,236,140,0.7)' },
  plankHole: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  light: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,240,170,0.16)' },
  center: { alignItems: 'center', justifyContent: 'center' },
  pet: { position: 'absolute', left: 0 },
  floor: { borderRadius: 18, backgroundColor: '#E5F3DC', borderWidth: 2, borderColor: '#C3DFB4' },
  floorTile: { position: 'absolute', width: TILE, height: TILE },
  stone: { width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center' },
  stoneText: { fontSize: 22, fontWeight: '900', color: '#3B2A10' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.95 }] },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, padding: 10 },
  noteGood: { backgroundColor: t.successBg },
  noteBad: { backgroundColor: t.dangerBg },
  noteText: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  primary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#3E8E4F', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryText: { color: t.onPrimary, fontWeight: '900', fontSize: 16 },
  secondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontWeight: '900', fontSize: 15 },
  dimmed: { opacity: 0.45 },
}));
