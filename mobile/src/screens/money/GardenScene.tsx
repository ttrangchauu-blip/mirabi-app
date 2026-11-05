import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { sunAt } from '../../components/daylight';
import { Text } from '../../components/Typography';
import { formatVnd, type FinanceGoal } from '../../life/worlds';
import { appTheme as t } from '../../theme';
import { useAtmosphere } from '../../world/atmosphere';
import { useFrameWatch, useSwing, useTravel, useWorldMotion } from '../../world/budget';
import { Hit, Plate, Triumph, useSize } from '../../world/diorama';
import { Fireflies, Fog, LivingPet, type LivingPetHandle, Rain, Snow } from '../../world/living';
import { castBy, SkyBodies, Stars } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { YardClouds } from '../garden/GardenWorld';
import { BOX_TALL, CanArt, FOOT, GoalGround, GoalTree, groundOrigin, groundTop, PLANT_BLOOM, WateringCan } from './GardenArt';
import { BLOOM, ICON, MEADOW, MEADOW_TALL, RIVER, SAILS, SIGN, SIGN_FACE, SIGN_TALL, VALE, VALE_FENCE, VALE_HUB, VALE_SAIL_REACH, VALE_TALL } from './gardenAssets';

/** Points at the top of the garden kept for the header and the tabs floating over its sky. */
export const CHROME = 118;
/** Pet's size on the lawn. */
const PET = 62;
/** A plant not picked stands smaller and further back; the picked one comes forward. */
const FAR = 0.62;
const BACK = -12;
/** Where a tag starts, below a plant's foot, in lengths of the plant's world. */
const TAG_BELOW = 0.34;

/** What a folded card takes of the page under the garden, its margins included. */
const FOLDED_CARD = 123;

/**
 * The land under the header, by the height of the screen. With the card folded away the garden takes its room: all of
 * `room`, the height the page really has between the top and the tab bar, once that is known.
 */
export const landFor = (screen: number, folded: boolean, room?: number) => {
  const open = Math.round(Math.max(250, Math.min(400, screen * 0.44)));
  if (!folded) return open;
  return Math.round(Math.max(open, Math.min(720, room ? room - CHROME - FOLDED_CARD : screen - 360)));
};

/** Everything's place, as it follows from the room there is. `world` is points to one unit of the rendered plants. */
export function gardenLayout(width: number, land: number) {
  const scene = CHROME + land;
  const world = land * 0.18;
  // Far enough apart that two crowns in full bloom can't touch, whichever is picked.
  const slot = Math.max(Math.round(width * 0.4), Math.round(world * 2.4));
  const pad = Math.max(0, (width - slot) / 2);
  const box = 4.2 * world;
  // Room below the foot for the tag, which hangs further down the larger the plants are, and for the card's edge over the garden.
  const feet = scene - Math.max(96, Math.round(world * TAG_BELOW + 74));
  const valeTall = Math.max(land * 0.76, (width * 1.2) * VALE_TALL);
  const valeWide = valeTall / VALE_TALL;
  const valeTop = CHROME - 10 - (valeTall - land * 0.76);
  const fence = valeTop + valeTall * VALE_FENCE;
  const meadowWide = Math.round((land * 0.47) / MEADOW_TALL);
  const meadowTall = meadowWide * MEADOW_TALL;
  return { scene, world, slot, pad, box, feet, valeTall, valeWide, valeTop, fence, meadowTall, meadowWide, centerOf: (i: number) => pad + i * slot + slot / 2 };
}
type Layout = ReturnType<typeof gardenLayout>;

/** The pet stands on the back lawn beside the picked plant, on the side where the neighbour is smaller: behind the plants, so it never hides one. */
export function petSpot(goals: FinanceGoal[], index: number, l: Layout) {
  const at = Math.max(0, index);
  const left = at > 0 ? goals[at - 1].stage : -1;
  const right = at < goals.length - 1 ? goals[at + 1].stage : 0;
  const side = left < right ? -1 : 1;
  return { x: l.centerOf(at) + side * l.slot * 0.68, y: l.fence + 14 };
}

