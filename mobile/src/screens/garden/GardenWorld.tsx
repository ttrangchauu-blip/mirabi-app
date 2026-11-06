import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, type ImageSourcePropType, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { type Light, sunAt } from '../../components/daylight';
import { Text } from '../../components/Typography';
import type { CareKind, GardenPlot } from '../../inventory/types';
import { radius } from '../../ui/design';
import { makeStyles } from '../../ui/theme';
import { useAtmosphere, useSameValue } from '../../world/atmosphere';
import { useEased, useFrameWatch, useTravel, useWorldMotion } from '../../world/budget';
import { ContactShadow, Hit, Plate } from '../../world/diorama';
import { Fireflies, Fog, LivingPet, type LivingPetHandle, Rain, Snow, Sway } from '../../world/living';
import { EASE } from '../../world/motion';
import { castBy, SkyBodies, Stars } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { BED, BED_FRAME_TOP, BED_SOIL, BED_TALL, CLOUDS, plantArt, PLANT_FOOT, plantScale, PLANT_TALL, YARD, YARD_FENCE, YARD_FRONT, YARD_GATE_X, YARD_HILLTOP, YARD_LAWN, YARD_LAWN_X, YARD_POND_END, YARD_POND_RIGHT, YARD_RIDGE, YARD_SWAY, YARD_TALL } from './gardenArt';
import { CARE, CARE_KINDS, careOf } from './gardenUi';
import { tierOf } from './tiers';

/** A planting, a care or a harvest just confirmed by the server, played once on its plot. A harvest carries what was
 * picked and what the backend paid for it, since the plot is already empty when it plays. */
export type GardenFx = { plot: number; kind: CareKind | 'plant' | 'harvest'; key: number;
  harvest?: { item_id: string; art: string; exp: number; coins: number } };

type Props = {
  plots: GardenPlot[]; busy: number | null;
  /** Plots the chosen tool would act on (outlined). */ ready: (plot: GardenPlot) => boolean;
  labelFor: (plot: GardenPlot) => string; onPress: (plot: GardenPlot) => void;
  /** Points kept for what floats over the scene, at the top and the bottom. */ top: number; bottom: number;
  /** The owner's pet out in its garden; a visitor sees none. */ pet?: { id: string; level: number } | null;
  fx?: GardenFx | null;
  children?: React.ReactNode;
};

/** How wide a plant's picture is, as a share of its plot's: plants stand a bit bigger than life on their beds. */
const PLANT_WIDE = 1.45;
// Until the first layout (and in tests) a phone-sized scene.
const FALLBACK = { width: 390, height: 640 };
/** The least a row of plots takes from front to back, so a finger fits on each. */
const MIN_ROW = 46;
/** The open sky between what floats at the top and the far hills: it gets all that is left over, and at least this. */
const MIN_SKY = 44;
/** How far the yard's picture may shrink, and the least it does: only a screen much wider than tall needs it, since copies then carry
 * the land on to the edges, a second pond among them. A phone a little short scrolls instead. */
const MIN_ZOOM = 0.58;
const SHRINKS_BELOW = 0.8;

/** Where everything stands. The rows of plots are packed from the pond's end down, and the yard's picture stands behind
 * them with the sky above it. The back rows are smaller, for depth. Each plot's area for a finger (`pitch` by `h`) meets its
 * neighbours' and never overlaps them. A phone too short for all of it scrolls (`content`). Same numbers for the same
 * space, so the scene never jumps. */
export function yardLayout(count: number, width: number, height: number, top: number, bottom: number) {
  const rows = Math.max(1, Math.ceil(count / 3));
  const base = Math.min(width * 0.295, 122);
  const widths = Array.from({ length: rows }, (_, r) => base * (rows === 1 ? 1 : 0.86 + (0.14 * r) / (rows - 1)));
  const bands = widths.map((w) => Math.max(MIN_ROW, w * BED_TALL));
  const beds = bands.reduce((sum, band) => sum + band, 0);
  const span = YARD_POND_END - YARD_HILLTOP;
  const pondEnd = height - bottom - 4 - beds;
  const natural = width * YARD_TALL;
  const fits = (pondEnd - top - MIN_SKY) / span / natural;
  const zoom = fits >= SHRINKS_BELOW ? 1 : Math.max(MIN_ZOOM, fits);
  const tall = natural * zoom;
  const extra = Math.max(0, top + MIN_SKY - (pondEnd - span * tall));
  const picTop = pondEnd + extra - YARD_POND_END * tall;
  let feet = pondEnd + extra;
  const rowFeet = bands.map((band) => (feet += band));
  const places = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 3);
    const w = widths[row], pitch = w * 1.08;
    return { x: width / 2 + ((i % 3) - 1) * pitch, feet: rowFeet[row], w, h: bands[row], pitch, row };
  });
  return { places, zoom, tall, picTop, content: height + extra, rowFeet, widths };
}
export const plotPlaces = (count: number, width: number, height: number, top: number, bottom: number) => yardLayout(count, width, height, top, bottom).places;

