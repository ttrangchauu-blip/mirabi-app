import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, type ImageSourcePropType, Image, LayoutChangeEvent, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Rect } from 'react-native-svg';
import type { User } from '../../auth/AuthContext';
import { sunAt } from '../../components/daylight';
import { Text } from '../../components/Typography';
import { lifeEligible } from '../../life/access';
import { petById } from '../../pets';
import { hasSprite } from '../../petSprites';
import { radius, type as typeScale } from '../../ui/design';
import { makeStyles, useTheme } from '../../ui/theme';
import { Button, ProgressBar } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { useAtmosphere, useSameValue } from '../../world/atmosphere';
import { useFrameWatch, useWorldMotion } from '../../world/budget';
import { Plate } from '../../world/diorama';
import { Fireflies, Fog, LivingPet, type LivingPetHandle, Rain, Snow, Sway, WeatherChip, WorldPanel } from '../../world/living';
import { EASE, restartFromZero } from '../../world/motion';
import { castBy, Glow, SkyBodies, Stars } from '../../world/sky';
import { useWeather } from '../../world/weather';
import { formatRemaining, normalizePetSpace, type PetSpace } from '../main/petSpace';
import { request } from '../main/shared';
import { YardClouds } from '../garden/GardenWorld';
import { PhotoControls } from './PhotoControls';
import { loopAt, loopMs, pacing, RATE, roadTrack, shownSlots, SWAY, valleyLayout, type ValleyLayout, WALK_X, WILD } from './exploreArt';
import { SWITCHER_HEIGHT, SWITCHER_TOP } from './spaces';

type Props = {
  user: User; top: number; bottom: number;
  /** Changes after the gift popup is confirmed: the walk is read again. */ version: number;
  onOpenGifts: () => Promise<void> | void; onOpenInventory: () => void; onOpenQuests: () => void;
  /** Phiêu lưu cuộc sống, for those aged 16 and over. */ onOpenAdventure?: () => void;
  /** Every answer of /api/pet/space, for the hatching to follow. */ onPetSpace?: (space: unknown) => void;
  /** The app hides its own bars while the scene is alone on the screen. */ onPhotoMode?: (on: boolean) => void;
  /** What the system takes at the bottom of the screen, once the app's own bar has gone. */ safeBottom?: number;
};

const FALLBACK = { width: 390, height: 680 };
/** From this dark on only the night picture is drawn: the day's pale edge would show through round the hills. */
const FULL_DARK = 0.9;

/**
 * Khám phá: the pet's walk as a place. All the walk's rules stay in companion.py: this screen only reads
 * /api/pet/space, and never starts, ends or rewards anything by itself (the gift stays in the app's own popup).
 * - The scene is an open valley seen from far back that never ends (exploreArt.ts). While it is out, the pet walks on and
 *   on: it holds its place on the screen and the land goes by, each layer at the speed its distance gives it.
 * - Where it has got to comes from when the walk began, so leaving the app or the screen and coming back finds it further on.
 * - It comes back along the same road, glad to be home, with what it found still wrapped up.
 * - Photo mode only hides things: the scene, the pet and the countdown stay mounted and running, so nothing about the
 *   walk can change by turning it on or off, and the walk may even end while it is on.
 */