function useFocus(ids: number[], selected: number | null, instant: boolean) {
  const values = useRef(new Map<number, Animated.Value>()).current;
  const of = (id: number) => {
    let v = values.get(id);
    if (!v) { v = new Animated.Value(id === selected ? 1 : 0); values.set(id, v); }
    return v;
  };
  const key = ids.join(',');
  useEffect(() => {
    const runs = ids.map((id) => {
      const to = id === selected ? 1 : 0;
      if (instant) { of(id).setValue(to); return null; }
      return Animated.timing(of(id), { toValue: to, duration: 420, useNativeDriver: true });
    }).filter(Boolean) as Animated.CompositeAnimation[];
    const all = Animated.parallel(runs);
    all.start();
    return () => all.stop();
  }, [selected, key, instant]); // eslint-disable-line react-hooks/exhaustive-deps
  return of;
}

/** Sparks of light coming and going round a plant that has reached its goal. */
const SPARKS = [[-0.9, -0.6, 13], [0.86, -0.92, 11], [-0.42, -1.5, 9], [0.34, -1.72, 12], [1.02, -0.2, 9], [-1.08, -1.25, 10]];
const Sparks = memo(function Sparks({ world, color }: { world: number; color: string }) {
  const clock = useTravel({ ms: 3400 });
  return <>{SPARKS.map(([x, y, size], i) => {
    return (
      <Animated.View key={i} style={{ position: 'absolute', left: x * world - size / 2, top: y * world - size / 2, opacity: clock.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: i % 2 ? [0, 1, 0, 0, 0] : [0, 0, 0, 1, 0] }) }}>
        <Ionicons name="sparkles" size={size} color={color} />
      </Animated.View>
    );
  })}</>;
});

/** The far valley moves slower than the lawn, and everything in it that is alive moves with it: the windmill's sails, the river's light, and a pale rainbow behind. */
const Valley = memo(function Valley({ l, width, scrollX, maxScroll, night, rainbow, weak }: { l: Layout; width: number; scrollX: Animated.Value; maxScroll: number; night: number; rainbow: number; weak: boolean }) {
  // It starts with the windmill on the right of the screen and the river on the left, and has what is left of its width to slide over.
  const start = Math.max(0, Math.min(l.valeWide - width, VALE_HUB[0] * l.valeWide - width * 0.78));
  const range = Math.max(0, Math.min(l.valeWide - width - start, maxScroll * 0.3));
  const shift = useMemo(() => (maxScroll > 0 && range > 0 ? scrollX.interpolate({ inputRange: [0, maxScroll], outputRange: [-start, -start - range], extrapolate: 'clamp' }) : -start), [scrollX, maxScroll, range, start]);
  const turn = useTravel({ ms: 15000 });
  const flow = useTravel({ ms: 3600, enabled: !weak });
  const reach = VALE_SAIL_REACH * l.valeWide;
  const hub = { x: VALE_HUB[0] * l.valeWide, y: VALE_HUB[1] * l.valeTall };
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: l.valeTop, width: l.valeWide, height: l.valeTall, transform: [{ translateX: shift as any }] }}>
      {rainbow > 0.02 ? <Rainbow x={start + width * 0.62} y={l.valeTall * 0.46} radius={l.valeTall * 0.4} opacity={rainbow} /> : null}
      <Plate source={VALE.day} width={l.valeWide} height={l.valeTall} />
      {night > 0.01 ? <Plate source={VALE.night} width={l.valeWide} height={l.valeTall} opacity={night} /> : null}
      <Animated.View style={{ position: 'absolute', left: hub.x - reach, top: hub.y - reach, width: reach * 2, height: reach * 2, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }} testID="windmill-sails">
        <Plate source={SAILS.day} width={reach * 2} height={reach * 2} />
        {night > 0.01 ? <Plate source={SAILS.night} width={reach * 2} height={reach * 2} opacity={night} /> : null}
      </Animated.View>
      {weak ? null : RIVER.map(([x, y, wide], i) => {
        const size = wide * l.valeWide * 0.5, phase = (i * 0.37) % 1;
        return <Animated.View key={i} style={[s.glint, { left: x * l.valeWide - size / 2, top: y * l.valeTall, width: size, height: Math.max(1.5, size * 0.1), opacity: flow.interpolate({ inputRange: [0, phase * 0.5 + 0.01, phase * 0.5 + 0.25, phase * 0.5 + 0.5, 1], outputRange: [0, 0, 0.85 * (1 - night * 0.6), 0, 0] }),
          transform: [{ translateX: flow.interpolate({ inputRange: [0, 1], outputRange: [size * 0.2, -size * 0.2] }) }] }]} />;
      })}
    </Animated.View>
  );
});

