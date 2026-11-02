import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Ellipse, G, Path, Rect, SvgXml } from 'react-native-svg';
import { type Light, mixColor, sunAt } from '../../components/daylight';
import { Text } from '../../components/Typography';
import { GARDEN_PLANTS, SOIL_PLOT } from '../../gardenArt';
import type { CareKind, GardenPlot } from '../../inventory/types';
import { appTheme as t } from '../../theme';
import { radius, type as typeScale } from '../../ui/design';
import { useAtmosphere, useSameValue } from '../../world/atmosphere';
import { useEased, useFrameWatch, useWorldMotion } from '../../world/budget';
import { CloudDeck, Fireflies, Fog, GrassField, LivingPet, type LivingPetHandle, Pond, Rain, Snow, Sway } from '../../world/living';
import { EASE } from '../../world/motion';
import { castBy, SkyBodies, Stars, wave } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { CARE, CARE_KINDS, careOf, growthText } from './gardenUi';

/** A care just confirmed by the server, played once on its plot. */
export type GardenFx = { plot: number; kind: CareKind; key: number };

type Props = {
  plots: GardenPlot[]; busy: number | null;
  /** Plots the chosen tool would act on (outlined). */ ready: (plot: GardenPlot) => boolean;
  labelFor: (plot: GardenPlot) => string; onPress: (plot: GardenPlot) => void;
  /** Points kept for what floats over the scene, at the top and the bottom. */ top: number; bottom: number;
  /** The owner's pet out in its garden; a visitor sees none. */ pet?: { id: string; level: number } | null;
  fx?: GardenFx | null;
  children?: React.ReactNode;
};

/** The bed's height, as a share of the plot's width. */
const BED = 0.46;
// Until the first layout (and in tests) a phone-sized scene.
const FALLBACK = { width: 390, height: 640 };
const COLUMNS = [0.2, 0.5, 0.8];
/** Grass, by share of the ground: [x, y, size]. */
const GRASS = [[0.05, 0.02, 1], [0.92, 0.1, 1.2], [0.34, 0.1, 0.9], [0.66, 0.06, 1.1], [0.04, 0.42, 1.3], [0.95, 0.5, 1.2], [0.36, 0.48, 1.1], [0.65, 0.52, 1.25], [0.17, 0.92, 1.4], [0.83, 0.94, 1.4], [0.5, 0.96, 1.3], [0.28, 0.72, 1]] as const;

/** Where a plot's foot is and how big it is drawn: the back row smaller and higher, for depth; never fewer than the
 * size a finger needs. Same numbers for the same space, so the scene never jumps. */
export function plotPlaces(count: number, width: number, height: number, top: number, bottom: number) {
  const area = Math.max(240, height - top - bottom);
  const base = Math.min(width * 0.29, 118);
  const rows = [{ feet: top + area * 0.58, scale: 0.84 }, { feet: top + area * 0.93, scale: 1 }];
  return Array.from({ length: count }, (_, i) => {
    const row = rows[Math.floor(i / 3) % 2];
    const w = base * row.scale;
    return { x: width * COLUMNS[i % 3], feet: row.feet, w, h: w * 1.18, row: Math.floor(i / 3) };
  });
}

/**
 * The garden as a place: sky and hills by the hour and the weather, a pond, grass that doesn't move in step, and the six
 * plots laid out on the ground. Each plot keeps the same tap, label and data as before. Everything drawn comes from the
 * server's state (what is planted, which stage, what was watered today); nothing here changes it.
 */
