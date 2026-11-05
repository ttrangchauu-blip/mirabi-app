import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import type { Plant } from '../../life/worlds';
import { useSwing, useWorldMotion } from '../../world/budget';
import { BEAT } from '../../world/diorama';
import { EASE } from '../../world/motion';
import { GROUND_ART, GROUND_NIGHT, PLANT_ART, PLANT_NIGHT } from './gardenAssets';

/**
 * The plants of Vườn tài chính, one per savings goal, from seed (stage 0) to full bloom (stage 5): the stage is the
 * server's, worked out from what the owner really saved. Everything here only draws: nothing changes a goal.
 *
 * A plant comes in two pictures of one box, rendered in 3D together (`scripts/render-scenes/scenes/scene-grove.js`): the plant, which sways, and its ground (a ring of
 * stones and the shadow the plant casts), which stays. The foot of the plant is at `FOOT` of the box.
 */

export const PLANT_BLOOM: Record<Plant, string> = { sakura: '#F9BBD0', oak: '#F2C94E', sunflower: '#FBD148', bamboo: '#E5F4BE', maple: '#F7A048', lotus: '#F7AECA' };
/** The box's height over its width, the share of it that its ground picture starts at, and the foot of the plant in it. */
export const BOX_TALL = 600 / 672;
const GROUND_FROM = 280 / 600;
export const FOOT = { x: 1.7 / 4.2, y: 0.84 };
const ORIGIN = `${FOOT.x * 100}% ${FOOT.y * 100}%`;
const GROUND_ORIGIN = `${FOOT.x * 100}% ${((FOOT.y - GROUND_FROM) / (1 - GROUND_FROM)) * 100}%`;

const clampStage = (s: number) => Math.max(0, Math.min(5, Math.round(s)));

/** A rendered picture filling its parent; its night render comes up over it as it gets dark (0 to 1). */
function Lit({ source, nightSource, night = 0 }: { source: ImageSourcePropType; nightSource?: ImageSourcePropType; night?: number }) {
  return <>
    {night < 0.99 || !nightSource ? <Image source={source} style={s.fill} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors /> : null}
    {night > 0.01 && nightSource ? <Image source={nightSource} style={[s.fill, { opacity: night }]} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors /> : null}
  </>;
}

export const groundOrigin = GROUND_ORIGIN;
export const plantOrigin = ORIGIN;
/** The height of the ground's picture, for a box of a width. */
export const groundTall = (size: number) => size * BOX_TALL * (1 - GROUND_FROM);
export const groundTop = (size: number) => size * BOX_TALL * GROUND_FROM;

/** The ring of stones under a plant and the shadow it casts. `plant` null is the empty plot of a goal not yet sown. */
export const GoalGround = memo(function GoalGround({ plant, stage = 0, size, night }: { plant: Plant | null; stage?: number; size: number; night?: number }) {
  const at = clampStage(stage);
  const art = plant ? (GROUND_ART[plant] ?? GROUND_ART.sakura)[at] : GROUND_ART.plot[0];
  const dark = plant ? (GROUND_NIGHT[plant] ?? GROUND_NIGHT.sakura)[at] : GROUND_NIGHT.plot[0];
  return <View style={{ width: size, height: groundTall(size) }} pointerEvents="none"><Lit source={art} nightSource={dark} night={night} /></View>;
});

/** The whole picture of a plant in its ring, without motion. */
export const PlantArt = memo(function PlantArt({ plant, stage, size }: { plant: Plant; stage: number; size: number }) {
  return (
    <View style={{ width: size, height: size * BOX_TALL }}>
      <View style={{ position: 'absolute', top: groundTop(size) }}><GoalGround plant={plant} stage={stage} size={size} /></View>
      <Lit source={(PLANT_ART[plant] ?? PLANT_ART.sakura)[clampStage(stage)]} />
    </View>
  );
});

function Petal({ left, color, ms, delay, drop }: { left: number; color: string; ms: number; delay: number; drop: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  const { animate } = useWorldMotion();
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(fall, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }), Animated.timing(fall, { toValue: 0, duration: 0, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [animate, fall, ms, delay]);
  return (
    <Animated.View style={[s.petal, { left, backgroundColor: color, opacity: fall.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }), transform: [
      { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [0, drop] }) },
      { translateX: fall.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 10, -3] }) },
      { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '220deg'] }) },
    ] }]} />
  );
}

/**
 * A goal's plant, alive: it bends with the wind (`wind`, from the real weather when there is any), rustles when `rustle`
 * changes (a tap: nothing else happens), grows with a springy swell when the stage rises, and drops petals in full bloom.
 * `still` holds it while it is far off screen. Only the plant: its ground is `GoalGround`.
 */