export function ExploreSpace({ user, top, bottom, version, onOpenGifts, onOpenInventory, onOpenQuests, onOpenAdventure, onPetSpace, onPhotoMode, safeBottom = 0 }: Props) {
  const { t } = useTheme();
  const s = useStyles();
  const [space, setSpace] = useState<PetSpace | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(FALLBACK);
  const [photo, setPhoto] = useState(false);
  const scene = useRef<View>(null);
  // When the walk began on this phone's clock, from the server's own times: the same whenever this screen is opened during the walk.
  const walkedFrom = useMemo(() => {
    if (space?.status !== 'walking') return null;
    const left = space.return_at && space.server_now ? Date.parse(space.return_at) - Date.parse(space.server_now) : space.seconds_left * 1000;
    return Date.now() - Math.max(0, space.walk_minutes * 60_000 - left);
  }, [space?.status, space?.return_at]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // The bars come back however this screen ends.
  const onPhotoRef = useRef(onPhotoMode);
  onPhotoRef.current = onPhotoMode;
  useEffect(() => { onPhotoRef.current?.(photo); }, [photo]);
  useEffect(() => () => { onPhotoRef.current?.(false); }, []);
  useEffect(() => {
    if (!photo) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPhoto(false); return true; });
    return () => sub.remove();
  }, [photo]);

  const pet = petById(user.pet);
  const name = user.pet_name ?? pet.name;
  // The scene is laid out for the whole window and never for the space left by the bars, so hiding them moves nothing in it.
  const { height: windowHeight } = useWindowDimensions();
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((b) => (b.width === width && b.height === height ? b : { width, height }));
  };
  const screenHeight = Math.max(windowHeight, size.height);
  const hidden = photo ? s.hidden : null;
  return (
    <View style={s.fill} onLayout={onLayout} testID="explore-space">
      <View ref={scene} collapsable={false} style={[s.scene, { height: screenHeight }]} testID="explore-scene">
        <Valley width={size.width} height={windowHeight} pet={pet.id} level={user.level} status={space?.status ?? null} walkedFrom={walkedFrom} />
      </View>
      <View style={[s.topRow, { top: top + 8 }, hidden]} pointerEvents="box-none">
        <Weather />
        <View style={s.topRight}>
          <Pressable onPress={() => setPhoto(true)} style={s.fullButton} accessibilityRole="button" accessibilityLabel="Toàn màn hình để ngắm cảnh và chụp ảnh" hitSlop={6} testID="explore-photo-open">
            <Ionicons name="scan-outline" size={21} color={t.accent} />
          </Pressable>
          <Pressable onPress={() => setPhoto(true)} style={s.hideToggle} accessibilityRole="switch" accessibilityState={{ checked: false }} accessibilityLabel="Ẩn giao diện" hitSlop={4} testID="explore-photo-toggle">
            <Text style={s.hideText}>Ẩn giao diện</Text>
            <View style={s.track}><View style={s.knob} /></View>
          </Pressable>
        </View>
      </View>
      <View style={[s.dock, { bottom: bottom + 10 }, hidden]} pointerEvents="box-none">
        {!space ? (
          <WorldPanel>
            {failed ? <Pressable onPress={() => { setFailed(false); void load(); }} accessibilityRole="button" style={s.retry}>
              <Ionicons name="refresh" size={16} color={t.accent} /><Text style={s.retryText}>Chưa tải được chuyến đi. Chạm để thử lại</Text>
            </Pressable> : <View style={s.retry}><ActivityIndicator color={t.accent} accessibilityLabel="Đang xem pet đi đâu" /></View>}
          </WorldPanel>
        ) : <Journey space={space} name={name} egg={user.level === 0} onExpired={load} onOpenGifts={onOpenGifts} onOpenInventory={onOpenInventory} onOpenQuests={onOpenQuests}
          onOpenAdventure={lifeEligible(user) ? onOpenAdventure : undefined} />}
      </View>
      {photo ? <ExplorePhotoControls scene={scene} top={Math.max(8, top - SWITCHER_HEIGHT - SWITCHER_TOP + 8)} bottom={safeBottom + 18} onClose={() => setPhoto(false)} /> : null}
    </View>
  );
}

/** The real weather, small, in the corner of the sky; nothing at all without a reading. */
function Weather() {
  const s = useStyles();
  const { reading } = useWeather();
  const { night } = useAtmosphere(reading);
  if (!reading) return <View />;
  return <View pointerEvents="none"><WorldPanel style={s.weather}><WeatherChip night={night} /></WorldPanel></View>;
}

// ------------------------------------------------------------------------------------------------ photo mode
/** All that is left on the screen in photo mode (the two study rooms have the same). */
function ExplorePhotoControls(props: { scene: React.RefObject<View | null>; top: number; bottom: number; onClose: () => void }) {
  const toast = useToast();
  return <PhotoControls {...props} notify={toast} />;
}