/** A pale rainbow, in the live sky behind the hills. */
const BANDS = ['#F47C7C', '#F7B267', '#F6E27F', '#8FD694', '#7CC6F2', '#A99BF0'];
const Rainbow = memo(function Rainbow({ x, y, radius, opacity }: { x: number; y: number; radius: number; opacity: number }) {
  const band = Math.max(2.5, radius * 0.035);
  const size = (radius + band) * 2;
  return (
    <View style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, opacity: 0.34 * opacity }} testID="garden-rainbow">
      <Svg width={size} height={size}>{BANDS.map((color, i) => <Circle key={color} cx={size / 2} cy={size / 2} r={radius - i * band} stroke={color} strokeWidth={band} fill="none" />)}</Svg>
    </View>
  );
});

/** The lawn the plants stand on: it moves with them. */
const Meadow = memo(function Meadow({ l, stripWidth, night }: { l: Layout; stripWidth: number; night: number }) {
  const tiles = Array.from({ length: Math.ceil(stripWidth / l.meadowWide) + 1 }, (_, i) => i * l.meadowWide);
  const top = l.scene - l.meadowTall;
  return <View style={[StyleSheet.absoluteFill, s.clip]} pointerEvents="none">
    {night < 0.99 ? tiles.map((x) => <Plate key={x} source={MEADOW.day} width={l.meadowWide} height={l.meadowTall} style={{ left: x, top }} />) : null}
    {night > 0.01 ? tiles.map((x) => <Plate key={x} source={MEADOW.night} width={l.meadowWide} height={l.meadowTall} opacity={night} style={{ left: x, top }} />) : null}
  </View>;
});

/** The wooden board on its branch, top left: the sum of what is saved in the goals on show, written live. It hangs still enough to read. */
const SavingsSign = memo(function SavingsSign({ total, width, night, top }: { total: number; width: number; night: number; top: number }) {
  const swing = useSwing({ ms: 3400, rest: [0, 1200] });
  const wide = Math.min(244, width * 0.64);
  const tall = wide * SIGN_TALL;
  const [[x0, y0], [x1, y1]] = SIGN_FACE;
  // Written in pale paint once the board has gone dark, so it can still be read.
  const dark = night > 0.45;
  const face = { left: x0 * wide, top: y0 * tall, width: (x1 - x0) * wide, height: (y1 - y0) * tall };
  return (
    <Animated.View pointerEvents="none" style={[s.sign, { top, width: wide, height: tall, transformOrigin: '50% 12%', transform: [{ rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: ['-0.6deg', '0.6deg'] }) }] }]} testID="savings-sign">
      <Plate source={SIGN.day} width={wide} height={tall} />
      {night > 0.01 ? <Plate source={SIGN.night} width={wide} height={tall} opacity={night} /> : null}
      <View style={[s.signFace, face]} accessible accessibilityLabel={`Tổng tiết kiệm ${formatVnd(total)}`}>
        <View style={s.signRow}>
          <Image source={ICON.piggy} style={s.signIcon} fadeDuration={0} accessibilityIgnoresInvertColors />
          <Text style={[s.signLabel, dark && s.signTextNight]} numberOfLines={1}>Tổng tiết kiệm</Text>
        </View>
        <Text style={[s.signValue, dark && s.signTextNight]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>{formatVnd(total)}</Text>
      </View>
    </Animated.View>
  );
});

/** A butterfly, wandering over the lawn with its wings beating. */
const Butterfly = memo(function Butterfly({ source, x, y, size, reach, ms, delay }: { source: ImageSourcePropType; x: number; y: number; size: number; reach: number; ms: number; delay: number }) {
  const path = useTravel({ ms, delay });
  const wing = useTravel({ ms: 340 });
  return (
    <Animated.View style={{ position: 'absolute', left: x, top: y, width: size, height: size, transform: [
      { translateX: path.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, reach, reach * 0.35, -reach * 0.6, 0] }) },
      { translateY: path.interpolate({ inputRange: [0, 0.2, 0.45, 0.7, 1], outputRange: [0, -18, 9, -12, 0] }) },
      { rotate: path.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: ['14deg', '20deg', '-14deg', '-20deg', '14deg'] }) },
    ] }}>
      <Animated.Image source={source} style={{ width: size, height: size, transform: [{ scaleX: wing.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.32, 1] }) }] }} fadeDuration={0} />
    </Animated.View>
  );
});