type Spot = { x: number; y: number };
type Lane = { y: number; left: number; right: number; kind: 'lawn' | 'front' | 'aisle' };

/** Where the pet can walk: the lawn behind the fence, the ground in front of it (from the pond on) and the aisles between
 * the rows of beds. It gets from one to another through the gate or round the outside of the beds. */
export function gardenPaths(yard: ReturnType<typeof yardLayout>, width: number) {
  const wide = width * yard.zoom;
  const across = (share: number) => (width - wide) / 2 + share * wide;
  const down = (share: number) => yard.picTop + share * yard.tall;
  const widest = Math.max(...yard.widths);
  const margin = Math.max(12, ((width - widest * 3.24) / 2) * 0.9);
  const sides = [margin, width - margin] as const;
  const lanes: Lane[] = [
    { y: down(YARD_LAWN), left: across(YARD_LAWN_X[0]), right: across(YARD_LAWN_X[1]), kind: 'lawn' },
    { y: down(YARD_FRONT), left: across(YARD_POND_RIGHT), right: sides[1], kind: 'front' },
    ...yard.rowFeet.slice(1).map((feet, r) => ({ y: feet - yard.widths[r + 1] * BED_FRAME_TOP - 2, left: sides[0], right: sides[1], kind: 'aisle' as const })),
  ];
  return { lanes, sides, gateX: across(YARD_GATE_X) };
}
type Paths = ReturnType<typeof gardenPaths>;

/** The straight legs from one spot to another, along the lanes: never through a bed. */
export function gardenRoute({ lanes, sides, gateX }: Paths, from: Spot, to: Spot): Spot[] {
  const laneOf = (y: number) => lanes.reduce((best, lane) => (Math.abs(lane.y - y) < Math.abs(best.y - y) ? lane : best));
  const front = lanes[1];
  const legs: Spot[] = [];
  let here = from;
  const go = (x: number, y: number) => { if (here.x !== x || here.y !== y) { here = { x, y }; legs.push(here); } };
  let at = laneOf(from.y);
  const target = laneOf(to.y);
  go(from.x, at.y);
  if (at !== target && at.kind === 'lawn') { go(gateX, at.y); go(gateX, front.y); at = front; }
  const end = target.kind === 'lawn' && at !== target ? front : target;
  if (at !== end) {
    // Only the right-hand side is open from the front ground: the pond is on the left.
    const side = at === front || end === front || Math.abs(sides[1] - here.x) < Math.abs(sides[0] - here.x) ? sides[1] : sides[0];
    go(side, at.y); go(side, end.y);
  }
  if (end !== target) { go(gateX, end.y); go(gateX, target.y); }
  go(to.x, target.y);
  return legs;
}

const between = (low: number, high: number) => low + Math.random() * (high - low);
/** Somewhere to go next, away from the edges of its lane. */
function nextSpot({ lanes }: Paths, from: Spot): Spot {
  const lane = lanes[Math.floor(Math.random() * lanes.length)];
  const inset = Math.min(28, (lane.right - lane.left) / 3);
  const x = between(lane.left + inset, lane.right - inset);
  return lane.y === from.y && Math.abs(x - from.x) < 40 ? { x: x > (lane.left + lane.right) / 2 ? lane.left + inset : lane.right - inset, y: lane.y } : { x, y: lane.y };
}

/**
 * The garden as a place: sky and hills by the hour and the weather, a pond, trees and flowers that don't move in step, and
 * the plots laid out on the ground. Each plot keeps the same tap, label and data as before. Everything drawn comes from the
 * server's state (what is planted, which stage, what was watered today); nothing here changes it.
 */
