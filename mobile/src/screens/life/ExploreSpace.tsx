import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import type { User } from '../../auth/AuthContext';
import { type Light, mixColor, sunAt } from '../../components/daylight';
import { Text } from '../../components/Typography';
import { lifeEligible } from '../../life/access';
import { petById } from '../../pets';
import { hasSprite, WALK_CYCLE_MS } from '../../petSprites';
import { appTheme as t } from '../../theme';
import { type as typeScale } from '../../ui/design';
import { Button, ProgressBar } from '../../ui/kit';
import { useAtmosphere, useSameValue } from '../../world/atmosphere';
import { useFrameWatch, useTravel, useWorldMotion } from '../../world/budget';
import { CloudDeck, Fireflies, Fog, GrassField, LivingPet, type LivingPetHandle, Rain, Snow, WeatherChip, WorldPanel } from '../../world/living';
import { EASE } from '../../world/motion';
import { castBy, type Cast, Glow, SkyBodies, Stars, wave } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { formatRemaining, normalizePetSpace, type PetSpace } from '../main/petSpace';
import { request } from '../main/shared';

type Props = {
  user: User; top: number; bottom: number;
  /** Changes after the gift popup is confirmed: the walk is read again. */ version: number;
  onOpenGifts: () => Promise<void> | void; onOpenInventory: () => void; onOpenQuests: () => void;
  /** Phiêu lưu cuộc sống, for those aged 16 and over. */ onOpenAdventure?: () => void;
  /** Every answer of /api/pet/space, for the hatching to follow. */ onPetSpace?: (space: unknown) => void;
};

const FALLBACK = { width: 390, height: 680 };
/** How much road the pet covers per full loop of its walk strip, as a share of its size. */
const STRIDE_SHARE = 0.62;

/**
 * Khám phá: the pet's walk as a place. All the walk's rules stay in companion.py: this screen only reads
 * /api/pet/space, and never starts, ends or rewards anything by itself (the gift stays in the app's own popup).
 * - On its way, the pet really walks a road: the camera follows it, and the road and the strip are driven by one value,
 *   so its feet stay on the ground at any screen width.
 * - It leaves from the gate and comes back along the same road, glad to be home, with what it found still wrapped up.
 */
export function ExploreSpace({ user, top, bottom, version, onOpenGifts, onOpenInventory, onOpenQuests, onOpenAdventure, onPetSpace }: Props) {
  const [space, setSpace] = useState<PetSpace | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(FALLBACK);
  // Only the latest answer counts: one that started before the gift was confirmed is out of date.
  const loads = useRef(0);
  const onPetSpaceRef = useRef(onPetSpace);
  onPetSpaceRef.current = onPetSpace;
  const load = useCallback(async () => {
    const id = ++loads.current;
    try {
      const answer = normalizePetSpace(await request('/api/pet/space'));
      if (id !== loads.current) return;
      setFailed(false);
      setSpace(answer);
      if (answer) onPetSpaceRef.current?.(answer);
    } catch { if (id === loads.current) setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load, version]);
  useEffect(() => {
    if (space?.status === 'walking' || space?.status === 'rested') return;
    const timer = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(timer);
  }, [space?.status, load]);

  const pet = petById(user.pet);
  const name = user.pet_name ?? pet.name;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((b) => (b.width === width && b.height === height ? b : { width, height }));
  };
  return (
    <View style={s.fill} onLayout={onLayout} testID="explore-space">
      <Road width={size.width} height={size.height} pet={pet.id} level={user.level} status={space?.status ?? 'rested'} bottom={bottom} />
      <Weather top={top + 8} />
      <View style={[s.dock, { bottom: bottom + 10 }]} pointerEvents="box-none">
        {!space ? (
          <WorldPanel>
            {failed ? <Pressable onPress={() => { setFailed(false); void load(); }} accessibilityRole="button" style={s.retry}>
              <Ionicons name="refresh" size={16} color={t.accent} /><Text style={s.retryText}>Chưa tải được chuyến đi. Chạm để thử lại</Text>
            </Pressable> : <View style={s.retry}><ActivityIndicator color={t.accent} accessibilityLabel="Đang xem pet đi đâu" /></View>}
          </WorldPanel>
        ) : <Journey space={space} name={name} egg={user.level === 0} onExpired={load} onOpenGifts={onOpenGifts} onOpenInventory={onOpenInventory} onOpenQuests={onOpenQuests}
          onOpenAdventure={lifeEligible(user) ? onOpenAdventure : undefined} />}
      </View>
    </View>
  );
}