/** A petal on the wind, right across the garden. */
const DriftPetal = memo(function DriftPetal({ width, top, drop, color, ms, delay }: { width: number; top: number; drop: number; color: string; ms: number; delay: number }) {
  const path = useTravel({ ms, delay });
  return <Animated.View style={[s.driftPetal, { backgroundColor: color, top, opacity: path.interpolate({ inputRange: [0, 0.06, 0.92, 1], outputRange: [0, 0.95, 0.95, 0] }), transform: [
    { translateX: path.interpolate({ inputRange: [0, 1], outputRange: [width + 12, -20] }) },
    { translateY: path.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: [0, drop * 0.4, drop * 0.45, drop] }) },
    { rotate: path.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '540deg'] }) },
  ] }]} />;
});

/** One goal's ground: under every plant and the pet. */
const SlotGround = memo(function SlotGround({ goal, index, l, focus, night }: { goal: FinanceGoal; index: number; l: Layout; focus: Animated.Value; night: number }) {
  const top = l.feet - l.box * BOX_TALL * FOOT.y + groundTop(l.box);
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: l.centerOf(index) - l.box * FOOT.x, top, width: l.box, transformOrigin: groundOrigin, transform: [
      { translateY: focus.interpolate({ inputRange: [0, 1], outputRange: [BACK, 0] }) }, { scale: focus.interpolate({ inputRange: [0, 1], outputRange: [FAR, 1] }) }] }}>
      <GoalGround plant={goal.plant} stage={goal.stage} size={l.box} night={night} />
    </Animated.View>
  );
});

/** One goal's plant, its name and its bar: the whole of it takes a finger. */
const Slot = memo(function Slot({ goal, index, l, focus, picked, wind, rustle, night, still, onPick }: { goal: FinanceGoal; index: number; l: Layout; focus: Animated.Value; picked: boolean; wind: number;
  rustle: number; night: number; still: boolean; onPick: (id: number) => void }) {
  const { level } = useWorldMotion();
  const done = goal.percent >= 100;
  const center = l.slot / 2;
  return (
    <Pressable onPress={() => onPick(goal.id)} style={[s.slot, { left: l.pad + index * l.slot, width: l.slot, height: l.scene - CHROME }]} accessibilityRole="button"
      accessibilityState={{ selected: picked }} accessibilityLabel={`${goal.name}: ${goal.stage_name}, ${goal.percent}%`} testID={`tree-${goal.id}`}>
      <Animated.View pointerEvents="none" style={[s.plantWrap, { left: center - l.box * FOOT.x, top: l.feet - CHROME - l.box * BOX_TALL * FOOT.y, width: l.box, height: l.box * BOX_TALL,
        transformOrigin: `${FOOT.x * 100}% ${FOOT.y * 100}%`, transform: [{ translateY: focus.interpolate({ inputRange: [0, 1], outputRange: [BACK, 0] }) }, { scale: focus.interpolate({ inputRange: [0, 1], outputRange: [FAR, 1] }) }] }]}>
        <GoalTree plant={goal.plant} stage={goal.stage} size={l.box} wind={wind} rustle={rustle} night={night} still={still} />
        {done && level === 'full' && !still ? <View style={{ position: 'absolute', left: l.box * FOOT.x, top: l.box * BOX_TALL * FOOT.y }}><Sparks world={l.world} color={PLANT_BLOOM.sunflower} /></View> : null}
      </Animated.View>
      <View pointerEvents="none" style={[s.tag, picked && s.tagOn, { top: l.feet - CHROME + l.world * TAG_BELOW, left: (l.slot - Math.min(l.slot - 8, 128)) / 2, width: Math.min(l.slot - 8, 128) }]}>
        <Text style={s.tagName} numberOfLines={1}>{goal.name}</Text>
        <Text style={s.tagPercent}>{goal.percent}%</Text>
        <View style={s.tagTrack}><View style={[s.tagFill, { width: `${Math.max(0, Math.min(100, goal.percent))}%` }]} /></View>
      </View>
    </Pressable>
  );
});