export function GardenWorld({ plots, busy, ready, labelFor, onPress, top, bottom, pet, fx, children }: Props) {
  const [size, setSize] = useState(FALLBACK);
  const { reading } = useWeather();
  const { hours, mood, light: c, night } = useAtmosphere(reading);
  const { animate } = useWorldMotion();
  useFrameWatch('garden');
  const cast = useSameValue(castBy(sunAt(hours)));
  const { width, height } = size;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((b) => (b.width === w && b.height === h ? b : { width: w, height: h }));
  };
  const yard = useMemo(() => yardLayout(plots.length, width, height, top, bottom), [plots.length, width, height, top, bottom]);
  const { places, content } = yard;
  const area = Math.max(240, height - top - bottom);
  const horizon = Math.round(yard.picTop + yard.tall * YARD_RIDGE);
  const fence = yard.picTop + yard.tall * YARD_FENCE;

  // The pet strolls about its yard on its own, stopping now and then; a care just done brings it to that plot's side first.
  const petRef = useRef<LivingPetHandle>(null);
  const petSize = Math.round(Math.min(width * 0.18, 76));
  const paths = useMemo(() => gardenPaths(yard, width), [yard, width]);
  const lastLane = paths.lanes[paths.lanes.length - 1];
  const homeSpot = useMemo(() => ({ x: width * 0.82, y: paths.lanes[1].y }), [width, paths]);
  const depth = useMemo(() => ({ farY: paths.lanes[0].y, nearY: Math.max(lastLane.y, paths.lanes[0].y + 1), far: 0.6 }), [paths, lastLane]);
  const standing = useRef<Spot>(homeSpot);
  const [petZ, setPetZ] = useState(1);
  // In front of the rows it has passed, behind the others.
  const stepTo = async (spot: Spot) => {
    setPetZ(1 + 2 * yard.rowFeet.filter((feet) => feet <= spot.y).length);
    standing.current = spot;
    await petRef.current?.walkTo(spot.x, spot.y);
  };
  const [caring, setCaring] = useState(false);
  const roams = !!pet && pet.level > 0 && animate && !caring;
  useEffect(() => { standing.current = homeSpot; setPetZ(1 + 2 * yard.rowFeet.filter((feet) => feet <= homeSpot.y).length); }, [homeSpot, yard]);
  useEffect(() => {
    if (!roams) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rest = (ms: number) => new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
    void (async () => {
      await rest(between(1500, 4000));
      while (live) {
        for (const leg of gardenRoute(paths, standing.current, nextSpot(paths, standing.current))) {
          if (!live) return;
          await stepTo(leg);
        }
        if (!live) return;
        if (Math.random() < 0.25) await petRef.current?.act('hop');
        if (live) await rest(between(2500, 6500));
      }
    })();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [roams, paths]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fx || !places[fx.plot]) return;
    const place = places[fx.plot];
    const side = fx.plot % 3 === 2 ? -1 : 1;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setCaring(true);
    void stepTo({ x: place.x + side * (place.w * 0.62), y: place.feet - 6 }).then(() => {
      if (!live) return undefined;
      return petRef.current?.act('hop');
    }).then(() => {
      if (live) timer = setTimeout(() => {
        setCaring(false);
        if (!animate) void stepTo(homeSpot);
      }, 3200);
    });
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [fx?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.fill} onLayout={onLayout} testID="garden-world">
      <ScrollView scrollEnabled={content > height + 1} bounces={false} overScrollMode="never" showsVerticalScrollIndicator={false} contentContainerStyle={{ height: content }}>
        <Backdrop width={width} top={top} yard={yard} horizon={horizon} c={c} hours={hours} cover={mood.cover} wind={mood.wind} />
        {pet && pet.level > 0 ? <LivingPet ref={petRef} pet={pet.id} level={pet.level} size={petSize} x={homeSpot.x} y={homeSpot.y} depth={depth} zIndex={petZ} shadow={{ dx: cast.dx, stretch: cast.stretch, opacity: c.shadow }} /> : null}
        {plots.map((plot, i) => <PlotSpot key={plot.plot} plot={plot} place={places[i]} busy={busy === plot.plot} ready={ready(plot)} label={labelFor(plot)} onPress={onPress} wind={mood.wind} night={night}
          fx={fx && fx.plot === plot.plot ? fx : null} />)}
        {/* Above every plant, so a tall one in front never hides how the plant behind it is doing. The button's label says the same. */}
        {plots.map((plot, i) => <PlotSign key={plot.plot} plot={plot} place={places[i]} />)}
      </ScrollView>
      <Fireflies width={width} top={horizon} height={area * 0.8} strength={c.fireflies} />
      <Fog height={height} strength={mood.fog} top={0.2} />
      <Rain width={width} height={height} strength={mood.rain} wind={mood.wind} ground={Math.min(0.9, fence / height)} />
      <Snow width={width} height={height} strength={mood.snow} />
      {children}
    </View>
  );
}

const SEAM = 2;

/** The rendered yard at its own shape, narrower than the scene when it has shrunk: mirrored copies carry the land on to
 * both edges, and a flipped one carries the meadow on below it, under what floats at the bottom. */
