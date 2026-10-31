import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { DayPeriod } from '../../components/useDayPeriod';
import type { Ambience } from '../../life/types';
import type { Layout, Placement } from '../../room/types';

/**
 * The room's windows show the sky of the hour on the device's clock (withLiveSky: display only, the owner's curtains
 * kept). Góc thư giãn adds to the room's canvas (RoomScene's `underlay`): rain / leaves behind the glass of its own
 * windows, stars twinkling there at night, and a soft glow, fading to nothing at its edge, on its own lamps. Nothing is
 * added where the room has no window or lamp.
 */

export type Sky = 'morning' | 'sunset' | 'starry';
/** The window sky (a window variant of the room catalog) for a part of the day: sáng and trưa, chiều, tối. */
export const skyOf = (period: DayPeriod): Sky => (period === 'night' ? 'starry' : period === 'afternoon' ? 'sunset' : 'morning');
/** The glass of each window item, around its anchor, in canvas units (the frames are symmetric, so flipping is the same). */
const GLASS: Record<string, { x0: number; y0: number; x1: number; y1: number; round: boolean }> = {
  window: { x0: -46, y0: -64, x1: 46, y1: 62, round: false },
  window_round: { x0: -40, y0: -40, x1: 40, y1: 40, round: true },
};
/** Where each lamp's light comes from (around its anchor), and how far it reaches. */
const LAMPS: Record<string, { dx: number; dy: number; r: number; color: string }> = {
  floor_lamp: { dx: 0, dy: -150, r: 90, color: '#FFD9A0' },
  desk_lamp: { dx: 6, dy: -36, r: 60, color: '#FFE3A8' },
  night_lamp: { dx: 0, dy: -18, r: 48, color: '#FFE7B8' },
  mushroom_lamp: { dx: 0, dy: -30, r: 56, color: '#FFD6C2' },
  thunder_lamp: { dx: -2, dy: -26, r: 52, color: '#FFF2A8' },
  flame_lamp: { dx: 0, dy: -26, r: 52, color: '#FFC98A' },
  lantern_shelf: { dx: 0, dy: -10, r: 64, color: '#FFE0A0' },
  fairy_lights: { dx: 0, dy: 6, r: 80, color: '#FFF0B8' },
};
const WARM: Ambience[] = ['cozy_night', 'rainy_day', 'starry_night'];

/** The room with its windows showing `sky` (and their own curtains). Only for drawing; the saved room is unchanged. */
export function withLiveSky(layout: Layout, sky: Sky): Layout {
  if (!layout.items.some((p) => GLASS[p.item])) return layout;
  return { ...layout, items: layout.items.map((p) => (GLASS[p.item] ? { ...p, variant: `${p.variant.split('~')[0]}~${sky}` } : p)) };
}

export const RoomAmbience = memo(function RoomAmbience({ layout, ambience, sky, k }: { layout: Layout; ambience: Ambience; sky: Sky; k: number }) {
  const windows = layout.items.filter((p) => GLASS[p.item]);
  // Lamps are on in the evening, and in the cosy scenes whatever the hour.
  const lamps = sky !== 'morning' || WARM.includes(ambience) ? layout.items.filter((p) => LAMPS[p.item]) : [];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      testID={`room-ambience-${ambience}`}>
      {lamps.map((p, i) => <LampGlow key={`lamp-${i}`} p={p} k={k} />)}
      {windows.map((p, i) => <WindowWeather key={`win-${i}`} p={p} k={k} ambience={ambience} night={sky === 'starry'} />)}
    </View>
  );
});

function useBreath(duration: number, delay = 0) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (reduce) return;
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(Animated.sequence([Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing: ease, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: ease, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [reduce, duration, delay, v]);
  return reduce ? null : v;
}

function useFall(duration: number, delay: number) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [reduce, duration, delay, v]);
  return reduce ? null : v;
}

