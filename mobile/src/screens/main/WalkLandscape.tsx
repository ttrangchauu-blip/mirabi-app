import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { PetArt, restartFromZero } from '../../components/PetArt';
import { hasSprite, WALK_CYCLE_MS } from '../../petSprites';
import { DayPeriod } from '../../components/useDayPeriod';
import { ArcPoint, Light, lightAt, moonAt, sunAt, useDaylight } from '../../components/daylight';
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

const PERIOD_LABEL: Record<DayPeriod, string> = { morning: 'buổi sáng', noon: 'buổi trưa', afternoon: 'buổi chiều', night: 'buổi tối' };
/** The sun and moon sit on this line at rise and set. The far hills always cover the sky below HORIZON_CLIP, so the
 * bodies are cut off there and sink behind the hills instead of vanishing. */
const HORIZON_Y = 80;
const HORIZON_CLIP = 86;
const ZENITH_Y = 22;

/** Returns the previous object while the new one has the same values, so memoised layers skip redrawing. */
function useSame<T>(value: T): T {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value;
  return ref.current;
}

const round = (value: number, step: number) => Math.round(value / step) * step;
/** Shadows fall away from the sun: long and to one side when it is low, short and under things at noon, and gone
 * (just a faint soft patch) while it is below the horizon. */
function castBy(sun: ArcPoint) {
  const up = Math.max(0, Math.min(1, sun.altitude / 0.2));
  const low = 1 - Math.max(0, sun.altitude);
  return { dx: round(-(sun.x - 0.5) * 16 * low * up, 0.5), stretch: round(1 + 0.4 * low * up, 0.05) };
}
type Cast = ReturnType<typeof castBy>;

/** Each scrolling layer is a single SVG two widths long (scenery drawn twice), so there is no seam between copies. */
function Strip({ width, children }: { width: number; children: (offset: number) => React.ReactNode }) {
  return <Svg width={width * 2} height={HEIGHT}>{[0, width].map((offset) => <G key={offset}>{children(offset)}</G>)}</Svg>;
}

/** The layers below are memoised: the day–night clock re-renders the scene every few seconds, but their colours only
 * change every half minute or so, and only then are they redrawn. */
const Clouds = React.memo(function Clouds({ width, c }: { width: number; c: Light }) {
  return <Strip width={width}>{(offset) => [[0.18, 22, 1], [0.58, 36, 0.8], [0.86, 16, 0.65]].map(([x, y, s]) =>
    <G key={x} opacity={c.cloudOpacity} transform={`translate(${offset + width * x} ${y})`}>
      <Ellipse cx={0} cy={0} rx={22 * s} ry={8 * s} fill={c.cloud} />
      <Ellipse cx={-8 * s} cy={-5 * s} rx={11 * s} ry={8 * s} fill={c.cloud} />
      <Ellipse cx={7 * s} cy={-7 * s} rx={13 * s} ry={10 * s} fill={c.cloud} />
    </G>)}</Strip>;
});

const FarHills = React.memo(function FarHills({ width, c }: { width: number; c: Light }) {
  return <Svg width={width * 2} height={HEIGHT}>
    <Path d={wave(width, 74, 9, 2, HEIGHT, 0.6)} fill={c.hills[0]} />
    <Path d={wave(width, 86, 6, 3, HEIGHT, 2.1)} fill={c.hills[1]} />
  </Svg>;
});

function Tree({ x, scale = 1, c, cast }: { x: number; scale?: number; c: Light; cast: Cast }) {
  return <G transform={`translate(${x} ${PATH_TOP - 2}) scale(${scale})`}>
    <Ellipse cx={cast.dx} cy={0} rx={10 * cast.stretch} ry={2.2} fill="#2E3B2A" opacity={c.shadow} />
    <Rect x={-2} y={-16} width={4} height={16} rx={2} fill={c.trees[0]} />
    <Circle cx={0} cy={-24} r={11} fill={c.trees[1]} />
    <Circle cx={-6} cy={-19} r={8} fill={c.trees[2]} />
    <Circle cx={6} cy={-20} r={8} fill={c.trees[3]} />
  </G>;
}