const YardPicture = memo(function YardPicture({ source, width, yard, opacity }: { source: ImageSourcePropType; width: number; yard: ReturnType<typeof yardLayout>; opacity?: number }) {
  const wide = width * yard.zoom;
  const left = (width - wide) / 2;
  const below = yard.picTop + yard.tall < yard.content;
  // The picture's own copy last and the mirrored ones running under its edges, so no seam shows between them.
  const row = (top: number, scaleY: number) => [[left - wide + SEAM, -1], [left + wide - SEAM, -1], [left, 1]].filter(([, scaleX]) => scaleX === 1 || yard.zoom < 1).map(([x, scaleX]) =>
    <Plate key={`${x}-${scaleY}`} source={source} width={wide} height={yard.tall} opacity={opacity} style={{ left: x, top, transform: [{ scaleX }, { scaleY }] }} />);
  return <>{row(yard.picTop, 1)}{below ? row(yard.picTop + yard.tall - 0.5, -1) : null}</>;
});

/** [across the width, down the sky, width as a share of the scene's, which cloud, which layer]; the first ones show whatever the weather. */
const CLOUD_SPOTS = [[0.02, 0.56, 0.34, 0, 1], [0.62, 0.16, 0.24, 1, 0], [0.72, 0.66, 0.26, 2, 1], [0.36, 0.34, 0.14, 2, 0], [0.06, 0.14, 0.17, 1, 0], [0.46, 0.8, 0.15, 0, 0]] as const;

/** The rendered clouds drifting over the live sky: the near ones faster than the far ones. */
export const YardClouds = memo(function YardClouds({ width, top, horizon, opacity, night, cover }: { width: number; top: number; horizon: number; opacity: number; night: number; cover: number }) {
  const { count } = useWorldMotion();
  const far = useTravel({ ms: 170_000 });
  const near = useTravel({ ms: 100_000 });
  if (!width) return null;
  const sky = Math.max(60, horizon - top);
  const shown = CLOUD_SPOTS.slice(0, count(Math.round(2 + cover * 4)));
  const layer = (index: number, progress: Animated.Value) => (
    <Animated.View key={index} pointerEvents="none" style={[StyleSheet.absoluteFill, { width: width * 2, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] }]}>
      {[0, width].map((offset) => shown.filter((spot) => spot[4] === index).map(([x, y, wide, cloud]) => {
        const w = width * wide, h = w * CLOUDS[cloud].tall, style = { left: offset + width * x, top: top + y * sky - h / 2 };
        return <React.Fragment key={`${offset}-${x}`}>
          <Plate source={CLOUDS[cloud].day} width={w} height={h} opacity={opacity} style={style} />
          {night > 0 ? <Plate source={CLOUDS[cloud].night} width={w} height={h} opacity={opacity * night} style={style} /> : null}
        </React.Fragment>;
      }))}
    </Animated.View>
  );
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{layer(0, far)}{layer(1, near)}</View>;
});

/** The trees and flowers over the land, each moving from its foot in its own time. The flowers in the grass never stand among the plots, however short the phone. */
const YardSways = memo(function YardSways({ width, yard, wind, night }: { width: number; yard: ReturnType<typeof yardLayout>; wind: number; night: number }) {
  const wide = width * yard.zoom, left = (width - wide) / 2;
  const lastRow = yard.rowFeet[yard.rowFeet.length - 1];
  return <>{YARD_SWAY.map((sway) => (
    <Sway key={sway.ms} wind={Math.max(wind, 0.6)} depth={sway.depth} ms={sway.ms} rest={[0, 700]} style={{ position: 'absolute', left: left + sway.x * wide, top: Math.max(yard.picTop + sway.y * yard.tall, sway.low ? lastRow : 0), width: sway.w * wide, height: sway.h * yard.tall }}>
      <Image source={sway.day} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={s.layer} />
      {night > 0 ? <Image source={sway.night} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={[s.layer, { opacity: night }]} /> : null}
    </Sway>
  ))}</>;
});

/** The real sky behind the rendered yard, whose ridge meets the horizon; night fades in over day. */
const Backdrop = memo(function Backdrop({ width, top, yard, horizon, c, hours, cover, wind }: { width: number; top: number; yard: ReturnType<typeof yardLayout>; horizon: number; c: Light; hours: number; cover: number; wind: number }) {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {/* The sky's palest colour meets the hills. */}
    <LinearGradient colors={c.sky} end={{ x: 0, y: Math.min(1, horizon / yard.content) }} style={StyleSheet.absoluteFill} />
    {c.stars > 0 ? <Stars width={width} height={horizon} opacity={c.stars} scale={horizon / 44} testID="garden-stars" /> : null}
    <SkyBodies width={width} hours={hours} c={c} horizon={horizon} zenith={top + 22} clip={horizon + 20} body={92} idPrefix="garden" />
    {/* More than the weather's own share, so the sky is never empty. */}
    <YardClouds width={width} top={top} horizon={horizon} opacity={c.cloudOpacity} night={c.stars} cover={Math.max(cover, 0.5)} />
    <YardPicture source={YARD.day} width={width} yard={yard} />
    {c.stars > 0 ? <YardPicture source={YARD.night} width={width} yard={yard} opacity={c.stars} /> : null}
    <YardSways width={width} yard={yard} wind={wind} night={c.stars} />
  </View>;
});