/** A lamp's light: a radial gradient that is fully transparent at its edge, breathing very slowly. */
function LampGlow({ p, k }: { p: Placement; k: number }) {
  const lamp = LAMPS[p.item];
  const breath = useBreath(3200);
  const r = lamp.r * k;
  const cx = (p.x + (p.flip ? -lamp.dx : lamp.dx)) * k;
  const cy = (p.y + lamp.dy) * k;
  const id = `glow-${p.item}-${Math.round(p.x)}-${Math.round(p.y)}`;
  return (
    <Animated.View style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2,
      opacity: breath ? breath.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) : 0.85 }}>
      <Svg width={r * 2} height={r * 2}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={lamp.color} stopOpacity="0.5" />
            <Stop offset="0.45" stopColor={lamp.color} stopOpacity="0.18" />
            <Stop offset="1" stopColor={lamp.color} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={r} cy={r} rx={r} ry={r} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const DROPS = [[0.12, 0], [0.3, 0.45], [0.5, 0.15], [0.68, 0.6], [0.86, 0.3], [0.22, 0.75], [0.6, 0.85], [0.78, 0.05], [0.4, 0.62]] as const;
const STARS = [[0.2, 0.18], [0.42, 0.08], [0.7, 0.3], [0.28, 0.42], [0.82, 0.12], [0.58, 0.5]] as const;

/** What happens behind one window's glass: rain (with a grey sky veil), stars twinkling (only at night), or a leaf
 * drifting down. */
function WindowWeather({ p, k, ambience, night }: { p: Placement; k: number; ambience: Ambience; night: boolean }) {
  const g = GLASS[p.item];
  const w = (g.x1 - g.x0) * k, h = (g.y1 - g.y0) * k;
  const shape = g.round ? { borderRadius: w / 2 } : { borderTopLeftRadius: w / 2, borderTopRightRadius: w / 2 };
  return (
    <View style={[s.glass, shape, { left: (p.x + g.x0) * k, top: (p.y + g.y0) * k, width: w, height: h }]}>
      {ambience === 'rainy_day' ? <>
        <View style={[StyleSheet.absoluteFill, s.rainVeil]} />
        {DROPS.map(([x, d], i) => <Drop key={i} x={x * w} h={h} delay={d * 900} k={k} />)}
      </> : null}
      {night && ambience !== 'rainy_day'
        ? STARS.map(([x, y], i) => <Twinkle key={i} x={x * w} y={y * h} delay={i * 450} k={k} />) : null}
      {ambience === 'forest_retreat' ? [0.3, 0.7].map((x, i) => <Leaf key={i} x={x * w} h={h} delay={i * 2600} k={k} />) : null}
    </View>
  );
}

function Drop({ x, h, delay, k }: { x: number; h: number; delay: number; k: number }) {
  const fall = useFall(800, delay);
  return <Animated.View style={[s.drop, { left: x, width: Math.max(1, 1.2 * k), height: 10 * k,
    transform: [{ translateY: fall ? fall.interpolate({ inputRange: [0, 1], outputRange: [-12 * k, h] }) : h * 0.4 }] }]} />;
}

function Twinkle({ x, y, delay, k }: { x: number; y: number; delay: number; k: number }) {
  const t = useBreath(1800, delay);
  const size = 2.6 * k;
  return <Animated.View style={[s.star, { left: x, top: y, width: size, height: size, borderRadius: size / 2,
    opacity: t ? t.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.95] }) : 0.7 }]} />;
}

function Leaf({ x, h, delay, k }: { x: number; h: number; delay: number; k: number }) {
  const fall = useFall(5200, delay);
  return (
    <Animated.Text style={[s.leaf, { left: x, fontSize: 9 * k, transform: [
      { translateY: fall ? fall.interpolate({ inputRange: [0, 1], outputRange: [-10 * k, h] }) : h * 0.5 },
      { rotate: fall ? fall.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '200deg'] }) : '0deg' },
    ] }]}>🍃</Animated.Text>
  );
}

const s = StyleSheet.create({
  glass: { position: 'absolute', overflow: 'hidden' },
  rainVeil: { backgroundColor: 'rgba(96,116,140,0.35)' },
  drop: { position: 'absolute', top: 0, borderRadius: 1, backgroundColor: 'rgba(235,244,255,0.85)' },
  star: { position: 'absolute', backgroundColor: '#FFF7D6' },
  leaf: { position: 'absolute', top: 0 },
});