const Ground = React.memo(function Ground({ width, c, cast }: { width: number; c: Light; cast: Cast }) {
  return <Svg width={width * 2} height={HEIGHT}>
    <Path d={wave(width, 97, 4, 2, HEIGHT, 1.2)} fill={c.meadow} />
    {[0, width].map((offset) => {
      const at = (f: number) => offset + width * f;
      return <G key={offset}>
        <Tree x={at(0.14)} c={c} cast={cast} /><Tree x={at(0.67)} scale={0.8} c={c} cast={cast} /><Tree x={at(0.9)} scale={1.1} c={c} cast={cast} />
      </G>;
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
        {c.fireflies > 0 ? <G opacity={c.fireflies}>{[[0.06, 88], [0.4, 80], [0.6, 92], [0.84, 84]].map(([f, y]) =>
          <G key={`fly${f}`}><Circle cx={at(f)} cy={y} r={3.5} fill="rgba(255,233,150,0.25)" /><Circle cx={at(f)} cy={y} r={1.3} fill="#FFE996" /></G>)}</G> : null}
      </G>;
    })}
  </Svg>;
});

/** Stars stay put in the sky (they are far away); they come out at dusk and fade as the sky gets light. */
const Stars = React.memo(function Stars({ width, opacity }: { width: number; opacity: number }) {
  const stars = [[0.06, 14, 1.2], [0.14, 34, 0.8], [0.27, 10, 1], [0.36, 28, 1.4], [0.47, 16, 0.8], [0.55, 40, 1],
    [0.63, 8, 1.2], [0.71, 30, 0.8], [0.93, 44, 1], [0.97, 18, 0.8]];
  return <Svg width={width} height={HEIGHT} style={[StyleSheet.absoluteFill, { opacity }]} testID="walk-stars">
    {stars.map(([f, y, r]) => <Circle key={f} cx={width * f} cy={y} r={r} fill="#FFFFFF" opacity={0.55 + r * 0.25} />)}
  </Svg>;
});

/** A soft light that fades out to its edge. */
function Glow({ id, color, opacity = 1, cx, cy, rx, ry }: { id: string; color: string; opacity?: number; cx: number; cy: number; rx: number; ry: number }) {
  return <>
    <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={opacity} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
    <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
  </>;
}

const BODY = 72; // the sun's or moon's square, glow included
/** Below this altitude a body is well under the clip line, so it is not drawn at all. */
const SET = -0.45;
const bodyPlace = (width: number, at: ArcPoint) => ({ transform: [
  { translateX: round(width * (0.07 + 0.86 * at.x) - BODY / 2, 0.1) },
  { translateY: round(HORIZON_Y - at.altitude * (HORIZON_Y - ZENITH_Y) - BODY / 2, 0.1) },
] });

/** The sun and moon on their arcs, with a warm band of light on the horizon around the sun while it is low. Clipped
 * just under the horizon, so they rise and set behind the hills. A soft glow only: never bright enough to glare. */
function SkyBodies({ width, hours, c }: { width: number; hours: number; c: Light }) {
  const sun = sunAt(hours);
  const moon = moonAt(hours);
  const dawnGlow = round(Math.max(0, 1 - Math.abs(sun.altitude) / 0.45) * 0.6, 0.01);
  return <View pointerEvents="none" style={styles.skyBodies}>
    {dawnGlow > 0 ? <Svg width={width} height={HORIZON_CLIP} style={StyleSheet.absoluteFill}>
      <Glow id="walk-horizon" color={c.horizon} opacity={dawnGlow} cx={width * (0.07 + 0.86 * sun.x)} cy={HORIZON_Y} rx={width * 0.5} ry={36} />
    </Svg> : null}
    {c.moonOpacity > 0 && moon.altitude > SET ? <Svg width={BODY} height={BODY} viewBox={`${-BODY / 2} ${-BODY / 2} ${BODY} ${BODY}`}
      style={[styles.body, { opacity: c.moonOpacity }, bodyPlace(width, moon)]} testID="walk-moon">
      <Glow id="walk-moon-glow" color={c.moon} opacity={0.35} cx={0} cy={0} rx={26} ry={26} />
      <Path d="M4 -12.4 A13 13 0 1 0 4 12.4 A16 16 0 0 1 4 -12.4 Z" fill={c.moon} />
    </Svg> : null}
    {sun.altitude > SET ? <Svg width={BODY} height={BODY} viewBox={`${-BODY / 2} ${-BODY / 2} ${BODY} ${BODY}`}
      style={[styles.body, bodyPlace(width, sun)]} testID="walk-sun">
      <Glow id="walk-sun-glow" color={c.sunGlow} opacity={0.5} cx={0} cy={0} rx={BODY / 2} ry={BODY / 2} />
      <Circle cx={0} cy={0} r={12} fill={c.sun} />
    </Svg> : null}
  </View>;
}