/** The bed gets dark where it was watered today, and dries back when the day's care is over. */
function Moist({ wet, w, night }: { wet: boolean; w: number; night: boolean }) {
  const opacity = useEased(wet ? 1 : 0, 900);
  return <Animated.Image source={BED.wet[night ? 'night' : 'day']} resizeMode="stretch" style={[s.bed, { opacity, width: w, height: w * BED_TALL }]} testID={wet ? 'garden-soil-wet' : undefined} />;
}

/** A plant arriving or moving to its next stage: pushes up from the soil, overshoots, settles. Only for a change seen
 * here: opening the garden shows every plant at rest. */
function usePop(stage: number | null, delay = 0) {
  const { animate } = useWorldMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const was = useRef(stage);
  useEffect(() => {
    if (was.current === stage) return;
    was.current = stage;
    if (stage === null || !animate) { pop.setValue(1); return; }
    pop.setValue(0);
    const run = Animated.timing(pop, { toValue: 1, duration: 620, delay, easing: EASE.land, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [stage, animate, pop]);
  return pop;
}

function PlotSpot({ plot, place, busy, ready, label, onPress, wind, night, fx }: { plot: GardenPlot; place: ReturnType<typeof plotPlaces>[number]; busy: boolean; ready: boolean; label: string;
  onPress: (plot: GardenPlot) => void; wind: number; night: boolean; fx: GardenFx | null }) {
  const art = plot.empty ? null : plantArt(plot, night);
  const ripe = !plot.empty && (plot.ready ?? plot.grown);
  // The seed lands first, then the sprout comes up.
  const pop = usePop(plot.empty ? null : plot.stage, fx?.kind === 'plant' ? SEED_LANDS : 0);
  const { w, h, pitch } = place;
  const plantW = w * PLANT_WIDE * (plot.empty ? 1 : plantScale(plot.art, plot.stage, plot.stage_count)), plantH = plantW * PLANT_TALL;
  const plus = Math.round(w * 0.26);
  // Taller plants bend more, and no two take the same time.
  const depth = plot.empty ? 0 : 1.6 + (plot.stage / Math.max(1, (plot.stage_count ?? 3) - 1)) * 1.8;
  return (
    <View style={[s.plot, { left: place.x - pitch / 2, top: place.feet - h, width: pitch, height: h, zIndex: 2 * (place.row + 1) }]} testID={`garden-plot-${plot.plot}-area`}>
      <Hit onPress={() => onPress(plot)} sink={0.96} accessibilityRole="button" accessibilityLabel={label} testID={`garden-plot-${plot.plot}`} style={{ width: pitch, height: h }}>
        {/* Nothing in it takes a finger: what rises above the plot (a tall plant) doesn't take the taps of the plot behind. */}
        <View pointerEvents="none" style={[s.bedSpot, { left: (pitch - w) / 2, width: w, height: w * BED_TALL }]}>
          <ContactShadow width={w * 1.06} height={w * BED_TALL} opacity={night ? 0.45 : 0.28} style={[s.bed, { left: -w * 0.03, bottom: -w * 0.025 }]} />
          <Image source={BED.dry[night ? 'night' : 'day']} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={[s.bed, { width: w, height: w * BED_TALL }]} />
          {plot.empty ? null : <Moist wet={careOf(plot, 'water').done} w={w} night={night} />}
          {ready ? <View style={[s.readyRing, { width: w * 0.72, height: w * 0.27, left: w * 0.14, bottom: w * (BED_SOIL - 0.135), borderRadius: w * 0.13 }]} testID={`garden-plot-${plot.plot}-ready`} /> : null}
          {art ? (
            <Animated.View style={[s.plantWrap, { width: plantW, height: plantH, left: (w - plantW) / 2, bottom: w * BED_SOIL - plantH * (1 - PLANT_FOOT), transformOrigin: `50% ${PLANT_FOOT * 100}%`, transform: [
              { scaleY: pop.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) },
              { scaleX: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
            ] }]}>
              <Sway wind={wind} depth={depth} ms={2100 + (plot.plot * 397) % 1300} rest={[0, 900]} style={s.fillWidth}>
                <Image source={art} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={s.fillWidth} />
              </Sway>
            </Animated.View>
          ) : <>
            <Svg width={w * 0.56} height={w * 0.2} style={[s.bed, { left: w * 0.22, bottom: w * (BED_SOIL - 0.1) }]}>
              <Rect x={1} y={1} width={w * 0.56 - 2} height={w * 0.2 - 2} rx={w * 0.05} fill="none" stroke="#FFFFFF" strokeOpacity={0.62} strokeWidth={1.1} strokeDasharray="4 3" />
            </Svg>
            <View style={[s.bed, { left: (w - plus) / 2, bottom: w * BED_SOIL - plus / 2 }]}><Ionicons name={ready ? 'add-circle' : 'add-circle-outline'} size={plus} color="#FFFFFF" /></View>
          </>}
          {ripe && !plot.empty ? <ReadyGlint w={w} color={tierOf(plot.tier).dot} seed={plot.plot} /> : null}
          {fx?.kind === 'plant' ? <SeedFx key={fx.key} w={w} /> : null}
          {fx?.kind === 'harvest' && fx.harvest ? <HarvestFx key={fx.key} w={w} night={night} harvest={fx.harvest} /> : null}
          {fx?.kind === 'water' ? <WaterFx key={fx.key} w={w} /> : null}
          {fx?.kind === 'tend' ? <TendFx key={fx.key} w={w} /> : null}
          {plot.empty ? null : <View style={[s.badges, { bottom: w * BED_FRAME_TOP - 12 }]}>
            {CARE_KINDS.filter((k) => careOf(plot, k).done).map((k) => <View key={k} style={[s.badge, { backgroundColor: CARE[k].bg }]}><Ionicons name={CARE[k].icon} size={10} color={CARE[k].color} /></View>)}
          </View>}
          {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#FFFFFF" /> : null}
        </View>
      </Hit>
    </View>
  );
}

/** How a plant is doing, on one small line at the foot of its plot, with a dot of its tier's colour. A ready plant says
 * "Thu hoạch" in gold. An empty plot needs no words: its (+) says it. */
function PlotSign({ plot, place }: { plot: GardenPlot; place: ReturnType<typeof plotPlaces>[number] }) {
  const sign = useSignStyles();
  if (plot.empty) return null;
  const { w } = place;
  const ripe = plot.ready ?? plot.grown;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.signSpot, { left: place.x - w / 2, top: place.feet - 16, width: w }]}>
    <View style={[sign.sign, ripe && s.signReady]} testID={ripe ? `garden-plot-${plot.plot}-harvestable` : undefined}>
      {ripe ? <Ionicons name="basket" size={10} color="#7A4E00" /> : <View style={[s.tierDot, { backgroundColor: tierOf(plot.tier).dot }]} />}
      <Text style={[sign.signStage, ripe && s.signStageReady]} numberOfLines={1}>{ripe ? 'Thu hoạch' : plot.stage_label}</Text>
    </View>
  </View>;
}

/** A ready plant: two small sparkles of its tier's colour come and go above it, never in step with its neighbours. No halo. */
function ReadyGlint({ w, color, seed }: { w: number; color: string; seed: number }) {
  const { animate } = useWorldMotion();
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(Animated.timing(run, { toValue: 1, duration: 2400 + (seed * 271) % 900, easing: (x) => x, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [animate, run, seed]);
  const spots = [[0.2, -0.5, 11, [0, 1, 0, 0]], [0.7, -0.74, 9, [0, 0, 1, 0]]] as const;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="garden-ready-glint">
    {spots.map(([fx, fy, px, out], i) => (
      <Animated.View key={i} style={{ position: 'absolute', left: fx * w, top: fy * w, opacity: animate ? run.interpolate({ inputRange: [0, 0.25, 0.5, 1], outputRange: [...out] }) : 0.85 }}>
        <Ionicons name="sparkles" size={px} color={color} />
      </Animated.View>
    ))}
  </View>;
}

/** Harvesting: the plant comes up out of its plot and goes (primary), and what the backend paid floats up from it
 * (secondary): "+40 xu", "+7 EXP". Played after the server's answer, from what it paid, never before. */
function HarvestFx({ w, night, harvest }: { w: number; night: boolean; harvest: NonNullable<GardenFx['harvest']> }) {
  const { animate } = useWorldMotion();
  const run = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const anim = Animated.timing(run, { toValue: 1, duration: 1600, easing: (x) => x, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [animate, run]);
  if (!animate) return null;
  const plantW = w * PLANT_WIDE * plantScale(harvest.art, 4, 5), plantH = plantW * PLANT_TALL;
  const picture = plantArt({ item_id: harvest.item_id, art: harvest.art, stage: 4, stage_count: 5 }, night);
  const lines = [`+${harvest.coins} xu`, ...(harvest.exp > 0 ? [`+${harvest.exp} EXP`] : [])];
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="garden-harvest-fx">
    <Animated.Image source={picture} resizeMode="stretch" fadeDuration={0} style={{ position: 'absolute', width: plantW, height: plantH, left: (w - plantW) / 2,
      bottom: w * BED_SOIL - plantH * (1 - PLANT_FOOT), opacity: run.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [1, 1, 0, 0] }),
      transform: [{ translateY: run.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [0, 6, -w * 0.5, -w * 0.5] }) },
        { scale: run.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [1, 1.04, 0.55, 0.55] }) }] }} />
    {lines.map((text, i) => (
      <Animated.View key={text} style={[s.gain, { top: -w * 0.1 - i * 20, opacity: run.interpolate({ inputRange: [0, 0.3 + i * 0.08, 0.45 + i * 0.08, 0.9, 1], outputRange: [0, 0, 1, 1, 0] }),
        transform: [{ translateY: run.interpolate({ inputRange: [0, 1], outputRange: [10, -w * 0.32] }) }] }]}>
        <View style={[s.gainPill, i === 0 ? s.gainCoins : s.gainExp]}><Text style={[s.gainText, i === 0 ? s.gainTextCoins : s.gainTextExp]}>{text}</Text></View>
      </Animated.View>
    ))}
  </View>;
}