export function GardenWorld({ plots, busy, ready, labelFor, onPress, top, bottom, pet, fx, children }: Props) {
  const [size, setSize] = useState(FALLBACK);
  const { reading } = useWeather();
  const { hours, mood, light: c } = useAtmosphere(reading);
  useFrameWatch('garden');
  const cast = useSameValue(castBy(sunAt(hours)));
  const { width, height } = size;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((b) => (b.width === w && b.height === h ? b : { width: w, height: h }));
  };
  const places = useMemo(() => plotPlaces(plots.length, width, height, top, bottom), [plots.length, width, height, top, bottom]);
  const area = Math.max(240, height - top - bottom);
  const horizon = Math.round(top + area * 0.1);

  // The pet stands by the pond; a care just done brings it to that plot's side, then it wanders back.
  const petRef = useRef<LivingPetHandle>(null);
  const petSize = Math.round(Math.min(width * 0.2, 84));
  const homeSpot = { x: width * 0.82, y: horizon + area * 0.2 };
  useEffect(() => {
    if (!fx || !places[fx.plot]) return;
    const place = places[fx.plot];
    const side = fx.plot % 3 === 2 ? -1 : 1;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void petRef.current?.walkTo(place.x + side * (place.w * 0.62), place.feet - 6).then(() => {
      if (!live) return undefined;
      return petRef.current?.act('hop');
    }).then(() => {
      if (live) timer = setTimeout(() => { void petRef.current?.walkTo(homeSpot.x, homeSpot.y); }, 3200);
    });
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [fx?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.fill} onLayout={onLayout} testID="garden-world">
      <Backdrop width={width} height={height} horizon={horizon} c={c} hours={hours} cover={mood.cover} />
      <Pond x={width * 0.07} y={horizon + area * 0.07} width={width * 0.46} height={area * 0.18} water={mixColor(c.sky[1], '#5FB8D8', 0.55)} edge={mixColor(c.meadow, '#6C8C5A', 0.6)} rain={mood.rain > 0.3} wind={mood.wind} />
      <GrassField width={width} height={area * 0.62} top={horizon + area * 0.3} color={mixColor(c.front, '#1E5A2A', 0.3)} wind={mood.wind} spots={GRASS} />
      {pet && pet.level > 0 ? <LivingPet ref={petRef} pet={pet.id} level={pet.level} size={petSize} x={homeSpot.x} y={homeSpot.y} shadow={{ dx: cast.dx, stretch: cast.stretch, opacity: c.shadow }} /> : null}
      {plots.map((plot, i) => <PlotSpot key={plot.plot} plot={plot} place={places[i]} busy={busy === plot.plot} ready={ready(plot)} label={labelFor(plot)} onPress={onPress} wind={mood.wind}
        fx={fx && fx.plot === plot.plot ? fx : null} />)}
      <Fireflies width={width} top={horizon} height={area * 0.8} strength={c.fireflies} />
      <Fog height={height} strength={mood.fog} top={0.2} />
      <Rain width={width} height={height} strength={mood.rain} wind={mood.wind} ground={Math.min(0.9, (horizon + area * 0.3) / height)} />
      <Snow width={width} height={height} strength={mood.snow} />
      {children}
    </View>
  );
}

