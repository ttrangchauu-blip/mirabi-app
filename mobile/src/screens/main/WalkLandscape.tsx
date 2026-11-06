import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, type ImageSourcePropType, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { PetArt, restartFromZero } from '../../components/PetArt';
import { hasSprite, WALK_CYCLE_MS } from '../../petSprites';
import { DayPeriod } from '../../components/useDayPeriod';
import { Light, lightAt, mixColor, sunAt, useDaylight } from '../../components/daylight';
import { Plate } from '../../world/diorama';
import { useSwing } from '../../world/budget';
import { arcPoint, castBy, Glow, round, SkyBodies, Stars } from '../../world/sky';
import { moodOf, shade } from '../../world/atmosphere';
import { CloudDeck, Fireflies, GrassField, Rain } from '../../world/living';
import { useWeather } from '../../world/weather';
import { useReduceMotion } from '../../components/useReduceMotion';

const PET_SIZE = 76;
const PET_X = 0.24;  // where the pet's centre sits, as a share of the scene width
/** The land is drawn at this share of the scene, keeping its picture's 3:1 shape, and stands on the scene's bottom edge.
 * A taller scene only shows more sky: nothing is stretched. */
const LAND_SHARE = 0.68;
/** Where things are in the rendered land, as shares of its height from the top. */
const AT = { feet: 0.914, path: 0.743, sunset: 0.571, clip: 0.614, farRidge: 0.33, nearRidge: 0.5 };
const LAND = {
  far: { day: require('../../../assets/world/walk/far-day.webp'), night: require('../../../assets/world/walk/far-night.webp') },
  near: { day: require('../../../assets/world/walk/near-day.webp'), night: require('../../../assets/world/walk/near-night.webp') },
};

/** 210 on a small phone, 230 on a large one. */
export const walkSceneHeight = (screenHeight: number) => Math.round(Math.min(230, Math.max(210, screenHeight * 0.27)));

/** Every position in the scene, from its height. */
function layoutOf(height: number) {
  const land = Math.round(height * LAND_SHARE);
  const top = height - land;
  const at = (share: number) => top + share * land;
  // The land repeats every `tile` points; `far` and `near` slide at different speeds, and night fades in over day.
  return { height, land, top, tile: land * 3, feet: land * (1 - AT.feet), path: at(AT.path), horizon: at(AT.sunset), clip: at(AT.clip), farRidge: at(AT.farRidge), nearRidge: at(AT.nearRidge) };
}
type Layout = ReturnType<typeof layoutOf>;

const PERIOD_LABEL: Record<DayPeriod, string> = { morning: 'buổi sáng', noon: 'buổi trưa', afternoon: 'buổi chiều', night: 'buổi tối' };
const ZENITH_Y = 22;

/** Returns the previous object while the new one has the same values, so memoised layers skip redrawing. */
function useSame<T>(value: T): T {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value;
  return ref.current;
}

/** How far each ray of sunlight points from straight down, and how wide it is drawn, in degrees: thin rays over wide ones
 * make a soft edge. */
const SHAFTS = [-34, -9, 19, 42];
const SHAFT_WIDTHS = [9, 6.5, 4, 2];

/** Soft light falling from the sun over the far land, breathing slowly. Behind the clouds and hills, gone at night and under cloud. */
const SunShafts = React.memo(function SunShafts({ width, clip, x, y, strength }: { width: number; clip: number; x: number; y: number; strength: number }) {
  const breath = useSwing({ ms: 8000 });
  const reach = clip * 1.6;
  const ray = (angle: number, half: number) => {
    const end = (degrees: number) => { const a = (degrees * Math.PI) / 180; return `${(x + Math.sin(a) * reach).toFixed(1)} ${(y + Math.cos(a) * reach).toFixed(1)}`; };
    return `M${x} ${y} L${end(angle - half)} L${end(angle + half)} Z`;
  };
  return <Animated.View pointerEvents="none" style={[styles.shafts, { height: clip, opacity: breath.interpolate({ inputRange: [-1, 1], outputRange: [strength * 0.6, strength] }) }]} testID="walk-sunlight">
    <Svg width={width} height={clip}>
      <Defs><RadialGradient id="walk-shaft" gradientUnits="userSpaceOnUse" cx={x} cy={y} r={reach}><Stop offset="0" stopColor="#FFF4CF" stopOpacity={0.14} /><Stop offset="1" stopColor="#FFF4CF" stopOpacity={0} /></RadialGradient></Defs>
      {SHAFTS.flatMap((angle) => SHAFT_WIDTHS.map((half) => <Path key={`${angle}-${half}`} d={ray(angle, half)} fill="url(#walk-shaft)" />))}
    </Svg>
  </Animated.View>;
});

