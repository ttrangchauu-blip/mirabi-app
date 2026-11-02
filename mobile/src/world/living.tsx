import React, { memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Ellipse, G, Path } from 'react-native-svg';
import { PetArt } from '../components/PetArt';
import { Text } from '../components/Typography';
import { petById } from '../pets';
import { hasSprite, WALK_CYCLE_MS } from '../petSprites';
import { elevation, glass, radius, type as typeScale } from '../ui/design';
import { appTheme as t } from '../theme';
import { useEased, useSwing, useTravel, useWorldMotion } from './budget';
import { type ActName, actTransform, EASE, newActValues, PET_ACTS, playAct } from './motion';
import { artFor, type PetState, usePetMachine } from './petMachine';
import { describeWeather, useWeather } from './weather';

/** The living parts of a scene. Each loops on its own clock, with its own speed, so nothing moves in step. All of them
 * go still with "reduce motion", stop in the background and draw fewer of themselves on a weak device (budget.ts). */

// ------------------------------------------------------------------------------------------------ plants
/** Swaying from its foot, as hard as the wind blows. `depth` is how much it can bend. */
export function Sway({ children, wind, depth = 3, ms = 2600, rest, style }: {
  children: React.ReactNode; wind: number; depth?: number; ms?: number; rest?: [number, number]; style?: object;
}) {
  const swing = useSwing({ ms, rest });
  const gust = useEased(wind, 1800);
  const bend = useMemo(() => Animated.multiply(swing, gust).interpolate({ inputRange: [-2, 2], outputRange: [`${-depth * 2}deg`, `${depth * 2}deg`] }), [swing, gust, depth]);
  return <Animated.View style={[style, { transformOrigin: '50% 100%', transform: [{ rotate: bend }] }]} renderToHardwareTextureAndroid shouldRasterizeIOS>{children}</Animated.View>;
}

const TUFT = 'M2 22 Q3 12 1 4 M6 22 Q6 10 8 1 M10 22 Q11 14 15 7';
/** A few blades of grass; each tuft keeps its own time. */
export const GrassTuft = memo(function GrassTuft({ x, y, scale = 1, color, wind, ms }: { x: number; y: number; scale?: number; color: string; wind: number; ms: number }) {
  const size = 22 * scale;
  return (
    <Sway wind={wind} depth={6} ms={ms} rest={[200, 2200]} style={{ position: 'absolute', left: x - size / 2, top: y - size, width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 16 22"><Path d={TUFT} stroke={color} strokeWidth={1.8} strokeLinecap="round" fill="none" /></Svg>
    </Sway>
  );
});

/** Grass over a stretch of ground, placed by index so it never reshuffles (`spots`: [x share, y share, scale]). */
export const GrassField = memo(function GrassField({ width, height, top, color, wind, spots }: {
  width: number; height: number; top: number; color: string; wind: number; spots: readonly (readonly [number, number, number])[];
}) {
  const { count } = useWorldMotion();
  const shown = spots.slice(0, count(spots.length));
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {shown.map(([x, y, scale], i) => <GrassTuft key={i} x={x * width} y={top + y * height} scale={scale} color={color} wind={wind} ms={1900 + (i * 373) % 1500} />)}
  </View>;
});

// ------------------------------------------------------------------------------------------------ water
/** One ring spreading on water and gone; a pause before the next, longer than the ring. */
function Ripple({ x, y, size, ms, wait, color = 'rgba(255,255,255,0.75)' }: { x: number; y: number; size: number; ms: number; wait: number; color?: string }) {
  const { animate } = useWorldMotion();
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) { ring.setValue(0.4); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let run: Animated.CompositeAnimation | null = null;
    const next = () => {
      if (stopped) return;
      ring.setValue(0);
      run = Animated.timing(ring, { toValue: 1, duration: ms, easing: EASE.water, useNativeDriver: true });
      run.start(({ finished }) => { if (finished && !stopped) timer = setTimeout(next, wait * (0.6 + Math.random() * 0.8)); });
    };
    timer = setTimeout(next, Math.random() * wait);
    return () => { stopped = true; run?.stop(); if (timer) clearTimeout(timer); };
  }, [animate, ms, wait, ring]);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: x - size / 2, top: y - size * 0.2, width: size, height: size * 0.4, borderRadius: size,
    borderWidth: 1.2, borderColor: color,
    opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }] }} />;
}

