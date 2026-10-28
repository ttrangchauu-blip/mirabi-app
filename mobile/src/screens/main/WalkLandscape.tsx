import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { PetArt, restartFromZero } from '../../components/PetArt';
import { hasSprite, WALK_CYCLE_MS } from '../../petSprites';
import { DayPeriod, useDayPeriod } from '../../components/useDayPeriod';
import { useReduceMotion } from '../../components/useReduceMotion';

const HEIGHT = 140;
const PET_SIZE = 76;
const PET_X = 0.24;  // where the pet's centre sits, as a share of the scene width
const PATH_TOP = 104;
/** A sine-topped band over a strip two scene-widths long. Whole periods per width make the second half repeat the
 * first exactly, so scrolling by one width loops without a jump. It runs past both ends so the SVG clips it cleanly. */
function wave(width: number, base: number, amp: number, periods: number, bottom = HEIGHT, phase = 0) {
  const y = (x: number) => (base + amp * Math.sin((x / width) * periods * 2 * Math.PI + phase)).toFixed(1);
  const end = width * 2 + 4;
  let d = `M-4 ${bottom}`;
  for (let x = -4; x < end; x += 6) d += ` L${x} ${y(x)}`;
  return `${d} L${end} ${y(end)} L${end} ${bottom} Z`;
}

/** The scene's colours and sky details for each part of the day. The layout, path and pet never change; the pet is
 * drawn above every layer, so no colour is ever laid over it. */
type Palette = {
  sky: [string, string, string]; body: 'sun' | 'moon'; bodyTop: number; bodyColor: string; glow: string;
  cloud: string; cloudOpacity: number; stars: boolean; fireflies: boolean;
  hills: [string, string]; meadow: string; trees: [string, string, string, string]; path: [string, string]; front: string;
  pebble: string; flowers: [string, string, string]; petLight?: string;
};
const PALETTES: Record<DayPeriod, Palette> = {
  // Sáng: a soft, pale sky with a low, gentle sun.
  morning: { sky: ['#CDE8F6', '#E6F4F3', '#F8F3E4'], body: 'sun', bodyTop: 22, bodyColor: '#FFE7A3', glow: 'rgba(255,231,163,0.7)',
    cloud: '#FFFFFF', cloudOpacity: 0.9, stars: false, fireflies: false,
    hills: ['#D3E9D6', '#C2E0C6'], meadow: '#A9D4AF', trees: ['#9A7A5C', '#7DB988', '#8CC596', '#73AF7F'], path: ['#EBDDBF', '#F4EAD3'],
    front: '#9ECDA5', pebble: '#D3C29F', flowers: ['#F2A7B6', '#F7D774', '#FFFFFF'] },
  // Trưa: a clear blue sky, the sun high and bright, the greens richer.
  noon: { sky: ['#8DCDF1', '#BDE4F7', '#EAF7FB'], body: 'sun', bodyTop: 8, bodyColor: '#FFF2B0', glow: 'rgba(255,246,196,0.95)',
    cloud: '#FFFFFF', cloudOpacity: 1, stars: false, fireflies: false,
    hills: ['#C4E5C3', '#ACD9AF'], meadow: '#94CC9C', trees: ['#8F6F51', '#6DB17A', '#7FC08A', '#62A570'], path: ['#EEDFC0', '#F8F0DC'],
    front: '#8BC594', pebble: '#D6C49E', flowers: ['#F59AAE', '#FFD95E', '#FFFFFF'] },
  // Chiều: golden light with the first blush of sunset, the sun lower and warmer.
  afternoon: { sky: ['#F2B48C', '#F8D3A2', '#FCEACB'], body: 'sun', bodyTop: 34, bodyColor: '#FFC46B', glow: 'rgba(255,176,92,0.75)',
    cloud: '#FFE6CF', cloudOpacity: 0.85, stars: false, fireflies: false,
    hills: ['#DCD7A8', '#CACF98'], meadow: '#B5CB8C', trees: ['#8E6646', '#94B36E', '#A5C07A', '#86A863'], path: ['#EDD3A8', '#F6E2BE'],
    front: '#A6C283', pebble: '#CDB088', flowers: ['#F29C8F', '#F9CB5C', '#FFF3DE'] },
  // Tối: deep blue sky with a moon and stars; fireflies keep it soft, and a pool of moonlight keeps the pet clear.
  night: { sky: ['#17264D', '#283C6E', '#405784'], body: 'moon', bodyTop: 14, bodyColor: '#FFF3C9', glow: 'rgba(255,243,201,0.45)',
    cloud: '#8E9CC4', cloudOpacity: 0.35, stars: true, fireflies: true,
    hills: ['#2F4A70', '#36567C'], meadow: '#3A6274', trees: ['#4E4352', '#2F5C63', '#386A6E', '#29525A'], path: ['#9C97AE', '#B7B2C6'],
    front: '#33586A', pebble: '#7E7A92', flowers: ['#C9A2C8', '#E8D9A0', '#D8DDF0'], petLight: 'rgba(255,240,196,0.45)' },
};
const PERIOD_LABEL: Record<DayPeriod, string> = { morning: 'buổi sáng', noon: 'buổi trưa', afternoon: 'buổi chiều', night: 'buổi tối' };
const FADE_MS = 1200;