/** The layers below are memoised: the day–night clock re-renders the scene every few seconds, but their colours only
 * change every half minute or so, and only then are they redrawn.
 *
 * One rendered layer, repeated across the scene: the same picture by day and at night, crossfading with the dark. */
const Band = React.memo(function Band({ width, l, day, night, stars }: { width: number; l: Layout; day: ImageSourcePropType; night: ImageSourcePropType; stars: number }) {
  const tiles = useMemo(() => Array.from({ length: Math.ceil(width / l.tile) + 1 }, (_, i) => i * l.tile), [width, l.tile]);
  return <>
    {tiles.map((x) => <Plate key={x} source={day} width={l.tile + 0.5} height={l.land} style={{ left: x, top: l.top }} />)}
    {stars > 0 ? tiles.map((x) => <Plate key={x} source={night} width={l.tile + 0.5} height={l.land} opacity={stars} style={{ left: x, top: l.top }} />) : null}
  </>;
});

/** Grass on the meadow behind and in front of the path ([x share of a tile, y share of the land, scale]), moving with the wind. */
const GRASS = [[0.05, 0.66, 0.42], [0.2, 0.74, 0.5], [0.34, 0.63, 0.38], [0.47, 0.71, 0.5], [0.62, 0.66, 0.42], [0.78, 0.74, 0.5], [0.92, 0.64, 0.38],
  [0.12, 1.0, 0.6], [0.42, 1.01, 0.55], [0.7, 1.0, 0.6], [0.88, 1.01, 0.55]] as const;

/** The grass rides on the ground's layer, one set on each copy of the land. */
const Grass = React.memo(function Grass({ width, l, color, wind }: { width: number; l: Layout; color: string; wind: number }) {
  const tiles = useMemo(() => Array.from({ length: Math.ceil(width / l.tile) + 1 }, (_, i) => i * l.tile), [width, l.tile]);
  return <>{tiles.map((x) => <View key={x} pointerEvents="none" style={[styles.grass, { left: x, width: l.tile, height: l.height }]}>
    <GrassField width={l.tile} height={l.land} top={l.top} color={color} wind={wind} spots={GRASS} />
  </View>)}</>;
});

/** Everything behind the pet. A single layer whose colours and lights follow the clock: nothing is swapped or
 * remounted as the day goes on, so the scrolling (and the clouds) carry on undisturbed. */