/**
 * Vườn tài chính's garden, a real place: the sky of this hour and the weather really outside, a far valley rendered in 3D that slides slower than the lawn, and on the lawn one
 * plant per goal in a row you walk along with a finger. Picking a plant brings it to the middle and forward. The pet is the user's own, or nobody. Nothing here moves money: a tap
 * picks a plant and rustles it, and the can by the last plot only waters for the fun of it.
 */
export function GardenScene({ goals, selected, onSelect, onNew, watering, burst, land, pet }: { goals: FinanceGoal[]; selected: number | null; onSelect: (id: number) => void; onNew: () => void;
  watering: number; burst: number; land: number; pet?: { id: string; level: number } | null }) {
  const [size, onLayout] = useSize({ width: 384, height: CHROME + land });
  const { width } = size;
  const l = useMemo(() => gardenLayout(width, land), [width, land]);
  const { reading } = useWeather();
  const { hours, mood, light: c } = useAtmosphere(reading);
  const { animate, level } = useWorldMotion();
  useFrameWatch('money-garden');
  const night = c.stars;
  const count = goals.length + 1;
  const stripWidth = Math.max(width, l.pad * 2 + count * l.slot);
  const maxScroll = Math.max(0, stripWidth - width);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scroll = useRef<ScrollView>(null);
  const index = goals.findIndex((g) => g.id === selected);
  const at = Math.max(0, index);
  const [rustle, setRustle] = useState<{ id: number; n: number }>({ id: 0, n: 0 });
  const [justForFun, setJustForFun] = useState(0);
  const [canNote, setCanNote] = useState(false);
  // What has been looked at last: plants far from it hold still.
  const [around, setAround] = useState(at);
  useEffect(() => {
    if (!canNote) return;
    const id = setTimeout(() => setCanNote(false), 3200);
    return () => clearTimeout(id);
  }, [canNote]);
  const ids = useMemo(() => goals.map((g) => g.id), [goals]);
  const focusOf = useFocus(ids, selected, level === 'still');

  // Picking a plant walks the camera to it. The first picture is simply there.
  const placed = useRef(false);
  useEffect(() => {
    if (index < 0) return;
    setAround(index);
    scroll.current?.scrollTo({ x: index * l.slot, animated: placed.current && animate });
    placed.current = true;
  }, [index, l.slot, animate]);

  // The pet walks over to the picked plant. It comes back to where it belongs if the room changes.
  const petRef = useRef<LivingPetHandle>(null);
  const spot = petSpot(goals, index, l);
  const home = useRef({ key: '', x: spot.x, y: spot.y });
  const petKey = `${width}:${land}`;
  if (home.current.key !== petKey) home.current = { key: petKey, x: spot.x, y: spot.y };
  const hasPet = !!pet && pet.level > 0;
  useEffect(() => { if (hasPet) void petRef.current?.walkTo(spot.x, spot.y); }, [hasPet, spot.x, spot.y]);
  const seen = useRef(burst);
  useEffect(() => {
    if (burst === seen.current) return;
    seen.current = burst;
    void petRef.current?.act('celebrate');
  }, [burst]);
  const cast = castBy(sunAt(hours));
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const onPick = useRef((id: number) => { pick.current(id); setRustle((r) => ({ id, n: r.n + 1 })); }).current;
  const total = useMemo(() => goals.reduce((sum, g) => sum + g.saved_amount, 0), [goals]);
  const center = l.centerOf(at);
  const plotCenter = l.centerOf(goals.length);
  const horizon = l.valeTop + l.valeTall * 0.33;
  const clear = 1 - night;
  const rainbow = Math.max(0, clear * (1 - mood.cover * 1.2) * (1 - mood.rain * 2) * (1 - mood.fog * 2));
  const onSettle = (x: number) => setAround(Math.round(x / l.slot));
  const lively = level === 'full' && clear > 0.6 && mood.rain < 0.1 && mood.snow < 0.1;
  return (
    <View style={[s.garden, { height: l.scene }]} onLayout={onLayout} testID="garden-scene">
      <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <LinearGradient colors={[c.sky[0], c.sky[1], c.sky[2]]} end={{ x: 0, y: Math.min(1, (horizon + 40) / l.scene) }} style={StyleSheet.absoluteFill} />
        <Stars width={width} height={horizon} opacity={night} />
        <SkyBodies width={width} hours={hours} c={c} horizon={horizon + 6} zenith={8} clip={horizon + 18} body={64} idPrefix="money" />
        <YardClouds width={width} top={8} horizon={horizon} opacity={c.cloudOpacity} night={night} cover={Math.max(mood.cover, 0.5)} />
        <Valley l={l} width={width} scrollX={scrollX} maxScroll={maxScroll} night={night} rainbow={rainbow} weak={level !== 'full'} />
      </View>
      <Animated.ScrollView ref={scroll as any} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ width: stripWidth, height: l.scene }} scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        onMomentumScrollEnd={(e) => onSettle(e.nativeEvent.contentOffset.x)} onScrollEndDrag={(e) => onSettle(e.nativeEvent.contentOffset.x)}>
        <Meadow l={l} stripWidth={stripWidth} night={night} />
        <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {/* Flowers in the near corners where the row begins and ends. */}
          <Corner source={BLOOM.l} night={night} wide={Math.min(l.pad * 1.1, 150)} left={-8} top={l.scene - 18} />
          <Corner source={BLOOM.r} night={night} wide={Math.min(l.pad * 1.1, 150)} left={stripWidth - Math.min(l.pad * 1.1, 150) + 8} top={l.scene - 18} />
          <View style={{ position: 'absolute', left: plotCenter - l.box * FOOT.x, top: l.feet + BACK - l.box * BOX_TALL * FOOT.y + groundTop(l.box), width: l.box, transformOrigin: groundOrigin, transform: [{ scale: FAR }] }}>
            <GoalGround plant={null} size={l.box} night={night} />
          </View>
          {goals.map((g, i) => <SlotGround key={g.id} goal={g} index={i} l={l} focus={focusOf(g.id)} night={night} />)}
          {hasPet ? <LivingPet key={home.current.key} ref={petRef} pet={pet!.id} level={pet!.level} size={PET} x={home.current.x} y={home.current.y} shadow={{ dx: cast.dx, stretch: cast.stretch, opacity: c.shadow }} /> : null}
        </View>
        {goals.map((g, i) => <Slot key={g.id} goal={g} index={i} l={l} focus={focusOf(g.id)} picked={g.id === selected} wind={mood.wind} rustle={rustle.id === g.id ? rustle.n : 0}
          night={night} still={Math.abs(i - around) > 2} onPick={onPick} />)}
        <Pressable onPress={onNew} accessibilityRole="button" accessibilityLabel="Gieo mục tiêu mới" style={[s.slot, { left: l.pad + goals.length * l.slot, width: l.slot, height: l.scene - CHROME }]} testID="new-goal-plot">
          <View pointerEvents="none" style={[s.plus, { top: l.feet + BACK - CHROME - l.world * 0.62 }]}>
            <Svg width={72} height={72} style={StyleSheet.absoluteFill}>
              <Defs><RadialGradient id="plot-glow" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#FFF3B8" stopOpacity={0.95} /><Stop offset="1" stopColor="#FFF3B8" stopOpacity={0} /></RadialGradient></Defs>
              <Ellipse cx={36} cy={36} rx={36} ry={36} fill="url(#plot-glow)" />
            </Svg>
            <Ionicons name="add" size={38} color="#F2A92E" />
          </View>
          <View pointerEvents="none" style={[s.tag, s.plotTag, { top: l.feet - CHROME + l.world * TAG_BELOW, left: (l.slot - Math.min(l.slot - 8, 128)) / 2, width: Math.min(l.slot - 8, 128) }]}><Text style={s.tagName}>Gieo hạt mới</Text></View>
        </Pressable>
        {goals.length ? (
          <View style={[s.canSpot, { left: plotCenter + l.slot * 0.42, top: l.feet - 30 }]}>
            <Hit onPress={() => { setJustForFun((n) => n + 1); setCanNote(true); }} accessibilityRole="button" accessibilityLabel="Tưới cây cho vui" accessibilityHint="Chỉ là hoạt ảnh, không thay đổi số tiền">
              <CanArt size={46} />
            </Hit>
          </View>
        ) : null}
        <WateringCan key={`w${watering}`} play={watering} x={center + l.world * 0.3} y={l.feet - l.box * BOX_TALL * 0.5} />
        <WateringCan key={`f${justForFun}`} play={justForFun} x={center + l.world * 0.3} y={l.feet - l.box * BOX_TALL * 0.5} />
        <Triumph play={burst} color={goals[at] ? PLANT_BLOOM[goals[at].plant] : '#F9BBD0'} size={Math.round(l.world * 5)} style={{ left: center, top: l.feet - l.world * 1.3 }} />
      </Animated.ScrollView>
      <SavingsSign total={total} width={width} night={night} top={CHROME - 8} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {lively ? <>
          <Butterfly source={ICON.fly[0]} x={width * 0.14} y={l.fence + 22} size={21} reach={width * 0.24} ms={13000} delay={0} />
          <Butterfly source={ICON.fly[1]} x={width * 0.66} y={l.fence - 8} size={17} reach={width * 0.2} ms={16500} delay={1800} />
          <Butterfly source={ICON.fly[2]} x={width * 0.42} y={l.feet - 34} size={19} reach={width * 0.3} ms={19000} delay={4200} />
          <DriftPetal width={width} top={CHROME + 30} drop={land * 0.5} color="#FBC4D8" ms={15000} delay={0} />
          <DriftPetal width={width} top={CHROME + 74} drop={land * 0.42} color="#FFE0EA" ms={19000} delay={5200} />
          <DriftPetal width={width} top={CHROME + 8} drop={land * 0.62} color="#F9A8C8" ms={23000} delay={10400} />
        </> : null}
        <Fog height={l.scene} strength={mood.fog} />
        <Rain width={width} height={l.scene} strength={mood.rain} wind={mood.wind} ground={0.7} />
        <Snow width={width} height={l.scene} strength={mood.snow} />
        <Fireflies width={width} top={horizon} height={l.scene - horizon} strength={c.fireflies} />
      </View>
      {canNote ? <View style={[s.tag, s.canNote]}><Text style={s.canNoteText} accessibilityLiveRegion="polite">Cây vui lắm! Cây chỉ lớn khi bạn ghi một khoản tiết kiệm.</Text></View> : null}
    </View>
  );
}

