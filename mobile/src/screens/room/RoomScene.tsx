import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { hasSprite } from '../../petSprites';
import { frontSvg, geometry, GUEST_SPOT, homeOf, itemArt, itemAt, itemsInFront, keyOf, liftedSvg, petSpot, placedBox, roomSvg, roomView, seatCover, Spot } from '../../room/art';
import type { PetAction } from '../../room/prefs';
import { PROBLEM_TEXT, ridersOf, type Change, type Problem } from '../../room/rules';
import type { Layout, Placement, Pose, RoomKind, RoomPet } from '../../room/types';
import { along, findPath, pathLength, Point, WALK_SPEED } from '../../room/walk';
import { appTheme as t } from '../../theme';

// Until the first layout pass (and in tests, which have none) the room is drawn in a phone-sized space.
const FALLBACK = { width: 320, height: 676 };

type Props = {
  layout: Layout;
  /** Which room's canvas: Phòng cá nhân (default) or the Focus Space room. */
  kind?: RoomKind;
  /** At its desk on a break (the focus room): its still artwork, lowered behind the desk, with a small moon. */
  resting?: boolean;
  pet: RoomPet;
  pose: Pose;
  /** Out on its walk: the room is shown without the pet. */
  away: boolean;
  /** A visiting friend's pet, on its own spot in front that never covers the host. */
  guest?: RoomPet | null;
  onPetPress?: () => void;
  /** The pet's label for a screen reader, when its tap does something other than play. */
  petLabel?: string;
  /** A short line over the pet; a new `key` replays its animation (a hop, or the one of the `action` chosen). */
  reaction?: { key: number; text: string; action?: PetAction } | null;
  /** The small menu next to the pet (or its away marker), opened by a tap on it. While open, a tap anywhere else in the
   * room only closes it. An action that can't be used now is `disabled`, with `note` (why) read after its label. */
  petMenu?: { actions: PetMenuAction[]; onAction: (id: string) => void; onClose: () => void } | null;
  /** Out on its walk: a small marker where the pet would be, saying so; a tap on it can open the menu. */
  awayMarker?: { text: string; onPress?: () => void } | null;
  /** Hops, hearts, the treat, the ball and the walk ring; off, the pet still answers but nothing bounces. */
  effects?: boolean;
  /** Edge to edge (the whole screen), without the rounded corners of a room shown as a card. */
  fullScreen?: boolean;
  /** Points at the top kept for a header drawn over the room: the room's content starts under it. With `safeBottom`,
   * this alone sets the camera, so pass fixed values: a header that grows a line must never move or rescale the room. */
  safeTop?: number;
  /** Points at the bottom covered by the menu bar or a panel (the room goes on under them). */
  safeBottom?: number;
  /** Where the header drawn over the room really ends (points): the pet's menu and lines stay below it. `safeTop` when
   * not given. */
  menuTop?: number;
  description: string;
  /** Decorating: a tap selects the item under it (or clears the selection), a drag moves it inside the room. While it
   * moves, `place` says where it lands (every frame), `preview` whether it may stay there (a few times a second);
   * `onMove` drops it (once, when the finger lifts). */
  editor?: { selected: string | null; onSelect: (item: string | null) => void; place: (item: string, x: number, y: number) => Placement | null;
    preview: (item: string, x: number, y: number) => Change | null; onMove: (item: string, x: number, y: number) => void } | null;
  /** Decorating with its header and panel drawn over the room: the points they cover at the top and the bottom. The
   * camera starts as the one outside decorating (same scale, same place); the room slides up or down (a drag on an
   * empty spot, or by itself to show the selected item) to reach what is under them. Item positions never change.
   * Decorating, the room can also be zoomed in (see `ZoomControls`); it is back to its own camera afterwards. */
  chrome?: { top: number; bottom: number };
  /** The owner's room, pet on its rug: a tap on free floor walks it there. Never for visitors. */
  walkable?: boolean;
  /** A burst of little hearts over the pet; a new number plays it again. */
  hearts?: number;
};

export type PetMenuAction = { id: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; disabled?: boolean; note?: string };

const TAP_SLOP = 8; // a touch that moves more than this (screen points) is a drag, not a tap
/** Decorating zoom, around the room's own camera (1): the buttons go from level to level, two fingers anywhere between
 * the first and the last. */
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const zoomIn = (z: number) => ZOOM_LEVELS.find((level) => level > z + 0.01) ?? MAX_ZOOM;
const zoomOut = (z: number) => [...ZOOM_LEVELS].reverse().find((level) => level < z - 0.01) ?? MIN_ZOOM;

