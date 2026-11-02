import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../components/PetArt';
import { attackWindupMs, drawnActions } from '../petSprites';
import { Text } from '../components/Typography';
import { Gem, HeartFx, Shard } from './art/effects';
import { Sparkle } from './art/mathBattle';
import { Chest, Creature, DOOR_OPENING, DoorFrame, DoorLeaf, Flower, ForestLayer, Rune, Vines } from './art/wordForest';
import { useReactions } from './engine/feedback';
import { Layer, Parallax } from './engine/Parallax';
import { useRig } from './engine/rig';
import { useSfx } from './engine/sfx';
import { type Advance, useAdvance } from './quests/worlds';

// Word Forest's quests for the Tiếng Việt lessons, drawn above the lesson game being played (its content is the
// lesson's own):
// - door (Sắp xếp: câu, trình tự câu chuyện): a secret door with carved runes; a right order lights the runes one after
//   another, the door rumbles, its two leaves swing open and the pet walks through to the next door.
// - rescue (Ghép cặp, Chọn đáp án: từ đồng nghĩa, trái nghĩa, từ phù hợp): a forest creature caught in thorny vines;
//   every right answer snaps one layer (it bursts into pieces); the last frees it: it runs to the pet to thank it and
//   the treasure chest opens on a gem.
// A wrong answer shakes the door (or tightens the vines). Progress comes from the session (questions done / total).
// Each right answer is a reaction of the feedback loop (engine/feedback.ts): the explanation and the next question wait
// for it, and "Bỏ qua" jumps to its end.

export type Quest = 'door' | 'rescue';
const LAYERS = 3;

/** The vine layers still holding the creature after `done` of `total` right answers (3 at the start, 0 at the end). */
export function vinesLeft(done: number, total: number): number {
  if (total <= 0) return LAYERS;
  return Math.max(0, Math.ceil(LAYERS * (1 - Math.min(done, total) / total)));
}

const FOREST: Layer[] = [
  { key: 'sky', speed: 0, render: (w, h) => <ForestLayer layer="sky" width={w} height={h} /> },
  { key: 'far', speed: 0.25, render: (w, h) => <ForestLayer layer="far" width={w} height={h} /> },
  { key: 'mid', speed: 0.55, render: (w, h) => <ForestLayer layer="mid" width={w} height={h} /> },
  { key: 'near', speed: 1, render: (w, h) => <ForestLayer layer="near" width={w} height={h} /> },
];
const H = 176;
const DOOR = 100; // the archway: DOOR wide, 1.2 × DOOR tall; its leaves fill DOOR_OPENING
const RUNES = 3;
const SHARDS = [0, 1, 2, 3, 4].map((i) => ({ a: -Math.PI / 2 + (i - 2) * 0.62, d: 46 + (i % 2) * 14 }));