// ------------------------------------------------------------------------------------------------ the panel
/** What the walk is at, in words. The second-by-second countdown lives here alone, so the road never re-renders for it. */
function Journey({ space, name, egg, onExpired, onOpenGifts, onOpenInventory, onOpenQuests, onOpenAdventure }: {
  space: PetSpace; name: string; egg: boolean; onExpired: () => void; onOpenGifts: Props['onOpenGifts']; onOpenInventory: () => void; onOpenQuests: () => void; onOpenAdventure?: () => void;
}) {
  const { t } = useTheme();
  const s = useStyles();
  // How far the phone's clock is from the server's, worked out once per answer: redone on a later render, `server_now`
  // would be old by then and the time left would never go down.
  const offset = useRef({ answer: null as string | null, ms: 0 });
  if (space.server_now && offset.current.answer !== space.server_now) offset.current = { answer: space.server_now, ms: Date.parse(space.server_now) - Date.now() };
  const left = useCallback(() => (space.return_at ? Math.max(0, Math.ceil((Date.parse(space.return_at) - Date.now() - offset.current.ms) / 1000)) : space.seconds_left),
    [space.return_at, space.seconds_left]);
  const [seconds, setSeconds] = useState(left);
  const [small, setSmall] = useState(false);
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
      <View style={s.headingRow}>
        <Text style={[s.heading, s.grow]}>{name} đang khám phá</Text>
        <Pressable onPress={() => setSmall((was) => !was)} style={s.fold} accessibilityRole="button" accessibilityLabel={small ? 'Mở rộng thẻ' : 'Thu gọn thẻ'} hitSlop={8} testID="explore-card-fold">
          <Ionicons name={small ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
        </Pressable>
      </View>
      <View style={s.timeRow} accessible accessibilityLabel={`Còn ${formatRemaining(seconds)}${arrival ? `, về lúc ${arrival}` : ''}`}>
        <Ionicons name="time-outline" size={15} color={t.accent} />
        <Text style={s.time}>{formatRemaining(seconds)}</Text>
        {arrival ? <Text style={s.body}>Về lúc {arrival}</Text> : null}
      </View>
      {small ? null : <>
        <ProgressBar value={Math.max(0, Math.min(1, 1 - seconds / total))} />
        <Text style={s.body}>Quà vẫn là bí mật cho tới khi {name} về nhà.</Text>
        {links}
      </>}
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

// ------------------------------------------------------------------------------------------------ the valley
type Art = { day: ImageSourcePropType; night: ImageSourcePropType };
type Box = { x: number; y: number; w: number; h: number };
type Picture = Art & Box;

/** One layer's picture at its place along the strip: the same picture by day and at night, crossfading with the dark. */
const Layer = memo(function Layer({ art, l, left, stars }: { art: Picture; l: ValleyLayout; left: number; stars: number }) {
  const width = art.w * l.wide + 0.5, height = art.h * l.tall, style = { left: left + art.x * l.wide, top: l.top + art.y * l.tall };
  return <>
    {stars < FULL_DARK ? <Plate source={art.day} width={width} height={height} style={style} /> : null}
    {stars > 0 ? <Plate source={art.night} width={width} height={height} opacity={stars < FULL_DARK ? stars : 1} style={style} /> : null}
  </>;
});

/** The trees of a hill picture that move with the wind, each from its foot. Always a little: a still tree looks painted. */
const Trees = memo(function Trees({ hill, l, left, wind, stars }: { hill: number; l: ValleyLayout; left: number; wind: number; stars: number }) {
  return <>{SWAY[hill].map((tree) => (
    <Sway key={tree.ms} wind={Math.max(wind, 0.5)} depth={tree.depth} ms={tree.ms} rest={[0, 800]} style={{ position: 'absolute', left: left + tree.x * l.wide, top: l.top + tree.y * l.tall, width: tree.w * l.wide, height: tree.h * l.tall }}>
      <Image source={tree.day} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={a.whole} />
      {stars > 0 ? <Image source={tree.night} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={[a.whole, { opacity: stars }]} /> : null}
    </Sway>
  ))}</>;
});

/**
 * An endless layer: its pictures one after the other and the first again at the end, sliding left once per loop. Which
 * pictures are mounted follows the same clock as the loop, once a second: only what is on the screen or about to be holds
 * a texture, and what comes on was mounted long before. Nothing here moves by React: the slide never stops for a render.
 */
function Loop({ pictures, l, width, value, ms, clock, moving, render }: { pictures: number; l: ValleyLayout; width: number; value: Animated.Value; ms: number; clock: () => number; moving: boolean;
  render: (index: number, left: number) => React.ReactNode }) {
  const span = l.wide * pictures;
  const [slots, setSlots] = useState(() => shownSlots(pictures, l.wide, width, loopAt(clock(), ms), (span / ms) * 1400));
  useEffect(() => {
    const look = () => { const next = shownSlots(pictures, l.wide, width, loopAt(clock(), ms), (span / ms) * 1400); setSlots((old) => (old.join() === next.join() ? old : next)); };
    look();
    if (!moving) return;
    const timer = setInterval(look, 1000);
    return () => clearInterval(timer);
  }, [pictures, l.wide, width, clock, ms, moving, span]);
  const translateX = useMemo(() => value.interpolate({ inputRange: [0, 1], outputRange: [0, -span] }), [value, span]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: span + l.wide, transform: [{ translateX }] }]}>
    {slots.map((slot) => <React.Fragment key={slot}>{render(slot % pictures, slot * l.wide)}</React.Fragment>)}
  </Animated.View>;
}