/** Sky, hills, fence and ground, redrawn only when their colours change. */
const Backdrop = memo(function Backdrop({ width, height, horizon, c, hours, cover }: { width: number; height: number; horizon: number; c: Light; hours: number; cover: number }) {
  const posts = useMemo(() => Array.from({ length: Math.ceil(width / 34) + 1 }, (_, i) => i * 34), [width]);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <LinearGradient colors={c.sky} style={StyleSheet.absoluteFill} />
    {c.stars > 0 ? <Stars width={width} height={horizon} opacity={c.stars} scale={2} testID="garden-stars" /> : null}
    <SkyBodies width={width} hours={hours} c={c} horizon={horizon - 14} zenith={Math.max(48, horizon * 0.4)} clip={horizon + 4} body={92} idPrefix="garden" />
    <CloudDeck width={width} top={Math.max(60, horizon * 0.36)} color={c.cloud} opacity={c.cloudOpacity} cover={cover} scale={1.15} />
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Path d={wave(width, horizon - 26, 10, 1, horizon + 30, 0.6, 12)} fill={mixColor(c.hills[0], c.sky[2], 0.3)} />
      <Path d={wave(width, horizon - 10, 7, 2, horizon + 30, 2.1, 12)} fill={c.hills[1]} />
    </Svg>
    <LinearGradient colors={[c.meadow, mixColor(c.meadow, c.front, 0.6), c.front]} style={{ position: 'absolute', left: 0, right: 0, top: horizon + 6, bottom: 0 }} />
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {/* Bushes behind the fence, the garden path from its gate, and the ground's soft hollows give the place its depth. */}
      {[[0.06, 16], [0.2, 22], [0.33, 14], [0.68, 18], [0.84, 24], [0.97, 15]].map(([fx, r], i) => <G key={fx}>
        <Circle cx={fx * width} cy={horizon + 4 - r * 0.2} r={r} fill={i % 2 ? c.trees[1] : c.trees[3]} />
        <Circle cx={fx * width + r * 0.8} cy={horizon + 6} r={r * 0.72} fill={i % 2 ? c.trees[2] : c.trees[1]} />
      </G>)}
      {[[0.22, 0.34, 0.34, 0.05], [0.78, 0.62, 0.3, 0.06], [0.2, 0.84, 0.4, 0.07]].map(([fx, fy, rx, ry]) => (
        <Ellipse key={fx * fy} cx={fx * width} cy={horizon + fy * (height - horizon)} rx={rx * width} ry={ry * height} fill={mixColor(c.front, '#1E5A2A', 0.3)} opacity={0.22} />
      ))}
      <Path d={`M${width * 0.56} ${horizon + 8} C${width * 0.5} ${horizon + (height - horizon) * 0.3} ${width * 0.72} ${horizon + (height - horizon) * 0.42} ${width * 0.62} ${height}
        L${width * 0.36} ${height} C${width * 0.48} ${horizon + (height - horizon) * 0.42} ${width * 0.4} ${horizon + (height - horizon) * 0.3} ${width * 0.5} ${horizon + 8} Z`} fill={c.path[0]} opacity={0.5} />
      {/* The fence at the back of the garden, on the same light as everything else. */}
      <Rect x={0} y={horizon + 4} width={width} height={3} fill={mixColor(c.trees[0], '#FFFFFF', 0.25)} />
      <Rect x={0} y={horizon + 12} width={width} height={3} fill={mixColor(c.trees[0], '#FFFFFF', 0.25)} />
      {posts.map((x) => <Rect key={x} x={x} y={horizon - 4} width={5} height={24} rx={2} fill={mixColor(c.trees[0], '#FFFFFF', 0.35)} />)}
      {[[0.3, 0.46, 0], [0.74, 0.64, 1], [0.12, 0.72, 2], [0.9, 0.84, 0], [0.58, 0.92, 2], [0.06, 0.94, 1]].map(([fx, fy, i]) => (
        <G key={fx} transform={`translate(${fx * width} ${horizon + fy * (height - horizon)})`}>
          <Ellipse cx={0} cy={0} rx={4} ry={2.4} fill={c.flowers[i]} /><Ellipse cx={5} cy={3} rx={3} ry={2} fill={c.flowers[(i + 1) % 3]} />
        </G>
      ))}
    </Svg>
  </View>;
});

/** The soil gets dark where it was watered today, and dries back when the day's care is over. */
function Moist({ wet, w }: { wet: boolean; w: number }) {
  const opacity = useEased(wet ? 0.5 : 0, 900);
  // Exactly the soil of SOIL_PLOT (56 x 21 of its 64 x 40), drawn fitted to the bed's height.
  const unit = (w * BED) / 40;
  return <Animated.View pointerEvents="none" style={[s.moist, { opacity, width: 54 * unit, height: 20 * unit, left: (w - 54 * unit) / 2, bottom: 10 * unit, borderRadius: 2 }]} testID={wet ? 'garden-soil-wet' : undefined} />;
}

/** A plant arriving or moving to its next stage: pushes up from the soil, overshoots, settles. Only for a change seen
 * here: opening the garden shows every plant at rest. */