/** Each scrolling layer is a single SVG two widths long (scenery drawn twice), so there is no seam between copies. */
function Strip({ width, children }: { width: number; children: (offset: number) => React.ReactNode }) {
  return <Svg width={width * 2} height={HEIGHT}>{[0, width].map((offset) => <G key={offset}>{children(offset)}</G>)}</Svg>;
}

function Clouds({ width, c }: { width: number; c: Palette }) {
  return <Strip width={width}>{(offset) => [[0.18, 22, 1], [0.58, 36, 0.8], [0.86, 16, 0.65]].map(([x, y, s]) =>
    <G key={x} opacity={c.cloudOpacity} transform={`translate(${offset + width * x} ${y})`}>
      <Ellipse cx={0} cy={0} rx={22 * s} ry={8 * s} fill={c.cloud} />
      <Ellipse cx={-8 * s} cy={-5 * s} rx={11 * s} ry={8 * s} fill={c.cloud} />
      <Ellipse cx={7 * s} cy={-7 * s} rx={13 * s} ry={10 * s} fill={c.cloud} />
    </G>)}</Strip>;
}

function FarHills({ width, c }: { width: number; c: Palette }) {
  return <Svg width={width * 2} height={HEIGHT}>
    <Path d={wave(width, 74, 9, 2, HEIGHT, 0.6)} fill={c.hills[0]} />
    <Path d={wave(width, 86, 6, 3, HEIGHT, 2.1)} fill={c.hills[1]} />
  </Svg>;
}

function Tree({ x, scale = 1, c }: { x: number; scale?: number; c: Palette }) {
  return <G transform={`translate(${x} ${PATH_TOP - 2}) scale(${scale})`}>
    <Rect x={-2} y={-16} width={4} height={16} rx={2} fill={c.trees[0]} />
    <Circle cx={0} cy={-24} r={11} fill={c.trees[1]} />
    <Circle cx={-6} cy={-19} r={8} fill={c.trees[2]} />
    <Circle cx={6} cy={-20} r={8} fill={c.trees[3]} />
  </G>;
}

function Ground({ width, c }: { width: number; c: Palette }) {
  return <Svg width={width * 2} height={HEIGHT}>
    <Path d={wave(width, 97, 4, 2, HEIGHT, 1.2)} fill={c.meadow} />
    {[0, width].map((offset) => {
      const at = (f: number) => offset + width * f;
      return <G key={offset}><Tree x={at(0.14)} c={c} /><Tree x={at(0.67)} scale={0.8} c={c} /><Tree x={at(0.9)} scale={1.1} c={c} /></G>;
    })}
    <Path d={wave(width, PATH_TOP, 1.5, 4, HEIGHT)} fill={c.path[0]} />
    <Path d={wave(width, PATH_TOP + 2, 1.5, 4, PATH_TOP + 5)} fill={c.path[1]} opacity={0.8} />
    <Path d={wave(width, 126, 2, 5, HEIGHT, 0.4)} fill={c.front} />
    {[0, width].map((offset) => {
      const at = (f: number) => offset + width * f;
      return <G key={offset}>
        {[0.08, 0.33, 0.52, 0.79].map((f) => <Ellipse key={f} cx={at(f)} cy={116 + (f * 10) % 5} rx={3.5} ry={1.8} fill={c.pebble} />)}
        {([[0.24, 0], [0.27, 1], [0.45, 2], [0.74, 0], [0.96, 1]] as const).map(([f, i]) =>
          <Circle key={f} cx={at(f)} cy={101} r={2.2} fill={c.flowers[i]} />)}
        {c.fireflies ? [[0.06, 88], [0.4, 80], [0.6, 92], [0.84, 84]].map(([f, y]) =>
          <G key={`fly${f}`}><Circle cx={at(f)} cy={y} r={3.5} fill="rgba(255,233,150,0.25)" /><Circle cx={at(f)} cy={y} r={1.3} fill="#FFE996" /></G>) : null}
      </G>;
    })}
  </Svg>;
}

