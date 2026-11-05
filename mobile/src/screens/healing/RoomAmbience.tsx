import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import type { DayPeriod } from '../../components/useDayPeriod';
import type { Ambience } from '../../life/types';
import { itemArt, keyOf, placedBox, variantOf } from '../../room/art';
import type { Layout, Placement } from '../../room/types';
import { CALM, type Mood, roomLight } from '../../world/atmosphere';
import { useSwing, useWorldMotion } from '../../world/budget';
import { EASE } from '../../world/motion';

/**
 * The room's windows show the sky of the hour on the device's clock (withLiveSky: display only, the owner's curtains
 * kept). On the room's canvas (RoomScene's `underlay`, under the pet, which keeps its own colours): the light of the hour
 * and the sky over the whole room, curtains moving a little, what the weather is doing behind the glass, and a soft glow,
 * fading to nothing at its edge, on its lamps, which come on by themselves at dusk or stay as the user switched them.
 * Góc thư giãn chooses its own scene for the same layers. Nothing is added where the room has no window or lamp, and
 * nothing here is ever saved: the room's layout stays as it is.
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

export const isLamp = (item: string) => !!LAMPS[item];
/** Whether a lamp is lit: the user's hand first, else by itself in the evening, under a dark sky and in the cosy scenes. */
export const lampLit = (p: Placement, sky: Sky, mood: Mood, ambience: Ambience | null, switched: Record<string, boolean> = {}) =>
  switched[keyOf(p)] ?? (sky !== 'morning' || mood.gloom >= 0.6 || (!!ambience && WARM.includes(ambience)));

export const RoomAmbience = memo(function RoomAmbience({ layout, ambience, sky, k, hours, mood = CALM, lamps: switched, ownCurtains }: {
  layout: Layout; /** Góc thư giãn's scene; null is the room as it really is outside. */ ambience: Ambience | null; sky: Sky; k: number;
  hours?: number; mood?: Mood; /** Lamps switched by hand. */ lamps?: Record<string, boolean>;
  /** Windows whose curtains are drawn and moved elsewhere (the focus room's pictures). */ ownCurtains?: (p: Placement) => boolean;
}) {
  const windows = layout.items.filter((p) => GLASS[p.item]);
  const lamps = layout.items.filter((p) => LAMPS[p.item]);
  const wash = hours !== undefined && !ambience ? roomLight(hours, mood) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      testID={ambience ? `room-ambience-${ambience}` : 'room-life'}>
      {windows.map((p) => <WindowWeather key={keyOf(p)} p={p} k={k} ownCurtains={ownCurtains?.(p)} ambience={ambience} night={sky === 'starry'} rainy={ambience === 'rainy_day' || (!ambience && mood.rain > 0.3)} wind={mood.wind} cover={mood.cover} items={layout.items} />)}
      {/* Over the windows and curtains too (they are in the room), under the lamps (their light is what stands out). */}
      {wash && wash.opacity > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: wash.color, opacity: wash.opacity }]} testID="room-light" /> : null}
      {lamps.map((p) => <LampGlow key={keyOf(p)} p={p} k={k} on={lampLit(p, sky, mood, ambience, switched)} />)}
    </View>
  );
});