/** The real weather, small, in the corner of the sky; nothing at all without a reading. */
function Weather({ top }: { top: number }) {
  const { reading } = useWeather();
  const { night } = useAtmosphere(reading);
  if (!reading) return null;
  return <View style={[s.topRow, { top }]} pointerEvents="none"><WorldPanel style={s.weather}><WeatherChip night={night} /></WorldPanel></View>;
}

// ------------------------------------------------------------------------------------------------ the panel
/** What the walk is at, in words. The second-by-second countdown lives here alone, so the road never re-renders for it. */
function Journey({ space, name, egg, onExpired, onOpenGifts, onOpenInventory, onOpenQuests, onOpenAdventure }: {
  space: PetSpace; name: string; egg: boolean; onExpired: () => void; onOpenGifts: Props['onOpenGifts']; onOpenInventory: () => void; onOpenQuests: () => void; onOpenAdventure?: () => void;
}) {
  const offset = useRef(0);
  if (space.server_now) offset.current = Date.parse(space.server_now) - Date.now();
  const left = useCallback(() => (space.return_at ? Math.max(0, Math.ceil((Date.parse(space.return_at) - Date.now() - offset.current) / 1000)) : space.seconds_left),
    [space.return_at, space.seconds_left]);
  const [seconds, setSeconds] = useState(left);
  const walking = space.status === 'walking';
  useEffect(() => {
    if (!walking) return;
    setSeconds(left());
    const timer = setInterval(() => {
      const next = left();
      setSeconds(next);
      if (next <= 0) { clearInterval(timer); onExpired(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [walking, left, onExpired]);
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try { await onOpenGifts(); } finally { setOpening(false); }
  };
  const adventure = onOpenAdventure ? (
    <Pressable onPress={onOpenAdventure} style={s.link} accessibilityRole="button" accessibilityLabel="Phiêu lưu cuộc sống: Hoạt động thật, bản đồ phiêu lưu" testID="open-adventure" hitSlop={6}>
      <Ionicons name="map-outline" size={15} color={t.accent} /><Text style={s.linkText}>Phiêu lưu cuộc sống</Text>
    </Pressable>
  ) : null;
  const inventory = (
    <Pressable onPress={onOpenInventory} style={s.link} accessibilityRole="button" accessibilityLabel="Kho đồ" hitSlop={6}>
      <Ionicons name="cube-outline" size={15} color={t.accent} /><Text style={s.linkText}>Kho đồ</Text>
    </Pressable>
  );
  const links = <View style={s.links}>{inventory}{adventure}</View>;

  if (walking) {
    const total = Math.max(1, space.walk_minutes * 60);
    const arrival = space.return_at ? new Date(space.return_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    return <WorldPanel style={s.panelBody}>
      <Text style={s.heading}>{name} đang khám phá</Text>
      <View style={s.timeRow} accessible accessibilityLabel={`Còn ${formatRemaining(seconds)}${arrival ? `, về lúc ${arrival}` : ''}`}>
        <Ionicons name="time-outline" size={15} color={t.accent} />
        <Text style={s.time}>{formatRemaining(seconds)}</Text>
        {arrival ? <Text style={s.body}>Về lúc {arrival}</Text> : null}
      </View>
      <ProgressBar value={Math.max(0, Math.min(1, 1 - seconds / total))} />
      <Text style={s.body}>Quà vẫn là bí mật cho tới khi {name} về nhà.</Text>
      {links}
    </WorldPanel>;
  }
  if (space.status === 'returned') {
    return <WorldPanel style={s.panelBody}>
      <Text style={s.heading}>{name} đã trở về!</Text>
      <Text style={s.body}>{name} mang về một món quà dành cho bạn.</Text>
      <Button title="Xem quà" icon="gift-outline" onPress={() => { void open(); }} loading={opening} />
    </WorldPanel>;
  }
  if (space.status === 'waiting_hatch') {
    return <WorldPanel style={s.panelBody}>
      <Text style={s.heading}>Trứng sắp nở rồi</Text>
      <Text style={s.body}>Pet sẽ đi khám phá sau khi nở xong. Về Trang chủ để xem trứng nở nhé.</Text>
    </WorldPanel>;
  }
  if (space.status === 'rested') {
    return <WorldPanel style={s.panelBody}>
      <Text style={s.heading}>Hôm nay {name} đã đi khám phá</Text>
      <Text style={s.body}>{space.last_find ? `Lần này ${name} tìm được ${space.last_find.name}. ` : ''}Mai hoàn thành mục tiêu, {name} lại lên đường.</Text>
      {links}
    </WorldPanel>;
  }
  return <WorldPanel style={s.panelBody}>
    <Text style={s.heading}>{egg ? 'Trứng đang được ủ ấm' : `${name} đang chờ lên đường`}</Text>
    <Text style={s.body}>Hoàn thành mọi mục tiêu hôm nay, {name} sẽ tự lên đường khám phá và mang quà về.</Text>
    <Button title="Xem mục tiêu hôm nay" icon="ribbon-outline" variant="secondary" onPress={onOpenQuests} />
    {links}
  </WorldPanel>;
}

// ------------------------------------------------------------------------------------------------ the road
const strip = (width: number, height: number, children: React.ReactNode) => <Svg width={width * 2} height={height}>{children}</Svg>;
/** Slides a two-width strip left by one width per cycle: an endless band of scenery. */
function Scroller({ width, progress, children }: { width: number; progress: Animated.Value; children: React.ReactNode }) {
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: width * 2, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] }]}>{children}</Animated.View>;
}

const Far = memo(function Far({ width, height, ground, c }: { width: number; height: number; ground: number; c: Light }) {
  return strip(width, height, <>
    <Path d={wave(width, ground - height * 0.2, height * 0.03, 2, ground + 8, 0.6, 10)} fill={mixColor(c.hills[0], c.sky[1], 0.35)} />
    <Path d={wave(width, ground - height * 0.14, height * 0.022, 3, ground + 8, 2.1, 10)} fill={c.hills[0]} />
  </>);
});
const Near = memo(function Near({ width, height, ground, c }: { width: number; height: number; ground: number; c: Light }) {
  return strip(width, height, <Path d={wave(width, ground - height * 0.075, height * 0.016, 2, ground + 8, 1.2, 10)} fill={c.hills[1]} />);
});

function Tree({ x, y, k, c, cast, kind }: { x: number; y: number; k: number; c: Light; cast: Cast; kind: number }) {
  return <G transform={`translate(${x} ${y}) scale(${k})`}>
    <Path d={`M${-10 * cast.stretch + cast.dx} 1 Q${cast.dx} 4 ${10 * cast.stretch + cast.dx} 1 Q${cast.dx} -1 ${-10 * cast.stretch + cast.dx} 1Z`} fill="#2E3B2A" opacity={c.shadow} />
    <Rect x={-2.4} y={-18} width={4.8} height={18} rx={2} fill={c.trees[0]} />
    {kind === 0 ? <>
      <Circle cx={0} cy={-27} r={12} fill={c.trees[1]} /><Circle cx={-7} cy={-21} r={9} fill={c.trees[2]} /><Circle cx={7} cy={-22} r={9} fill={c.trees[3]} />
    </> : <>
      <Path d="M0 -44 L13 -18 L-13 -18Z" fill={c.trees[1]} /><Path d="M0 -34 L15 -10 L-15 -10Z" fill={c.trees[3]} />
    </>}
  </G>;
}
const Trees = memo(function Trees({ width, height, ground, c, cast, k }: { width: number; height: number; ground: number; c: Light; cast: Cast; k: number }) {
  return strip(width, height, [0, width].map((offset) => <G key={offset}>
    {[[0.08, 0, 1], [0.27, 1, 0.8], [0.46, 0, 1.15], [0.68, 1, 1], [0.88, 0, 0.9]].map(([f, kind, scale]) =>
      <Tree key={f} x={offset + width * f} y={ground - 4} k={k * scale} c={c} cast={cast} kind={kind} />)}
  </G>));
});
const Land = memo(function Land({ width, height, ground, c, k }: { width: number; height: number; ground: number; c: Light; k: number }) {
  const road = ground + 8 * k;
  return strip(width, height, <>
    <Path d={wave(width, ground - 2, 2.5, 2, height, 1.2, 8)} fill={c.meadow} />
    <Path d={wave(width, road, 2, 4, road + 34 * k, 0, 8)} fill={c.path[0]} />
    <Path d={wave(width, road + 3 * k, 2, 4, road + 11 * k, 0, 8)} fill={c.path[1]} opacity={0.75} />
    <Path d={wave(width, road + 34 * k, 2.5, 5, height, 0.4, 8)} fill={c.front} />
    {[0, width].map((offset) => <G key={offset}>
      {[0.09, 0.3, 0.51, 0.77].map((f) => <Rect key={f} x={offset + width * f} y={road + ((f * 100) % 22) * k} width={7 * k} height={3 * k} rx={1.5 * k} fill={c.pebble} />)}
      {([[0.04, 0], [0.21, 1], [0.38, 2], [0.59, 0], [0.73, 1], [0.94, 2]] as const).map(([f, i]) =>
        <Circle key={f} cx={offset + width * f} cy={ground + 4 * k - (f * 10) % 3} r={2.4 * k} fill={c.flowers[i]} />)}
    </G>)}
  </>);
});
const Front = memo(function Front({ width, height, c }: { width: number; height: number; c: Light }) {
  const dark = mixColor(c.front, '#1E3A2A', 0.3);
  return strip(width, height, <>
    <Path d={wave(width, height - 24, 5, 4, height, 2, 8)} fill={dark} />
    {[0, width].map((offset) => <G key={offset}>
      {[0.06, 0.22, 0.41, 0.63, 0.82].map((f) => <Path key={f} d={`M${offset + width * f} ${height - 18} q-3 -16 -7 -24 M${offset + width * f + 4} ${height - 18} q0 -18 3 -30 M${offset + width * f + 8} ${height - 18} q3 -12 9 -20`}
        stroke={dark} strokeWidth={3} strokeLinecap="round" fill="none" />)}
    </G>)}
  </>);
});

const GRASS = [[0.08, 0.1, 1.1], [0.22, 0.42, 1.4], [0.36, 0.05, 1], [0.52, 0.5, 1.5], [0.67, 0.14, 1.1], [0.84, 0.36, 1.35], [0.94, 0.04, 1], [0.14, 0.6, 1.5]] as const;

/** The whole scene. Layers from far to near slide at rising speeds (parallax); clouds drift on their own clock, also
 * while the pet is home. Only the time of day and the weather recolour it: nothing is remounted, so the pet's walk
 * carries on through any change of light or rain. */
const Road = memo(function Road({ width, height, pet, level, status, bottom }: { width: number; height: number; pet: string; level: number; status: PetSpace['status']; bottom: number }) {
  const { reading } = useWeather();
  const { hours, period, mood, light: c } = useAtmosphere(reading);
  useFrameWatch('explore');
  const cast = useSameValue(castBy(sunAt(hours)));
  const { animate } = useWorldMotion();
  const k = Math.max(1, Math.min(1.9, height / 420));
  // High enough for the panel at the bottom to leave its feet in view on a short screen.
  const ground = Math.round(Math.min(height * 0.62, height - bottom - 216 - 30 * k));
  const size = Math.round(Math.max(92, Math.min(150, width * 0.36)));
  const feet = ground + 30 * k;
  const on = status === 'walking';
  // One loop of the road is a whole number of strides, so the strip is on the frame it started on at the seam. The road
  // moves exactly as fast as the pet's feet: width / strides per strip loop.
  const strideLength = size * STRIDE_SHARE;
  const strides = Math.max(1, Math.round(width / strideLength));
  const roadMs = strides * WALK_CYCLE_MS;
  const road = useTravel({ ms: roadMs, enabled: on });
  const trees = useTravel({ ms: roadMs * 1.5, enabled: on });
  const near = useTravel({ ms: roadMs * 3, enabled: on });
  const far = useTravel({ ms: roadMs * 6, enabled: on });
  const front = useTravel({ ms: roadMs * 0.7, enabled: on });
  const phase = useMemo(() => Animated.multiply(road, strides) as unknown as Animated.Value, [road, strides]);
  // Two steps per loop of the strip: the body dips at each landing, and dust is kicked back from it.
  const stepping = useMemo(() => Animated.modulo(Animated.multiply(road, strides * 2), 1), [road, strides]);
  const drawn = hasSprite(pet, level, 'walk');

  const petRef = useRef<LivingPetHandle>(null);
  const homeX = width * 0.56;
  const walkX = width * 0.36;
  // Starting out it comes in from the gate on the left; the road is moving already, so its pace never jumps.
  const entrance = useRef(new Animated.Value(on ? 0 : 1)).current;
  const was = useRef(status);
  const [arrived, setArrived] = useState(status !== 'returned');
  useEffect(() => {
    const before = was.current;
    was.current = status;
    if (status === 'walking') {
      entrance.setValue(0);
      const run = Animated.timing(entrance, { toValue: 1, duration: animate ? 1100 : 0, easing: Easing.out(Easing.quad), useNativeDriver: true });
      run.start();
      return () => run.stop();
    }
    if (status === 'returned') {
      let live = true;
      setArrived(false);
      void petRef.current?.walkTo(homeX, feet).then(() => {
        if (!live) return;
        setArrived(true);
        return petRef.current?.act('celebrate');
      });
      return () => { live = false; };
    }
    if (before === 'returned') setArrived(true);
    return undefined;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const away = status === 'walking';
  const startX = status === 'returned' ? width + size * 0.5 : on ? walkX : homeX;
  const label = on ? `Pet đang đi trên con đường giữa những ngọn đồi, ${PERIOD[period]}` : `Cổng nhà, nơi pet lên đường, ${PERIOD[period]}`;
  return (
    <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={label} testID={`explore-road-${period}`}>
      <LinearGradient colors={c.sky} style={StyleSheet.absoluteFill} />
      {c.stars > 0 ? <Stars width={width} height={ground} opacity={c.stars} scale={2.4} testID="explore-stars" /> : null}
      <SkyBodies width={width} hours={hours} c={c} horizon={ground - height * 0.1} zenith={height * 0.14} clip={ground - height * 0.06} body={110} idPrefix="explore" />
      <CloudDeck width={width} top={height * 0.14} color={c.cloud} opacity={c.cloudOpacity} cover={mood.cover} />
      <Scroller width={width} progress={far}><Far width={width} height={height} ground={ground} c={c} /></Scroller>
      <Scroller width={width} progress={near}><Near width={width} height={height} ground={ground} c={c} /></Scroller>
      <Scroller width={width} progress={trees}><Trees width={width} height={height} ground={ground} c={c} cast={cast} k={k * 1.5} /></Scroller>
      <Scroller width={width} progress={road}><Land width={width} height={height} ground={ground} c={c} k={k} /></Scroller>
      {c.petLight > 0 ? <Svg pointerEvents="none" width={size * 2} height={size * 0.6} style={{ position: 'absolute', left: (away ? walkX : homeX) - size, top: feet - size * 0.3 }}>
        <Glow id="explore-pet-light" color="#FFF0C4" opacity={c.petLight} cx={size} cy={size * 0.3} rx={size} ry={size * 0.3} />
      </Svg> : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [
        { translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.55, 0] }) },
        { translateY: on && animate ? stepping.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -size * 0.016, 0] }) : 0 },
      ] }]}>
        {on && animate ? <Animated.View style={[s.dust, { left: walkX - size * 0.34, top: feet - 8,
          opacity: stepping.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [0.45, 0.32, 0, 0.45] }),
          transform: [{ translateX: stepping.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, -size * 0.14, 0] }) }, { scale: stepping.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 1.3, 0.5] }) }] }]}>
          <View style={s.dustDot} /><View style={s.dustSmall} />
        </Animated.View> : null}
        <LivingPet ref={petRef} pet={pet} level={level} size={size} x={startX} y={feet} walking={on} phase={on && drawn ? phase : undefined}
          facing={status === 'returned' && !arrived ? -1 : 1} shadow={{ dx: cast.dx, stretch: cast.stretch, opacity: c.shadow }} />
      </Animated.View>
      {status === 'returned' && arrived ? <GiftBundle x={homeX + size * 0.48} y={feet} /> : null}
      <Fireflies width={width} top={ground - height * 0.14} height={height * 0.3} strength={c.fireflies} />
      <GrassField width={width} height={Math.max(1, height - feet - bottom * 0.2)} top={feet + 6} color={mixColor(c.front, '#1E3A2A', 0.25)} wind={mood.wind} spots={GRASS} />
      <Scroller width={width} progress={front}><Front width={width} height={height} c={c} /></Scroller>
      <Fog height={height} strength={mood.fog} top={0.32} />
      <Rain width={width} height={height} strength={mood.rain} wind={mood.wind} ground={0.66} />
      <Snow width={width} height={height} strength={mood.snow} />
    </View>
  );
});

