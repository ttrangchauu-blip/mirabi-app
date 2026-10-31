import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, LayoutChangeEvent, Platform, Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAudioPlayer } from 'expo-audio';
import { Text, TextInput } from '../../../components/Typography';
import { PetArt } from '../../../components/PetArt';
import type { Turn, WordPair } from '../../../learning/types';
import { hasSprite, moveActivity } from '../../../petSprites';
import { appTheme as t } from '../../../theme';
import { bulletAt, BURST_MS, burstLook, combinePoses, idleTiltAt, JOY, joyAt, LANDING_MS, landingAt, leanAt, Move,
  muzzle, PEBBLES, PET_SIZE, petBounds, petDrift, petMoving, petX, planShot, Point, type Pose, shardsAt, ShotPlan,
  shotPoseAt, sparksAt, startleAt, STRIDE_PX, targetLook, TRAIL, trailAt, WIGGLE_MS, LITE_CHECK_FRAMES, nextLite } from './shooterFx';
import { AnswerSlots, SLOT_PITCH } from './LetterInput';
import { FIELD, FallingWord, laneLefts, WordField, WordSpec } from './wordField';

export type Flash = { turnId: string; kind: 'hit' | 'miss' } | null;

/** What a destroyed (or missed) word leaves behind for a moment: its meaning or its English word, where it was: `at`
 * (the point where it broke), or else its lane and how far it had fallen. */
export type Burst = { id: string; position: number; progress: number; title: string; sub: string | null; tone: 'hit' | 'miss';
  at?: Point };
/** A word answered right. It stops where it was (it can no longer be missed), glows while the pet's bullets fly to it,
 * cracks and breaks once they have all hit. */
export type Shot = { id: string; turn: Turn; word: WordPair | null; /** It was the aimed one (drawn larger). */ aimed: boolean;
  /** false: shot as soon as it was typed right, the server has not confirmed it yet. It stops and is shot at once, but
   * only breaks (and counts) once confirmed: until then it stays cracked and glowing where the bullets hit it. */
  confirmed?: boolean };
/** The typed answer of the falling-word games: one text field for the whole field, shown in the aimed target's frame.
 * The game shoots by itself as soon as what is typed is right; Enter (`onSubmit`) sends what is typed anyway. */
export type Answer = { value: string; onChange: (value: string) => void; editable: boolean; onSubmit?: () => void };

type Props = {
  /** meteor: Vietnamese meanings on falling rocks; words: English words falling (Anh → Việt). Math's monsters are
   * MathBattle. */
  variant: 'meteor' | 'words';
  /** The falling-word games: every open word not answered yet (those without room yet wait in the field's queue). */
  turns: Turn[];
  /** 0 = just appeared, 1 = reached the ground. */
  progress: (turn: Turn) => number;
  selectedId: string | null;
  onSelect: (turnId: string) => void;
  petId: string;
  petLevel: number;
  reduceMotion: boolean;
  flash: Flash;
  /** Labels fading out where words were hit or missed. Drawn under the falling targets and never touchable. */
  bursts?: Burst[];
  /** The falling-word games: the game is running (paused, everything here stops: the words, the pet, the bullets). */
  running?: boolean;
  /** Words answered right: each one is LOCKED in `field` first (it stopped where it was). */
  shots?: Shot[];
  /** The word broke at `at` (the caller shows its meaning and counts it). Once per word. */
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
  /** The falling-word games: the engine holding every word (the game reads and locks words in it). One is made here if
   * none is given. */
  field?: WordField<Turn>;
};

const BURST_W = 150;
const BURST_H = 50;
const GROUND = 22;
/** The shooter stands on the ground, at the bottom of the field. */
const PET_BOTTOM = 10;
/** Where a held word is hit: about the middle of its rock or tile. */
const HIT_Y = 40;

/** A falling word's box: its tile (or rock) and its answer boxes, the same whether it is aimed or not (so aiming
 * another word never resizes anything). Its width follows its answer: a long word takes a wider box. */
const WORD_MIN_W = FIELD.laneWidth;
const WORD_MAX_W = 220;
/** Anh → Việt: the meaning is typed freely, in a field this wide. */
const MEANING_W = 168;
const WORD_H = 120;
const ROCK_H = 146;

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** The box of a falling word on a field `fieldWidth` wide. */
export function wordBox(turn: Turn, variant: 'meteor' | 'words', fieldWidth: number): { width: number; height: number } {
  const room = Math.max(60, fieldWidth - 2 * FIELD.margin);
  const height = variant === 'words' ? WORD_H : ROCK_H;
  if (turn.prompt.answer_lang === 'vi') return { width: Math.min(MEANING_W, room), height };
  const letters = turn.prompt.letters ?? [];
  const total = letters.reduce((a, b) => a + b, 0);
  const need = total * SLOT_PITCH + Math.max(0, letters.length - 1) * 8 + 16;
  return { width: Math.min(room, Math.max(WORD_MIN_W, Math.min(WORD_MAX_W, need))), height };
}

/** Anh → Việt: the English word itself falls; Việt → Anh: a rock carrying the Vietnamese meaning. */
const targetLabel = (turn: Turn) => (turn.kind === 'word_spelling'
  ? { label: turn.prompt.word ?? '', noun: 'Từ' } : { label: turn.prompt.meaning_vi ?? '', noun: 'Thiên thạch' });

/** What the engine needs to know about a word. Only the words open when the game opens use `on_screen_ms`. */
export function wordSpec(turn: Turn, variant: 'meteor' | 'words', fieldWidth: number): WordSpec<Turn> {
  const travelMs = turn.travel_seconds * 1000;
  const seen = turn.on_screen_ms ?? 0;
  return { id: turn.turn_id, word: targetLabel(turn).label, acceptedAnswers: turn.prompt.answer_keys ?? [], ...wordBox(turn, variant, fieldWidth), travelMs,
    startProgress: travelMs > 0 ? seen / travelMs : Math.min(FIELD.practiceStop, (seen / FIELD.practiceMs) * FIELD.practiceStop), data: turn };
}

/** Meteors (or English words) fall toward the ground, monsters walk toward the base. In the falling-word games the pet
 * at the bottom shoots the words that were answered. */
export const Playfield = memo(function Playfield(props: Props) {
  return <FallingField {...props} />;
});

/** Each drawn word's own position, in the field's frame. Made once per word, written by the frame loop. */
type WordPos = { x: Animated.Value; y: Animated.Value; lx: number; ly: number };
/** Below this a position change is not written (a fraction of a pixel): fewer native updates, no visible difference. */
const WRITE_PX = 0.1;
/** A new word fades in while it is this young (ms of play time). */
const ENTER_MS = 400;