function Corner({ source, night, wide, left, top }: { source: { day: ImageSourcePropType; night: ImageSourcePropType }; night: number; wide: number; left: number; top: number }) {
  const tall = wide * 0.7;
  return <>
    <Plate source={source.day} width={wide} height={tall} style={{ left, top: top - tall }} />
    {night > 0.01 ? <Plate source={source.night} width={wide} height={tall} opacity={night} style={{ left, top: top - tall }} /> : null}
  </>;
}

const s = StyleSheet.create({
  garden: { overflow: 'hidden', backgroundColor: '#BFE3F5' },
  clip: { overflow: 'hidden' },
  glint: { position: 'absolute', borderRadius: 3, backgroundColor: '#FFFFFF' },
  sign: { position: 'absolute', left: -6, zIndex: 2 },
  signFace: { position: 'absolute', justifyContent: 'center', paddingHorizontal: 10, gap: 1 },
  signRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  signIcon: { width: 17, height: 17 },
  signTextNight: { color: '#FFF3D6' },
  signLabel: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#4A3418' },
  signValue: { fontSize: 17, fontWeight: '900', color: t.ink },
  slot: { position: 'absolute', top: CHROME },
  plantWrap: { position: 'absolute' },
  plus: { position: 'absolute', alignSelf: 'center', width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1.5, borderColor: '#F0DFC0',
    shadowColor: t.shadow, shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  tagOn: { borderColor: '#7CC6F2', backgroundColor: '#FFFFFF' },
  plotTag: { paddingVertical: 8 },
  tagName: { fontSize: 12, fontWeight: '900', color: t.ink },
  tagPercent: { fontSize: 11, fontWeight: '800', color: '#22703A' },
  tagTrack: { alignSelf: 'stretch', height: 5, borderRadius: 3, marginTop: 2, backgroundColor: '#DCEFE2', overflow: 'hidden' },
  tagFill: { height: 5, borderRadius: 3, backgroundColor: '#3FA45A' },
  canSpot: { position: 'absolute' },
  canNote: { left: 14, right: 14, top: 128, zIndex: 4 },
  canNoteText: { fontSize: 13, lineHeight: 18, fontWeight: '800', color: t.ink },
  driftPetal: { position: 'absolute', left: 0, width: 7, height: 5, borderRadius: 3 },
});