/** Everything behind the pet. A single layer whose colours and lights follow the clock: nothing is swapped or
 * remounted as the day goes on, so the scrolling (and the clouds) carry on undisturbed. */
function Scenery({ c, hours, cast, width, clouds, hills, ground }: {
  c: Light; hours: number; cast: Cast; width: number; clouds: Animated.Value; hills: Animated.Value; ground: Animated.Value;
}) {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <LinearGradient colors={c.sky} style={StyleSheet.absoluteFill} />
    {width ? <>
      {c.stars > 0 ? <Stars width={width} opacity={c.stars} /> : null}
      <SkyBodies width={width} hours={hours} c={c} />
      <Scroller width={width} progress={clouds}><Clouds width={width} c={c} /></Scroller>
      <Scroller width={width} progress={hills}><FarHills width={width} c={c} /></Scroller>
      <Scroller width={width} progress={ground}><Ground width={width} c={c} cast={cast} /></Scroller>
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
 * it from looking pinned. The sky follows the local clock continuously (see daylight.ts): the sun rises on the left,
 * crosses on an arc and sets behind the hills on the right, the colours and shadows shift with it, and at night the
 * moon and stars come out. Only colours and the sun and moon move; the pet and its walk animation are untouched. */
export function WalkLandscape({ pet, level, now }: { pet: string; level: number; /** A clock for tests. */ now?: () => Date }) {
  const reduceMotion = useReduceMotion();
  const { hours, period } = useDaylight({ now, smooth: !reduceMotion });
  const c = useSame(lightAt(hours));
  const cast = useSame(castBy(sunAt(hours)));
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

  // The pet is drawn above every layer with no tint, so it keeps its own colours; it never re-renders with the light.
  const petArt = useMemo(() => <PetArt pet={pet} size={PET_SIZE} stage={level} walking={!reduceMotion} />, [pet, level, reduceMotion]);

  return <View style={[styles.scene, { backgroundColor: c.sky[1] }]} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    accessible accessibilityLabel={`Pet đang đi dạo ${PERIOD_LABEL[period]} trên con đường giữa những ngọn đồi`} testID={`walk-scene-${period}`}>
    <Scenery c={c} hours={hours} cast={cast} width={width} clouds={clouds} hills={hills} ground={ground} />
    {/* Moonlight on the path where the pet walks, behind it: the pet keeps its own colours and stays easy to see. */}
    {c.petLight > 0 && width ? <Svg pointerEvents="none" width={140} height={48} style={[styles.petLight, { left: x + PET_SIZE / 2 - 70 }]}>
      <Glow id="pet-light" color="#FFF0C4" opacity={c.petLight} cx={70} cy={24} rx={70} ry={24} />
    </Svg> : null}
    {width ? <>
      <Animated.View style={[styles.traveler, { transform: [{ translateX: x }] }]} pointerEvents="none">
        <View style={[styles.cast, { opacity: c.shadow, transform: [{ translateX: cast.dx }, { scaleX: cast.stretch }] }]}>
          <Animated.View style={[styles.shadow, { transform: [{ scaleX: shadow }] }]} />
        </View>
        {!reduceMotion ? <Animated.View style={[styles.puff, { opacity: puffOpacity, transform: [{ translateX: puffX }, { scale: puffScale }] }]}>
          <View style={styles.puffDot} /><View style={[styles.puffDot, styles.puffDotSmall]} />
        </Animated.View> : null}
        <Animated.View style={{ transform: [{ translateY: lift }, { rotate: sway }, { scaleY: squash }] }}>
          {petArt}
        </Animated.View>
      </Animated.View>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  scene: { height: HEIGHT, width: '100%', borderRadius: 22, overflow: 'hidden', marginBottom: 12 },
  skyBodies: { position: 'absolute', left: 0, right: 0, top: 0, height: HORIZON_CLIP, overflow: 'hidden' },
  body: { position: 'absolute', left: 0, top: 0 },
  petLight: { position: 'absolute', bottom: HEIGHT - PATH_TOP - 30 },
  traveler: { position: 'absolute', left: 0, bottom: HEIGHT - PATH_TOP - 16, width: PET_SIZE, alignItems: 'center', justifyContent: 'flex-end' },
  cast: { position: 'absolute', bottom: 2 },
  shadow: { width: 44, height: 8, borderRadius: 99, backgroundColor: '#544830' },
  puff: { position: 'absolute', bottom: 4, left: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  puffDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(214,196,160,0.9)' },
  puffDotSmall: { width: 4, height: 4, borderRadius: 2, marginBottom: 3 },
});
