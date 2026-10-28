import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../../components/Typography';
import { PetArt } from '../../../components/PetArt';
import type { Turn } from '../../../learning/types';
import { appTheme as t } from '../../../theme';

export type Flash = { turnId: string; kind: 'hit' | 'miss' } | null;

/** What a destroyed (or missed) word leaves behind for a moment: its meaning or its English word, where it was. */
export type Burst = { id: string; position: number; progress: number; title: string; sub: string | null; tone: 'hit' | 'miss' };
/** How long a burst stays on screen: shown plainly, then fading out. */
export const BURST_MS = 2300;
const BURST_HOLD_MS = 500;

type Props = {
  /** meteor: Vietnamese meanings on falling rocks; words: English words falling (Anh → Việt); defense: monsters. */
  variant: 'meteor' | 'words' | 'defense';
  turns: Turn[];
  /** 0 = just appeared, 1 = reached the ground (meteor) or the base (defense). */
  progress: (turn: Turn) => number;
  selectedId: string | null;
  onSelect: (turnId: string) => void;
  petId: string;
  petLevel: number;
  reduceMotion: boolean;
  flash: Flash;
  /** Labels fading out where words were hit or missed. Drawn under the falling targets and never touchable. */
  bursts?: Burst[];
  /** Rendered inside the aimed meteor, under its Vietnamese word (the answer boxes); gets the width available. */
  input?: (width: number) => React.ReactNode;
};

const PET_ZONE = 84; // the pet stands here; targets keep out of it when the field is wide enough for two lanes beside it
const TARGET_W = 132;
const TARGET_H = 64;
const METEOR_W = 120;
const METEOR_H = 112;
const AIMED_H = 176;
const BURST_W = 170;
const BURST_H = 58;
const GROUND = 22;

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** Meteors (or English words) fall toward the ground, monsters walk toward the base. Positions come from the
 * pause-aware game clock. */