/** Stars stay put in the sky (they are far away); only at night. */
function Stars({ width }: { width: number }) {
  const stars = [[0.06, 14, 1.2], [0.14, 34, 0.8], [0.27, 10, 1], [0.36, 28, 1.4], [0.47, 16, 0.8], [0.55, 40, 1],
    [0.63, 8, 1.2], [0.71, 30, 0.8], [0.93, 44, 1], [0.97, 18, 0.8]];
  return <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
    {stars.map(([f, y, r]) => <Circle key={f} cx={width * f} cy={y} r={r} fill="#FFFFFF" opacity={0.55 + r * 0.25} />)}
  </Svg>;
}

/** A soft light that fades out to its edge. */
function Glow({ id, color, cx, cy, rx, ry }: { id: string; color: string; cx: number; cy: number; rx: number; ry: number }) {
  return <>
    <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={1} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
    <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
  </>;
}

/** Sun or moon with its glow, top right. The moon is a drawn crescent, so nothing covers the glow behind it. */
function SkyBody({ c, id }: { c: Palette; id: string }) {
  return <Svg width={56} height={56} viewBox="-28 -28 56 56" style={[styles.body, { top: c.bodyTop - 4 }]}>
    <Glow id={`glow-${id}`} color={c.glow} cx={0} cy={0} rx={28} ry={28} />
    {c.body === 'moon'
      ? <Path d="M4 -12.4 A13 13 0 1 0 4 12.4 A16 16 0 0 1 4 -12.4 Z" fill={c.bodyColor} />
      : <Circle cx={0} cy={0} r={13} fill={c.bodyColor} />}
  </Svg>;
}

/** Everything behind the pet for one part of the day. The scrolling layers share the walk's progress values, so two
 * sceneries stacked for a cross-fade stay exactly aligned. */
function Scenery({ c, width, clouds, hills, ground }: {
  c: Palette; width: number; clouds: Animated.Value; hills: Animated.Value; ground: Animated.Value;
}) {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <LinearGradient colors={c.sky} style={StyleSheet.absoluteFill} />
    {c.stars && width ? <Stars width={width} /> : null}
    <SkyBody c={c} id={c.body + c.bodyTop} />
    {width ? <>
      <Scroller width={width} progress={clouds}><Clouds width={width} c={c} /></Scroller>
      <Scroller width={width} progress={hills}><FarHills width={width} c={c} /></Scroller>
      <Scroller width={width} progress={ground}><Ground width={width} c={c} /></Scroller>
    </> : null}
  </View>;
}

/** Slides a two-width strip left by one width per cycle: an endless band of scenery. */
function Scroller({ width, progress, children }: { width: number; progress: Animated.Value; children: React.ReactNode }) {
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width] });
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: width * 2, transform: [{ translateX }] }]}>
    {children}
  </Animated.View>;
}

const GAIT_MS = WALK_CYCLE_MS;  // one left + right step, in step with the drawn walk cycle
const GROUND_MS = 17500;  // path, near hill and trees pass by once per width: an unhurried stroll
const HILLS_MS = 30000;   // far hills, slower: parallax depth
const CLOUDS_MS = 70000;

/** A small landscape the pet walks through, filmed by a camera that follows it: the pet stays in frame while the
 * path, hills and clouds slide past at different speeds, so it reads as walking forward. It stays at one spot on the
 * left; its gait (its drawn walk cycle, or bounce, sway and squash for pets without one; dust at each landing) keeps
 * it from looking pinned. The sky, light and colours follow the local time of day (sáng, trưa, chiều, tối) and
 * cross-fade when the period changes; the pet and its walk animation are untouched by the change. */