/** A value going 0 to 1 and over again, for as long as the pet walks, standing where the walk's own clock says it is: back from the background or reopened, the road has gone on. */
function useLoop(ms: number, on: boolean, clock: () => number) {
  const value = useRef(new Animated.Value(loopAt(clock(), ms))).current;
  useEffect(() => {
    const from = loopAt(clock(), ms);
    value.setValue(from);
    if (!on) return;
    const first = Animated.timing(value, { toValue: 1, duration: ms * (1 - from), easing: Easing.linear, useNativeDriver: true });
    const loop = Animated.loop(restartFromZero(value, 1, ms));
    let stopped = false;
    first.start(({ finished }) => { if (!finished || stopped) return; value.setValue(0); loop.start(); });
    return () => { stopped = true; first.stop(); loop.stop(); };
  }, [on, ms, clock, value]);
  return value;
}

/**
 * The whole scene, far from the panel. While the pet is out it walks and never stops: it holds its place on the screen,
 * its strip and the road are driven by one value, and every other layer slides by how far away it is. Its pace is a whole
 * number of steps per picture, so its feet never slide and the strip is on the frame it started from at each join. Only
 * the time of day and the weather recolour the rest: nothing is remounted, so a walk carries on through any change of
 * light or rain, and through photo mode.
 */