/** A pond with its rings and a highlight drifting over it. Rain makes more rings. */
export const Pond = memo(function Pond({ x, y, width, height, water, edge, rain, wind }: {
  x: number; y: number; width: number; height: number; water: string; edge: string; rain: boolean; wind: number;
}) {
  const { count } = useWorldMotion();
  const drift = useSwing({ ms: 5200 + (1 - Math.min(1, wind)) * 2600, rest: [0, 1400] });
  const rings = useMemo(() => [[0.28, 0.42], [0.62, 0.6], [0.45, 0.3], [0.74, 0.38], [0.2, 0.62], [0.52, 0.72]], []);
  const shown = rings.slice(0, count(rain ? 6 : 2));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width, height }} testID="garden-pond">
      <Svg width={width} height={height}>
        <Ellipse cx={width / 2} cy={height / 2 + 2} rx={width / 2} ry={height / 2 - 2} fill={edge} />
        <Ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 4} ry={height / 2 - 6} fill={water} />
        {/* The far bank's shade on the water, and a few lily pads. */}
        <Ellipse cx={width / 2} cy={height * 0.3} rx={width * 0.4} ry={height * 0.14} fill="#0A3A55" opacity={0.1} />
        <Ellipse cx={width * 0.74} cy={height * 0.62} rx={width * 0.07} ry={height * 0.07} fill="#6FB678" />
        <Ellipse cx={width * 0.64} cy={height * 0.72} rx={width * 0.05} ry={height * 0.05} fill="#7FC486" />
      </Svg>
      <Animated.View style={[s.shine, { left: width * 0.24, top: height * 0.32, width: width * 0.34, height: Math.max(3, height * 0.09),
        transform: [{ translateX: drift.interpolate({ inputRange: [-1, 1], outputRange: [-width * 0.08, width * 0.1] }) }] }]} />
      {shown.map(([fx, fy], i) => <Ripple key={i} x={fx * width} y={fy * height} size={width * (rain ? 0.22 : 0.36)} ms={rain ? 1100 : 2600} wait={rain ? 500 : 3200} />)}
    </View>
  );
});

// ------------------------------------------------------------------------------------------------ weather
const FAR = 0.55;
/** One drop falling the whole height, on its own clock; far drops are thin, slow and dim, near ones the opposite, which
 * is what gives rain its depth. */
function Drop({ x, height, ms, near, delay, slant }: { x: number; height: number; ms: number; near: boolean; delay: number; slant: number }) {
  const fall = useTravel({ ms, delay });
  const len = near ? 18 : 10;
  return <Animated.View pointerEvents="none" style={[near ? s.dropNear : s.dropFar, { left: x, height: len, transform: [
    { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-len - 10, height + 10] }) },
    { translateX: fall.interpolate({ inputRange: [0, 1], outputRange: [0, slant * height] }) },
    { rotate: `${Math.atan(slant) * -57.3}deg` },
  ] }]} />;
}

/** Rain over a scene, in two depths, with rings where it lands (`ground`: where the ground starts, as a share). Slanted
 * by the wind. Fades in and out instead of switching. */