export function WalkLandscape({ pet, level, now }: { pet: string; level: number; /** A clock for tests. */ now?: () => Date }) {
  const reduceMotion = useReduceMotion();
  const period = useDayPeriod(now);
  // `shown` is drawn underneath; on a change the new period fades in on top of it, then becomes the one underneath.
  const [shown, setShown] = useState(period);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (period === shown) return;
    if (reduceMotion) { setShown(period); return; }
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) setShown(period); });
    return () => animation.stop();
  }, [period, shown, fade, reduceMotion]);
  const drawnGait = hasSprite(pet, level, 'walk');
  const [width, setWidth] = useState(0);
  const clouds = useRef(new Animated.Value(0)).current;
  const hills = useRef(new Animated.Value(0)).current;
  const ground = useRef(new Animated.Value(0)).current;
  const gait = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const values = [clouds, hills, ground, gait];
    if (reduceMotion || !width) { values.forEach((value) => { value.stopAnimation(); value.setValue(0); }); return; }
    const linear = (value: Animated.Value, duration: number) => Animated.loop(restartFromZero(value, 1, duration));
    const loops = [linear(clouds, CLOUDS_MS), linear(hills, HILLS_MS), linear(ground, GROUND_MS), linear(gait, GAIT_MS)];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [clouds, hills, ground, gait, reduceMotion, width]);

  const steps = [0, 0.25, 0.5, 0.75, 1];
  // A relaxed stroll: only a soft bob and rock. A drawn walk cycle already moves the legs, so it gets even less.
  const hop = drawnGait ? 1.5 : 2;
  const tilt = drawnGait ? 0.6 : 1.2;
  const give = drawnGait ? 0.003 : 0.01;
  const lift = gait.interpolate({ inputRange: steps, outputRange: [0, -hop, 0, -hop, 0] });
  const sway = gait.interpolate({ inputRange: steps, outputRange: ['0deg', `-${tilt}deg`, '0deg', `${tilt}deg`, '0deg'] });
  const squash = gait.interpolate({ inputRange: steps, outputRange: [1 - give, 1 + give, 1 - give, 1 + give, 1 - give] });
  const shadow = gait.interpolate({ inputRange: steps, outputRange: [1, 0.8, 1, 0.8, 1] });
  // A puff of dust kicked back at each landing (gait 0 and 0.5).
  const puffOpacity = gait.interpolate({ inputRange: [0, 0.1, 0.45, 0.5, 0.6, 0.95, 1], outputRange: [0.35, 0.28, 0, 0.35, 0.28, 0, 0.35] });
  const puffX = gait.interpolate({ inputRange: [0, 0.45, 0.5, 0.95, 1], outputRange: [0, -14, 0, -14, 0] });
  const puffScale = gait.interpolate({ inputRange: [0, 0.45, 0.5, 0.95, 1], outputRange: [0.5, 1.25, 0.5, 1.25, 0.5] });
  // Pinned on the left, facing the open road ahead: it keeps walking and never quite gets anywhere.
  const x = Math.max(12, width * PET_X - PET_SIZE / 2);

  const light = PALETTES[period].petLight;

  return <View style={[styles.scene, { backgroundColor: PALETTES[shown].sky[1] }]} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    accessible accessibilityLabel={`Pet đang đi dạo ${PERIOD_LABEL[period]} trên con đường giữa những ngọn đồi`} testID={`walk-scene-${period}`}>
    <Scenery c={PALETTES[shown]} width={width} clouds={clouds} hills={hills} ground={ground} />
    {period !== shown ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <Scenery c={PALETTES[period]} width={width} clouds={clouds} hills={hills} ground={ground} />
    </Animated.View> : null}
    {/* Moonlight on the path where the pet walks, behind it: the pet keeps its own colours and stays easy to see. */}
    {light && width ? <Svg pointerEvents="none" width={140} height={48} style={[styles.petLight, { left: x + PET_SIZE / 2 - 70 }]}>
      <Glow id="pet-light" color={light} cx={70} cy={24} rx={70} ry={24} />
    </Svg> : null}
    {width ? <>
      <Animated.View style={[styles.traveler, { transform: [{ translateX: x }] }]} pointerEvents="none">
        <Animated.View style={[styles.shadow, { transform: [{ scaleX: shadow }] }]} />
        {!reduceMotion ? <Animated.View style={[styles.puff, { opacity: puffOpacity, transform: [{ translateX: puffX }, { scale: puffScale }] }]}>
          <View style={styles.puffDot} /><View style={[styles.puffDot, styles.puffDotSmall]} />
        </Animated.View> : null}
        <Animated.View style={{ transform: [{ translateY: lift }, { rotate: sway }, { scaleY: squash }] }}>
          <PetArt pet={pet} size={PET_SIZE} stage={level} walking={!reduceMotion} />
        </Animated.View>
      </Animated.View>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  scene: { height: HEIGHT, width: '100%', borderRadius: 22, overflow: 'hidden', marginBottom: 12 },
  body: { position: 'absolute', right: 11 },
  petLight: { position: 'absolute', bottom: HEIGHT - PATH_TOP - 30 },
  traveler: { position: 'absolute', left: 0, bottom: HEIGHT - PATH_TOP - 16, width: PET_SIZE, alignItems: 'center', justifyContent: 'flex-end' },
  shadow: { position: 'absolute', bottom: 2, width: 44, height: 8, borderRadius: 99, backgroundColor: 'rgba(84,72,48,0.18)' },
  puff: { position: 'absolute', bottom: 4, left: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  puffDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(214,196,160,0.9)' },
  puffDotSmall: { width: 4, height: 4, borderRadius: 2, marginBottom: 3 },
});
