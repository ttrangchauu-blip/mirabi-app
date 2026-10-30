import React, { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Platform, Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer } from 'expo-audio';
import { Text, TextInput } from '../../../components/Typography';
import { PetArt } from '../../../components/PetArt';
import type { Turn, WordPair } from '../../../learning/types';
import { hasSprite, moveActivity } from '../../../petSprites';
import { appTheme as t } from '../../../theme';
import { Box, laneLefts, resolveOverlaps } from './fieldLayout';
import {
  BURST_MS, bulletAt, burstLook, leanAt, muzzle, Move, PET_SIZE, petBounds, petDrift, petMoving, petX, planShot, Point, shardsAt, ShotPlan,
  wiggleAt, WIGGLE_MS,
} from './shooterFx';
import { AnswerSlots, SLOT_PITCH } from './LetterInput';

export type Flash = { turnId: string; kind: 'hit' | 'miss' } | null;

/** What a destroyed (or missed) word leaves behind for a moment: its meaning or its English word, where it was: `at`
 * (the point where the bullet hit it), or else its lane and how far it had fallen. */
export type Burst = { id: string; position: number; progress: number; title: string; sub: string | null; tone: 'hit' | 'miss';
  at?: Point };
/** A word answered right. It keeps falling as before (its `progress`; it can no longer be missed) while the pet's
 * bullets fly after it, and breaks where the first one reaches it. */
export type Shot = { id: string; turn: Turn; word: WordPair | null; /** It was the aimed one (drawn larger). */ aimed: boolean };
/** The typed answer of the falling-word games: one text field for the whole field, shown in the aimed target's boxes.
 * There is no "Bắn" and no Enter: the game shoots by itself as soon as what is typed is right. */
export type Answer = { value: string; onChange: (value: string) => void; editable: boolean };

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
  /** The falling-word games: the game is running (paused, everything here stops: the pet, the bullets, the effects). */
  running?: boolean;
  shots?: Shot[];
  /** The first bullet reached a shot word at `at`: it breaks now (the caller shows its meaning and counts it). */
  onImpact?: (shot: Shot, at: Point) => void;
  /** A shot is over (the pieces are gone), and a burst has faded out. */
  onShotDone?: (id: string) => void;
  onBurstDone?: (id: string) => void;
  /** Bumped after a wrong answer: the pet shakes a little, no shot. */
  wrongKey?: number;
  /** Shot and break sounds ("Âm thanh"). */
  sound?: boolean;
  /** The falling-word games: every target carries answer boxes under its word; the aimed one shows what is typed. */
  answer?: Answer;
};

const PET_ZONE = 84; // defense: the pet stands by the base, monsters keep out of it
const TARGET_W = 132;
const TARGET_H = 64;
const METEOR_W = 112;
const METEOR_H = 100;
const SLOTS_H = 118; // a target with its small answer boxes
const AIMED_MAX_W = 260;
const AIMED_H = 150; // the aimed target: its word and the answer boxes
const BURST_W = 150;
const BURST_H = 50;
const GROUND = 22;
/** The shooter stands on the ground, at the bottom of the field. */
const PET_BOTTOM = 10;
/** Where a held word is hit: about the middle of its rock or tile. */
const HIT_Y = 40;

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** Wide enough for the word's answer boxes, never wider than needed (so it rarely crowds another word). */
const aimedWidth = (turn: Turn, fieldWidth: number) => {
  const letters = turn.prompt.letters ?? [];
  const total = letters.reduce((a, b) => a + b, 0);
  const need = total * SLOT_PITCH + Math.max(0, letters.length - 1) * 8 + 16;
  return Math.max(METEOR_W, Math.min(AIMED_MAX_W, need, fieldWidth - 16));
};

/** Meteors (or English words) fall toward the ground, monsters walk toward the base. Positions come from the
 * pause-aware game clock. In the falling-word games the pet at the bottom shoots the words that were answered. */