const Valley = memo(function Valley({ width, height, pet, level, status, walkedFrom }: { width: number; height: number; pet: string; level: number; status: PetSpace['status'] | null; /** When the walk began, on this phone's clock. */ walkedFrom: number | null }) {
  const { reading } = useWeather();
  const { hours, period, mood, light: c } = useAtmosphere(reading);
  useFrameWatch('explore');
  const cast = useSameValue(castBy(sunAt(hours)));
  const { animate } = useWorldMotion();
  const l = useMemo(() => valleyLayout(width, height), [width, height]);
  const size = l.pet;
  const paced = useMemo(() => pacing(l.wide, size), [l.wide, size]);
  const walkX = width * WALK_X;

  // How long the pet has been out; once it is back, how far it had got.
  const lastElapsed = useRef(0);
  // The walk has just ended: the land stops right where it is, with no step back to the last time it was read.
  const walkStart = useRef(walkedFrom);
  if (walkedFrom !== null) walkStart.current = walkedFrom;
  else if (walkStart.current !== null) { lastElapsed.current = Math.max(0, Date.now() - walkStart.current); walkStart.current = null; }
  const clock = useCallback(() => {
    if (walkedFrom !== null) lastElapsed.current = Math.max(0, Date.now() - walkedFrom);
    return lastElapsed.current;
  }, [walkedFrom]);
  const walking = status === 'walking';
  const on = walking && animate;
  const roadMs = paced.tileMs * WILD.lands.length;
  const road = useLoop(roadMs, on, clock);
  const front = useLoop(loopMs(paced.tileMs, WILD.fronts.length, RATE.front), on, clock);
  const near = useLoop(loopMs(paced.tileMs, WILD.nears.length, RATE.near), on, clock);
  const mid = useLoop(loopMs(paced.tileMs, WILD.mids.length, RATE.mid), on, clock);
  const far = useLoop(loopMs(paced.tileMs, 1, RATE.far), on, clock);
  // Steps go on across the road's loop: a whole number of them per loop, so the strip never skips a frame at the join.
  const phase = useMemo(() => Animated.multiply(road, paced.steps * WILD.lands.length) as unknown as Animated.Value, [road, paced.steps]);
  // Two steps per loop of the strip: the body dips at each landing, and dust is kicked back from it.
  const stepping = useMemo(() => Animated.modulo(Animated.multiply(road, paced.steps * WILD.lands.length * 2), 1), [road, paced.steps]);
  const track = useMemo(() => roadTrack(walkX / l.wide), [walkX, l.wide]);
  const feet = useMemo(() => road.interpolate({ inputRange: track.at, outputRange: track.rows.map((row) => l.top + row * l.tall) }), [road, track, l]);
  const nearer = useMemo(() => road.interpolate({ inputRange: track.at, outputRange: track.scales }), [road, track]);
  const drawn = hasSprite(pet, level, 'walk');

  const petRef = useRef<LivingPetHandle>(null);
  // Setting out, it comes in from the left and the road is already moving, so its pace never jumps. Opened while it is out, it is simply there, walking.
  const entrance = useRef(new Animated.Value(1)).current;
  const was = useRef<PetSpace['status'] | null>(null);
  const [arrived, setArrived] = useState(status !== 'returned');
  const [fromRight, setFromRight] = useState(false);
  useEffect(() => {
    if (status === null) return undefined;
    const before = was.current;
    was.current = status;
    if (status === 'walking') {
      if (before === null || before === 'walking') return undefined;
      entrance.setValue(0);
      const run = Animated.timing(entrance, { toValue: 1, duration: animate ? 1100 : 0, easing: Easing.out(Easing.quad), useNativeDriver: true });
      run.start();
      return () => run.stop();
    }
    if (status === 'returned') {
      // It was walking here: it stops where it is, with no jump, and is glad. Opened later: it comes along the road from the right.
      if (before === 'walking' || before === 'returned') { setArrived(true); if (before === 'walking') void petRef.current?.act('celebrate'); return undefined; }
      setFromRight(true);
      setArrived(false);
      return undefined;
    }
    if (before === 'returned') setArrived(true);
    return undefined;
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Its own effect, so that it runs once the pet is standing off the screen on the right.
  useEffect(() => {
    if (!fromRight) return undefined;
    let live = true;
    void petRef.current?.walkTo(0, 0).then(() => {
      if (!live) return;
      setFromRight(false);
      setArrived(true);
      return petRef.current?.act('celebrate');
    });
    return () => { live = false; };
  }, [fromRight]);

  const startX = fromRight ? width * 0.6 + size / 2 : 0;
  const label = walking ? `Pet đang đi trên con đường giữa thung lũng, ${PERIOD[period]}` : `Thung lũng rộng, pet đang đứng trên con đường, ${PERIOD[period]}`;
  const ridge = l.top + l.ridge * l.tall;
  // The low sun warms the land; the pet stands in front of it and keeps its colours.
  const low = Math.max(0, 1 - Math.abs(sunAt(hours).altitude - 0.14) / 0.34) * (1 - mood.gloom) * (1 - c.stars);
  const grey = mood.gloom * (1 - c.stars);
  const loopProps = { l, width, clock, moving: on };
  return (
    <View style={StyleSheet.absoluteFill} accessible accessibilityLabel={label} testID={`explore-road-${period}`}>
      {/* The sky's palest colour meets the land. */}
      <LinearGradient colors={c.sky} end={{ x: 0, y: Math.max(0.2, Math.min(1, (ridge + 90) / height)) }} style={StyleSheet.absoluteFill} />
      {c.stars > 0 ? <Stars width={width} height={Math.max(0, ridge)} opacity={c.stars} scale={2.4} testID="explore-stars" /> : null}
      <SkyBodies width={width} hours={hours} c={c} horizon={ridge + 40} zenith={Math.max(40, l.top * 0.6)} clip={ridge + 70} body={78} idPrefix="explore" />
      <YardClouds width={width} top={Math.max(56, l.top * 0.42)} horizon={ridge + 30} opacity={c.cloudOpacity} night={c.stars} cover={Math.max(mood.cover, 0.6)} />
      <Loop {...loopProps} pictures={1} value={far} ms={loopMs(paced.tileMs, 1, RATE.far)} render={(_, left) => <Layer art={WILD.far} l={l} left={left} stars={c.stars} />} />
      <Loop {...loopProps} pictures={WILD.mids.length} value={mid} ms={loopMs(paced.tileMs, WILD.mids.length, RATE.mid)} render={(i, left) => <>
        <Layer art={WILD.mids[i]} l={l} left={left} stars={c.stars} />
        <Trees hill={i} l={l} left={left} wind={mood.wind} stars={c.stars} />
      </>} />
      <Loop {...loopProps} pictures={WILD.lands.length} value={road} ms={roadMs} render={(i, left) => <Layer art={WILD.lands[i]} l={l} left={left} stars={c.stars} />} />
      <Loop {...loopProps} pictures={WILD.fronts.length} value={front} ms={loopMs(paced.tileMs, WILD.fronts.length, RATE.front)} render={(i, left) => <Layer art={WILD.fronts[i]} l={l} left={left} stars={c.stars} />} />
      <Loop {...loopProps} pictures={WILD.nears.length} value={near} ms={loopMs(paced.tileMs, WILD.nears.length, RATE.near)} render={(i, left) => <Layer art={WILD.nears[i]} l={l} left={left} stars={c.stars} />} />
      {low > 0.02 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFB26B', opacity: Math.round(low * 0.14 * 50) / 50 }]} testID="explore-warm-light" /> : null}
      {grey > 0.02 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#5C6E86', opacity: Math.round(grey * 0.2 * 50) / 50 }]} /> : null}
      {/* Its feet are this view's origin: the pet's own box hangs from it. It stays at one place across the screen; only the road's rise and fall move it. */}
      <Animated.View pointerEvents="none" style={[a.traveller, { left: walkX, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.6, 0] }) }, { translateY: feet }, { scale: nearer },
        { translateY: on ? stepping.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -size * 0.016, 0] }) : 0 }] }]} testID="explore-pet">
        {/* A soft shadow on the road, leaning away from the sun. */}
        <Svg pointerEvents="none" width={size} height={size * 0.26} style={{ position: 'absolute', left: -size / 2 + cast.dx, top: -size * 0.13, transform: [{ scaleX: cast.stretch }] }}>
          <Glow id="explore-pet-shadow" color="#3A4A2C" opacity={Math.min(0.42, c.shadow * 2.4)} cx={size / 2} cy={size * 0.13} rx={size * 0.42} ry={size * 0.1} />
        </Svg>
        {c.petLight > 0 ? <Svg pointerEvents="none" width={size * 2} height={size * 0.6} style={{ position: 'absolute', left: -size, top: -size * 0.3 }}>
          <Glow id="explore-pet-light" color="#FFF0C4" opacity={c.petLight} cx={size} cy={size * 0.3} rx={size} ry={size * 0.3} />
        </Svg> : null}
        {on ? <Animated.View style={[a.dust, { left: -size * 0.34 - 6, top: -8,
          opacity: stepping.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [0.45, 0.32, 0, 0.45] }),
          transform: [{ translateX: stepping.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, -size * 0.14, 0] }) }, { scale: stepping.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 1.3, 0.5] }) }] }]}>
          <View style={a.dustDot} /><View style={a.dustSmall} />
        </Animated.View> : null}
        <LivingPet ref={petRef} pet={pet} level={level} size={size} x={startX} y={0} walking={walking} phase={on && drawn ? phase : undefined} facing={fromRight ? -1 : 1} />
        {status === 'returned' && arrived ? <GiftBundle x={size * 0.48} y={0} /> : null}
      </Animated.View>
      <Fireflies width={width} top={ridge + 60} height={Math.max(1, l.top + l.tall * 0.5 - ridge)} strength={c.fireflies} />
      <Fog height={height} strength={mood.fog} top={0.32} />
      <Rain width={width} height={height} strength={mood.rain} wind={mood.wind} ground={Math.min(0.9, (l.top + l.tall * 0.46) / height)} />
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