/** Walks the pet along a path at a steady speed, from wherever it is; `at` is null while it stands on its spot. */
function useWalker(layout: Layout, home: Spot, enabled: boolean) {
  const [at, setAt] = useState<Point | null>(null);
  const [moving, setMoving] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [target, setTarget] = useState<{ key: number; at: Point } | null>(null);
  const live = useRef<{ at: Point | null; path: Point[] | null; walked: number; frame: number | null; last: number }>(
    { at: null, path: null, walked: 0, frame: null, last: 0 });
  const stop = useCallback(() => {
    if (live.current.frame !== null) cancelAnimationFrame(live.current.frame);
    live.current.frame = null;
    live.current.path = null;
  }, []);
  // Decorating (where the room changes), studying, resting or out walking: back to its spot, as before.
  useEffect(() => {
    if (enabled) return;
    stop();
    live.current.at = null;
    setAt(null); setMoving(false); setTarget(null);
  }, [enabled, stop]);
  useEffect(() => () => stop(), [stop]);

  const step = useCallback((now: number) => {
    const w = live.current;
    if (!w.path) return;
    w.walked += (WALK_SPEED * Math.min(100, now - w.last)) / 1000; // a stalled frame never makes it jump ahead
    w.last = now;
    const next = along(w.path, w.walked);
    w.at = next.at;
    setAt(next.at);
    setFacing(next.facing);
    if (next.done) { w.path = null; w.frame = null; setMoving(false); return; }
    w.frame = requestAnimationFrame(step);
  }, []);

  /** Walk to a tapped floor point; from where it is now when it is already walking. */
  const walkTo = useCallback((to: Point) => {
    const from = live.current.at ?? { x: home.x, feet: home.feet };
    const path = findPath(layout, home.size, from, to);
    if (!path || pathLength(path) < 1) return false;
    if (live.current.frame !== null) cancelAnimationFrame(live.current.frame);
    if (!live.current.at) setAt(from); // leaves its spot: from now on it is drawn where it walks
    Object.assign(live.current, { path, walked: 0, last: Date.now(), at: from });
    setTarget((t) => ({ key: (t?.key ?? 0) + 1, at: path[path.length - 1] }));
    setMoving(true);
    live.current.frame = requestAnimationFrame((now) => { live.current.last = now; step(now); });
    return true;
  }, [layout, home.x, home.feet, home.size, step]);
  /** Stops where it is (its menu opened on it). */
  const halt = useCallback(() => { stop(); setMoving(false); setTarget(null); }, [stop]);
  return { at, moving, facing, target, walkTo, halt };
}

/**
 * The room in the space it is given. The personal room fills it edge to edge: its content as large as fits at the
 * canvas proportions (never stretched) between `safeTop` and `safeBottom`, the rest more wall and floor around it. The
 * focus room is as large as fits, at the top. The furniture as one drawing, then the pets on top; only the desk a pet
 * sits behind, or furniture it walked behind, is drawn again over it. Everything placed in canvas units (pets, taps,
 * menus) is laid out on the canvas inside the space. While decorating, an overlay above everything picks and drags
 * items: a dragged item (with what stands on it) is lifted off the room, which is drawn once without it, and follows
 * the finger on its own layer; it is put back in its place among the others when it is dropped.
 */
