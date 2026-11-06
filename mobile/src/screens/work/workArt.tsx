import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { ProjectTheme } from '../../life/types';

/**
 * Work Quest's drawn things: project islands that are built up stage by stage, reward chests and the bursts of stars
 * a finished quest gets (the desk itself is WorkDesk.tsx). Every loop runs on the native driver
 * (transforms and opacity only), stops when its component unmounts and stays still with "reduce motion" on.
 */

/** A looping 0 → 1 → 0 value; null when motion is reduced (callers then draw the still frame). */
export function useLoop(duration: number, enabled = true, delay = 0) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;
  const on = enabled && !reduce;
  useEffect(() => {
    value.setValue(0);
    if (!on) return;
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration, easing: ease, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration, easing: ease, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on, duration, delay, value]);
  return on ? value : null;
}

const range = (v: Animated.Value | null, from: number, to: number) => (v ? v.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) : from);

/** Each theme's island at each stage of its project, rendered in 3D (`scripts/render-scenes`): a sign, a hut, a tree, a house, then a flag. */
const ISLAND: Record<ProjectTheme, ImageSourcePropType[]> = {
  meadow: [require('../../../assets/world/work/isle-meadow-0.webp'), require('../../../assets/world/work/isle-meadow-1.webp'), require('../../../assets/world/work/isle-meadow-2.webp'), require('../../../assets/world/work/isle-meadow-3.webp'), require('../../../assets/world/work/isle-meadow-4.webp'), require('../../../assets/world/work/isle-meadow-5.webp')],
  beach: [require('../../../assets/world/work/isle-beach-0.webp'), require('../../../assets/world/work/isle-beach-1.webp'), require('../../../assets/world/work/isle-beach-2.webp'), require('../../../assets/world/work/isle-beach-3.webp'), require('../../../assets/world/work/isle-beach-4.webp'), require('../../../assets/world/work/isle-beach-5.webp')],
  forest: [require('../../../assets/world/work/isle-forest-0.webp'), require('../../../assets/world/work/isle-forest-1.webp'), require('../../../assets/world/work/isle-forest-2.webp'), require('../../../assets/world/work/isle-forest-3.webp'), require('../../../assets/world/work/isle-forest-4.webp'), require('../../../assets/world/work/isle-forest-5.webp')],
  snow: [require('../../../assets/world/work/isle-snow-0.webp'), require('../../../assets/world/work/isle-snow-1.webp'), require('../../../assets/world/work/isle-snow-2.webp'), require('../../../assets/world/work/isle-snow-3.webp'), require('../../../assets/world/work/isle-snow-4.webp'), require('../../../assets/world/work/isle-snow-5.webp')],
  desert: [require('../../../assets/world/work/isle-desert-0.webp'), require('../../../assets/world/work/isle-desert-1.webp'), require('../../../assets/world/work/isle-desert-2.webp'), require('../../../assets/world/work/isle-desert-3.webp'), require('../../../assets/world/work/isle-desert-4.webp'), require('../../../assets/world/work/isle-desert-5.webp')],
  sky: [require('../../../assets/world/work/isle-sky-0.webp'), require('../../../assets/world/work/isle-sky-1.webp'), require('../../../assets/world/work/isle-sky-2.webp'), require('../../../assets/world/work/isle-sky-3.webp'), require('../../../assets/world/work/isle-sky-4.webp'), require('../../../assets/world/work/isle-sky-5.webp')],
};
/** An island's picture is taller than wide: what is built on it stands up out of the square it used to fill. */
const ISLAND_TALL = 1.25;
const CHEST: Record<'locked' | 'ready' | 'opened', ImageSourcePropType> = { locked: require('../../../assets/world/work/chest-0.webp'), ready: require('../../../assets/world/work/chest-1.webp'), opened: require('../../../assets/world/work/chest-2.webp') };

/** A project island. `stage` 0..5 is what has been built on it; a finished one (`lit`) glows. It bobs on the water, and pops a little when a stage is added. */
export function ProjectIslandArt({ theme, stage, lit, size = 128 }: { theme: ProjectTheme; stage: number; lit: boolean; size?: number }) {
  const bob = useLoop(2400);
  const glow = useLoop(1400, lit);
  const pop = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const shown = useRef(stage);
  useEffect(() => {
    if (stage <= shown.current) { shown.current = stage; return; }
    shown.current = stage;
    if (reduce) return;
    pop.setValue(0.85);
    const anim = Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [stage, reduce, pop]);
  const height = size * ISLAND_TALL;
  const art = ISLAND[theme] ?? ISLAND.meadow;
  return (
    <Animated.View style={{ width: size, height, transform: [{ translateY: range(bob, 0, -3) }, { scale: pop }] }}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {lit ? <Animated.View style={[styles.islandGlow, { width: size, height: size, top: height - size, borderRadius: size / 2, opacity: glow ? range(glow, 0.25, 0.55) : 0.4 }]} /> : null}
      <Image source={art[Math.max(0, Math.min(5, stage))]} style={{ width: size, height }} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

/** A reward chest: grey and locked, bouncing and glowing when ready, open with what was in it once opened. Opening swells it once. */
export function ChestArt({ status, size = 64, opening = false }: { status: 'locked' | 'ready' | 'opened'; size?: number; opening?: boolean }) {
  const bounce = useLoop(700, status === 'ready' && !opening);
  const swell = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const open = status === 'opened' || opening;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open || reduce) return;
    swell.setValue(0.82);
    const anim = Animated.spring(swell, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [open, reduce, swell]);
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: range(bounce, 0, -5) }, { scale: swell }] }}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {status === 'ready' ? <View style={[styles.chestGlow, { width: size, height: size, borderRadius: size / 2 }]} /> : null}
      <Image source={CHEST[open ? 'opened' : status]} style={{ width: size, height: size }} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />
    </Animated.View>
  );
}

/** Stars bursting out from the centre, once per `burstKey` change (none with reduced motion). */
export function StarBurst({ burstKey, color = '#F6C945' }: { burstKey: number; color?: string }) {
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!burstKey || reduce) return;
    t.setValue(0);
    const anim = Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [burstKey, reduce, t]);
  if (!burstKey || reduce) return null;
  return (
    <View style={styles.burst} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 8;
        return (
          <Animated.Text key={i} style={[styles.star, { color, opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 60] }) },
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 60] }) },
              { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.2, 0.8] }) },
            ] }]}>★</Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  islandGlow: { position: 'absolute', backgroundColor: '#FFE27A' },
  chestGlow: { position: 'absolute', backgroundColor: '#FFE9A8', opacity: 0.55 },
  burst: { position: 'absolute', left: '50%', top: '45%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  star: { position: 'absolute', fontSize: 20, fontWeight: '900' },
});