export function Playfield({ variant, turns, progress, selectedId, onSelect, petId, petLevel, reduceMotion, flash, bursts = [],
  running = true, shots = [], onImpact, onShotDone, onBurstDone, wrongKey = 0, sound = false, answer }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  const meteor = variant !== 'defense';
  // The shooter walks along the whole bottom (drawn under the targets), so the falling words use the full width.
  const lanes = laneLefts(size.width, METEOR_W);
  const laneLeft = (lane: number, w: number) =>
    Math.max(8, Math.min(lanes[lane % lanes.length] + (METEOR_W - w) / 2, size.width - w - 8));
  /** Where a target would be from its lane and its fall alone. The height of its fall is the same for every target, so
   * becoming the aimed one (a taller frame, growing downward) never moves a word up. */
  const travel = Math.max(0, size.height - (answer ? AIMED_H : METEOR_H) - GROUND - 2);
  // Each word gets its lane when it first appears: the one whose top is clearest (the words in it are furthest down),
  // so a new word comes in at the top beside the others, never on a word still falling or being shot.
  const laneOf = useRef(new Map<string, number>());
  const lastRects = useRef(new Map<string, Rect>());
  const fresh: Rect[] = []; // lanes taken in this same render (two words appearing together)
  const lane = (turn: Turn) => {
    let chosen = laneOf.current.get(turn.turn_id);
    if (chosen === undefined && size.width > 0) {
      const others = [...lastRects.current.values(), ...fresh];
      const clearance = (i: number) => {
        const left = laneLeft(i, METEOR_W);
        const below = others.filter((r) => r.left < left + METEOR_W && left < r.left + r.width).map((r) => r.top);
        return below.length ? Math.min(...below) : Infinity;
      };
      const order = lanes.map((_, i) => (turn.position + i) % lanes.length); // a tie: the word's own lane first
      chosen = order.reduce((best, i) => (clearance(i) > clearance(best) ? i : best), order[0]);
      laneOf.current.set(turn.turn_id, chosen);
      fresh.push({ left: laneLeft(chosen, METEOR_W), top: 0, width: METEOR_W, height: SLOTS_H });
    }
    return chosen ?? turn.position;
  };
  const naturalRect = (turn: Turn, p: number, aimed: boolean): Rect => {
    const big = aimed && !!answer;
    const width = big ? aimedWidth(turn, size.width) : METEOR_W;
    const height = big ? AIMED_H : answer ? SLOTS_H : METEOR_H;
    return { left: laneLeft(lane(turn), width), top: Math.max(0, Math.min(1, p)) * travel, width, height };
  };

  // A shot word is drawn until the first bullet reaches it (then it breaks into pieces).
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const flying = shots.filter((s) => !broken.has(s.id));
  // Where each target is drawn: its natural spot, moved aside when it would cover another word (or a word being shot).
  // Sideways it slides (eased); up and down it only ever waits and falls on: a word never shows higher than it was a
  // moment ago. A word being shot is never held up: it falls on at its own speed, the others make room for it.
  const shown = useRef(new Map<string, { left: number; top: number }>());
  const shotRects = useRef(new Map<string, Rect>());
  const rects = new Map<string, Rect>();
  if (meteor && size.width > 0) {
    const fixed: Box[] = flying.map((s) => {
      const was = lastRects.current.get(s.turn.turn_id);
      const fall = naturalRect(s.turn, progress(s.turn), false).top;
      const rect = was ? { ...was, top: Math.max(was.top, fall) } : naturalRect(s.turn, progress(s.turn), s.aimed);
      shotRects.current.set(s.id, rect);
      return { id: s.id, ...rect };
    });
    // Never above where it was last shown: a word that waited, or went ahead of its fall, goes on from there.
    const natural = turns.map((turn) => {
      const rect = naturalRect(turn, progress(turn), turn.turn_id === selectedId);
      return { id: turn.turn_id, ...rect, top: Math.max(rect.top, shown.current.get(turn.turn_id)?.top ?? 0) };
    });
    // From the ground up: a word higher up waits above the ones below it.
    const order = [...natural].sort((a, b) => b.top - a.top);
    const spots = resolveOverlaps(fixed, order, lanes.map((l) => l + METEOR_W / 2), { width: size.width, height: size.height - GROUND });
    const ease = (from: number, to: number, snap: number) => (reduceMotion || Math.abs(to - from) < snap ? to : from + (to - from) * 0.35);
    for (const box of natural) {
      const spot = spots.get(box.id)!;
      const was = shown.current.get(box.id);
      // Sideways it slides; down it falls (a bigger step, going ahead of a word, eases); up it never goes.
      const left = was ? ease(was.left, spot.left, 0.5) : spot.left;
      const top = was ? Math.max(was.top, ease(was.top, spot.top, 4)) : spot.top;
      shown.current.set(box.id, { left, top });
      rects.set(box.id, { left, top, width: box.width, height: box.height });
    }
    for (const id of shown.current.keys()) if (!rects.has(id)) shown.current.delete(id);
    for (const [id, rect] of rects) lastRects.current.set(id, rect);
    for (const { id, left, top, width, height } of fixed) lastRects.current.set(id, { left, top, width, height });
    const present = new Set([...rects.keys(), ...fixed.map((b) => b.id)]);
    for (const id of lastRects.current.keys()) if (!present.has(id)) lastRects.current.delete(id);
  }
  const rectOf = (turn: Turn) => rects.get(turn.turn_id) ?? naturalRect(turn, progress(turn), turn.turn_id === selectedId);
  // The bullets read where each shot word is now, every frame (the word keeps falling while they fly).
  const aimPoint = useCallback((id: string): Point | null => {
    const rect = shotRects.current.get(id);
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + HIT_Y } : null;
  }, []);
  const impact = useCallback((shot: Shot, at: Point) => {
    setBroken((set) => new Set(set).add(shot.id));
    onImpact?.(shot, at);
  }, [onImpact]);

  // One text field for every target: it stays mounted (and focused) while targets fall, when another one is chosen and
  // when a word breaks, so the keyboard never closes and reopens and what is typed is kept.
  const input = useRef<RNTextInput>(null);
  // On the web, focusing must not scroll the page or the field to the (invisible) field: the words would shift.
  const focusField = () => (input.current as unknown as { focus: (options?: object) => void } | null)
    ?.focus(Platform.OS === 'web' ? { preventScroll: true } : undefined);
  const answerFor = (turnId: string) => { onSelect(turnId); focusField(); };
  // After a shot the next word in falling order is aimed: typing goes on there without tapping it.
  const editable = !!answer?.editable;
  useEffect(() => {
    if (editable && selectedId) focusField();
  }, [selectedId, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where each burst sits, chosen once when it appears: at the broken word, moved clear of every word on screen then
  // (the next word usually appears right there), so the meaning can be read. Drawn under the targets, a word that
  // falls past it later is never hidden by it.
  const placed = useRef(new Map<string, { left: number; top: number }>());
  const placeBurst = (b: Burst) => {
    const known = placed.current.get(b.id);
    if (known) return known;
    const maxTop = Math.max(0, size.height - BURST_H - GROUND - 4);
    const box: Rect = b.at
      ? { left: Math.max(8, Math.min(b.at.x - BURST_W / 2, size.width - BURST_W - 8)), width: BURST_W, height: BURST_H,
        top: Math.max(0, Math.min(maxTop, b.at.y - BURST_H / 2)) }
      : { left: laneLeft(b.position, BURST_W), width: BURST_W, height: BURST_H,
        top: Math.min(maxTop, Math.max(0, Math.min(1, b.progress)) * Math.max(0, size.height - METEOR_H - GROUND - 2) + 24) };
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
  useEffect(() => {
    const live = new Set(shots.map((s) => s.id));
    for (const id of shotRects.current.keys()) if (!live.has(id)) shotRects.current.delete(id);
    setBroken((set) => ([...set].every((id) => live.has(id)) ? set : new Set([...set].filter((id) => live.has(id)))));
  }, [shots]);
  useEffect(() => {
    const live = new Set([...turns.map((x) => x.turn_id), ...shots.map((s) => s.id)]);
    for (const id of laneOf.current.keys()) if (!live.has(id)) laneOf.current.delete(id);
  }, [turns, shots]);
  // The shooter only re-renders when a shot or a meaning comes or goes (its motion runs frame by frame on its own).
  const shownBursts = useMemo(() => bursts.map((b) => ({ burst: b, spot: placeBurst(b) })), [bursts, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const aimedTurn = turns.find((x) => x.turn_id === selectedId);
  const aimedAt = aimedTurn ? rectOf(aimedTurn) : null;
  return (
    <View style={[styles.field, meteor ? styles.sky : styles.meadow]} onLayout={onLayout}
      accessibilityLabel={variant === 'words' ? 'Bầu trời từ vựng' : meteor ? 'Bầu trời thiên thạch' : 'Đường tới căn cứ'}>
      {meteor ? <Stars /> : null}
      {meteor ? <View style={styles.ground} /> : <View style={styles.base}><Text style={styles.baseIcon}>🏰</Text></View>}
      {meteor ? (size.width > 0 ? (
        // Under the targets: a fading meaning or the pieces of a broken word never hide a word that is still falling.
        <>
          {/* The words being shot fall on under the bullets, untouchable: they can no longer be answered or missed. */}
          {flying.map((shot) => {
            const rect = shotRects.current.get(shot.id);
            return rect ? (
              <View key={shot.id} testID={`shot-${shot.id}`} pointerEvents="none" style={[styles.meteor, { left: rect.left, top: rect.top, width: rect.width }]}
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <TargetBody turn={shot.turn} danger={false} big={shot.aimed} />
              </View>
            ) : null;
          })}
          <ShooterLayer width={size.width} height={size.height} words={variant === 'words'} petId={petId} petLevel={petLevel}
            running={running} reduceMotion={reduceMotion} sound={sound} wrongKey={wrongKey} shots={shots} aimPoint={aimPoint} bursts={shownBursts}
            onImpact={impact} onShotDone={onShotDone} onBurstDone={onBurstDone} />
        </>
      ) : null) : (
        <View style={[styles.pet, styles.petDefense]} pointerEvents="none">
          <PetArt pet={petId} size={64} stage={petLevel} still={reduceMotion} />
        </View>
      )}
      {/* The aimed target last, so it is drawn over any other one. */}
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
        const rect = rectOf(turn);
        const pos = { left: rect.left, top: rect.top, width: rect.width };
        const { label, noun } = targetLabel(turn);
        const body = <TargetBody turn={turn} danger={p > 0.75} big={selected} />;
        if (selected) {
          return (
            <View key={turn.turn_id} accessibilityLabel={`${noun} đang nhắm: ${label}`} style={[styles.meteor, pos]}>
              {body}
              {answer ? (
                // The answer rides in the target's frame, right under its word, and moves with it.
                <View style={styles.answerRow}>
                  <AnswerSlots letters={turn.prompt.letters} value={answer.value} width={rect.width - 8} onPress={focusField} />
                </View>
              ) : null}
            </View>
          );
        }
        return (
          // Tapping another target (its boxes or its word) answers that one.
          <Pressable key={turn.turn_id} onPress={() => answerFor(turn.turn_id)} accessibilityRole="button" accessibilityState={{ selected }}
            accessibilityLabel={`${noun}: ${label}`} accessibilityHint={answer ? 'Chạm để nhập đáp án cho mục tiêu này' : undefined} style={[styles.meteor, pos]}>
            {body}
            {answer ? <View style={styles.answerRowCompact}><AnswerSlots letters={turn.prompt.letters} value="" width={rect.width - 8} compact /></View> : null}
          </Pressable>
        );
      })}
      {answer && size.width > 0 ? (
        <TextInput ref={input} value={answer.value} onChangeText={answer.onChange} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          // Enter sends nothing (a right answer is shot as it is typed) and keeps the keyboard open.
          autoFocus={Platform.OS !== 'web'} returnKeyType="done" submitBehavior="submit" onSubmitEditing={() => {}} editable={answer.editable} maxLength={40}
          accessibilityLabel="Đáp án tiếng Anh" caretHidden contextMenuHidden
          style={[styles.hiddenInput, aimedAt ? { left: aimedAt.left + 8, top: aimedAt.top + aimedAt.height - 30 } : { left: 8, bottom: 8 }]} />
      ) : null}
    </View>
  );
}

/** Anh → Việt: the English word itself falls; Việt → Anh: a rock carrying the Vietnamese meaning. */
const targetLabel = (turn: Turn) => (turn.kind === 'word_spelling'
  ? { label: turn.prompt.word ?? '', noun: 'Từ' } : { label: turn.prompt.meaning_vi ?? '', noun: 'Thiên thạch' });

const TargetBody = memo(function TargetBody({ turn, danger, big }: { turn: Turn; danger: boolean; big: boolean }) {
  const { label } = targetLabel(turn);
  if (turn.kind === 'word_spelling') return <WordTile word={label} danger={danger} big={big} />;
  return (
    <>
      <Rock danger={danger} big={big} />
      <Text style={[styles.word, big && styles.wordAimed]} numberOfLines={2}>{label}</Text>
      {big && turn.prompt.context_vi ? <Text style={styles.context} numberOfLines={1}>{turn.prompt.context_vi}</Text> : null}
    </>
  );
});

// ------------------------------------------------------------------------------------------------ the shooter
const SOUNDS = { shot: require('../../../../assets/audio/game-shot.wav'), break: require('../../../../assets/audio/game-break.wav') };

/** One player per sound, so a shot and a break can overlap; silent while "Âm thanh" is off. */
function useGameSounds(enabled: boolean) {
  const shot = useAudioPlayer(SOUNDS.shot);
  const crack = useAudioPlayer(SOUNDS.break);
  return useCallback((which: 'shot' | 'break') => {
    if (!enabled) return;
    const player = which === 'shot' ? shot : crack;
    try {
      player.replace(SOUNDS[which]);
      player.volume = which === 'shot' ? 0.35 : 0.5;
      player.play();
    } catch { /* a missing audio device never breaks the game */ }
  }, [enabled, shot, crack]);
}

const SHARDS = 8;
type XY = { x: Animated.Value; y: Animated.Value; o: Animated.Value };
type Live = {
  plan: ShotPlan; fired: boolean; impacted: boolean; done: boolean;
  /** Where each bullet left the pet (known once it fires). */ origins: ({ x: number; y: number } | null)[];
  bullets: (XY & { r: Animated.Value })[]; shards: (XY & { r: Animated.Value })[]; ring: { s: Animated.Value; o: Animated.Value };
};
const value = (v = 0) => new Animated.Value(v);
const deg = (v: Animated.Value) => v.interpolate({ inputRange: [-720, 720], outputRange: ['-720deg', '720deg'] });

/**
 * The pet, its bullets, the pieces of broken words and the meanings fading out. Its motion runs one step per frame on
 * its own effect clock (it only advances while the game runs, so a pause freezes everything here together) and goes
 * straight into Animated values: nothing re-renders frame by frame, so the shots stay smooth while the game updates.
 */
const ShooterLayer = memo(function ShooterLayer({ width, height, words, petId, petLevel, running, reduceMotion, sound, wrongKey, shots, aimPoint,
  bursts, onImpact, onShotDone, onBurstDone }: {
  width: number; height: number; words: boolean; petId: string; petLevel: number; running: boolean; reduceMotion: boolean; sound: boolean;
  wrongKey: number; shots: Shot[]; /** Where a shot word is now (it keeps falling). */ aimPoint: (id: string) => Point | null;
  bursts: { burst: Burst; spot: { left: number; top: number } }[];
  onImpact?: (shot: Shot, at: Point) => void; onShotDone?: (id: string) => void; onBurstDone?: (id: string) => void;
}) {
  const play = useGameSounds(sound);
  const clock = useRef({ base: 0, since: null as number | null });
  const now = () => clock.current.base + (clock.current.since === null ? 0 : Date.now() - clock.current.since);
  const bounds = petBounds(width);
  const home = useRef<number | null>(null);
  home.current ??= (bounds.min + bounds.max) / 2;
  const wander = !reduceMotion;
  const moves = useRef<Move[]>([]);
  const live = useRef(new Map<string, Live>());
  const burstVals = useRef(new Map<string, { born: number; o: Animated.Value; rise: Animated.Value }>());
  const pet = useRef({ x: value(home.current), lean: value(0), recoil: value(0) }).current;
  const wiggleSince = useRef<number | null>(null);
  const [walk, setWalk] = useState<{ moving: boolean; facing: 1 | -1; stroll: boolean }>({ moving: false, facing: 1, stroll: false });
  const walkRef = useRef(walk);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // A new shot: the pet walks under the word (where it is now) and fires. Planned once, the first time it is drawn.
  for (const shot of shots) {
    if (live.current.has(shot.id)) continue;
    const at = aimPoint(shot.id);
    if (!at) continue;
    const plan = planShot(moves.current, now(), at, home.current, bounds, wander, height, PET_BOTTOM);
    const xy = () => ({ x: value(), y: value(), o: value(0), r: value() });
    live.current.set(shot.id, { plan, fired: false, impacted: false, done: false, origins: Array(plan.bullets).fill(null),
      bullets: Array.from({ length: plan.bullets }, xy), shards: Array.from({ length: SHARDS }, xy), ring: { s: value(0.4), o: value(0) } });
  }
  for (const { burst } of bursts) if (!burstVals.current.has(burst.id)) burstVals.current.set(burst.id, { born: now(), o: value(1), rise: value(0) });

  useEffect(() => {
    if (wrongKey > 0 && !reduceMotion) wiggleSince.current = now();
  }, [wrongKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // One frame: move everything to where it is at this moment, and pass the moments that matter (sounds, the break,
  // the end of an effect).
  const latest = useRef({ shots, bursts, aimPoint, onImpact, onShotDone, onBurstDone, play });
  latest.current = { shots, bursts, aimPoint, onImpact, onShotDone, onBurstDone, play };
  const frame = useRef<() => void>(() => {});
  frame.current = () => {
    const tNow = now();
    const { shots: held, bursts: shown } = latest.current;
    const wiggle = wiggleSince.current !== null && tNow - wiggleSince.current < WIGGLE_MS ? wiggleAt(wiggleSince.current, tNow) : 0;
    const x = petX(moves.current, tNow, home.current!, bounds, wander);
    pet.x.setValue(x + wiggle);
    let lean = 0;
    let recoil = 0;
    for (const shot of held) {
      const s = live.current.get(shot.id);
      if (!s || s.done) continue;
      const { plan } = s;
      // The bullets chase the word where it is now; once it is hit, they finish at the spot where it broke.
      const target = s.impacted ? plan.target : latest.current.aimPoint(shot.id) ?? plan.target;
      if (!s.impacted && tNow >= plan.impactAt) {
        plan.target = { ...target };
        s.impacted = true;
        latest.current.play('break');
        rerender();
        latest.current.onImpact?.(shot, plan.target);
      }
      lean = lean || leanAt(plan, tNow, x + PET_SIZE / 2);
      if (tNow >= plan.fireAt && tNow < plan.fireAt + 120) recoil = -3 * (1 - (tNow - plan.fireAt) / 120);
      for (let i = 0; i < plan.bullets; i++) {
        const leave = plan.fireAt + i * plan.gap;
        if (!s.origins[i] && tNow >= leave) s.origins[i] = muzzle(petX(moves.current, leave, home.current!, bounds, wander), height, PET_BOTTOM);
        const b = s.origins[i] ? bulletAt(plan, i, tNow, s.origins[i]!, s.impacted ? plan.target : target) : null;
        if (b) { s.bullets[i].x.setValue(b.x); s.bullets[i].y.setValue(b.y); s.bullets[i].r.setValue((b.angle * 180) / Math.PI); }
        s.bullets[i].o.setValue(b ? 1 : 0);
      }
      const since = tNow - plan.impactAt;
      const pieces = shardsAt(plan, tNow, SHARDS);
      s.shards.forEach((v, i) => {
        const p = pieces[i];
        if (p) { v.x.setValue(p.x); v.y.setValue(p.y); v.r.setValue(p.rotate); }
        v.o.setValue(p ? p.opacity : 0);
      });
      const ring = since >= 0 && since < 220 ? since / 220 : null;
      s.ring.o.setValue(ring === null ? 0 : 0.5 * (1 - ring));
      if (ring !== null) s.ring.s.setValue(0.4 + ring);
      if (!s.fired && tNow >= plan.fireAt) { s.fired = true; latest.current.play('shot'); }
      if (tNow >= plan.doneAt) { s.done = true; latest.current.onShotDone?.(shot.id); }
    }
    pet.lean.setValue(lean);
    pet.recoil.setValue(recoil);
    const dart = petMoving(moves.current, tNow);
    // Between shots the pet strolls across the field, stepping the way it goes (its move strip, or its walk strip).
    const drift = petDrift(moves.current, tNow, home.current!, bounds, wander);
    const motion = drift ? { moving: true, facing: drift, stroll: true } : { ...dart, stroll: false };
    const was = walkRef.current;
    if (motion.moving !== was.moving || motion.facing !== was.facing || motion.stroll !== was.stroll) { walkRef.current = motion; setWalk(motion); }
    for (const { burst } of shown) {
      const v = burstVals.current.get(burst.id);
      if (!v) continue;
      const look = burstLook(tNow - v.born, reduceMotion);
      v.o.setValue(look.opacity);
      v.rise.setValue(look.rise);
      if (tNow - v.born >= BURST_MS) { burstVals.current.delete(burst.id); latest.current.onBurstDone?.(burst.id); }
    }
  };
  // The effect clock: runs (frame by frame) only while the game runs.
  useEffect(() => {
    if (!running) return;
    clock.current.since = Date.now();
    let id = requestAnimationFrame(function tick() { frame.current(); id = requestAnimationFrame(tick); });
    return () => {
      cancelAnimationFrame(id);
      const c = clock.current;
      if (c.since !== null) c.base += Date.now() - c.since;
      c.since = null;
    };
  }, [running]);
  // Shots and meanings dropped by the caller (done, or a new stage) take their values with them.
  useEffect(() => {
    const ids = new Set(shots.map((s) => s.id));
    for (const id of live.current.keys()) if (!ids.has(id)) live.current.delete(id);
  }, [shots]);

  const colors = words ? ['#7FD3FF', '#4C6FFF'] : ['#FFE29A', '#F58A3A'];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {bursts.map(({ burst, spot }) => {
        const v = burstVals.current.get(burst.id);
        return (
          <Animated.View key={burst.id} accessibilityLiveRegion="polite" accessibilityLabel={`${burst.title}${burst.sub ? `, ${burst.sub}` : ''}`}
            style={[styles.burst, spot, v ? { opacity: v.o, transform: [{ translateY: v.rise }] } : null]}>
            <Text style={[styles.burstTitle, burst.tone === 'miss' && styles.burstMiss]} numberOfLines={2}>{burst.title}</Text>
            {burst.sub ? <Text style={styles.burstSub} numberOfLines={1}>{burst.sub}</Text> : null}
          </Animated.View>
        );
      })}
      {shots.map((shot) => {
        const s = live.current.get(shot.id);
        if (!s) return null;
        return (
          <React.Fragment key={shot.id}>
            <Animated.View style={[styles.ring, { left: s.plan.target.x - 22, top: s.plan.target.y - 22, borderColor: colors[0], opacity: s.ring.o,
              transform: [{ scale: s.ring.s }] }]} />
            {s.shards.map((v, i) => {
              const size = i % 3 === 0 ? 8 : 5;
              return <Animated.View key={i} style={[styles.shard, { left: -size / 2, top: -size / 2, width: size, height: size, backgroundColor: colors[i % 2],
                opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { rotate: deg(v.r) }] }]} />;
            })}
            {s.bullets.map((v, i) => (
              <Animated.View key={i} testID="bullet" style={[styles.bullet, { opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { rotate: deg(v.r) }] }]}>
                <LinearGradient colors={['rgba(255,236,140,0)', 'rgba(255,236,140,0.85)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.bulletTrail} />
                <View style={styles.bulletHead} />
              </Animated.View>
            ))}
          </React.Fragment>
        );
      })}
      <Animated.View testID="shooter-pet" style={[styles.shooter, { bottom: PET_BOTTOM, transform: [{ translateX: pet.x }, { translateY: pet.recoil }, { rotate: deg(pet.lean) }] }]}>
        {/* A pet with drawn move strips has one for each way. Otherwise it walks, and the walk strips face right:
            walking left mirrors it. Standing, it faces the player again. */}
        <View style={{ transform: [{ scaleX: running && walk.moving && !hasSprite(petId, petLevel, moveActivity(walk.facing)) ? walk.facing : 1 }] }}>
          <PetArt pet={petId} size={PET_SIZE} stage={petLevel} moving={walk.moving ? walk.facing : undefined} strolling={walk.stroll}
            still={reduceMotion || !running} />
        </View>
      </Animated.View>
    </View>
  );
});

/** A glowing rock with a fiery tail streaming up behind it (also drawn by the game's guide, TutorialArt). */
export function Rock({ danger, big }: { danger: boolean; big: boolean }) {
  const d = big ? 42 : 36;
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

/** An English word falling in Anh → Việt: a glowing tile with a short trail (also drawn by the game's guide). */
export function WordTile({ word, danger, big }: { word: string; danger: boolean; big: boolean }) {
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
  ground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND, backgroundColor: '#3E5F45' },
  base: { position: 'absolute', left: 0, top: 0, bottom: 0, width: PET_ZONE - 6, backgroundColor: '#C7E5CF', alignItems: 'center', paddingTop: 8 },
  baseIcon: { fontSize: 28 },
  pet: { position: 'absolute' },
  petDefense: { left: 8, bottom: 8 },
  shooter: { position: 'absolute', left: 0, width: PET_SIZE, height: PET_SIZE, transformOrigin: '50% 100%' },
  meteor: { position: 'absolute', alignItems: 'center' },
  rockWrap: { alignItems: 'center' },
  tail: { height: 34, marginBottom: -12 },
  rock: { shadowColor: '#FF8A3D', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  crater: { position: 'absolute', backgroundColor: 'rgba(110,40,20,0.35)' },
  word: { marginTop: 4, fontSize: 13, lineHeight: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  wordAimed: { fontSize: 15, lineHeight: 19, color: '#FFE9B8' },
  context: { fontSize: 11, color: '#C9D6F2', textAlign: 'center' },
  trail: { width: 16, height: 26, borderRadius: 8, marginBottom: -6 },
  tile: { minWidth: 72, maxWidth: METEOR_W, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, alignItems: 'center',
    shadowColor: '#7FB8FF', shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  tileBig: { maxWidth: AIMED_MAX_W, paddingVertical: 7, borderWidth: 1.5, borderColor: '#FFE9B8' },
  tileText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  tileTextBig: { fontSize: 17 },
  tileTextLong: { fontSize: 13, textAlign: 'center' }, // phrases wrap on two lines instead of being cut
  answerRow: { marginTop: 6, alignItems: 'center' },
  answerRowCompact: { marginTop: 3 },
  // The one text field: invisible, kept where the aimed target's boxes are; the boxes show what it holds.
  hiddenInput: { position: 'absolute', width: 2, height: 2, opacity: 0.01, color: 'transparent', padding: 0 },
  bullet: { position: 'absolute', left: -3, top: -3, width: 6, height: 6 },
  bulletTrail: { position: 'absolute', right: 3, top: 1.5, width: 16, height: 3, borderRadius: 2 },
  bulletHead: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF4B0',
    shadowColor: '#FFD84D', shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  ring: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  shard: { position: 'absolute', borderRadius: 2 },
  burst: { position: 'absolute', width: BURST_W, minHeight: BURST_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(12,22,52,0.55)' },
  burstTitle: { fontSize: 15, fontWeight: '800', color: '#FFE9B8', textAlign: 'center' },
  burstMiss: { color: '#FFB3BD' },
  burstSub: { fontSize: 12, fontWeight: '600', color: '#C9D6F2', textAlign: 'center' },
  monster: { position: 'absolute', width: TARGET_W, minHeight: TARGET_H, borderRadius: 18, paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 2, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 },
  selected: { borderColor: '#F2A93B' },
  danger: { backgroundColor: '#FFE7EE' },
  icon: { fontSize: 20 },
  monsterText: { flex: 1, fontSize: 14, fontWeight: '800', color: t.ink },
});