export const Rain = memo(function Rain({ width, height, strength, wind, ground = 0.6 }: { width: number; height: number; strength: number; wind: number; ground?: number }) {
  const { animate, count } = useWorldMotion();
  const opacity = useEased(Math.min(1, strength), 1500);
  const slant = Math.min(0.28, wind * 0.14);
  const drops = useMemo(() => Array.from({ length: 40 }, (_, i) => ({ x: (i * 0.618 % 1) * (width + height * slant), near: i % 3 === 0, ms: (i % 3 === 0 ? 620 : 980) + (i * 53) % 220, delay: (i * 137) % 900 })), [width, height, slant]);
  const rings = useMemo(() => Array.from({ length: 7 }, (_, i) => [(i * 0.382 + 0.08) % 1, ground + ((i * 0.57) % 1) * (0.98 - ground)]), [ground]);
  if (strength <= 0 || !width || !height) return null;
  const shown = drops.slice(0, count(strength > 1.5 ? 40 : 28));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]} testID="weather-rain">
    <View style={[StyleSheet.absoluteFill, s.rainVeil]} />
    {animate ? shown.map((d, i) => <Drop key={i} x={d.x - height * slant} height={height} ms={d.ms} near={d.near} delay={d.delay} slant={slant} />) : null}
    {rings.slice(0, count(rings.length)).map(([fx, fy], i) => <Ripple key={i} x={fx * width} y={fy * height} size={30} ms={700} wait={900} color="rgba(235,245,255,0.7)" />)}
  </Animated.View>;
});

function Flake({ x, height, ms, delay, size }: { x: number; height: number; ms: number; delay: number; size: number }) {
  const fall = useTravel({ ms, delay });
  const swing = useSwing({ ms: 1900 });
  return <Animated.View pointerEvents="none" style={[s.flake, { left: x, width: size, height: size, borderRadius: size / 2, transform: [
    { translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-10, height + 10] }) },
    { translateX: swing.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) },
  ] }]} />;
}

export const Snow = memo(function Snow({ width, height, strength }: { width: number; height: number; strength: number }) {
  const { animate, count } = useWorldMotion();
  const opacity = useEased(Math.min(1, strength), 1500);
  const flakes = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ x: (i * 0.618 % 1) * width, ms: 4200 + (i * 211) % 2600, delay: (i * 397) % 4000, size: 2.5 + (i % 3) * 1.4 })), [width]);
  if (strength <= 0 || !width) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]} testID="weather-snow">
    {animate ? flakes.slice(0, count(22)).map((f, i) => <Flake key={i} x={f.x} height={height} ms={f.ms} delay={f.delay} size={f.size} />) : null}
  </Animated.View>;
});

/** Fog, a pale band low over the land, drifting a little. */
export const Fog = memo(function Fog({ height, strength, top = 0.25 }: { height: number; strength: number; top?: number }) {
  const opacity = useEased(strength * 0.55, 2000);
  const drift = useSwing({ ms: 9000 });
  if (strength <= 0) return null;
  return <Animated.View pointerEvents="none" style={[s.fog, { top: height * top, height: height * 0.5, opacity,
    transform: [{ translateX: drift.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }) }] }]} testID="weather-fog" />;
});

/** Clouds passing slowly, two layers at different speeds; how many follows the cloud cover. */
export const CloudDeck = memo(function CloudDeck({ width, top, color, opacity, cover, scale = 1.5 }: { width: number; top: number; color: string; opacity: number; cover: number; scale?: number }) {
  const { count } = useWorldMotion();
  const far = useTravel({ ms: 150_000 });
  const near = useTravel({ ms: 90_000 });
  const spots = useMemo(() => [[0.12, 0, 0.85, 0], [0.62, 22, 1, 1], [0.38, 44, 0.7, 0], [0.88, 12, 0.8, 1], [0.24, 66, 1.05, 1], [0.74, 58, 0.75, 0]] as const, []);
  const wanted = Math.round(1 + cover * 5);
  const shown = spots.slice(0, count(wanted));
  if (!width) return null;
  const layer = (index: number, progress: Animated.Value) => (
    <Animated.View key={index} pointerEvents="none" style={[StyleSheet.absoluteFill, { width: width * 2, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] }]}>
      <Svg width={width * 2} height={top + 150}>
        {[0, width].map((offset) => <G key={offset}>{shown.filter((c) => c[3] === index).map(([x, y, k]) => {
          const size = k * scale;
          return <G key={x} opacity={opacity * (index ? 1 : 0.8)} transform={`translate(${offset + width * x} ${top + y})`}>
            <Ellipse cx={0} cy={0} rx={24 * size} ry={8 * size} fill={color} />
            <Ellipse cx={-9 * size} cy={-5 * size} rx={12 * size} ry={8 * size} fill={color} />
            <Ellipse cx={8 * size} cy={-7 * size} rx={14 * size} ry={10 * size} fill={color} />
          </G>;
        })}</G>)}
      </Svg>
    </Animated.View>
  );
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{layer(0, far)}{layer(1, near)}</View>;
});