const PERIOD: Record<string, string> = { morning: 'buổi sáng', noon: 'buổi trưa', afternoon: 'buổi chiều', night: 'buổi tối' };

/** What the pet carried home: a wrapped bundle that lands beside it with a bounce and sparkles once. */
function GiftBundle({ x, y }: { x: number; y: number }) {
  const { animate } = useWorldMotion();
  const pop = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) { pop.setValue(1); return; }
    const run = Animated.timing(pop, { toValue: 1, duration: 620, easing: EASE.land, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [animate, pop]);
  const sparkles = [[-24, -44], [26, -50], [0, -62], [-34, -18], [34, -22]];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - 22, top: y - 42, width: 44, height: 44 }} testID="explore-gift">
      {sparkles.map(([dx, dy], i) => <Animated.View key={i} style={{ position: 'absolute', left: 18, top: 24, opacity: pop.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateX: pop.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) }] }}>
        <Ionicons name="sparkles" size={12} color="#F7C53F" />
      </Animated.View>)}
      <Animated.View style={{ transformOrigin: '50% 100%', opacity: pop.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }), transform: [
        { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [-46, 0] }) }, { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
        <Svg width={44} height={44} viewBox="0 0 44 44">
          <Rect x={7} y={18} width={30} height={23} rx={4} fill="#F7A072" stroke="#8A4A2C" strokeWidth={1.6} />
          <Rect x={5} y={13} width={34} height={8} rx={3} fill="#FBC17F" stroke="#8A4A2C" strokeWidth={1.6} />
          <Rect x={19} y={13} width={6} height={28} fill="#FFF1C9" stroke="#8A4A2C" strokeWidth={1} />
          <Path d="M22 13c-4-6-11-7-12-3 0 3 6 4 12 3Zm0 0c4-6 11-7 12-3 0 3-6 4-12 3Z" fill="#FFF1C9" stroke="#8A4A2C" strokeWidth={1.4} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  topRow: { position: 'absolute', right: 12, flexDirection: 'row' },
  weather: { paddingVertical: 2, paddingHorizontal: 4 },
  dock: { position: 'absolute', left: 12, right: 12 },
  panelBody: { gap: 8, padding: 14 },
  heading: { ...typeScale.title, color: t.ink, fontSize: 17, lineHeight: 22 },
  body: { ...typeScale.body, color: t.muted, fontSize: 13, lineHeight: 18 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 19, lineHeight: 24, fontWeight: '900', color: t.accent, fontVariant: ['tabular-nums'] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
  linkText: { ...typeScale.caption, color: t.accent, fontWeight: '800' },
  retry: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retryText: { ...typeScale.caption, color: t.accent },
  dust: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  dustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(214,196,160,0.9)' },
  dustSmall: { width: 4, height: 4, borderRadius: 2, marginBottom: 3, backgroundColor: 'rgba(214,196,160,0.9)' },
});