export function ForestQuest({ quest, done, total, wrongKey, petId, petLevel, reduceMotion, running, hold = false }: {
  quest: Quest; done: number; total: number; wrongKey: number; petId: string; petLevel: number; reduceMotion: boolean; running: boolean;
  /** The answered question waits for "Câu tiếp theo": the door opens, but the pet walks through to the next one only then. */
  hold?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const travel = useRef(new Animated.Value(quest === 'door' ? done : 0)).current;
  const open = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current; // door: 0 → RUNES, the runes lighting one after another; rescue: a burst of light
  const rumble = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const walk = useRef(new Animated.Value(0)).current;
  const snap = useRef(new Animated.Value(0)).current; // the vine layer breaking: 1 → 0
  const thanks = useRef(new Animated.Value(0)).current; // the freed creature: 0 in its cage → 1 by the pet
  const gem = useRef(new Animated.Value(0)).current;
  const [walking, setWalking] = useState(false);
  const [breaking, setBreaking] = useState<number | null>(null);
  const sound = useSfx();
  const react = useReactions();
  const advanceFor = useAdvance(hold);
  const windup = attackWindupMs(petId, petLevel, reduceMotion);
  const pet = useRig({ facing: 1, running, reduceMotion, ...drawnActions(petId, petLevel) });
  const creature = useRig({ facing: -1, running, reduceMotion });
  const ms = (n: number) => (reduceMotion ? 0 : n);
  const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration: ms(duration), easing, useNativeDriver: false });
  // Each right answer is one run: a newer run (or going away) makes the older one's late callbacks do nothing; the older
  // reaction is ended when the newer begins.
  const runSeq = useRef(0);
  const runEnd = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => { runSeq.current++; }, []);
  /** An animation's end: at once when it finished, a moment later when it was stopped (its views detached during a commit,
   * where no state may change). */
  const after = (alive: () => boolean, fn: () => void) => ({ finished }: { finished: boolean }) => {
    if (!alive()) return;
    if (finished) fn(); else setTimeout(() => { if (alive()) fn(); }, 0);
  };

  // A right answer.
  const lastDone = useRef(done);
  useEffect(() => {
    const before = lastDone.current;
    lastDone.current = done;
    if (done <= before) return;
    runEnd.current?.();
    const run = ++runSeq.current;
    const alive = () => runSeq.current === run;
    if (quest === 'door') {
      sound('unlock');
      glow.setValue(0); open.setValue(0); walk.setValue(0); rumble.setValue(0);
      const opening = Animated.sequence([
        timing(glow, RUNES, 180 * RUNES, Easing.linear),
        timing(rumble, 1, 360, Easing.linear),
        timing(open, 1, 520, Easing.out(Easing.quad)),
      ]);
      // Through the open door to the next one: once "Câu tiếp theo" is pressed, when the answered question waits for it.
      const enter = (entered: () => void) => {
        const step = ++runSeq.current;
        const still = () => runSeq.current === step;
        rumble.setValue(0);
        setWalking(!reduceMotion);
        Animated.sequence([timing(walk, 1, 700, Easing.in(Easing.quad)), Animated.parallel([timing(travel, done, 700), timing(glow, 0, 700)])])
          .start(after(still, () => { open.setValue(0); walk.setValue(0); setWalking(false); entered(); }));
      };
      let advance: Advance = () => {};
      let opened = false;
      const through = () => { opened = true; advance(enter); };
      // Skipped or timed out: while it opens, the door stands open at once (the walk through it still waits when held);
      // while the pet walks through, it is at the next door.
      const toEnd = () => {
        runSeq.current++;
        opening.stop();
        pet.stop();
        if (!opened) { glow.setValue(RUNES); rumble.setValue(0); open.setValue(1); through(); return; }
        open.setValue(0); walk.setValue(0); rumble.setValue(0); glow.setValue(0); travel.setValue(done);
        setWalking(false);
      };
      const end = react.begin('forest:door', { maxMs: 5000, finish: toEnd });
      advance = advanceFor(end);
      runEnd.current = end;
      pet.play('cheer'); // it is over before the door has opened and the pet walks through
      opening.start(after(alive, through));
      return;
    }
    const freed = done >= total;
    const layer = vinesLeft(done, total) < vinesLeft(before, total) ? vinesLeft(done, total) : null;
    pet.play('attack');
    // The vines hold until the pet's strike lands (at once for a pet with no drawn attack).
    setBreaking(layer);
    snap.setValue(1);
    const strike = () => {
      sound(freed ? 'complete' : 'hit');
      glow.setValue(1);
      if (freed) creature.play('celebrate'); else creature.play('jump');
      anim.start(after(alive, () => { setBreaking(null); pet.play('cheer'); end(); }));
    };
    const steps: Animated.CompositeAnimation[] = [Animated.parallel([timing(glow, 0, 700), timing(snap, 0, 600, Easing.out(Easing.quad))])];
    if (freed) {
      thanks.setValue(0); gem.setValue(0);
      steps.push(Animated.parallel([
        Animated.sequence([timing(thanks, 1, 650), Animated.delay(ms(700)), timing(thanks, 0, 550)]),
        Animated.sequence([Animated.delay(ms(300)), timing(gem, 1, 700, Easing.out(Easing.back(1.6)))]),
      ]));
    }
    const anim = Animated.sequence(steps);
    const windingUp = windup ? Animated.delay(windup) : null;
    const toEnd = () => {
      runSeq.current++;
      windingUp?.stop();
      anim.stop();
      glow.setValue(0); snap.setValue(0); thanks.setValue(0); gem.setValue(freed ? 1 : 0);
      setBreaking(null);
    };
    const end = react.begin('forest:rescue', { maxMs: 5000, finish: toEnd });
    runEnd.current = end;
    if (windingUp) windingUp.start(after(alive, strike)); else strike();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // A wrong answer: felt in the world, but the lesson game stays playable (not a critical reaction).
  const firstWrong = useRef(wrongKey);
  useEffect(() => {
    if (wrongKey === firstWrong.current) return;
    firstWrong.current = wrongKey;
    sound('wrong');
    shake.setValue(0);
    const end = react.begin('forest:wrong', { critical: false, maxMs: 1500 });
    timing(shake, 1, 480, Easing.linear).start(end);
    if (quest === 'rescue') creature.play('hit');
  }, [wrongKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = width || 320;
  const jolt = Animated.add(
    shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -7, 7, -5, 3, 0] }),
    rumble.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 2.5, -2.5, 2, 0] }),
  );
  const left = vinesLeft(done, total);
  const freed = done >= total && total > 0;
  const doorX = W * 0.58;
  const cageX = W * 0.56;
  const petStand = 14;
  const label = quest === 'door'
    ? `Cánh cửa bí mật thứ ${Math.min(done + 1, total)} trên ${total}`
    : freed ? 'Sinh vật đã được giải cứu, rương kho báu mở' : `Sinh vật bị mắc kẹt, còn ${left} lớp dây gai`;
  return (
    <View style={[styles.scene, { height: H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image"
      accessibilityLabel={label}>
      {width ? <Parallax width={W} height={H} layers={FOREST} travel={travel} step={220} drift={0.6} running={running} reduceMotion={reduceMotion} /> : null}
      {quest === 'door' ? (
        <>
          <Animated.View style={[styles.door, { left: doorX, transform: [{ translateX: jolt }] }]}>
            <Animated.View style={[styles.beyond, { opacity: open }]} />
            {(['left', 'right'] as const).map((side) => (
              <Animated.View key={side} style={[styles.leaf, { left: (DOOR_OPENING.left + (side === 'right' ? DOOR_OPENING.leafWidth : 0)) * DOOR,
                transform: [{ translateX: open.interpolate({ inputRange: [0, 1], outputRange: [0, (side === 'left' ? -1 : 1) * DOOR_OPENING.leafWidth * DOOR * 0.9] }) }] }]}>
                <DoorLeaf size={DOOR} side={side} />
              </Animated.View>
            ))}
            <View style={StyleSheet.absoluteFill} pointerEvents="none"><DoorFrame size={DOOR} /></View>
            <View style={styles.runes}>
              {Array.from({ length: RUNES }).map((_, i) => (
                <View key={i}>
                  <Rune size={20} lit={false} />
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow.interpolate({ inputRange: [i, i + 1], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
                    <Rune size={20} lit />
                  </Animated.View>
                </View>
              ))}
            </View>
          </Animated.View>
          <Animated.View style={[styles.pet, { transform: [{ translateX: walk.interpolate({ inputRange: [0, 1], outputRange: [0, doorX - 20] }) },
            { scale: walk.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.85, 0.6] }) }], opacity: walk.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }) }]}>
            <Animated.View style={pet.style}><PetArt pet={petId} size={66} stage={petLevel} walking={walking} still={reduceMotion || !running} cheer={pet.cheer} /></Animated.View>
          </Animated.View>
        </>
      ) : (
        <>
          <View style={[styles.chest, { left: W * 0.82 }]}>
            <Chest size={50} open={freed} />
            {freed ? (
              <Animated.View pointerEvents="none" style={[styles.gem, { opacity: gem, transform: [{ translateY: gem.interpolate({ inputRange: [0, 1], outputRange: [6, -30] }) },
                { scale: gem.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]} accessibilityLabel="Phần thưởng: viên ngọc">
                <Gem size={30} />
              </Animated.View>
            ) : null}
          </View>
          <View style={[styles.flower, { left: W * 0.42 }]}><Flower size={30} open={freed || left < LAYERS} /></View>
          <Animated.View style={[styles.cage, { left: cageX, transform: [{ translateX: thanks.interpolate({ inputRange: [0, 1], outputRange: [0, petStand + 70 - cageX] }) }] }]}>
            <Animated.View style={[creature.style, { transform: [...(creature.style.transform as object[]), { translateX: jolt }] } as never]}>
              <Creature size={84} mood={freed ? 'happy' : 'trapped'} />
            </Animated.View>
            {Array.from({ length: LAYERS }).map((_, i) => (i < left ? (
              <View key={i} style={StyleSheet.absoluteFill} pointerEvents="none"><Vines size={96} layer={i as 0} /></View>
            ) : i === breaking ? ( // the layer just cut: it bursts and falls away
              <Animated.View key={i} style={[StyleSheet.absoluteFill, { opacity: snap, transform: [{ scale: snap.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }) }] }]}
                pointerEvents="none"><Vines size={96} layer={i as 0} /></Animated.View>
            ) : null))}
            {breaking !== null && !reduceMotion ? SHARDS.map((s, i) => (
              // Only once it is bursting (below 1): a layer still holding has no pieces in the air.
              <Animated.View key={i} pointerEvents="none" style={[styles.shard, { opacity: snap.interpolate({ inputRange: [0, 0.999, 1], outputRange: [0, 0.999, 0] }),
                transform: [{ translateX: snap.interpolate({ inputRange: [0, 1], outputRange: [Math.cos(s.a) * s.d, 0] }) },
                  { translateY: snap.interpolate({ inputRange: [0, 1], outputRange: [Math.sin(s.a) * s.d + 30, 0] }) },
                  { rotate: snap.interpolate({ inputRange: [0, 1], outputRange: [`${(i - 2) * 70}deg`, '0deg'] }) }] }]}>
                <Shard size={16} color={i % 2 ? '#5E8B3A' : '#7A5A34'} variant={i} />
              </Animated.View>
            )) : null}
            <Animated.View pointerEvents="none" style={[styles.sparkles, { opacity: glow }]}><Sparkle size={30} /></Animated.View>
            {freed && !reduceMotion ? [0, 1, 2].map((i) => ( // its thank-you, by the pet
              <Animated.View key={i} pointerEvents="none" style={[styles.heart, { left: 20 + i * 18,
                opacity: thanks.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] }),
                transform: [{ translateY: thanks.interpolate({ inputRange: [0, 1], outputRange: [0, -18 - i * 6] }) }] }]}>
                <HeartFx size={16} />
              </Animated.View>
            )) : null}
          </Animated.View>
          <View style={[styles.pet, { left: petStand }]}>
            <Animated.View style={pet.style}><PetArt pet={petId} size={66} stage={petLevel} still={reduceMotion || !running} strike={pet.strike} cheer={pet.cheer} /></Animated.View>
          </View>
          <View style={styles.counter}><Text style={styles.counterText}>{freed ? 'Đã giải cứu!' : `Dây gai: ${left}/${LAYERS}`}</Text></View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#CFEBC8', marginBottom: 10 },
  door: { position: 'absolute', bottom: 14, width: DOOR, height: DOOR * 1.2 },
  leaf: { position: 'absolute', top: DOOR_OPENING.top * DOOR },
  beyond: { position: 'absolute', left: DOOR_OPENING.left * DOOR, top: DOOR_OPENING.top * DOOR, width: DOOR_OPENING.leafWidth * 2 * DOOR,
    height: DOOR_OPENING.leafHeight * DOOR, backgroundColor: 'rgba(255,244,190,0.95)' },
  runes: { position: 'absolute', top: DOOR * 0.2, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  pet: { position: 'absolute', left: 14, bottom: 22 },
  cage: { position: 'absolute', bottom: 22, width: 96, height: 96, alignItems: 'center', justifyContent: 'flex-end' },
  sparkles: { position: 'absolute', top: 0 },
  shard: { position: 'absolute', top: 40, left: 40 },
  heart: { position: 'absolute', top: 0 },
  chest: { position: 'absolute', bottom: 24 },
  gem: { position: 'absolute', left: 10, top: 0 },
  flower: { position: 'absolute', bottom: 26 },
  counter: { position: 'absolute', top: 8, left: 8, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.9)' },
  counterText: { fontSize: 12, fontWeight: '900', color: '#22703A' },
});