export const RoomScene = memo(function RoomScene({ layout, kind = 'personal', resting = false, pet, pose, away, guest, onPetPress, petLabel, reaction, petMenu,
  awayMarker, effects = true, fullScreen = false, safeTop = 0, safeBottom = 0, menuTop = safeTop, description, editor, chrome, walkable = false, hearts }: Props) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  // The items a drag picked up (the dragged one and what stands on it), and how far they are moved, in points.
  const [lifted, setLifted] = useState<string[] | null>(null);
  const offset = useRef(new Animated.ValueXY()).current;
  // Back to no offset once the dropped (or refused) item is drawn in the room again, before that frame shows.
  useLayoutEffect(() => { if (!lifted) offset.setValue({ x: 0, y: 0 }); }, [lifted, offset]);
  const geo = geometry(kind);
  const CANVAS = geo.canvas;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
  };
  const space = box ?? FALLBACK;
  // One camera whether decorating or not (set by the space and the fixed reserves only). A room without a bleed (the
  // focus room's own decorating screen) is shown whole, centred.
  const bounded = !!editor && !geo.bleed;
  const { k, view } = roomView(kind, space.width, space.height, safeTop, safeBottom);
  const width = (view[2] - view[0]) * k;
  const height = (view[3] - view[1]) * k;
  const viewKey = view.map((v) => Math.round(v * 10)).join(' ');
  // Decorating zoom: everything on the canvas is drawn at `kz` points a canvas unit (the drawing grows with it); the
  // room is then panned in both directions. Never outside decorating.
  const [zoom, setZoom] = useState(1);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  const z = editor ? zoom : 1;
  const kz = k * z;
  useEffect(() => { if (!editor) { setZoom(1); zoomNow.current = 1; } }, [!!editor]); // eslint-disable-line react-hooks/exhaustive-deps
  const room = useMemo(() => (lifted ? { ...layout, items: layout.items.filter((p) => !lifted.includes(keyOf(p))) } : layout), [layout, lifted]);
  const svg = useMemo(() => roomSvg(room, kind, view), [room, kind, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ghost = useMemo(() => (lifted ? liftedSvg(layout.items.filter((p) => lifted.includes(keyOf(p))), kind) : null), [layout, lifted, kind]);
  // The canvas inside the space, and the part of it on screen between the header and the menu bar (in its own points),
  // for what is placed over the pet.
  const canvasStyle = { left: -view[0] * kz, top: -view[1] * kz, width: CANVAS.width * kz, height: CANVAS.height * kz };
  const bounds = { top: view[1] * kz + Math.max(safeTop, menuTop), bottom: view[1] * kz + height - safeBottom };
  const selected = editor?.selected ? layout.items.find((p) => keyOf(p) === editor.selected) : undefined;
  const frame = selected ? placedBox(selected) : null;
  const home = petSpot(layout, pose, kind);
  const canWalk = walkable && kind === 'personal' && !editor && !away && pose === 'rug';
  const walker = useWalker(layout, home, canWalk);
  // At its desk the pet sits on the chair behind it, and the desk's front is drawn over it. Its study strip has the
  // book at the bottom: lowered a little (studySink), the desk's front edge hides its bottom and the book lies on the
  // desk top. Its standing artwork (no strip) sits lower, so the desk hides its legs.
  // (Not while its desk is lifted: the pet stays where it is until the desk is dropped.)
  const desk = pose !== 'rug' ? homeOf(layout, pose) : undefined;
  const deskLifted = !!lifted && !!desk && lifted.includes(keyOf(desk));
  const cover = useMemo(() => (pose === 'rug' || deskLifted ? null : seatCover(layout, pose, kind)), [layout, pose, kind, deskLifted]);
  const studying = pose === 'study' && !resting && hasSprite(pet.id, pet.level, 'study');
  const sink = cover ? (studying ? cover.studySink : cover.sink) : 0;
  const spot: Spot = walker.at ? { x: walker.at.x, feet: walker.at.feet, size: home.size } : { ...home, feet: home.feet + sink };
  // Layered by where things touch the floor: the floor items standing in front of the pet's feet that overlap it are
  // drawn again on top of it, whether it walked behind them or stands on its spot (never its own bed or desk). Not
  // the items being dragged: they follow the finger above everything.
  const homePlacement = walker.at ? undefined : homeOf(layout, pose);
  const homeItem = homePlacement ? keyOf(homePlacement) : null;
  const front = useMemo(() => itemsInFront(room, spot.feet, [spot.x - spot.size / 2, spot.feet - spot.size, spot.x + spot.size / 2, spot.feet], homeItem),
    [room, spot.x, spot.feet, spot.size, homeItem]);
  const frontKey = front.map((p) => `${keyOf(p)}:${p.x}:${p.y}`).join('|');
  const overlay = useMemo(() => frontSvg(front, kind), [frontKey, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const menuOpen = !!petMenu && !editor && (!away || !!awayMarker);
  // Decorating under a header and a panel: how far the room may slide (points, up positive) so that the top of its
  // content clears the header and the bottom of the canvas clears the panel; zoomed in, as far as the drawing goes, and
  // sideways (left positive) across its width. Zoomed out, the drawing is centred (between the header and the panel
  // when it fits there).
  const slide = useRef(new Animated.Value(0)).current;
  const slid = useRef(0);
  const slideX = useRef(new Animated.Value(0)).current;
  const slidX = useRef(0);
  const top = chrome?.top ?? 0, under = chrome?.bottom ?? 0;
  const band = height - under - top;
  const fits = z < 1 && height * z <= band;
  const centredX = -(width * (1 - Math.min(z, 1))) / 2;
  const limits = !editor ? { min: 0, max: 0, minX: 0, maxX: 0 }
    : fits ? { min: -(top + (band - height * z) / 2), max: -(top + (band - height * z) / 2), minX: centredX, maxX: centredX }
    : { min: Math.min(0, (geo.top - view[1]) * kz - top),
      max: Math.max(0, (chrome ? (CANVAS.height - view[1]) * kz : 0) - (height - under), height * (z - 1)),
      minX: z < 1 ? centredX : 0, maxX: z < 1 ? centredX : width * (z - 1) };
  const slideTo = useCallback((p: number, animated = false, px = slidX.current) => {
    const next = Math.min(limits.max, Math.max(limits.min, p));
    const nextX = Math.min(limits.maxX, Math.max(limits.minX, px));
    slid.current = next;
    slidX.current = nextX;
    if (animated) {
      Animated.parallel([
        Animated.timing(slide, { toValue: -next, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(slideX, { toValue: -nextX, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else { slide.setValue(-next); slideX.setValue(-nextX); }
  }, [limits.min, limits.max, limits.minX, limits.maxX, slide, slideX]);
  useEffect(() => { if (editor) slideTo(slid.current); else slideTo(0, false, 0); }, [!!editor, slideTo]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Zooms keeping the middle of what is in view (between the header and the panel) where it is. */
  const zoomTo = useCallback((next: number) => {
    const was = zoomNow.current, to = clampZoom(next);
    if (to === was) return;
    const r = to / was, cy = (top + height - under) / 2, cx = width / 2;
    slid.current = (slid.current + cy) * r - cy;
    slidX.current = (slidX.current + cx) * r - cx;
    zoomNow.current = to;
    setZoom(to);
  }, [top, under, height, width]);
  // The selected item (just added, or picked) is brought out from under the header or the panel, and into view.
  useEffect(() => {
    if (!editor || !frame) return;
    const itemTop = (frame[1] - view[1]) * kz, itemBottom = (frame[3] - view[1]) * kz;
    const itemLeft = (frame[0] - view[0]) * kz, itemRight = (frame[2] - view[0]) * kz;
    const low = top + 8, high = height - under - 8;
    let p = slid.current, px = slidX.current;
    if (itemBottom - p > high) p = itemBottom - high;
    if (itemTop - p < low) p = itemTop - low;
    if (itemRight - px > width - 8) px = itemRight - width + 8;
    if (itemLeft - px < 8) px = itemLeft - 8;
    if (p !== slid.current || px !== slidX.current) slideTo(p, true, px);
  }, [editor?.selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const { halt } = walker;
  useEffect(() => { if (menuOpen) halt(); }, [menuOpen, halt]);

  /** A tap on the floor (not on the wall, a piece of furniture or the pet, which have their own taps). */
  const onFloorTap = (x: number, y: number) => {
    if (y < CANVAS.floorY) return;
    const hit = itemAt(layout, x, y);
    if (hit && itemArt(hit.item)?.mount === 'floor') return;
    walker.walkTo({ x, feet: y });
  };

  return (
    <View style={[s.fill, bounded && s.fillBounded]} onLayout={onLayout}>
      <View style={[s.scene, fullScreen && !bounded && s.sceneScreen, bounded && s.sceneBounded, { width, height }]} testID="room-scene">
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: slide }, { translateX: slideX }] }]} pointerEvents="box-none"
          testID="room-camera">
        <View style={[s.picture, { width: width * z, height: height * z }]} pointerEvents="none" accessible accessibilityRole="image"
          accessibilityLabel={description}>
          <Picture xml={svg} />
        </View>
        <View style={[s.canvas, canvasStyle]} pointerEvents="box-none" testID="room-canvas">
          {canWalk ? <FloorTaps k={k} onTap={onFloorTap} /> : null}
          {canWalk && effects && walker.target ? <TargetMark key={walker.target.key} at={walker.target.at} k={k} /> : null}
          {away ? null : <ScenePet pet={pet} spot={spot} k={kz} pose={pose} resting={resting} onPress={editor ? undefined : onPetPress} label={petLabel}
            reaction={editor ? null : reaction} effects={effects} moving={walker.moving} facing={walker.facing}
            hearts={editor || !effects ? undefined : hearts} canvasWidth={CANVAS.width} minTop={bounds.top} />}
          {cover && !away ? <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="room-seat-cover"><Picture xml={cover.svg} /></View> : null}
          {overlay && !away ? <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="room-front"><Picture xml={overlay} /></View> : null}
          {guest ? <ScenePet pet={guest} spot={GUEST_SPOT} k={kz} pose="rug" guest /> : null}
          {ghost ? (
            <Animated.View style={[StyleSheet.absoluteFill, { transform: offset.getTranslateTransform() }]} pointerEvents="none" testID="room-lifted">
              <Picture xml={ghost} />
            </Animated.View>
          ) : null}
          {editor ? <EditLayer layout={layout} k={kz} editor={editor} offset={offset} onLift={setLifted} frame={frame} minTop={bounds.top}
            slide={{ at: () => [slid.current, slidX.current], to: (p, px) => slideTo(p, false, px) }}
            zoom={{ at: () => zoom, to: zoomTo }} /> : null}
          {away && awayMarker && !editor ? <AwayMarker marker={awayMarker} spot={home} k={k} width={canvasStyle.width} /> : null}
        </View>
        </Animated.View>
        {menuOpen ? <PetMenu menu={petMenu!} spot={away ? { ...home, size: 56 } : spot} k={k} canvas={canvasStyle} bounds={bounds} /> : null}
        {editor ? <ZoomControls zoom={zoom} top={top + 8} onZoom={zoomTo} /> : null}
      </View>
    </View>
  );
});

/** The room drawing; kept apart so the pet moving does not redraw it. */
const Picture = memo(function Picture({ xml }: { xml: string }) {
  return <SvgXml xml={xml} width="100%" height="100%" />;
});

/** Taps on the floor, under the pets. A drag (the page scrolling) or a second finger is never a tap. */
function FloorTaps({ k, onTap }: { k: number; onTap: (x: number, y: number) => void }) {
  const touch = useRef<{ x: number; y: number; px: number; py: number; ok: boolean } | null>(null);
  const many = (e: GestureResponderEvent) => (e.nativeEvent.touches?.length ?? 1) > 1;
  return (
    <View style={StyleSheet.absoluteFill} testID="room-floor"
      onStartShouldSetResponder={() => true}
      onResponderGrant={(e) => {
        const { locationX, locationY, pageX, pageY } = e.nativeEvent;
        touch.current = { x: locationX, y: locationY, px: pageX, py: pageY, ok: !many(e) };
      }}
      onResponderMove={(e) => {
        const t = touch.current;
        if (t && (many(e) || Math.hypot(e.nativeEvent.pageX - t.px, e.nativeEvent.pageY - t.py) > TAP_SLOP)) t.ok = false;
      }}
      onResponderRelease={() => { const t = touch.current; touch.current = null; if (t?.ok) onTap(t.x / k, t.y / k); }}
      onResponderTerminate={() => { touch.current = null; }} />
  );
}

/** A small ring where the pet is heading, fading out. */
function TargetMark({ at, k }: { at: Point; k: number }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const run = Animated.timing(fade, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [fade]);
  const w = 26 * k, h = 10 * k;
  return <Animated.View pointerEvents="none" testID="room-walk-target" style={[s.target, {
    left: at.x * k - w / 2, top: at.feet * k - h / 2, width: w, height: h, borderRadius: w,
    opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
    transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) }],
  }]} />;
}

/** The pet's interaction menu, above its head (below its feet when there is no room above it under the header), placed
 * on the canvas. A transparent layer under it takes every other tap in the room and only closes it: no walk, no item. */
function PetMenu({ menu, spot, k, canvas, bounds }: {
  menu: NonNullable<Props['petMenu']>; spot: Spot; k: number; canvas: { left: number; top: number; width: number; height: number };
  bounds: { top: number; bottom: number };
}) {
  const w = Math.min(canvas.width - 16, 4 + menu.actions.length * 64);
  const h = 66;
  const above = (spot.feet - spot.size) * k - h - 6;
  const top = above >= bounds.top + 6 ? above : Math.min(bounds.bottom - h - 6, spot.feet * k + 6);
  const left = Math.max(8, Math.min(canvas.width - w - 8, spot.x * k - w / 2));
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={menu.onClose} accessibilityRole="button" accessibilityLabel="Đóng menu tương tác"
        testID="room-pet-menu-backdrop" />
      <View style={[s.canvas, canvas]} pointerEvents="box-none">
        <View style={[s.menu, { left, top, width: w, height: h }]} testID="room-pet-menu" accessibilityRole="menu">
          {menu.actions.map((a) => (
            <Pressable key={a.id} onPress={() => menu.onAction(a.id)} disabled={a.disabled}
              style={({ pressed }) => [s.menuItem, pressed && s.menuPressed, a.disabled && s.menuOff]}
              accessibilityRole="button" accessibilityLabel={a.note ? `${a.label}, ${a.note}` : a.label} accessibilityState={{ disabled: !!a.disabled }}>
              <View style={[s.menuIcon, a.disabled && s.menuIconOff]}><Ionicons name={a.icon} size={17} color="#FFFFFF" /></View>
              <Text style={s.menuText} numberOfLines={1}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );
}

/** Where an absent pet would be: a small "out on its walk" pill (a tap may open its menu, to leave a greeting). */
function AwayMarker({ marker, spot, k, width }: { marker: NonNullable<Props['awayMarker']>; spot: Spot; k: number; width: number }) {
  const w = Math.min(width - 16, 220);
  const left = Math.max(8, Math.min(width - w - 8, spot.x * k - w / 2));
  const top = (spot.feet - 28) * k - 22;
  const body = <><Ionicons name="walk-outline" size={15} color={t.accent} /><Text style={s.awayText} numberOfLines={2}>{marker.text}</Text></>;
  return marker.onPress ? (
    <Pressable onPress={marker.onPress} style={({ pressed }) => [s.away, { left, top, maxWidth: w }, pressed && s.menuPressed]} testID="room-away-marker"
      accessibilityRole="button" accessibilityLabel={marker.text} hitSlop={6}>{body}</Pressable>
  ) : (
    <View style={[s.away, { left, top, maxWidth: w }]} pointerEvents="none" testID="room-away-marker" accessible accessibilityLabel={marker.text}>{body}</View>
  );
}

/** "Cho ăn": a small treat dropping to the pet, then gone; "Chơi cùng": a ball bouncing past it. */
function ActionProp({ action, size }: { action: 'feed' | 'play'; size: number }) {
  const run = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    run.setValue(0);
    const anim = Animated.timing(run, { toValue: 1, duration: action === 'feed' ? 900 : 1200, easing: Easing.linear, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [run, action]);
  const px = Math.max(14, size * 0.2);
  if (action === 'feed') {
    return <Animated.View pointerEvents="none" testID="room-pet-treat" style={{ position: 'absolute', left: size / 2 - px / 2, top: size * 0.08,
      opacity: run.interpolate({ inputRange: [0, 0.1, 0.6, 0.8], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
      transform: [{ translateY: run.interpolate({ inputRange: [0, 0.6], outputRange: [-size * 0.3, size * 0.32], extrapolate: 'clamp' }) },
        { scale: run.interpolate({ inputRange: [0.6, 0.8], outputRange: [1, 0.4], extrapolate: 'clamp' }) }] }}>
      <Ionicons name="nutrition" size={px} color="#E8743B" />
    </Animated.View>;
  }
  return <Animated.View pointerEvents="none" testID="room-pet-ball" style={{ position: 'absolute', left: size * 0.86, top: size * 0.62,
    opacity: run.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] }),
    transform: [{ translateX: run.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.9] }) },
      { translateY: run.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -size * 0.32, 0, -size * 0.16, 0] }) },
      { rotate: run.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-540deg'] }) }] }}>
    <Ionicons name="tennisball" size={px} color="#9CC93A" />
  </Animated.View>;
}

/** Little hearts rising over the pet and fading, for a friend's tap. */
function HeartBurst({ size }: { size: number }) {
  const reduce = useReduceMotion();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rise.setValue(0);
    const run = Animated.timing(rise, { toValue: 1, duration: reduce ? 700 : 1300, easing: Easing.out(Easing.quad), useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [rise, reduce]);
  const hearts = [[-0.22, 0, 16], [0.02, 0.12, 20], [0.24, 0.05, 14], [-0.06, 0.22, 12]];
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.hearts]} testID="room-hearts">
    {hearts.map(([dx, delay, px], i) => {
      const t = rise.interpolate({ inputRange: [0, delay, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });
      return <Animated.View key={i} style={{ position: 'absolute', left: size / 2 + dx * size - px / 2, top: size * 0.25,
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 0.8, 0] }),
        transform: reduce ? [] : [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.45] }) },
          { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1, 0.9] }) }] }}>
        <Ionicons name="heart" size={px} color="#FF7AA8" />
      </Animated.View>;
    })}
  </View>;
}