function Scenery({ c, hours, width, l, hills, ground, cover, gloom, wind }: {
  c: Light; hours: number; width: number; l: Layout; hills: Animated.Value; ground: Animated.Value; cover: number; gloom: number; wind: number;
}) {
  const sun = sunAt(hours);
  const glow = arcPoint(width, sun, l.horizon, ZENITH_Y);
  const sunlight = round(Math.max(0, Math.min(1, sun.altitude / 0.3)) * (1 - gloom), 0.05);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {/* The sky's palest colour meets the land, however tall the scene is. */}
    <LinearGradient colors={c.sky} end={{ x: 0, y: l.nearRidge / l.height }} style={StyleSheet.absoluteFill} />
    {width ? <>
      {c.stars > 0 ? <Stars width={width} height={l.height} opacity={c.stars} scale={l.farRidge / 50} testID="walk-stars" /> : null}
      {sunlight > 0 ? <SunShafts width={width} clip={l.clip} x={round(glow.x, 2)} y={round(glow.y, 2)} strength={sunlight} /> : null}
      <SkyBodies width={width} hours={hours} c={c} horizon={l.horizon} zenith={ZENITH_Y} clip={l.clip} />
      {/* More of the sky than the weather's own share, so the wide sky is never empty. */}
      <CloudDeck width={width} top={l.top * 0.22} color={c.cloud} opacity={c.cloudOpacity} cover={Math.max(cover, 0.7)} scale={1} />
      <Scroller width={l.tile} progress={hills}><Band width={width} l={l} day={LAND.far.day} night={LAND.far.night} stars={c.stars} /></Scroller>
      {/* Air between the far hills and the near ridge: what is further away fades into the sky. */}
      <LinearGradient colors={[`${c.sky[2]}00`, `${c.sky[2]}66`]} style={[styles.haze, { top: l.farRidge, height: l.nearRidge + 6 - l.farRidge }]} />
      <Scroller width={l.tile} progress={ground}>
        <Band width={width} l={l} day={LAND.near.day} night={LAND.near.night} stars={c.stars} />
        {/* The grass of the picture, day and night: it crossfades with the land, not with the sky's colours. */}
        <Grass width={width} l={l} color={mixColor('#5F9449', '#1E3B34', c.stars)} wind={wind} />
      </Scroller>
      <Fireflies width={width} top={l.nearRidge} height={l.path + 24 - l.nearRidge} strength={c.fireflies} />
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
const GROUND_MS = 21000;  // path, near hill and trees pass by once per tile: an unhurried stroll
const HILLS_MS = 60000;   // far hills, much slower: parallax depth

/** A small landscape the pet walks through, filmed by a camera that follows it: the pet stays in frame while the
 * path, hills and clouds slide past at different speeds, so it reads as walking forward. It stays at one spot on the
 * left; its gait (its drawn walk cycle, or bounce, sway and squash for pets without one; dust at each landing) keeps
 * it from looking pinned. The sky follows the local clock continuously (see daylight.ts): the sun rises on the left,
 * crosses on an arc and sets behind the hills on the right, the colours and shadows shift with it, and at night the
 * moon and stars come out. Only colours and the sun and moon move; the pet and its walk animation are untouched. */
export function WalkLandscape({ pet, level, now }: { pet: string; level: number; /** A clock for tests. */ now?: () => Date }) {
  const reduceMotion = useReduceMotion();
  const { height: screenHeight } = useWindowDimensions();
  const l = useMemo(() => layoutOf(walkSceneHeight(screenHeight)), [screenHeight]);
  const { hours, period } = useDaylight({ now, smooth: !reduceMotion });
  const { reading } = useWeather();
  const mood = useMemo(() => moodOf(reading), [reading]);
  const c = useSame(shade(lightAt(hours), mood));
  const cast = useSame(castBy(sunAt(hours)));
  const drawnGait = hasSprite(pet, level, 'walk');
  const [width, setWidth] = useState(0);
  const hills = useRef(new Animated.Value(0)).current;
  const ground = useRef(new Animated.Value(0)).current;
  const gait = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const values = [hills, ground, gait];
    if (reduceMotion || !width) { values.forEach((value) => { value.stopAnimation(); value.setValue(0); }); return; }
    const linear = (value: Animated.Value, duration: number) => Animated.loop(restartFromZero(value, 1, duration));
    const loops = [linear(hills, HILLS_MS), linear(ground, GROUND_MS), linear(gait, GAIT_MS)];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [hills, ground, gait, reduceMotion, width]);

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

  return <View style={[styles.scene, { height: l.height, backgroundColor: c.sky[1] }]} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
    accessible accessibilityLabel={`Pet đang đi dạo ${PERIOD_LABEL[period]} trên con đường giữa những ngọn đồi`} testID={`walk-scene-${period}`}>
    <Scenery c={c} hours={hours} width={width} l={l} hills={hills} ground={ground} cover={mood.cover} gloom={mood.gloom} wind={mood.wind} />
    {/* Moonlight on the path where the pet walks, behind it: the pet keeps its own colours and stays easy to see. */}
    {c.petLight > 0 && width ? <Svg pointerEvents="none" width={140} height={48} style={[styles.petLight, { left: x + PET_SIZE / 2 - 70, bottom: l.feet - 14 }]}>
      <Glow id="pet-light" color="#FFF0C4" opacity={c.petLight} cx={70} cy={24} rx={70} ry={24} />
    </Svg> : null}
    {width ? <>
      {mood.rain > 0 ? <Rain width={width} height={l.height} strength={mood.rain} wind={mood.wind} ground={l.path / l.height} /> : null}
      <Animated.View style={[styles.traveler, { bottom: l.feet, transform: [{ translateX: x }] }]} pointerEvents="none" testID="walk-pet">
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
  scene: { width: '100%', borderRadius: 22, overflow: 'hidden', marginBottom: 10 },
  shafts: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  haze: { position: 'absolute', left: 0, right: 0 },
  grass: { position: 'absolute', top: 0 },
  petLight: { position: 'absolute' },
  traveler: { position: 'absolute', left: 0, width: PET_SIZE, alignItems: 'center', justifyContent: 'flex-end' },
  cast: { position: 'absolute', bottom: 2 },
  shadow: { width: 44, height: 8, borderRadius: 99, backgroundColor: '#544830' },
  puff: { position: 'absolute', bottom: 4, left: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  puffDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(214,196,160,0.9)' },
  puffDotSmall: { width: 4, height: 4, borderRadius: 2, marginBottom: 3 },
});