function useBreath(duration: number, delay = 0) {
  const reduce = !useWorldMotion().animate;
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
  const reduce = !useWorldMotion().animate;
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

/** A lamp's light: a radial gradient that is fully transparent at its edge, breathing very slowly. Switching on it
 * catches, dips and steadies, like a real bulb warming up; off it fades in a moment. */
function LampGlow({ p, k, on }: { p: Placement; k: number; on: boolean }) {
  const lamp = LAMPS[p.item];
  const breath = useBreath(3200);
  const { animate } = useWorldMotion();
  const power = useRef(new Animated.Value(on ? 1 : 0)).current;
  const was = useRef(on);
  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    if (!animate) { power.setValue(on ? 1 : 0); return; }
    const run = on ? Animated.sequence([
      Animated.timing(power, { toValue: 0.75, duration: 90, easing: EASE.ui, useNativeDriver: true }),
      Animated.timing(power, { toValue: 0.3, duration: 70, easing: EASE.light, useNativeDriver: true }),
      Animated.timing(power, { toValue: 1, duration: 240, easing: EASE.light, useNativeDriver: true }),
    ]) : Animated.timing(power, { toValue: 0, duration: 260, easing: EASE.light, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [on, animate, power]);
  const r = lamp.r * k;
  const cx = (p.x + (p.flip ? -lamp.dx : lamp.dx)) * k;
  const cy = (p.y + lamp.dy) * k;
  const id = `glow-${p.item}-${Math.round(p.x)}-${Math.round(p.y)}`;
  return (
    <Animated.View testID={on ? 'room-lamp-on' : 'room-lamp-off'} style={{ position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, opacity: power }}>
      <Animated.View style={{ flex: 1, opacity: breath ? breath.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) : 0.85 }}>
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
    </Animated.View>
  );
}

const DROPS = [[0.12, 0], [0.3, 0.45], [0.5, 0.15], [0.68, 0.6], [0.86, 0.3], [0.22, 0.75], [0.6, 0.85], [0.78, 0.05], [0.4, 0.62]] as const;
const STARS = [[0.2, 0.18], [0.42, 0.08], [0.7, 0.3], [0.28, 0.42], [0.82, 0.12], [0.58, 0.5]] as const;

/** What happens behind one window's glass: rain (with a grey sky veil), stars twinkling (only at night), a leaf drifting
 * down, or by day a cloud passing. Then the curtains in front of it, stirring. */
function WindowWeather({ p, k, ownCurtains = false, ambience, night, rainy, wind, cover, items }: { p: Placement; k: number; ownCurtains?: boolean; ambience: Ambience | null; night: boolean; rainy: boolean; wind: number; cover: number; items: Placement[] }) {
  const g = GLASS[p.item];
  const w = (g.x1 - g.x0) * k, h = (g.y1 - g.y0) * k;
  const shape = g.round ? { borderRadius: w / 2 } : { borderTopLeftRadius: w / 2, borderTopRightRadius: w / 2 };
  const { count } = useWorldMotion();
  return (
    <>
      <View style={[s.glass, shape, { left: (p.x + g.x0) * k, top: (p.y + g.y0) * k, width: w, height: h }]}>
        {rainy ? <>
          <View style={[StyleSheet.absoluteFill, s.rainVeil]} />
          {DROPS.slice(0, count(DROPS.length)).map(([x, d], i) => <Drop key={i} x={x * w} h={h} delay={d * 900} k={k} />)}
        </> : null}
        {night && !rainy ? STARS.slice(0, cover > 0.7 ? 1 : STARS.length).map(([x, y], i) => <Twinkle key={i} x={x * w} y={y * h} delay={i * 450} k={k} />) : null}
        {ambience === 'forest_retreat' ? [0.3, 0.7].map((x, i) => <Leaf key={i} x={x * w} h={h} delay={i * 2600} k={k} />) : null}
        {!night && !rainy && !ambience ? <PassingCloud w={w} h={h} k={k} /> : null}
      </View>
      {g.round || ownCurtains ? null : <Curtains p={p} k={k} wind={wind} items={items} />}
    </>
  );
}

/** A small cloud crossing the glass, slowly, then a long clear spell. */
function PassingCloud({ w, h, k }: { w: number; h: number; k: number }) {
  const fall = useFall(26000, 1500);
  const size = 18 * k;
  return <Animated.View style={[s.cloud, { top: h * 0.2, width: size * 1.8, height: size * 0.62, borderRadius: size,
    transform: [{ translateX: fall ? fall.interpolate({ inputRange: [0, 1], outputRange: [-size * 2, w + size] }) : w * 0.2 }] }]} />;
}

/** The window's own curtains (room-art.json: x -92 to -60 on each side, tied back at y 6): the part under the tie is
 * drawn again, exactly over itself, and stirs from the tie as air comes in. At rest it can't be told from the drawing;
 * above the tie nothing moves. */
const DRAPE = { left: 54, right: 94, top: 4, height: 84 };
/** How far down a curtain may stir (canvas units under its window's anchor): to the first thing standing in front of it,
 * which the room's drawing puts over the curtain and this layer can't. Null when that leaves too little to be seen. */
export function drapeLength(window: Placement, side: number, items: Placement[]) {
  const left = window.x + (side > 0 ? DRAPE.left : -DRAPE.right), right = left + (DRAPE.right - DRAPE.left);
  const top = window.y + DRAPE.top;
  let length: number = DRAPE.height;
  for (const item of items) {
    if (item === window || keyOf(item) === keyOf(window) || !itemArt(item.item)) continue;
    const box = placedBox(item);
    if (!box) continue;
    const [x0, y0, x1, y1] = box;
    if (x0 < right && x1 > left && y1 > top && y0 < top + length) length = Math.min(length, y0 - top);
  }
  return length >= 24 ? length : null;
}

function Curtains({ p, k, wind, items }: { p: Placement; k: number; wind: number; items: Placement[] }) {
  const art = itemArt(p.item);
  const colors = art ? variantOf(art, p.variant).colors : null;
  if (!colors?.curtain) return null;
  return <>{[-1, 1].map((side) => {
    const length = drapeLength(p, side, items);
    return length === null ? null : <Drape key={side} side={side} x={p.x} y={p.y} k={k} length={length} color={colors.curtain} fold={colors.curtain2 ?? colors.curtain} wind={wind} />;
  })}</>;
}
function Drape({ side, x, y, k, length, color, fold, wind }: { side: number; x: number; y: number; k: number; length: number; color: string; fold: string; wind: number }) {
  const swing = useSwing({ ms: 2600 + (side > 0 ? 500 : 0), rest: [300, 2800] });
  const reach = Math.min(1.6, wind);
  const width = (DRAPE.right - DRAPE.left) * k, height = length * k;
  const left = (x + (side > 0 ? DRAPE.left : -DRAPE.right)) * k;
  return (
    <Animated.View testID="room-curtain" style={{ position: 'absolute', left, top: (y + DRAPE.top) * k, width, height, overflow: 'hidden', transformOrigin: '50% 3%', transform: [
      { rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: [`${-1.5 * reach}deg`, `${1.5 * reach}deg`] }) },
      { skewX: swing.interpolate({ inputRange: [-1, 1], outputRange: [`${1.2 * reach}deg`, `${-1.2 * reach}deg`] }) },
    ] }}>
      {/* Canvas units of the left curtain; the right one is its mirror. */}
      <Svg width={width} height={DRAPE.height * k} viewBox={`${-DRAPE.right} ${DRAPE.top} ${DRAPE.right - DRAPE.left} ${DRAPE.height}`} style={side > 0 ? s.mirror : undefined}>
        <Path d="M-84.8 6Q-85.8 42-88 78Q-76 84-62 78Q-67 42-66.7 6Z" fill={color} />
        <Path d="M-77.4 8Q-76.6 42-78 76M-68.4 8Q-68.6 42-70 78" stroke={fold} strokeWidth={2} strokeOpacity={0.7} fill="none" />
        <Path d="M-92 6Q-74 14-60 4" stroke={fold} strokeWidth={4} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
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
  mirror: { transform: [{ scaleX: -1 }] },
  star: { position: 'absolute', backgroundColor: '#FFF7D6' },
  cloud: { position: 'absolute', left: 0, backgroundColor: 'rgba(255,255,255,0.8)' },
  leaf: { position: 'absolute', top: 0 },
});