function Firefly({ x, y, ms, delay }: { x: number; y: number; ms: number; delay: number }) {
  const glow = useSwing({ ms: ms * 0.5, rest: [400, 2400] });
  const wander = useSwing({ ms });
  const drift = useSwing({ ms: ms * 1.4 });
  return <Animated.View pointerEvents="none" style={[s.fly, { left: x, top: y,
    opacity: glow.interpolate({ inputRange: [-1, 1], outputRange: [0, 1] }),
    transform: [{ translateX: wander.interpolate({ inputRange: [-1, 1], outputRange: [-16, 16] }) }, { translateY: drift.interpolate({ inputRange: [-1, 1], outputRange: [-10, 10] }) }] }]} key={delay}>
    <View style={s.flyGlow} /><View style={s.flyDot} />
  </Animated.View>;
}

/** Night: fireflies over the land, glowing and going dark, never all at once. */
export const Fireflies = memo(function Fireflies({ width, top, height, strength }: { width: number; top: number; height: number; strength: number }) {
  const { count, animate } = useWorldMotion();
  const flies = useMemo(() => [[0.12, 0.2], [0.82, 0.12], [0.34, 0.5], [0.62, 0.34], [0.9, 0.62], [0.2, 0.78], [0.5, 0.86]], []);
  if (strength <= 0.05 || !width || !animate) return null;
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: strength }]} testID="weather-fireflies">
    {flies.slice(0, count(7)).map(([x, y], i) => <Firefly key={i} x={x * width} y={top + y * height} ms={3100 + (i * 613) % 1900} delay={i} />)}
  </View>;
});

// ------------------------------------------------------------------------------------------------ the pet
export type LivingPetHandle = {
  /** Plays an act; resolves when it is done. */ act: (name: ActName) => Promise<void>;
  /** Walks to a point of the scene at its strolling pace, feet in step with the ground; resolves on arrival. */ walkTo: (x: number, y: number) => Promise<void>;
};

/** Points walked per full loop of the walk strip (two steps), as a share of the pet's size. */
const STRIDE_SHARE = 0.62;

/**
 * The pet in an outdoor scene: its own artwork with its drawn strips (never altered), breathing from its feet, a touch
 * of its element around it, and acts on top. Where it stands (`x`, `y`) is its feet: its baseline never moves whatever
 * it is doing. Walking moves it by distance and turns the strip by the same distance, so its feet don't slide.
 */