/** How far into the seed's fall it lands, in milliseconds. */
const SEED_LANDS = 420;
const SEEDS = [[0.42, 0, -0.1], [0.5, 0.1, 0.02], [0.58, 0.05, 0.1]] as const;

/** Sowing: a few seeds drop into the soil (primary), a little earth jumps where they land (secondary). The sprout comes up after. */
function SeedFx({ w }: { w: number }) {
  const { animate } = useWorldMotion();
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const anim = Animated.timing(run, { toValue: 1, duration: 900, easing: (x) => x, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [animate, run]);
  if (!animate) return null;
  const land = SEED_LANDS / 900;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="garden-seed-fx">
    {SEEDS.map(([fx, delay, drift], i) => {
      const end = land - 0.1 + delay;
      return <React.Fragment key={i}>
        <Animated.View style={[s.seedDrop, { left: w * fx, bottom: w * BED_SOIL, opacity: run.interpolate({ inputRange: [0, 0.04, end, end + 0.02, 1], outputRange: [0, 1, 1, 0, 0] }),
          transform: [{ translateY: run.interpolate({ inputRange: [0, end, 1], outputRange: [-w * 0.42, 0, 0], easing: EASE.land }) }, { translateX: run.interpolate({ inputRange: [0, end, 1], outputRange: [0, w * drift, w * drift] }) }] }]} />
        <Animated.View style={[s.soilPuff, { left: w * (fx + drift) - 5, bottom: w * BED_SOIL - 3, opacity: run.interpolate({ inputRange: [0, end, end + 0.04, end + 0.3, 1], outputRange: [0, 0, 0.9, 0, 0] }),
          transform: [{ scale: run.interpolate({ inputRange: [0, end, Math.min(1, end + 0.3), 1], outputRange: [0.3, 0.3, 1.5, 1.5] }) }] }]} />
      </React.Fragment>;
    })}
  </View>;
}

const DROPS = [[0.34, 0], [0.42, 0.14], [0.5, 0.05], [0.56, 0.22], [0.64, 0.1], [0.46, 0.3], [0.6, 0.34]] as const;

/** Watering: the can lifts and tips (anticipation), water runs out in drops (primary), each makes a ring on the soil
 * (secondary), and the can rights itself and goes (settle). The soil was already darkening under it. */
function WaterFx({ w }: { w: number }) {
  const { animate, count } = useWorldMotion();
  const run = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const anim = Animated.timing(run, { toValue: 1, duration: 1500, easing: (x) => x, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [animate, run]);
  if (!animate) return null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="garden-water-fx">
    <Animated.View style={{ position: 'absolute', left: w * 0.62, top: -w * 0.42, opacity: run.interpolate({ inputRange: [0, 0.1, 0.86, 1], outputRange: [0, 1, 1, 0] }), transformOrigin: '20% 80%', transform: [
      { translateY: run.interpolate({ inputRange: [0, 0.12, 0.86, 1], outputRange: [10, -4, -4, -10] }) },
      { rotate: run.interpolate({ inputRange: [0, 0.12, 0.2, 0.78, 0.88, 1], outputRange: ['6deg', '10deg', '-34deg', '-34deg', '0deg', '0deg'] }) },
    ] }}>
      <Svg width={w * 0.42} height={w * 0.34} viewBox="0 0 42 34">
        <Path d="M12 12h18v18a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2Z" fill="#7CC4E8" stroke="#2D6E94" strokeWidth={1.8} />
        <Path d="M12 18 3 10" stroke="#2D6E94" strokeWidth={3.4} strokeLinecap="round" />
        <Path d="M0.5 7.5 5.5 12.5" stroke="#2D6E94" strokeWidth={3} strokeLinecap="round" />
        <Path d="M30 15c7-1 9 10 0 12" stroke="#2D6E94" strokeWidth={2} fill="none" />
        <Circle cx={21} cy={6} r={3.6} fill="none" stroke="#2D6E94" strokeWidth={1.8} />
      </Svg>
    </Animated.View>
    {DROPS.slice(0, count(DROPS.length)).map(([fx, delay], i) => {
      const start = 0.2 + delay, end = Math.min(0.94, start + 0.32);
      const t01 = run.interpolate({ inputRange: [0, start, end, 1], outputRange: [0, 0, 1, 1] });
      return <React.Fragment key={i}>
        <Animated.View style={[s.waterDrop, { left: w * fx, top: -w * 0.2, opacity: t01.interpolate({ inputRange: [0, 0.02, 0.92, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: t01.interpolate({ inputRange: [0, 1], outputRange: [0, w * 0.46] }) }] }]} />
        <Animated.View style={[s.waterRing, { left: w * fx - 6, top: w * 0.26, opacity: run.interpolate({ inputRange: [0, end - 0.01, end, Math.min(1, end + 0.14)], outputRange: [0, 0, 0.9, 0], extrapolate: 'clamp' }),
          transform: [{ scale: run.interpolate({ inputRange: [end - 0.01, Math.min(1, end + 0.14)], outputRange: [0.3, 1.3], extrapolate: 'clamp' }) }] }]} />
      </React.Fragment>;
    })}
  </View>;
}

/** Tending: a little sparkle rises around the plant. */
function TendFx({ w }: { w: number }) {
  const { animate } = useWorldMotion();
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animate) return;
    const anim = Animated.timing(run, { toValue: 1, duration: 1000, easing: EASE.rise, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [animate, run]);
  if (!animate) return null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="garden-tend-fx">
    {[[0.2, 0.2, 12], [0.76, 0.12, 14], [0.5, -0.08, 16], [0.34, -0.2, 10]].map(([fx, fy, px], i) => (
      <Animated.View key={i} style={{ position: 'absolute', left: fx * w, top: fy * w, opacity: run.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateY: run.interpolate({ inputRange: [0, 1], outputRange: [8, -w * 0.2] }) }, { scale: run.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.1, 0.8] }) }] }}>
        <Ionicons name="sparkles" size={px} color="#F7C53F" />
      </Animated.View>
    ))}
  </View>;
}