function usePop(stage: number | null) {
  const { animate } = useWorldMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const was = useRef(stage);
  useEffect(() => {
    if (was.current === stage) return;
    was.current = stage;
    if (stage === null || !animate) { pop.setValue(1); return; }
    pop.setValue(0);
    const run = Animated.timing(pop, { toValue: 1, duration: 620, easing: EASE.land, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [stage, animate, pop]);
  return pop;
}

function PlotSpot({ plot, place, busy, ready, label, onPress, wind, fx }: { plot: GardenPlot; place: ReturnType<typeof plotPlaces>[number]; busy: boolean; ready: boolean; label: string;
  onPress: (plot: GardenPlot) => void; wind: number; fx: GardenFx | null }) {
  const art = plot.empty ? null : (GARDEN_PLANTS[plot.item_id] ?? GARDEN_PLANTS.seedling)?.[plot.stage];
  const pop = usePop(plot.empty ? null : plot.stage);
  const { w, h } = place;
  // Taller plants bend more, and no two take the same time.
  const depth = plot.empty ? 0 : 1.6 + plot.stage * 0.9;
  return (
    <Pressable onPress={() => onPress(plot)} style={({ pressed }) => [s.plot, { left: place.x - w / 2, top: place.feet - h, width: w, height: h + 34 }, pressed && s.pressed]}
      accessibilityRole="button" accessibilityLabel={label} testID={`garden-plot-${plot.plot}`}>
      <View style={{ width: w, height: h }}>
        {ready ? <View pointerEvents="none" style={[s.readyRing, { width: w * 0.86, height: w * 0.44, left: w * 0.07, bottom: 0, borderRadius: w * 0.2 }]} testID={`garden-plot-${plot.plot}-ready`} /> : null}
        <View style={[s.soil, { height: w * BED }]}><SvgXml xml={SOIL_PLOT} width="100%" height="100%" /></View>
        {plot.empty ? null : <Moist wet={careOf(plot, 'water').done} w={w} />}
        {art ? (
          <Animated.View pointerEvents="none" style={[s.plantWrap, { bottom: w * 0.2, transformOrigin: '50% 100%', transform: [
            { scaleY: pop.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) },
            { scaleX: pop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
          ] }]}>
            <Sway wind={wind} depth={depth} ms={2100 + (plot.plot * 397) % 1300} rest={[0, 900]} style={s.fillWidth}>
              <SvgXml xml={art} width="100%" height="100%" />
            </Sway>
          </Animated.View>
        ) : <View style={[s.plus, { bottom: w * 0.14 }]}><Ionicons name={ready ? 'add-circle' : 'add-circle-outline'} size={24} color={ready ? '#FFFFFF' : 'rgba(255,255,255,0.82)'} /></View>}
        {fx?.kind === 'water' ? <WaterFx key={fx.key} w={w} /> : null}
        {fx?.kind === 'tend' ? <TendFx key={fx.key} w={w} /> : null}
        {plot.empty ? null : <View style={s.badges}>
          {CARE_KINDS.filter((k) => careOf(plot, k).done).map((k) => <View key={k} style={[s.badge, { backgroundColor: CARE[k].bg }]}><Ionicons name={CARE[k].icon} size={10} color={CARE[k].color} /></View>)}
        </View>}
        {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color="#FFFFFF" /> : null}
      </View>
      <View style={s.sign}>
        <Text style={s.signName} numberOfLines={1}>{plot.empty ? 'Ô trống' : plot.name}</Text>
        {plot.empty ? null : <Text style={s.signStage} numberOfLines={1}>{w < 104 ? plot.stage_label : growthText(plot)}</Text>}
      </View>
    </Pressable>
  );
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
    <Animated.View style={{ position: 'absolute', left: w * 0.62, top: -w * 0.04, opacity: run.interpolate({ inputRange: [0, 0.1, 0.86, 1], outputRange: [0, 1, 1, 0] }), transformOrigin: '20% 80%', transform: [
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
        <Animated.View style={[s.waterDrop, { left: w * fx, top: w * 0.14, opacity: t01.interpolate({ inputRange: [0, 0.02, 0.92, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: t01.interpolate({ inputRange: [0, 1], outputRange: [0, w * 0.62] }) }] }]} />
        <Animated.View style={[s.waterRing, { left: w * fx - 6, top: w * 0.76, opacity: run.interpolate({ inputRange: [0, end - 0.01, end, Math.min(1, end + 0.14)], outputRange: [0, 0, 0.9, 0], extrapolate: 'clamp' }),
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
    {[[0.2, 0.7, 12], [0.76, 0.6, 14], [0.5, 0.42, 16], [0.34, 0.3, 10]].map(([fx, fy, px], i) => (
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
  plot: { position: 'absolute', alignItems: 'center' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  soil: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  moist: { position: 'absolute', backgroundColor: '#3A2412' },
  readyRing: { position: 'absolute', borderWidth: 2.5, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.18)' },
  plantWrap: { position: 'absolute', left: '8%', right: '8%', top: 0 },
  plus: { position: 'absolute', alignSelf: 'center' },
  badges: { position: 'absolute', top: 2, right: 0, flexDirection: 'row', gap: 2 },
  badge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sign: { marginTop: 3, maxWidth: '100%', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm - 4, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center' },
  signName: { ...typeScale.micro, color: t.ink },
  signStage: { fontSize: 10, lineHeight: 12, fontWeight: '600', color: t.muted },
  waterDrop: { position: 'absolute', width: 3.5, height: 7, borderRadius: 3, backgroundColor: '#8ED3F2' },
  waterRing: { position: 'absolute', width: 14, height: 6, borderRadius: 7, borderWidth: 1.2, borderColor: '#BFE8FA' },
});