export const LivingPet = React.forwardRef<LivingPetHandle, {
  pet: string; level: number; size: number; x: number; y: number;
  /** Soft contact shadow: its offset and stretch follow the sun; `opacity` the light. */ shadow?: { dx: number; stretch: number; opacity: number };
  /** Driven from outside (the road going past on a walk). */ phase?: Animated.Value; walking?: boolean; facing?: 1 | -1; initialState?: PetState;
}>(function LivingPet({ pet, level, size, x, y, shadow, phase, walking = false, facing = 1, initialState = 'idle' }, ref) {
  const { animate } = useWorldMotion();
  const [state, send] = usePetMachine(initialState);
  const values = useRef(newActValues()).current;
  const left = useRef(new Animated.Value(x - size / 2)).current;
  const top = useRef(new Animated.Value(y - size)).current;
  const stride = useRef(new Animated.Value(0)).current;
  const pose = useRef({ x, y });
  const [turn, setTurn] = useState<1 | -1>(facing);
  useEffect(() => { setTurn(facing); }, [facing]);
  useEffect(() => {
    if (pose.current.x === x && pose.current.y === y) return;
    pose.current = { x, y };
    left.setValue(x - size / 2); top.setValue(y - size);
  }, [x, y, size, left, top]);
  // The walk strip while something outside moves it, or while it walks by itself.
  useEffect(() => { send(walking ? 'WALK' : 'ARRIVE'); }, [walking, send]);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => () => running.current?.stop(), []);

  useImperativeHandle(ref, () => ({
    act: (name) => new Promise((resolve) => {
      const act = PET_ACTS[name];
      if (!animate) { resolve(); return; }
      send(name === 'celebrate' ? 'CELEBRATE' : 'INTERACT');
      running.current?.stop();
      running.current = playAct(act, values);
      running.current.start(() => { send('DONE'); resolve(); });
    }),
    walkTo: (toX, toY) => new Promise((resolve) => {
      const from = pose.current;
      const distance = Math.hypot(toX - from.x, toY - from.y);
      pose.current = { x: toX, y: toY };
      if (!animate || distance < 2) { left.setValue(toX - size / 2); top.setValue(toY - size); resolve(); return; }
      setTurn(toX >= from.x ? 1 : -1);
      send('WALK');
      const perLoop = size * STRIDE_SHARE;
      const ms = (distance / perLoop) * WALK_CYCLE_MS;
      running.current?.stop();
      const start = () => {
        running.current = Animated.parallel([
          Animated.timing(left, { toValue: toX - size / 2, duration: ms, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(top, { toValue: toY - size, duration: ms, easing: Easing.linear, useNativeDriver: true }),
          // Whole loops only, so it stops on the frame it started from; the strip's own clock is never used here.
          Animated.timing(stride, { toValue: Math.max(1, Math.round(distance / perLoop)), duration: ms, easing: Easing.linear, useNativeDriver: true }),
        ]);
        running.current.start(({ finished }) => {
          stride.setValue(0);
          send('ARRIVE');
          if (finished) { running.current = playAct(PET_ACTS.stop, values); running.current.start(() => resolve()); } else resolve();
        });
      };
      running.current = playAct(PET_ACTS.stepOff, values);
      running.current.start(start);
    }),
  }), [animate, size, send, values, left, top, stride]);

  const art = artFor(state);
  const strolling = art.walking || walking;
  const breathe = useSwing({ ms: 1900, jitter: 0.18, enabled: !strolling && state === 'idle', rest: [0, 500] });
  const drawn = hasSprite(pet, level, 'walk');
  const motes = useWorldMotion().level === 'full' && level > 0 && state === 'idle';
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ translateX: left }, { translateY: top }] }} testID={`living-pet-${state}`}
      accessible accessibilityLabel={`${petById(pet).name}: ${STATE_WORDS[state]}`}>
      {shadow ? <View style={[s.shadow, { left: size * 0.22 + shadow.dx, bottom: 1, width: size * 0.56, height: size * 0.07, opacity: Math.min(0.28, shadow.opacity * 1.4), transform: [{ scaleX: shadow.stretch }] }]} /> : null}
      <Animated.View style={{ transformOrigin: '50% 100%', transform: actTransform(values, size) }}>
        <Animated.View style={{ transformOrigin: '50% 100%', transform: [
          { scaleY: breathe.interpolate({ inputRange: [-1, 1], outputRange: [1, 1.014] }) },
          { scaleX: breathe.interpolate({ inputRange: [-1, 1], outputRange: [1, 0.996] }) },
          // The walk strips face right; walking left mirrors it.
          { scaleX: turn },
        ] }}>
          <PetArt pet={pet} size={size} stage={level} walking={strolling} studying={art.studying} still={art.still}
            phase={strolling && drawn ? (phase ?? stride) : undefined} />
        </Animated.View>
      </Animated.View>
      {motes ? <ElementMotes color={petById(pet).element.color} size={size} /> : null}
    </Animated.View>
  );
});