/**
 * The falling-word games. Every word lives in the engine (`WordField`): it comes in where it can never touch another
 * word, falls at its own speed from one frame loop (one requestAnimationFrame for the words and the shooter), and only
 * its own Animated position changes, by transform: nothing re-renders while words fall. React re-renders a word only
 * when something about it changes (it is aimed, typed into, comes in or goes).
 */
function FallingField({ variant, turns, selectedId, onSelect, petId, petLevel, reduceMotion, bursts = [], running = true, shots = [],
  onImpact, onShotDone, onBurstDone, wrongKey = 0, sound = false, answer, field: given }: Props & { variant: 'meteor' | 'words' }) {
  const own = useRef<WordField<Turn> | null>(null);
  const field = given ?? (own.current ??= new WordField<Turn>());
  useSyncExternalStore(field.subscribe, field.getVersion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
  };
  // The keyboard opening (or closing) changes the height: the words keep their place, only the ground moves.
  useLayoutEffect(() => { if (size.width > 0) field.resize(size.width, size.height); }, [field, size.width, size.height]);
  // New words join the queue, gone ones leave; the ones being shot stay until their pieces are gone.
  useLayoutEffect(() => {
    if (size.width <= 0) return;
    field.sync(turns.map((turn) => wordSpec(turn, variant, size.width)), new Set(shots.map((s) => s.id)));
  }, [field, turns, shots, variant, size.width]);

  // Each word's own Animated position, made the first time it is drawn (from where it is then) and dropped with it.
  const positions = useRef(new Map<string, WordPos>()).current;
  const posOf = (w: FallingWord<Turn>) => {
    let p = positions.get(w.id);
    if (!p) { p = { x: new Animated.Value(w.x), y: new Animated.Value(w.y), lx: w.x, ly: w.y }; positions.set(w.id, p); }
    return p;
  };
  const writePositions = useCallback(() => {
    for (const w of field.drawn()) {
      const p = positions.get(w.id);
      if (!p) continue;
      if (Math.abs(w.y - p.ly) >= WRITE_PX) { p.ly = w.y; p.y.setValue(w.y); }
      if (Math.abs(w.x - p.lx) >= WRITE_PX) { p.lx = w.x; p.x.setValue(w.x); }
    }
  }, [field, positions]);
  const drawn = size.width > 0 ? field.drawn() : [];
  useLayoutEffect(() => {
    writePositions(); // paused and resized: the words still show where the engine has them
    const live = new Set(drawn.map((w) => w.id));
    for (const id of positions.keys()) if (!live.has(id)) positions.delete(id);
  });

  // A rock hitting the ground jolts the sky and the ground (not the words: no falling word ever moves for it).
  const jolt = useRef(new Animated.Value(0)).current;

  // The game loop: one frame callback for the words and the shooter, only while the game runs. The step is the time
  // since the last frame, capped by the engine (a frame after the app was frozen never makes words jump).
  const ticker = useRef(new Set<(now: number) => void>()).current;
  // Weak device: the frames the loop measures stay slow, so the extras that only decorate (embers, sway, trails, sparks
  // of joy, pebbles) are left out until it is quick again. The game itself (words, shots, breaks, meanings) never changes.
  const [lite, setLite] = useState(false);
  const liteRef = useRef({ on: false, checked: 0 });
  useEffect(() => {
    if (!running) return;
    let last: number | null = null;
    let handle = requestAnimationFrame(function frame(now: number) {
      const dt = last === null ? 0 : now - last;
      last = now;
      if (dt > 0) field.stats.frameMs = field.stats.frameMs ? field.stats.frameMs * 0.9 + dt * 0.1 : dt;
      field.step(dt);
      writePositions();
      const l = liteRef.current;
      if (++l.checked % LITE_CHECK_FRAMES === 0) {
        const on = nextLite(l.on, field.stats.frameMs);
        if (on !== l.on) { l.on = on; setLite(on); }
      }
      for (const tick of ticker) tick(now);
      handle = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(handle);
  }, [running, field, writePositions, ticker]);

  // One text field for every target: it stays mounted (and focused) while targets fall, when another one is chosen and
  // when a word breaks, so the keyboard never closes and reopens and what is typed is kept. It never moves either.
  const input = useRef<RNTextInput>(null);
  // On the web, focusing must not scroll the page or the field to the (invisible) field: the words would shift.
  const focusField = useCallback(() => (input.current as unknown as { focus: (options?: object) => void } | null)
    ?.focus(Platform.OS === 'web' ? { preventScroll: true } : undefined), []);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const answerFor = useCallback((turnId: string) => { onSelectRef.current(turnId); focusField(); }, [focusField]);
  // After a shot the next word in falling order is aimed: typing goes on there without tapping it.
  const editable = !!answer?.editable;
  useEffect(() => {
    if (editable && selectedId) focusField();
  }, [selectedId, editable, focusField]);

  // The engine follows the shot: a bullet reached it (HIT), it broke (DESTROYING: counted, once), its pieces are gone.
  const latest = useRef({ onImpact, onShotDone });
  latest.current = { onImpact, onShotDone };
  const onHit = useCallback((shot: Shot) => { field.hit(shot.id); }, [field]);
  const onBreak = useCallback((shot: Shot, at: Point) => { if (field.destroy(shot.id)) latest.current.onImpact?.(shot, at); }, [field]);
  const onDone = useCallback((id: string) => { field.remove(id); latest.current.onShotDone?.(id); }, [field]);
  // Where each shot word stopped: the shooter draws it there and the bullets fly to its centre.
  const heldRect = useCallback((id: string): Rect | null => {
    const r = field.rect(id);
    return r ? { left: r.x, top: r.y, width: r.width, height: r.height } : null;
  }, [field]);

  // Where each burst sits, chosen once when it appears: at the broken word, moved clear of every word on screen then
  // (the next word usually appears right there), so the meaning can be read. Drawn under the targets, a word that
  // falls past it later is never hidden by it.
  const placed = useRef(new Map<string, { left: number; top: number }>());
  const placeBurst = (b: Burst) => {
    const known = placed.current.get(b.id);
    if (known) return known;
    const maxTop = Math.max(0, size.height - BURST_H - GROUND - 4);
    const lanes = laneLefts(size.width, FIELD.laneWidth);
    const box: Rect = b.at
      ? { left: Math.max(8, Math.min(b.at.x - BURST_W / 2, size.width - BURST_W - 8)), width: BURST_W, height: BURST_H,
        top: Math.max(0, Math.min(maxTop, b.at.y - BURST_H / 2)) }
      : { left: Math.max(8, Math.min(lanes[b.position % lanes.length] + (FIELD.laneWidth - BURST_W) / 2, size.width - BURST_W - 8)), width: BURST_W,
        height: BURST_H, top: Math.min(maxTop, Math.max(0, Math.min(1, b.progress)) * maxTop) };
    // Clear of every word on screen, and of the meanings still fading out.
    const targets = [...field.drawn().map((w) => ({ left: w.x, top: w.y, width: w.width, height: w.height })),
      ...[...placed.current.values()].map((s) => ({ ...s, width: BURST_W, height: BURST_H }))];
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
  // The shooter only re-renders when a shot or a meaning comes or goes (its motion runs frame by frame on its own).
  const shownBursts = useMemo(() => bursts.map((b) => ({ burst: b, spot: placeBurst(b) })), [bursts, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the answer field is for, kept while no word is aimed (between two words), so it never changes its name.
  const answerLang = useRef<string | undefined>(undefined);
  const aimed = drawn.find((w) => w.id === selectedId);
  if (aimed) answerLang.current = aimed.data.prompt.answer_lang;
  const caret = !!answer?.editable && running && !reduceMotion;
  return (
    <View style={[styles.field, styles.sky]} onLayout={onLayout} accessibilityLabel={variant === 'words' ? 'Bầu trời từ vựng' : 'Bầu trời thiên thạch'}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: jolt }] }]} pointerEvents="none">
        <Stars />
        <View style={styles.ground} />
        {size.width > 0 ? <LandingLayer field={field} ticker={ticker} running={running} reduceMotion={reduceMotion} lite={lite} jolt={jolt}
          groundY={size.height - GROUND} /> : null}
      </Animated.View>
      {size.width > 0 ? (
        // Under the targets: the words being shot (stopped, untouchable: they can no longer be answered or missed), a
        // fading meaning or the pieces of a broken word never hide a word that is still falling.
        <ShooterLayer width={size.width} height={size.height} words={variant === 'words'} petId={petId} petLevel={petLevel} ticker={ticker}
          running={running} reduceMotion={reduceMotion} lite={lite} sound={sound} wrongKey={wrongKey} shots={shots} heldRect={heldRect} bursts={shownBursts}
          onHit={onHit} onImpact={onBreak} onShotDone={onDone} onBurstDone={onBurstDone} />
      ) : null}
      {drawn.map((w) => {
        const selected = w.id === selectedId;
        return (
          <FallingWordView key={w.id} id={w.id} turn={w.data} width={w.width} height={w.height} pos={posOf(w)} ground={field.groundFor(w)}
            aimed={selected} value={selected && answer ? answer.value : ''} answerOn={!!answer} caret={selected && caret}
            enter={field.time - w.spawnTime < ENTER_MS} reduceMotion={reduceMotion} lite={lite} onAim={answerFor} onFocus={focusField} />
        );
      })}
      {answer && size.width > 0 ? (
        <TextInput ref={input} value={answer.value} onChangeText={answer.onChange} autoCapitalize="none" autoCorrect={false} spellCheck={false}
          // A right answer is shot as it is typed; Enter sends what is typed anyway, and keeps the keyboard open.
          autoFocus={Platform.OS !== 'web'} returnKeyType="send" submitBehavior="submit" onSubmitEditing={() => answer.onSubmit?.()}
          editable={answer.editable} maxLength={60}
          accessibilityLabel={answerLang.current === 'vi' ? 'Nghĩa tiếng Việt' : 'Đáp án tiếng Anh'} caretHidden contextMenuHidden
          style={styles.hiddenInput} />
      ) : null}
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Writes an effect value only when it changes: most of them sit at rest (a hidden bullet, a spark gone), and on the
 * web every write is a style update. Every value of the shooter and the landings is written through it. */
const written = new WeakMap<Animated.Value, number>();
const put = (v: Animated.Value, x: number) => {
  if (written.get(v) === x) return;
  written.set(v, x);
  v.setValue(x);
};

/** At most this many landings show at once (the oldest gives its slot to a new one). */
const LANDINGS = 3;
type LandingSlot = { flash: Animated.Value; ring: Animated.Value; ringO: Animated.Value; dust: Animated.Value;
  pebbles: { x: Animated.Value; y: Animated.Value; o: Animated.Value }[] };

/**
 * A target that reached the ground (the backend takes one heart for it, once): a flash where it hit, a ring of dust
 * spreading along the ground, a few pebbles thrown up and falling back, and a short jolt of the sky and the ground. A
 * pool of LANDINGS slots, stepped by the play field's game loop (paused with it), each over in LANDING_MS.
 */
function LandingLayer({ field, ticker, running, reduceMotion, lite, jolt, groundY }: {
  field: WordField<Turn>; ticker: Set<(now: number) => void>; running: boolean; reduceMotion: boolean; lite: boolean; jolt: Animated.Value;
  groundY: number;
}) {
  const slots = useRef<LandingSlot[]>(Array.from({ length: LANDINGS }, () => ({ flash: value(0), ring: value(0), ringO: value(0), dust: value(0),
    pebbles: Array.from({ length: PEBBLES }, () => ({ x: value(), y: value(), o: value(0) })) }))).current;
  const [spots, setSpots] = useState<({ x: number; key: number } | null)[]>(() => Array(LANDINGS).fill(null));
  const ages = useRef<(number | null)[]>(Array(LANDINGS).fill(null));
  const next = useRef(0);
  useEffect(() => field.subscribe((event) => {
    if (event.type !== 'landed' || reduceMotion) return;
    const rect = field.rect(event.id);
    if (!rect) return;
    const slot = next.current;
    next.current = (slot + 1) % LANDINGS;
    ages.current[slot] = 0;
    setSpots((list) => list.map((s, i) => (i === slot ? { x: rect.x + rect.width / 2, key: (s?.key ?? 0) + 1 } : s)));
  }), [field, reduceMotion]);
  useEffect(() => {
    if (!running) return;
    let last: number | null = null;
    const tick = (now: number) => {
      const dt = last === null ? 0 : Math.min(50, now - last); // a long gap (the app was away) never skips a landing
      last = now;
      let shake = 0;
      ages.current.forEach((age, i) => {
        if (age === null) return;
        const at = age + dt;
        ages.current[i] = at >= LANDING_MS ? null : at;
        const look = landingAt(at);
        const v = slots[i];
        put(v.flash, look?.flash ?? 0);
        put(v.ring, look?.ring ?? 0);
        put(v.ringO, look ? 1 - look.ring : 0);
        put(v.dust, look?.dust ?? 0);
        v.pebbles.forEach((p, j) => {
          const q = look?.pebbles[j];
          if (q) { put(p.x, q.x); put(p.y, q.y); }
          put(p.o, q?.opacity ?? 0);
        });
        if (look && Math.abs(look.shake) > Math.abs(shake)) shake = look.shake;
      });
      put(jolt, shake);
    };
    ticker.add(tick);
    return () => { ticker.delete(tick); put(jolt, 0); };
  }, [running, ticker, slots, jolt]);
  return (
    <>
      {spots.map((spot, i) => (spot ? (
        <View key={`${i}-${spot.key}`} testID="landing" style={[styles.landing, { left: spot.x, top: groundY }]}>
          {lite ? null : <Animated.View style={[styles.landingDust, { opacity: slots[i].dust, transform: [{ scaleX: Animated.add(0.6, Animated.multiply(slots[i].ring, 0.8)) }] }]} />}
          <Animated.View style={[styles.landingRing, { opacity: slots[i].ringO, transform: [{ scale: Animated.add(0.3, Animated.multiply(slots[i].ring, 1.4)) }] }]} />
          <Animated.View style={[styles.landingFlash, { opacity: slots[i].flash }]} />
          {lite ? null : slots[i].pebbles.map((p, j) => (
            <Animated.View key={j} style={[styles.pebble, { opacity: p.o, transform: [{ translateX: p.x }, { translateY: p.y }] }]} />
          ))}
        </View>
      ) : null))}
    </>
  );
}

/**
 * One falling word and its answer boxes, moved as one by its own position (transform only). Memoised on what it shows:
 * typing re-renders the aimed word alone, and the others never re-render while they fall.
 */
const FallingWordView = memo(function FallingWordView({ id, turn, width, height, pos, ground, aimed, value, answerOn, caret, enter, reduceMotion,
  lite = false, onAim, onFocus }: {
  id: string; turn: Turn; width: number; height: number; pos: WordPos; /** Its top on the ground. */ ground: number; aimed: boolean;
  value: string; answerOn: boolean; caret: boolean; /** Just came in: it fades in. */ enter: boolean; reduceMotion: boolean; lite?: boolean;
  onAim: (id: string) => void; onFocus: () => void;
}) {
  const { label, noun } = targetLabel(turn);
  const vi = turn.prompt.answer_lang === 'vi';
  const placeholder = vi ? (aimed ? 'Gõ nghĩa tiếng Việt…' : 'Nghĩa?') : undefined;
  // Close to the ground it turns red: read from its own position, so it never re-renders for it.
  // It turns as it falls (a rock spins, a word tile sways), from its own position: no timer of its own.
  const fall = useMemo(() => ({ y: pos.y, dir: spinOf(id) }), [pos.y, id]);
  const alarm = useMemo(() => pos.y.interpolate({ inputRange: [ground * 0.7, Math.max(ground * 0.7 + 1, ground * 0.78)], outputRange: [0, 1],
    extrapolate: 'clamp' }), [pos.y, ground]);
  return (
    // Tapping the aimed one opens the keyboard, tapping another one answers that one.
    <AnimatedPressable onPress={aimed ? onFocus : () => onAim(id)} accessibilityRole="button" accessibilityState={{ selected: aimed }}
      accessibilityLabel={aimed ? `${noun} đang nhắm: ${label}` : `${noun}: ${label}`}
      accessibilityHint={answerOn && !aimed ? 'Chạm để nhập đáp án cho mục tiêu này' : undefined}
      style={[styles.target, { width, height, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <Appear reduceMotion={reduceMotion || !enter}>
        <TargetBody turn={turn} big={aimed} alarm={alarm} fall={reduceMotion || lite ? undefined : fall} />
        {answerOn ? (
          // The answer rides in the target's frame, right under its word, and moves with it.
          <View style={aimed ? styles.answerRow : styles.answerRowCompact}>
            <AnswerSlots letters={vi ? undefined : turn.prompt.letters} value={value} width={width - 8} compact={!aimed} placeholder={placeholder}
              caret={caret} onPress={aimed ? onFocus : undefined} />
          </View>
        ) : null}
      </Appear>
    </AnimatedPressable>
  );
});

/** A new falling word fades in, sliding down a little from above the top as it comes. */
function Appear({ reduceMotion, children }: { reduceMotion: boolean; children: React.ReactNode }) {
  const k = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.timing(k, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[styles.appear, { opacity: k, transform: [{ translateY: k.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
      { scale: k.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** A word's tile or rock. `alarm` (0..1, from its position) turns it red close to the ground. Its context is on the
 * question card: the box keeps one height whether the word is aimed or not. */
type Alarm = Animated.AnimatedInterpolation<number>;
/** A falling target's motion, for the way it turns as it falls: its position and which way it turns. */
type Fall = { y: Animated.Value; dir: 1 | -1 };
/** Which way a target turns: fixed per target, half each way. */
const spinOf = (id: string): 1 | -1 => ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) & 1 ? 1 : -1);
const TargetBody = memo(function TargetBody({ turn, big, alarm, fall }: { turn: Turn; big: boolean; alarm?: Alarm; fall?: Fall }) {
  const { label } = targetLabel(turn);
  if (turn.kind === 'word_spelling') return <WordTile word={label} danger={false} big={big} alarm={alarm} fall={fall} />;
  return (
    <>
      <Rock danger={false} big={big} alarm={alarm} fall={fall} />
      <Text style={[styles.word, big && styles.wordAimed]} numberOfLines={2}>{label}</Text>
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
const SPARKS = 10;
type XY = { x: Animated.Value; y: Animated.Value; o: Animated.Value };
type Dot = { x: Animated.Value; y: Animated.Value; o: Animated.Value };
type Live = {
  plan: ShotPlan; fired: boolean; /** The first bullet reached it. */ struck: boolean; broke: boolean; done: boolean;
  /** Where each bullet left the pet (known once it fires). */ origins: ({ x: number; y: number } | null)[];
  bullets: (XY & { r: Animated.Value })[]; /** Each bullet's trail dots (bullet i: TRAIL in a row). */ trails: Dot[];
  shards: (XY & { r: Animated.Value })[]; sparks: (XY & { s: Animated.Value })[];
  ring: { s: Animated.Value; o: Animated.Value };
  /** The word itself while it is shot: its glow, its cracks, its size, its shake, and whether it is still whole. */
  look: { glow: Animated.Value; crack: Animated.Value; scale: Animated.Value; shake: Animated.Value; shown: Animated.Value };
};
const value = (v = 0) => new Animated.Value(v);
const deg = (v: Animated.Value) => v.interpolate({ inputRange: [-720, 720], outputRange: ['-720deg', '720deg'] });
/** The cracks drawn over a word just before it breaks: [angle (deg), length (px)] from its centre. */
const CRACKS: [number, number][] = [[-20, 30], [35, 24], [160, 28], [-140, 20], [95, 14]];

/**
 * The pet, its bullets, the pieces of broken words and the meanings fading out. Its motion runs one step per frame of
 * the play field's game loop (`ticker`) on its own effect clock (it only advances while the game runs, so a pause
 * freezes everything here together) and goes straight into Animated values: nothing re-renders frame by frame.
 */
const ShooterLayer = memo(function ShooterLayer({ width, height, words, petId, petLevel, ticker, running, reduceMotion, lite = false, sound, wrongKey, shots,
  heldRect, bursts, onHit, onImpact, onShotDone, onBurstDone }: {
  width: number; height: number; words: boolean; petId: string; petLevel: number; /** The game loop's frame callbacks. */
  ticker: Set<(now: number) => void>; running: boolean; reduceMotion: boolean; /** Weak device: no trails or sparks of joy. */ lite?: boolean;
  sound: boolean;
  wrongKey: number; shots: Shot[]; /** Where a shot word stopped. */ heldRect: (id: string) => Rect | null;
  bursts: { burst: Burst; spot: { left: number; top: number } }[];
  /** The first bullet reached the word. */
  onHit?: (shot: Shot) => void;
  /** The word broke (after the last bullet hit it and it cracked), at `at`. */
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
  const burstVals = useRef(new Map<string, { born: number; o: Animated.Value; rise: Animated.Value; scale: Animated.Value }>());
  // The pet's whole body, set every frame from its pose: where it is, squash and stretch (from its feet), how high it
  // is off the ground, its tilt, and how far through its walk strip its steps are (driven by the distance walked).
  const pet = useRef({ x: value(home.current), lean: value(0), sx: value(1), sy: value(1), lift: value(0), phase: value(0) }).current;
  const walked = useRef({ x: null as number | null, distance: 0 });
  const joy = useRef(Array.from({ length: JOY }, () => ({ x: value(), y: value(), o: value(0), s: value(1) }))).current;
  const wiggleSince = useRef<number | null>(null);
  const [walk, setWalk] = useState<{ moving: boolean; facing: 1 | -1; stroll: boolean }>({ moving: false, facing: 1, stroll: false });
  const walkRef = useRef(walk);

  // A new shot: the pet walks under the word (where it stopped) and fires. Planned once, the first time it is drawn.
  for (const shot of shots) {
    if (live.current.has(shot.id)) continue;
    const rect = heldRect(shot.id);
    if (!rect) continue;
    const plan = planShot(moves.current, now(), { x: rect.left + rect.width / 2, y: rect.top + HIT_Y }, home.current, bounds, wander, height, PET_BOTTOM);
    const xy = () => ({ x: value(), y: value(), o: value(0), r: value() });
    live.current.set(shot.id, { plan, fired: false, struck: false, broke: false, done: false, origins: Array(plan.bullets).fill(null),
      bullets: Array.from({ length: plan.bullets }, xy), shards: Array.from({ length: SHARDS }, xy),
      trails: Array.from({ length: plan.bullets * TRAIL }, () => ({ x: value(), y: value(), o: value(0) })),
      sparks: Array.from({ length: SPARKS }, () => ({ x: value(), y: value(), o: value(0), s: value(1) })), ring: { s: value(0.4), o: value(0) },
      look: { glow: value(0.2), crack: value(0), scale: value(1), shake: value(0), shown: value(1) } });
  }
  for (const { burst } of bursts) {
    if (!burstVals.current.has(burst.id)) burstVals.current.set(burst.id, { born: now(), o: value(0), rise: value(0), scale: value(reduceMotion ? 1 : 0.55) });
  }

  useEffect(() => {
    if (wrongKey > 0 && !reduceMotion) wiggleSince.current = now();
  }, [wrongKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // One frame: move everything to where it is at this moment, and pass the moments that matter (sounds, the break,
  // the end of an effect).
  const latest = useRef({ shots, bursts, onHit, onImpact, onShotDone, onBurstDone, play });
  latest.current = { shots, bursts, onHit, onImpact, onShotDone, onBurstDone, play };
  const frame = useRef<() => void>(() => {});
  frame.current = () => {
    const tNow = now();
    const { shots: held, bursts: shown } = latest.current;
    const x = petX(moves.current, tNow, home.current!, bounds, wander);
    // Its steps follow the ground it covers (its feet never slide), whatever its speed.
    if (walked.current.x !== null) walked.current.distance += Math.abs(x - walked.current.x);
    walked.current.x = x;
    put(pet.phase, walked.current.distance / STRIDE_PX);
    // A wrong answer startles it backwards (away from the way it last faced).
    const startle = startleAt(wiggleSince.current, tNow);
    const poses: (Pose | null)[] = [startle ? { ...startle, back: -walkRef.current.facing * startle.back } : null];
    let lean = 0;
    let cheer: ShotPlan | null = null;
    for (const shot of held) {
      const s = live.current.get(shot.id);
      if (!s || s.done) continue;
      const { plan } = s;
      // Not confirmed yet by the server: it waits, cracked and glowing, just before it would break.
      if (shot.confirmed === false && !s.broke && tNow > plan.breakAt - 20) {
        const push = tNow - plan.breakAt + 20;
        plan.breakAt += push;
        plan.doneAt += push;
      }
      // The word stopped where it was answered: every bullet flies to that spot and hits it. It glows at each hit,
      // cracks after the last one, then breaks (its meaning shows and it counts).
      if (!s.struck && tNow >= plan.impactAt) { s.struck = true; latest.current.onHit?.(shot); }
      if (!s.broke && tNow >= plan.breakAt) {
        s.broke = true;
        latest.current.play('break');
        latest.current.onImpact?.(shot, plan.target);
      }
      const look = targetLook(plan, tNow, reduceMotion);
      put(s.look.glow, look.glow);
      put(s.look.crack, look.crack);
      put(s.look.scale, look.scale);
      put(s.look.shake, look.shake);
      put(s.look.shown, look.visible ? 1 : 0);
      lean = lean || leanAt(plan, tNow, x + PET_SIZE / 2);
      // Crouch before it fires, spring up with a little kick back as it does, settle, then a hop of joy when it breaks.
      const pose = shotPoseAt(plan, tNow);
      if (pose) poses.push({ ...pose, back: pose.back * (plan.target.x >= x + PET_SIZE / 2 ? -1 : 1) });
      if (tNow >= plan.breakAt && (!cheer || plan.breakAt > cheer.breakAt)) cheer = plan;
      for (let i = 0; i < plan.bullets; i++) {
        const leave = plan.fireAt + i * plan.gap;
        if (!s.origins[i] && tNow >= leave) s.origins[i] = muzzle(petX(moves.current, leave, home.current!, bounds, wander), height, PET_BOTTOM);
        const b = s.origins[i] ? bulletAt(plan, i, tNow, s.origins[i]!, plan.target) : null;
        if (b) { put(s.bullets[i].x, b.x); put(s.bullets[i].y, b.y); put(s.bullets[i].r, (b.angle * 180) / Math.PI); }
        put(s.bullets[i].o, b ? 1 : 0);
        // Its trail: where it was a moment ago, fading.
        const trail = s.origins[i] && !reduceMotion && !lite ? trailAt(plan, i, tNow, s.origins[i]!, plan.target) : [];
        for (let j = 0; j < TRAIL; j++) {
          const v = s.trails[i * TRAIL + j];
          const p = trail[j];
          if (p) { put(v.x, p.x); put(v.y, p.y); }
          put(v.o, p ? p.opacity : 0);
        }
      }
      const since = tNow - plan.breakAt;
      const pieces = shardsAt(plan, tNow, SHARDS);
      s.shards.forEach((v, i) => {
        const p = pieces[i];
        if (p) { put(v.x, p.x); put(v.y, p.y); put(v.r, p.rotate); }
        put(v.o, p ? p.opacity : 0);
      });
      const specks = sparksAt(plan, tNow, SPARKS);
      s.sparks.forEach((v, i) => {
        const p = specks[i];
        if (p) { put(v.x, p.x); put(v.y, p.y); put(v.s, p.scale); }
        put(v.o, p ? p.opacity : 0);
      });
      // A flash of light where it breaks, widening and fading.
      const ring = since >= 0 && since < 320 ? since / 320 : null;
      put(s.ring.o, ring === null ? 0 : 0.7 * (1 - ring));
      if (ring !== null) put(s.ring.s, 0.5 + 1.4 * (1 - (1 - ring) ** 2));
      if (!s.fired && tNow >= plan.fireAt) { s.fired = true; latest.current.play('shot'); }
      if (tNow >= plan.doneAt) { s.done = true; latest.current.onShotDone?.(shot.id); }
    }
    const dart = petMoving(moves.current, tNow);
    // Standing (not shooting, not walking): now and then a little tilt of the head.
    const idle = !wander || dart.moving || poses.length > 1 || walkRef.current.moving ? 0 : idleTiltAt(tNow);
    const pose = reduceMotion ? null : combinePoses(poses);
    put(pet.x, x + (pose?.back ?? 0));
    put(pet.lean, lean + (pose?.tilt ?? 0) + idle);
    put(pet.sx, pose?.sx ?? 1);
    put(pet.sy, pose?.sy ?? 1);
    put(pet.lift, -(pose?.lift ?? 0));
    // Sparks of joy over its head while it hops.
    const sparks = cheer && !reduceMotion && !lite ? joyAt(cheer, tNow) : [];
    joy.forEach((v, i) => {
      const p = sparks[i];
      if (p) { put(v.x, x + PET_SIZE / 2 + p.x); put(v.y, height - PET_BOTTOM - PET_SIZE + p.y); put(v.s, p.scale); }
      put(v.o, p ? p.opacity : 0);
    });
    // Between shots the pet strolls across the field, stepping the way it goes (its move strip, or its walk strip).
    const drift = petDrift(moves.current, tNow, home.current!, bounds, wander);
    const motion = drift ? { moving: true, facing: drift, stroll: true } : { ...dart, stroll: false };
    const was = walkRef.current;
    if (motion.moving !== was.moving || motion.facing !== was.facing || motion.stroll !== was.stroll) { walkRef.current = motion; setWalk(motion); }
    for (const { burst } of shown) {
      const v = burstVals.current.get(burst.id);
      if (!v) continue;
      const look = burstLook(tNow - v.born, reduceMotion);
      put(v.o, look.opacity);
      put(v.rise, look.rise);
      put(v.scale, look.scale);
      if (tNow - v.born >= BURST_MS) { burstVals.current.delete(burst.id); latest.current.onBurstDone?.(burst.id); }
    }
  };
  // The effect clock: runs (frame by frame, in the play field's one game loop) only while the game runs.
  useEffect(() => {
    if (!running) return;
    clock.current.since = Date.now();
    const tick = () => frame.current();
    ticker.add(tick);
    return () => {
      ticker.delete(tick);
      const c = clock.current;
      if (c.since !== null) c.base += Date.now() - c.since;
      c.since = null;
    };
  }, [running, ticker]);
  // Shots and meanings dropped by the caller (done, or a new stage) take their values with them.
  useEffect(() => {
    const ids = new Set(shots.map((s) => s.id));
    for (const id of live.current.keys()) if (!ids.has(id)) live.current.delete(id);
  }, [shots]);

  const colors = words ? ['#7FD3FF', '#4C6FFF'] : ['#FFE29A', '#F58A3A'];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shots.map((shot) => {
        // The word being shot, where it stopped: it glows (a halo behind, a sheen over it), cracks, then is gone.
        const s = live.current.get(shot.id);
        const rect = heldRect(shot.id);
        if (!s || !rect) return null;
        const glowW = Math.min(rect.width, 170);
        return (
          <Animated.View key={shot.id} testID={`shot-${shot.id}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.held, { left: rect.left, top: rect.top, width: rect.width, opacity: s.look.shown, transformOrigin: `50% ${HIT_Y}px`,
              transform: [{ translateX: s.look.shake }, { scale: s.look.scale }] }]}>
            <Animated.View style={[styles.halo, { left: (rect.width - glowW - 24) / 2, width: glowW + 24, top: HIT_Y - 30, opacity: s.look.glow }]} />
            <TargetBody turn={shot.turn} big={shot.aimed} />
            <Animated.View style={[styles.sheen, { left: (rect.width - glowW) / 2, width: glowW, top: HIT_Y - 20,
              opacity: Animated.multiply(s.look.glow, 0.45) }]} />
            <Animated.View style={[styles.cracks, { left: rect.width / 2, top: HIT_Y, opacity: s.look.crack }]}>
              {CRACKS.map(([angle, length], i) => (
                // Centred on the word's centre, turned, then pushed out by half its length: it starts at the centre.
                <View key={i} style={[styles.crack, { left: -length / 2, width: length, transform: [{ rotate: `${angle}deg` }, { translateX: length / 2 }] }]} />
              ))}
            </Animated.View>
          </Animated.View>
        );
      })}
      {bursts.map(({ burst, spot }) => {
        const v = burstVals.current.get(burst.id);
        return (
          <Animated.View key={burst.id} accessibilityLiveRegion="polite" accessibilityLabel={`${burst.title}${burst.sub ? `, ${burst.sub}` : ''}`}
            style={[styles.burst, burst.tone === 'hit' && styles.burstHit, spot, v ? { opacity: v.o, transform: [{ translateY: v.rise }, { scale: v.scale }] } : null]}>
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
            {s.sparks.map((v, i) => (
              <Animated.View key={`spark-${i}`} style={[styles.spark, { opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.s }] }]} />
            ))}
            {s.shards.map((v, i) => {
              const size = i % 3 === 0 ? 8 : 5;
              return <Animated.View key={i} style={[styles.shard, { left: -size / 2, top: -size / 2, width: size, height: size, backgroundColor: colors[i % 2],
                opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { rotate: deg(v.r) }] }]} />;
            })}
            {lite ? null : s.trails.map((v, i) => (
              <Animated.View key={`trail-${i}`} style={[styles.trailDot, { backgroundColor: colors[0], opacity: v.o,
                transform: [{ translateX: v.x }, { translateY: v.y }, { scale: 1 - (i % TRAIL) * 0.22 }] }]} />
            ))}
            {s.bullets.map((v, i) => (
              <Animated.View key={i} testID="bullet" style={[styles.bullet, { opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { rotate: deg(v.r) }] }]}>
                <LinearGradient colors={['rgba(255,236,140,0)', 'rgba(255,236,140,0.85)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.bulletTrail} />
                <View style={styles.bulletHead} />
              </Animated.View>
            ))}
          </React.Fragment>
        );
      })}
      {lite ? null : joy.map((v, i) => (
        <Animated.View key={`joy-${i}`} style={[styles.joy, { opacity: v.o, transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.s },
          { rotate: '45deg' }] }]} />
      ))}
      <Animated.View testID="shooter-pet" style={[styles.shooter, { bottom: PET_BOTTOM, transformOrigin: '50% 100%', transform: [{ translateX: pet.x },
        { translateY: pet.lift }, { rotate: deg(pet.lean) }, { scaleX: pet.sx }, { scaleY: pet.sy }] }]}>
        {/* A pet with drawn move strips has one for each way. Otherwise it walks, and the walk strips face right:
            walking left mirrors it. Standing, it faces the player again. */}
        <View style={{ transform: [{ scaleX: running && walk.moving && !hasSprite(petId, petLevel, moveActivity(walk.facing)) ? walk.facing : 1 }] }}>
          <PetArt pet={petId} size={PET_SIZE} stage={petLevel} moving={walk.moving ? walk.facing : undefined} strolling={walk.stroll}
            still={reduceMotion || !running} phase={walk.stroll ? pet.phase : undefined} />
        </View>
      </Animated.View>
    </View>
  );
});

const ROCK_DANGER = ['#FFB199', '#F0473A', '#7E1D1D'] as const;
const TILE_DANGER = ['#FFB199', '#E0475B'] as const;

/** A glowing rock with a fiery tail streaming up behind it (also drawn by the game's guide, TutorialArt). `alarm` fades
 * the red rock in over it (a falling word close to the ground). */
export function Rock({ danger, big, alarm, fall }: { danger: boolean; big: boolean; alarm?: Alarm; fall?: Fall }) {
  const d = big ? 42 : 36;
  // Falling, it spins (the body only: the tail streams up behind it and the word on it stays level) and sheds embers
  // that drift up its tail and fade, all read from how far it has fallen.
  const spin = useMemo(() => fall?.y.interpolate({ inputRange: [0, 100], outputRange: ['0deg', `${fall.dir * 70}deg`], extrapolate: 'extend' }),
    [fall]);
  const embers = useMemo(() => (fall ? EMBERS.map((e) => {
    const k = Animated.modulo(Animated.add(fall.y, e.offset), EMBER_CYCLE);
    return { left: e.x * d, rise: k.interpolate({ inputRange: [0, EMBER_CYCLE], outputRange: [0, -d * 0.9] }),
      o: k.interpolate({ inputRange: [0, EMBER_CYCLE * 0.15, EMBER_CYCLE], outputRange: [0, 0.9, 0] }) };
  }) : []), [fall, d]);
  return (
    <View style={styles.rockWrap} pointerEvents="none">
      <LinearGradient colors={['rgba(255,200,90,0)', 'rgba(255,150,60,0.55)', 'rgba(255,110,40,0.95)']}
        style={[styles.tail, { width: d * 0.62, borderRadius: d * 0.31 }]} />
      {embers.map((e, i) => (
        <Animated.View key={i} style={[styles.ember, { left: '50%', marginLeft: e.left, top: 30, opacity: e.o, transform: [{ translateY: e.rise }] }]} />
      ))}
      <Animated.View style={spin ? { transform: [{ rotate: spin }] } : undefined}>
      <LinearGradient colors={danger ? ROCK_DANGER : ['#FFE29A', '#F58A3A', '#8E3B1F']} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.85, y: 1 }}
        style={[styles.rock, { width: d, height: d, borderRadius: d / 2 }]}>
        {alarm ? (
          <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: d / 2, overflow: 'hidden', opacity: alarm }]}>
            <LinearGradient colors={ROCK_DANGER} start={{ x: 0.2, y: 0.1 }} end={{ x: 0.85, y: 1 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
        <View style={[styles.crater, { width: d * 0.22, height: d * 0.22, borderRadius: d * 0.11, left: d * 0.22, top: d * 0.5 }]} />
        <View style={[styles.crater, { width: d * 0.14, height: d * 0.14, borderRadius: d * 0.07, left: d * 0.58, top: d * 0.3 }]} />
      </LinearGradient>
      </Animated.View>
    </View>
  );
}

/** The embers a falling rock sheds: across its tail (fraction of its size from the centre) and when each one starts. */
const EMBER_CYCLE = 36;
const EMBERS = [{ x: -0.18, offset: 0 }, { x: 0.1, offset: 18 }];

/** An English word falling in Anh → Việt: a glowing tile with a short trail (also drawn by the game's guide). */
export function WordTile({ word, danger, big, alarm, fall }: { word: string; danger: boolean; big: boolean; alarm?: Alarm; fall?: Fall }) {
  // Falling, it rocks gently from side to side (a few degrees: always easy to read), in step with its fall.
  const sway = useMemo(() => (fall ? Animated.modulo(fall.y, SWAY_CYCLE).interpolate({
    inputRange: SWAY_STEPS.map((k) => k * SWAY_CYCLE), outputRange: SWAY_STEPS.map((k) => `${fall.dir * 2.5 * Math.sin(2 * Math.PI * k)}deg`) }) : null), [fall]);
  return (
    <Animated.View style={[styles.rockWrap, sway ? { transform: [{ rotate: sway }] } : null]} pointerEvents="none">
      <LinearGradient colors={['rgba(140,200,255,0)', 'rgba(120,180,255,0.5)']} style={styles.trail} />
      <LinearGradient colors={danger ? TILE_DANGER : ['#7FD3FF', '#4C6FFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.tile, big && styles.tileBig]}>
        {alarm ? (
          <Animated.View style={[StyleSheet.absoluteFill, styles.tileAlarm, { opacity: alarm }]}>
            <LinearGradient colors={TILE_DANGER} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
        <Text style={[styles.tileText, big && styles.tileTextBig, word.length > 12 && styles.tileTextLong]} numberOfLines={2}>{word}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

/** One sway of a word tile per SWAY_CYCLE px of its fall, smoothed by a few steps of a sine. */
const SWAY_CYCLE = 140;
const SWAY_STEPS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

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
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  ground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: GROUND, backgroundColor: '#3E5F45' },
  pet: { position: 'absolute' },
  shooter: { position: 'absolute', left: 0, width: PET_SIZE, height: PET_SIZE, transformOrigin: '50% 100%' },
  // A falling word's box, moved by transform only (never by left/top): its own position, in the field's frame.
  target: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
  appear: { alignSelf: 'stretch', alignItems: 'center' },
  rockWrap: { alignItems: 'center' },
  tail: { height: 34, marginBottom: -12 },
  rock: { shadowColor: '#FF8A3D', shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  crater: { position: 'absolute', backgroundColor: 'rgba(110,40,20,0.35)' },
  word: { marginTop: 4, fontSize: 13, lineHeight: 17, fontWeight: '800', color: '#FFFFFF', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  wordAimed: { fontSize: 15, lineHeight: 19, color: '#FFE9B8' },
  trail: { width: 16, height: 26, borderRadius: 8, marginBottom: -6 },
  tile: { minWidth: 72, maxWidth: WORD_MAX_W, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, alignItems: 'center',
    shadowColor: '#7FB8FF', shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  tileBig: { maxWidth: WORD_MAX_W, paddingVertical: 7, borderWidth: 1.5, borderColor: '#FFE9B8' },
  tileText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  tileTextBig: { fontSize: 17 },
  tileTextLong: { fontSize: 13, textAlign: 'center' }, // phrases wrap on two lines instead of being cut
  tileAlarm: { borderRadius: 12, overflow: 'hidden' },
  answerRow: { marginTop: 6, alignItems: 'center' },
  answerRowCompact: { marginTop: 3 },
  // The one text field: invisible and fixed at the top of the field (focusing it never pans or scrolls anything); the
  // aimed word's boxes show what it holds.
  hiddenInput: { position: 'absolute', left: 8, top: 0, width: 2, height: 2, opacity: 0.01, color: 'transparent', padding: 0 },
  bullet: { position: 'absolute', left: -3, top: -3, width: 6, height: 6 },
  bulletTrail: { position: 'absolute', right: 3, top: 1.5, width: 16, height: 3, borderRadius: 2 },
  bulletHead: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF4B0',
    shadowColor: '#FFD84D', shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  ring: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 3 },
  shard: { position: 'absolute', borderRadius: 2 },
  trailDot: { position: 'absolute', left: -3, top: -3, width: 6, height: 6, borderRadius: 3 },
  joy: { position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 2, backgroundColor: '#FFF1A8',
    shadowColor: '#FFE27A', shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  landing: { position: 'absolute', width: 0, height: 0 },
  landingFlash: { position: 'absolute', left: -26, top: -26, width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,214,140,0.85)' },
  landingRing: { position: 'absolute', left: -34, top: -8, width: 68, height: 16, borderRadius: 34, borderWidth: 3, borderColor: 'rgba(255,236,200,0.9)' },
  landingDust: { position: 'absolute', left: -40, top: -14, width: 80, height: 22, borderRadius: 40, backgroundColor: 'rgba(214,190,160,0.75)' },
  pebble: { position: 'absolute', left: -3, top: -3, width: 6, height: 6, borderRadius: 2, backgroundColor: '#8E6A52' },
  ember: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#FFC56B' },
  // A speck of light: a bright core in a soft golden halo (a border, so it reads the same on Android and iOS).
  spark: { position: 'absolute', left: -5, top: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFF8D6',
    borderWidth: 2.5, borderColor: 'rgba(255,210,90,0.55)' },
  held: { position: 'absolute', alignItems: 'center' },
  halo: { position: 'absolute', height: 60, borderRadius: 30, backgroundColor: 'rgba(255,228,140,0.55)',
    shadowColor: '#FFD86B', shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } },
  sheen: { position: 'absolute', height: 40, borderRadius: 14, backgroundColor: '#FFFFFF' },
  cracks: { position: 'absolute', width: 0, height: 0 },
  crack: { position: 'absolute', top: -1, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF', shadowOpacity: 1, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
  burst: { position: 'absolute', width: BURST_W, minHeight: BURST_H, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(12,22,52,0.55)' },
  // A meaning won by a hit: a glowing card.
  burstHit: { backgroundColor: 'rgba(20,40,96,0.82)', borderWidth: 1.5, borderColor: '#FFE9B8',
    shadowColor: '#FFD86B', shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  burstTitle: { fontSize: 15, fontWeight: '800', color: '#FFE9B8', textAlign: 'center' },
  burstMiss: { color: '#FFB3BD' },
  burstSub: { fontSize: 12, fontWeight: '600', color: '#C9D6F2', textAlign: 'center' },
});