const s = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  fillWidth: { width: '100%', height: '100%' },
  layer: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  plot: { position: 'absolute' },
  bedSpot: { position: 'absolute', bottom: 0 },
  bed: { position: 'absolute', left: 0, bottom: 0 },
  readyRing: { position: 'absolute', borderWidth: 2.5, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.08)' },
  plantWrap: { position: 'absolute' },
  badges: { position: 'absolute', right: '6%', flexDirection: 'row', gap: 2 },
  badge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  signSpot: { position: 'absolute', alignItems: 'center', zIndex: 100 },
  signReady: { backgroundColor: '#FFE59A' },
  signStageReady: { color: '#6B4300', fontWeight: '800' },
  tierDot: { width: 6, height: 6, borderRadius: 3 },
  gain: { position: 'absolute', left: -20, right: -20, alignItems: 'center' },
  gainPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  gainCoins: { backgroundColor: '#FFF1BF' },
  gainExp: { backgroundColor: '#E3F5E6' },
  gainText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  gainTextCoins: { color: '#7A4E00' },
  gainTextExp: { color: '#1F6A2E' },
  seedDrop: { position: 'absolute', width: 5, height: 7, borderRadius: 3, backgroundColor: '#5A3A1E' },
  soilPuff: { position: 'absolute', width: 10, height: 5, borderRadius: 5, backgroundColor: '#C99A68' },
  waterDrop: { position: 'absolute', width: 3.5, height: 7, borderRadius: 3, backgroundColor: '#8ED3F2' },
  waterRing: { position: 'absolute', width: 14, height: 6, borderRadius: 7, borderWidth: 1.2, borderColor: '#BFE8FA' },
});

/** A plant's sign is a label over the scene: the theme's glass and ink, so it reads in light and dark (the scene's own
 * art and effects above stay as drawn; a ripe plant's gold sign too). */
const useSignStyles = makeStyles(({ t }) => StyleSheet.create({
  sign: { maxWidth: '100%', flexDirection: 'row', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm - 4, backgroundColor: t.glass, alignItems: 'center' },
  signStage: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: t.ink, flexShrink: 1 },
}));