const STATE_WORDS: Record<PetState, string> = { idle: 'đang đứng chơi', walk: 'đang đi', interact: 'đang chơi cùng bạn', celebrate: 'đang vui mừng', study: 'đang học', rest: 'đang nghỉ', away: 'đang đi xa' };

/** A few specks of the pet's element around it, now and then: never on its body, and quiet most of the time. */
function ElementMotes({ color, size }: { color: string; size: number }) {
  const { animate } = useWorldMotion();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let run: Animated.CompositeAnimation | null = null;
    const next = () => {
      if (stopped) return;
      rise.setValue(0);
      run = Animated.timing(rise, { toValue: 1, duration: 1700, easing: EASE.rise, useNativeDriver: true });
      run.start(({ finished }) => { if (finished && !stopped) timer = setTimeout(next, 3600 + Math.random() * 4800); });
    };
    timer = setTimeout(next, 800 + Math.random() * 2400);
    return () => { stopped = true; run?.stop(); if (timer) clearTimeout(timer); };
  }, [animate, rise]);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {[[0.12, 0.62, 5], [0.9, 0.5, 4], [0.76, 0.76, 3]].map(([fx, fy, dot], i) => (
      <Animated.View key={i} style={{ position: 'absolute', left: fx * size, top: fy * size, width: dot, height: dot, borderRadius: dot, backgroundColor: color,
        opacity: rise.interpolate({ inputRange: [0, 0.2 + i * 0.1, 1], outputRange: [0, 0.85, 0] }),
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.3] }) }] }} />
    ))}
  </View>;
}

// ------------------------------------------------------------------------------------------------ small pieces
/** The weather as it really is here, small; nothing at all when there is no reading (so it never claims a weather). */
export function WeatherChip({ night, tone = 'dark' }: { night: boolean; tone?: 'dark' | 'light' }) {
  const { reading } = useWeather();
  if (!reading) return null;
  const { icon, text, label } = describeWeather(reading, night);
  const color = tone === 'dark' ? t.ink : '#FFFFFF';
  return (
    <View style={s.chip} accessible accessibilityRole="text" accessibilityLabel={label} testID="weather-chip">
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[s.chipText, { color }]}>{text}</Text>
    </View>
  );
}

/** A panel over a scene, the same for every space. */
export function WorldPanel({ children, style, testID }: { children: React.ReactNode; style?: object; testID?: string }) {
  return <View style={[s.panel, style]} testID={testID}>{children}</View>;
}

const s = StyleSheet.create({
  shine: { position: 'absolute', borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.45)' },
  rainVeil: { backgroundColor: 'rgba(52,70,92,0.10)' },
  dropFar: { position: 'absolute', top: 0, width: 1, borderRadius: 1, backgroundColor: 'rgba(225,238,250,0.5)', opacity: FAR },
  dropNear: { position: 'absolute', top: 0, width: 1.6, borderRadius: 1, backgroundColor: 'rgba(235,245,255,0.85)' },
  flake: { position: 'absolute', top: 0, backgroundColor: '#FFFFFFDD' },
  fog: { position: 'absolute', left: -24, right: -24, backgroundColor: 'rgba(235,240,244,1)', borderRadius: 80 },
  fly: { position: 'absolute', width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  flyGlow: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(255,233,150,0.28)' },
  flyDot: { width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: '#FFE996' },
  shadow: { position: 'absolute', borderRadius: 99, backgroundColor: '#2E3B2A' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 24 },
  chipText: { ...typeScale.caption },
  panel: { ...glass, ...elevation.floating, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 },
});