export function Playfield({ variant, turns, progress, selectedId, onSelect, petId, petLevel, reduceMotion, flash, bursts = [], input }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  const meteor = variant !== 'defense';
  // Two targets fall at once in Thử thách, so there are always two lanes where they fit: on a narrow phone (360 px)
  // the lanes also use the pet's side (the pet is drawn under the targets, so it never hides one).
  const laneStart = size.width - PET_ZONE >= 2 * (METEOR_W + 8) ? PET_ZONE : 8;
  const lanes = Math.max(1, Math.floor((size.width - laneStart - 8) / (METEOR_W + 8)));
  const laneLeft = (position: number, w: number) =>
    Math.max(8, Math.min(laneStart + (position % lanes) * (METEOR_W + 8) + (METEOR_W - w) / 2, size.width - w - 8));
  const rectOf = (turn: Turn): Rect => {
    const aimed = turn.turn_id === selectedId && !!input;
    const width = aimed ? Math.min(300, size.width - 16) : METEOR_W;
    const height = aimed ? AIMED_H : METEOR_H;
    const p = Math.max(0, Math.min(1, progress(turn)));
    return { left: laneLeft(turn.position, width), top: p * Math.max(0, size.height - height - 24), width, height };
  };
  // Where each burst sits, chosen once when it appears: at the broken word, moved clear of every word on screen then
  // (the next word usually appears right there), so the meaning can be read. Drawn under the targets, a word that
  // falls past it later is never hidden by it.
  const placed = useRef(new Map<string, { left: number; top: number }>());
  const placeBurst = (b: Burst) => {
    const known = placed.current.get(b.id);
    if (known) return known;
    const maxTop = Math.max(0, size.height - BURST_H - GROUND - 4);
    const box: Rect = { left: laneLeft(b.position, BURST_W), width: BURST_W, height: BURST_H,
      top: Math.min(maxTop, Math.max(0, Math.min(1, b.progress)) * Math.max(0, size.height - METEOR_H - 24) + 30) };
    // Clear of every word on screen, and of the meanings still fading out.
    const targets = [...turns.map(rectOf), ...[...placed.current.values()].map((s) => ({ ...s, width: BURST_W, height: BURST_H }))];
    for (let i = 0; i < targets.length && targets.some((r) => overlaps(box, r)); i++) {
      const blocking = targets.filter((r) => overlaps(box, r));
      const below = Math.max(...blocking.map((r) => r.top + r.height)) + 6;
      box.top = below <= maxTop ? below : Math.max(0, Math.min(...blocking.map((r) => r.top)) - BURST_H - 6);
    }
    const spot = { left: box.left, top: Math.min(maxTop, box.top) };
    placed.current.set(b.id, spot);
    return spot;
  };
  useEffect(() => {
    const live = new Set(bursts.map((b) => b.id));
    for (const id of placed.current.keys()) if (!live.has(id)) placed.current.delete(id);
  }, [bursts]);
  return (
    <View style={[styles.field, meteor ? styles.sky : styles.meadow]} onLayout={onLayout}
      accessibilityLabel={variant === 'words' ? 'Bầu trời từ vựng' : meteor ? 'Bầu trời thiên thạch' : 'Đường tới căn cứ'}>
      {meteor ? <Stars /> : null}
      {meteor ? <View style={styles.ground} /> : <View style={styles.base}><Text style={styles.baseIcon}>🏰</Text></View>}
      <View style={[styles.pet, meteor ? styles.petMeteor : styles.petDefense]} pointerEvents="none">
        <PetArt pet={petId} size={64} stage={petLevel} still={reduceMotion} />
      </View>
      {/* Under the targets, so a fading meaning never hides a word that is still falling. */}
      {size.width > 0 && meteor && bursts.map((b) => <BurstLabel key={b.id} burst={b} reduceMotion={reduceMotion} style={placeBurst(b)} />)}
      {/* The aimed target last, so it (and its answer boxes) is drawn over any other one. */}
      {size.width > 0 && [...turns].sort((a, b) => Number(a.turn_id === selectedId) - Number(b.turn_id === selectedId)).map((turn) => {
        const p = Math.max(0, Math.min(1, progress(turn)));
        const selected = turn.turn_id === selectedId;
        const hit = flash?.turnId === turn.turn_id && flash.kind === 'hit';
        if (!meteor) {
          const pos = { left: PET_ZONE + (1 - p) * Math.max(0, size.width - PET_ZONE - TARGET_W), top: 16 + (turn.position % 2) * (TARGET_H + 14) };
          return (
            <Pressable key={turn.turn_id} onPress={() => onSelect(turn.turn_id)} accessibilityRole="button" accessibilityState={{ selected }}
              accessibilityLabel={`Quái vật: ${turn.prompt.expression}${selected ? ', đang nhắm' : ''}`}
              style={[styles.monster, pos, selected && styles.selected, p > 0.75 && styles.danger]}>
              <Text style={styles.icon}>{hit ? '💥' : '👾'}</Text>
              <Text style={styles.monsterText} numberOfLines={2}>{turn.prompt.expression}</Text>
            </Pressable>
          );
        }
        const aimed = selected && !!input;
        const rect = rectOf(turn);
        const w = rect.width;
        const pos = { left: rect.left, top: rect.top, width: w };
        // Anh → Việt: the English word itself falls; Việt → Anh: a rock carrying the Vietnamese meaning.
        const spelled = turn.kind === 'word_spelling';
        const label = (spelled ? turn.prompt.word : turn.prompt.meaning_vi) ?? '';
        const noun = spelled ? 'Từ' : 'Thiên thạch';
        const body = spelled ? (
          <WordTile word={label} hit={hit} danger={p > 0.75} big={aimed} />
        ) : (
          <>
            <Rock hit={hit} danger={p > 0.75} big={aimed} />
            <Text style={[styles.word, aimed && styles.wordAimed]} numberOfLines={2}>{label}</Text>
            {aimed && turn.prompt.context_vi ? <Text style={styles.context} numberOfLines={1}>{turn.prompt.context_vi}</Text> : null}
          </>
        );
        if (aimed) {
          return (
            <View key={turn.turn_id} accessibilityLabel={`${noun} đang nhắm: ${label}`} style={[styles.meteor, pos]}>
              {body}
              {input!(w)}
            </View>
          );
        }
        return (
          <Pressable key={turn.turn_id} onPress={() => onSelect(turn.turn_id)} accessibilityRole="button" accessibilityState={{ selected }}
            accessibilityLabel={`${noun}: ${label}${selected ? ', đang nhắm' : ''}`} style={[styles.meteor, pos]}>
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A glowing rock with a fiery tail streaming up behind it. */
function Rock({ hit, danger, big }: { hit: boolean; danger: boolean; big: boolean }) {
  const d = big ? 48 : 40;
  if (hit) return <Text style={[styles.boom, { height: d + 34 }]}>💥</Text>;
  return (
    <View style={styles.rockWrap} pointerEvents="none">
      <LinearGradient colors={['rgba(255,200,90,0)', 'rgba(255,150,60,0.55)', 'rgba(255,110,40,0.95)']}
        style={[styles.tail, { width: d * 0.62, borderRadius: d * 0.31 }]} />
      <LinearGradient colors={danger ? ['#FFB199', '#F0473A', '#7E1D1D'] : ['#FFE29A', '#F58A3A', '#8E3B1F']} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.85, y: 1 }}
        style={[styles.rock, { width: d, height: d, borderRadius: d / 2 }]}>
        <View style={[styles.crater, { width: d * 0.22, height: d * 0.22, borderRadius: d * 0.11, left: d * 0.22, top: d * 0.5 }]} />
        <View style={[styles.crater, { width: d * 0.14, height: d * 0.14, borderRadius: d * 0.07, left: d * 0.58, top: d * 0.3 }]} />
      </LinearGradient>
    </View>
  );
}

/** An English word falling in Anh → Việt: a glowing tile with a short trail. */
function WordTile({ word, hit, danger, big }: { word: string; hit: boolean; danger: boolean; big: boolean }) {
  if (hit) return <Text style={[styles.boom, { height: 74 }]}>💥</Text>;
  return (
    <View style={styles.rockWrap} pointerEvents="none">
      <LinearGradient colors={['rgba(140,200,255,0)', 'rgba(120,180,255,0.5)']} style={styles.trail} />
      <LinearGradient colors={danger ? ['#FFB199', '#E0475B'] : ['#7FD3FF', '#4C6FFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.tile, big && styles.tileBig]}>
        <Text style={[styles.tileText, big && styles.tileTextBig, word.length > 12 && styles.tileTextLong]} numberOfLines={2}>{word}</Text>
      </LinearGradient>
    </View>
  );
}

/** The meaning (or the English word) shown where a word broke; it drifts up and fades, and takes no touches. */
function BurstLabel({ burst, reduceMotion, style }: { burst: Burst; reduceMotion: boolean; style: object }) {
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(fade, { toValue: 0, duration: BURST_MS - BURST_HOLD_MS, delay: BURST_HOLD_MS, easing: Easing.in(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fade, reduceMotion]);
  const rise = fade.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" accessibilityLabel={`${burst.title}${burst.sub ? `, ${burst.sub}` : ''}`}
      style={[styles.burst, style, { opacity: fade, transform: [{ translateY: rise }] }]}>
      <Text style={[styles.burstTitle, burst.tone === 'miss' && styles.burstMiss]} numberOfLines={2}>{burst.title}</Text>
      {burst.sub ? <Text style={styles.burstSub} numberOfLines={1}>{burst.sub}</Text> : null}
    </Animated.View>
  );
}

const STAR_SPOTS =[[8, 12], [22, 40], [37, 8], [55, 28], [70, 14], [86, 36], [14, 62], [48, 54], [78, 66], [92, 8], [63, 80], [30, 86]];
function Stars() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {STAR_SPOTS.map(([x, y], i) => <View key={i} style={[styles.star, { left: `${x}%`, top: `${y}%`, opacity: i % 3 ? 0.45 : 0.8 }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, minHeight: 170, borderRadius: 22, overflow: 'hidden', marginBottom: 10 },
  sky: { backgroundColor: '#142349' },
  meadow: { backgroundColor: '#DDF3E4' },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  ground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 22, backgroundColor: '#3E5F45' },
  base: { position: 'absolute', left: 0, top: 0, bottom: 0, width: PET_ZONE - 6, backgroundColor: '#C7E5CF', alignItems: 'center', paddingTop: 8 },
  baseIcon: { fontSize: 28 },
  pet: { position: 'absolute' },
  petMeteor: { left: 8, bottom: 12 },
  petDefense: { left: 8, bottom: 8 },
  meteor: { position: 'absolute', alignItems: 'center' },
  rockWrap: { alignItems: 'center' },
  tail: { height: 40, marginBottom: -14 },
  rock: { shadowColor: '#FF8A3D', shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  crater: { position: 'absolute', backgroundColor: 'rgba(110,40,20,0.35)' },
  boom: { fontSize: 38, textAlignVertical: 'bottom' },
  word: { marginTop: 6, fontSize: 16, fontWeight: '900', color: '#FFFFFF', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  wordAimed: { fontSize: 19, color: '#FFE9B8' },
  context: { fontSize: 12, color: '#C9D6F2', textAlign: 'center' },
  trail: { width: 18, height: 30, borderRadius: 9, marginBottom: -6 },
  tile: { minWidth: 84, maxWidth: METEOR_W, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, alignItems: 'center',
    shadowColor: '#7FB8FF', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  tileBig: { maxWidth: 260, paddingVertical: 10 },
  tileText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.5 },
  tileTextBig: { fontSize: 22 },
  tileTextLong: { fontSize: 15, textAlign: 'center' }, // phrases wrap on two lines instead of being cut
  burst: { position: 'absolute', width: BURST_W, minHeight: BURST_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14,
    backgroundColor: 'rgba(12,22,52,0.55)' },
  burstTitle: { fontSize: 18, fontWeight: '900', color: '#FFE9B8', textAlign: 'center' },
  burstMiss: { color: '#FFB3BD' },
  burstSub: { fontSize: 13, fontWeight: '700', color: '#C9D6F2', textAlign: 'center' },
  monster: { position: 'absolute', width: TARGET_W, minHeight: TARGET_H, borderRadius: 18, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 2, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 },
  selected: { borderColor: '#F2A93B' },
  danger: { backgroundColor: '#FFE7EE' },
  icon: { fontSize: 20 },
  monsterText: { flex: 1, fontSize: 14, fontWeight: '800', color: t.ink },
});