export const GoalTree = memo(function GoalTree({ plant, stage, size = 104, wind = 0.7, rustle = 0, night = 0, still = false }: { plant: Plant; stage: number; size?: number; wind?: number; rustle?: number; night?: number; still?: boolean }) {
  const swing = useSwing({ ms: 2300 + stage * 180, rest: [0, 900], enabled: !still });
  const { animate, level } = useWorldMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const shown = useRef(stage);
  const [bigger, setBigger] = useState(0);
  useEffect(() => {
    const grew = stage > shown.current;
    shown.current = stage;
    if (!grew || level === 'still') return;
    setBigger((n) => n + 1);
    pop.setValue(0.72);
    const anim = Animated.sequence([Animated.timing(pop, { toValue: 1.12, duration: BEAT.triumph * 0.45, easing: EASE.rise, useNativeDriver: true }), Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true })]);
    anim.start();
    return () => anim.stop();
  }, [stage, level, pop]);
  useEffect(() => {
    if (!rustle || level === 'still') return;
    shake.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 110, easing: EASE.leaf, useNativeDriver: true }), Animated.timing(shake, { toValue: -0.8, duration: 170, easing: EASE.leaf, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.45, duration: 170, easing: EASE.leaf, useNativeDriver: true }), Animated.timing(shake, { toValue: 0, duration: 200, easing: EASE.leaf, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [rustle, level, shake]);
  // A big tree moves less at its foot than a sapling does: only a degree or two.
  const reach = 0.5 + (5 - clampStage(stage)) * 0.2;
  const bend = useMemo(() => Animated.add(swing.interpolate({ inputRange: [-1, 1], outputRange: [-reach * wind, reach * wind] }), shake.interpolate({ inputRange: [-1, 1], outputRange: [-3, 3] }))
    .interpolate({ inputRange: [-8, 8], outputRange: ['-8deg', '8deg'] }), [swing, shake, wind, reach]);
  const petals = stage >= 5 && animate && level === 'full' && plant !== 'lotus' && !still;
  const tall = size * BOX_TALL;
  return (
    <View style={{ width: size, height: tall }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID={`plant-${plant}-${stage}`}>
      <Animated.View key={bigger} style={[s.fill, { transformOrigin: ORIGIN, transform: [{ scale: pop }, { rotate: bend }] }]}>
        <Lit source={(PLANT_ART[plant] ?? PLANT_ART.sakura)[clampStage(stage)]} nightSource={(PLANT_NIGHT[plant] ?? PLANT_NIGHT.sakura)[clampStage(stage)]} night={night} />
      </Animated.View>
      {petals ? [[0.2, 3600, 0], [0.54, 4300, 1400], [0.38, 3900, 2600]].map(([x, ms, delay], i) => (
        <Petal key={i} left={x * size} color={PLANT_BLOOM[plant] ?? PLANT_BLOOM.sakura} ms={ms} delay={delay} drop={tall * 0.56} />
      )) : null}
    </View>
  );
});

const DROPS = [[-10, 0], [0, 90], [10, 40], [-4, 150], [6, 210]];
/**
 * The watering can tipping over a plant, once per new `play`: it tilts, water falls and it is put back (about 1.2 s).
 * Only a picture: what makes a plant grow is the money the owner records. With reduced motion nothing plays.
 */
export const WateringCan = memo(function WateringCan({ play, x, y, onDone }: { play: number; x: number; y: number; onDone?: () => void }) {
  const { level } = useWorldMotion();
  const t = useRef(new Animated.Value(0)).current;
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!play) return;
    if (level === 'still') { onDone?.(); return; }
    setShowing(true);
    t.setValue(0);
    const anim = Animated.timing(t, { toValue: 1, duration: BEAT.triumph, easing: Easing.linear, useNativeDriver: true });
    anim.start(({ finished }) => { if (finished) { setShowing(false); onDone?.(); } });
    return () => anim.stop();
  }, [play, level]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!showing) return null;
  return (
    <View pointerEvents="none" style={[s.can, { left: x, top: y }]} testID="watering-can" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={{ transformOrigin: '60% 60%', opacity: t.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [-16, 0, 0, -12] }) }, { rotate: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: ['0deg', '-32deg', '-32deg', '0deg'] }) }] }}>
        <CanArt size={58} />
      </Animated.View>
      {DROPS.map(([dx, delay], i) => {
        const start = 0.2 + (delay / 1200);
        return <Animated.View key={i} style={[s.drop, { left: 2 + dx, opacity: t.interpolate({ inputRange: [start, start + 0.05, start + 0.32, Math.min(1, start + 0.36)], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
          transform: [{ translateY: t.interpolate({ inputRange: [start, start + 0.36], outputRange: [24, 96], extrapolate: 'clamp' }) }] }]} />;
      })}
    </View>
  );
});

const CAN = require('../../../assets/world/garden/can.webp');
export const CanArt = memo(function CanArt({ size }: { size: number }) {
  return <Image source={CAN} style={{ width: size, height: size * 0.8 }} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />;
});

const s = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  petal: { position: 'absolute', top: '34%', width: 6, height: 4, borderRadius: 3 },
  can: { position: 'absolute', width: 60, height: 60, zIndex: 5 },
  drop: { position: 'absolute', top: 0, width: 3, height: 7, borderRadius: 2, backgroundColor: '#8CD5F0' },
});