/** The pet drawing; memoised so the walk (which moves its frame every display frame) does not re-render it. */
const Art = memo(PetArt);

/** How often a drag checks whether the item may stay where it is (the rules walk the floor: not every frame). */
const CHECK_MS = 100;

/** Touch handling while decorating. Reads the latest props through a ref, since the responder is created once. The
 * grab point keeps its place on the item (it never jumps to the finger), and positions are canvas units: the touch in
 * points over the canvas's scale `k`, wherever the canvas is in the space. Moving only sets `offset` (no new render);
 * whether it may stay there is checked every CHECK_MS, and the room changes once, when it is dropped. */
function EditLayer({ layout, k, editor, offset, onLift, frame, minTop, slide, zoom }: {
  layout: Layout; k: number; editor: NonNullable<Props['editor']>; offset: Animated.ValueXY; onLift: (items: string[] | null) => void;
  frame: [number, number, number, number] | null; minTop: number;
  /** A drag on an empty spot slides the room (see RoomScene's `chrome`), up and down and, zoomed in, sideways. */
  slide: { at: () => [number, number]; to: (p: number, px: number) => void };
  /** Two fingers pinch the room in or out. */
  zoom: { at: () => number; to: (z: number) => void };
}) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const latest = useRef({ layout, k, editor, onLift, slide, zoom });
  latest.current = { layout, k, editor, onLift, slide, zoom };
  // A drag that started on no item: where the room was slid when it began.
  const sliding = useRef<[number, number] | null>(null);
  // Two fingers down: how far apart they started and the zoom then. Nothing else until both lift.
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const gesture = useRef<{ item: string; x0: number; y0: number; x: number; y: number; moved: boolean } | null>(null);
  const check = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responder = useMemo(() => {
    const checkNow = () => {
      check.current = null;
      const g = gesture.current;
      if (g?.moved) setProblem(latest.current.editor.preview(g.item, g.x, g.y)?.problem ?? null);
    };
    const end = (commit: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      if (check.current !== null) { clearTimeout(check.current); check.current = null; }
      if (!g?.moved) return;
      // Dropped where it may stay: the room keeps it there; anywhere else it goes back to where it was.
      if (commit) latest.current.editor.onMove(g.item, g.x, g.y);
      latest.current.onLift(null);
      setProblem(null);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { layout: current, k: scale, editor: ed } = latest.current;
        const hit = itemAt(current, e.nativeEvent.locationX / scale, e.nativeEvent.locationY / scale);
        ed.onSelect(hit ? keyOf(hit) : null);
        gesture.current = hit ? { item: keyOf(hit), x0: hit.x, y0: hit.y, x: hit.x, y: hit.y, moved: false } : null;
        sliding.current = hit ? null : latest.current.slide.at();
        pinch.current = null;
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches ?? [];
        if (touches.length >= 2) {
          // A second finger: the item goes back where it was, and the fingers zoom.
          if (gesture.current) end(false);
          sliding.current = null;
          const d = Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
          if (!pinch.current) pinch.current = { d0: Math.max(d, 1), z0: latest.current.zoom.at() };
          else latest.current.zoom.to(pinch.current.z0 * (d / pinch.current.d0));
          return;
        }
        if (pinch.current) return;
        if (sliding.current !== null) { latest.current.slide.to(sliding.current[0] - g.dy, sliding.current[1] - g.dx); return; }
        const current = gesture.current;
        if (!current || (!current.moved && Math.abs(g.dx) + Math.abs(g.dy) < 4)) return;
        const { layout: now, k: scale, editor: ed } = latest.current;
        if (!current.moved) {
          current.moved = true;
          offset.setValue({ x: 0, y: 0 });
          latest.current.onLift([current.item, ...ridersOf(now, current.item).map(keyOf)]);
        }
        current.x = current.x0 + g.dx / scale;
        current.y = current.y0 + g.dy / scale;
        const at = ed.place(current.item, current.x, current.y);
        if (at) offset.setValue({ x: (at.x - current.x0) * scale, y: (at.y - current.y0) * scale });
        if (check.current === null) check.current = setTimeout(checkNow, CHECK_MS);
      },
      onPanResponderRelease: () => { sliding.current = null; pinch.current = null; end(true); },
      onPanResponderTerminate: () => { sliding.current = null; pinch.current = null; end(false); },
    });
  }, [offset]);
  useEffect(() => () => { if (check.current !== null) clearTimeout(check.current); }, []);

  // The frame is drawn over the room (it takes no room of its own) and moves with the lifted item.
  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} testID="room-edit-layer">
      <Animated.View style={[StyleSheet.absoluteFill, { transform: offset.getTranslateTransform() }]} pointerEvents="none">
        {frame ? (
          <View style={[s.frame, problem ? s.frameBad : null, {
            left: frame[0] * k - 4, top: frame[1] * k - 4, width: (frame[2] - frame[0]) * k + 8, height: (frame[3] - frame[1]) * k + 8,
          }]} testID={problem ? 'room-selection-invalid' : 'room-selection'} />
        ) : null}
        {problem && frame ? (
          <View style={[s.problem, { top: Math.max(minTop + 4, frame[1] * k - 34) }]} accessibilityLiveRegion="polite">
            <Ionicons name="close-circle" size={14} color="#FFFFFF" /><Text style={s.problemText} selectable={false}>{PROBLEM_TEXT[problem]}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Decorating: zoom in and out over the room's top right corner, under the header; the middle shows the zoom and puts
 * the room back to its own camera. */
function ZoomControls({ zoom, top, onZoom }: { zoom: number; top: number; onZoom: (z: number) => void }) {
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <View style={[s.zoom, { top }]} testID="room-zoom">
      <Pressable onPress={() => onZoom(zoomIn(zoom))} disabled={zoom >= MAX_ZOOM} hitSlop={4}
        style={({ pressed }) => [s.zoomButton, pressed && s.menuPressed, zoom >= MAX_ZOOM && s.menuOff]}
        accessibilityRole="button" accessibilityLabel="Phóng to" accessibilityState={{ disabled: zoom >= MAX_ZOOM }}>
        <Ionicons name="add" size={20} color={t.accent} />
      </Pressable>
      <Pressable onPress={() => onZoom(1)} disabled={zoom === 1} style={s.zoomLevel} accessibilityRole="button"
        accessibilityLabel={`Thu phóng ${percent}, chạm để về cỡ gốc`} accessibilityState={{ disabled: zoom === 1 }}>
        <Text style={s.zoomText} selectable={false}>{percent}</Text>
      </Pressable>
      <Pressable onPress={() => onZoom(zoomOut(zoom))} disabled={zoom <= MIN_ZOOM} hitSlop={4}
        style={({ pressed }) => [s.zoomButton, pressed && s.menuPressed, zoom <= MIN_ZOOM && s.menuOff]}
        accessibilityRole="button" accessibilityLabel="Thu nhỏ" accessibilityState={{ disabled: zoom <= MIN_ZOOM }}>
        <Ionicons name="remove" size={20} color={t.accent} />
      </Pressable>
    </View>
  );
}

function ScenePet({ pet, spot, k, pose, resting: atDeskResting = false, guest = false, onPress, label, reaction, effects = true, moving = false, facing = 1, hearts,
  canvasWidth = 400, minTop = 0 }: {
  pet: RoomPet; spot: Spot; k: number; pose: Pose; resting?: boolean; guest?: boolean; onPress?: () => void; label?: string; reaction?: Props['reaction'];
  effects?: boolean;
  /** Walking across the room: its walk strip (or, without one, the still artwork with a light bob), facing its way. */
  moving?: boolean; facing?: 1 | -1; hearts?: number; canvasWidth?: number;
  /** Its line never goes above this (the header over the room). */
  minTop?: number;
}) {
  const reduce = useReduceMotion();
  const hop = useRef(new Animated.Value(0)).current;
  const squish = useRef(new Animated.Value(0)).current;
  const size = spot.size * k;
  const left = (spot.x - spot.size / 2) * k;
  const top = (spot.feet - spot.size) * k;
  const studying = pose === 'study' && !atDeskResting && hasSprite(pet.id, pet.level, 'study');
  const resting = pose === 'rest' || atDeskResting;

  const animate = !!reaction && !reduce && effects;
  useEffect(() => {
    if (!animate) return;
    hop.setValue(0); squish.setValue(0);
    const jump = (height: number, ms: number) => [
      Animated.timing(hop, { toValue: height, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: ms, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ];
    const lean = (ms: number) => [
      Animated.timing(squish, { toValue: 1, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(squish, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ];
    const action = reaction!.action;
    const run = action === 'pet' ? Animated.sequence([...lean(220), ...lean(220)]) // leans into the hand, twice
      : action === 'feed' ? Animated.sequence([Animated.delay(480), ...jump(0.25, 110), ...jump(0.25, 110)]) // nibbles the treat
      : action === 'play' ? Animated.sequence([...jump(1, 200), ...jump(0.6, 170)]) // jumps after the ball
      : Animated.sequence([
        Animated.timing(hop, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(hop, { toValue: 0, friction: 3, tension: 140, useNativeDriver: true }),
      ]);
    run.start();
    return () => run.stop();
  }, [reaction?.key, animate, hop, squish]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = pet.name || 'Pet';
  const art = (
    <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.16] }) },
      { scaleX: squish.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
      { scaleY: squish.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) },
      // The walk strips face right; walking left mirrors it. Standing still it faces the room again.
      { scaleX: moving ? facing : 1 }] }}>
      {/* A resting pet has no drawn sleep strip, so it keeps its still artwork (with a small moon). */}
      <Art pet={pet.id} size={size} stage={pet.level} studying={studying && !moving} still={resting && !moving} walking={moving} />
    </Animated.View>
  );
  return (
    <>
      <View style={[s.shadow, { left: left + size * 0.25, top: top + size * 0.935, width: size * 0.5, height: size * 0.07, borderRadius: size }]} pointerEvents="none" />
      {onPress ? (
        <Pressable onPress={onPress} style={[s.pet, { left, top, width: size, height: size }]} accessibilityRole="button"
          accessibilityLabel={label ?? `${name}, chạm để chơi cùng`} testID="room-pet">
          {art}
          {hearts ? <HeartBurst key={hearts} size={size} /> : null}
          {animate && reaction!.action === 'pet' ? <HeartBurst key={`pet${reaction!.key}`} size={size} /> : null}
          {animate && (reaction!.action === 'feed' || reaction!.action === 'play')
            ? <ActionProp key={reaction!.key} action={reaction!.action} size={size} /> : null}
        </Pressable>
      ) : (
        <View style={[s.pet, { left, top, width: size, height: size }]} pointerEvents="none"
          accessible accessibilityLabel={guest ? `${name}, pet của bạn, đang ghé chơi` : name} testID={guest ? 'room-guest-pet' : 'room-pet'}>
          {art}
        </View>
      )}
      {resting ? <View style={[s.moon, { left: left + size * 0.78, top: top + size * 0.02 }]} pointerEvents="none"><Ionicons name="moon" size={14} color="#8B8EA6" /></View> : null}
      {reaction ? (
        <View key={reaction.key} pointerEvents="none" style={[s.bubbleWrap, { top: Math.max(minTop + 4, top - 40), left: 0, right: 0 }]}>
          <View style={[s.bubble, { marginLeft: Math.max(0, Math.min(left + size / 2 - 90, k * canvasWidth - 180)) }]} accessibilityLiveRegion="polite">
            <Text style={s.bubbleText} numberOfLines={2}>{reaction.text}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', minHeight: 0 },
  scene: { borderRadius: 26, overflow: 'hidden', backgroundColor: '#F6EFE6' },
  sceneScreen: { borderRadius: 0 },
  // Decorating: the room as a card on a plain background, its edges plain to see.
  fillBounded: { justifyContent: 'center', backgroundColor: '#E9F0F5' },
  sceneBounded: { borderRadius: 6 },
  canvas: { position: 'absolute' },
  picture: { position: 'absolute', left: 0, top: 0 },
  zoom: { position: 'absolute', right: 10, width: 40, alignItems: 'center', borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1, borderColor: 'rgba(18,59,92,0.10)', shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 3 },
  zoomButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  zoomLevel: { height: 22, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(18,59,92,0.08)' },
  zoomText: { color: t.ink, fontSize: 10, fontWeight: '800' },
  pet: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  frame: { position: 'absolute', borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#2E9E6A', backgroundColor: 'rgba(46,158,106,0.10)' },
  frameBad: { borderColor: '#D64545', backgroundColor: 'rgba(214,69,69,0.14)' },
  problem: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D64545',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  problemText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  // A soft contact shadow under the feet, so the pet stands on the rug or the floor.
  shadow: { position: 'absolute', backgroundColor: 'rgba(90,64,48,0.18)' },
  target: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(31,111,168,0.75)', backgroundColor: 'rgba(255,255,255,0.45)' },
  hearts: { overflow: 'visible' },
  moon: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center' },
  bubbleWrap: { position: 'absolute' },
  bubble: { width: 180, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
    shadowColor: '#0A2438', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  bubbleText: { color: t.ink, fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  menu: { position: 'absolute', flexDirection: 'row', alignItems: 'stretch', padding: 2, borderRadius: 20, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#B9D6EA', shadowColor: '#0A2438', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 16, minWidth: 44 },
  menuPressed: { backgroundColor: '#E6F1F8' },
  menuIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  menuText: { color: t.ink, fontSize: 11, fontWeight: '800' },
  menuOff: { opacity: 0.45 },
  menuIconOff: { backgroundColor: '#8FA6B6' },
  away: { position: 'absolute', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 18, backgroundColor: '#FFFFFFE6', borderWidth: 1.5, borderColor: '#B9D6EA' },
  awayText: { flexShrink: 1, color: t.ink, fontSize: 12, fontWeight: '800' },
});