// Over the valley: the buttons, the switch and the panel's words are interface (glass, theme ink).
const useStyles = makeStyles(({ t }) => StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  scene: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  hidden: { display: 'none' },
  topRow: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fullButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass },
  hideToggle: { height: 42, borderRadius: 21, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.glass },
  hideText: { ...typeScale.caption, color: t.ink, fontWeight: '800' },
  track: { width: 34, height: 20, borderRadius: 10, padding: 2, backgroundColor: t.switchOff },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: t.thumbOff },
  weather: { paddingVertical: 2, paddingHorizontal: 4 },
  dock: { position: 'absolute', left: 12, right: 12 },
  panelBody: { gap: 8, padding: 16, borderRadius: radius.lg },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  fold: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  heading: { ...typeScale.title, color: t.ink, fontSize: 17, lineHeight: 22 },
  body: { ...typeScale.body, color: t.muted, fontSize: 13, lineHeight: 18 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 19, lineHeight: 24, fontWeight: '900', color: t.accent, fontVariant: ['tabular-nums'] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28 },
  linkText: { ...typeScale.caption, color: t.accent, fontWeight: '800' },
  retry: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  retryText: { ...typeScale.caption, color: t.accent },
}));

// Inside the picture: the layers' frames and the dust under the pet's feet.
const a = StyleSheet.create({
  // On the web an image keeps its file's size unless it is told otherwise.
  whole: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  traveller: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  dust: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  dustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(214,196,160,0.9)' },
  dustSmall: { width: 4, height: 4, borderRadius: 2, marginBottom: 3, backgroundColor: 'rgba(214,196,160,0.9)' },
});
