import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, GestureResponderEvent, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { hasSprite } from '../../petSprites';
import { CANVAS, frontSvg, GUEST_SPOT, itemArt, itemAt, itemsInFront, petSpot, placedBox, roomSvg, settle, Spot } from '../../room/art';
import type { Layout, Placement, Pose, RoomPet } from '../../room/types';
import { along, findPath, pathLength, Point, WALK_SPEED } from '../../room/walk';
import { appTheme as t } from '../../theme';

const FALLBACK_WIDTH = 320;

type Props = {
  layout: Layout;
  pet: RoomPet;
  pose: Pose;
  /** Out on its walk: the room is shown without the pet. */
  away: boolean;
  /** A visiting friend's pet, on its own spot in front that never covers the host. */
  guest?: RoomPet | null;
  onPetPress?: () => void;
  /** A short line over the pet; a new `key` replays the hop. */
  reaction?: { key: number; text: string } | null;
  /** A small notice at the top of the scene (walk, studying…). */
  notice?: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string } | null;
  description: string;
  /** Decorating: a tap selects the item under it (or clears the selection), a drag moves it inside the room. */
  editor?: { selected: string | null; onSelect: (item: string | null) => void; onMove: (item: string, x: number, y: number) => void } | null;
  /** The owner's room, pet on its rug: a tap on free floor walks it there. Never for visitors. */
  walkable?: boolean;
  /** A burst of little hearts over the pet; a new number plays it again. */
  hearts?: number;
};

const TAP_SLOP = 8; // a touch that moves more than this (screen points) is a drag, not a tap

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
  return { at, moving, facing, target, walkTo };
}

/**
 * The room, filling the space it is given at the canvas proportions (never stretched): the furniture as one drawing,
 * then the pets on top, so no furniture ever covers a pet. While decorating, an overlay above everything picks and
 * drags items; the room redraws as an item moves, so it slips behind or in front of the others as it goes.
 */
export const RoomScene = memo(function RoomScene({ layout, pet, pose, away, guest, onPetPress, reaction, notice, description, editor, walkable = false, hearts }: Props) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [drag, setDrag] = useState<Placement | null>(null);
  const shown = useMemo(() => (drag ? { ...layout, items: layout.items.map((p) => (p.item === drag.item ? drag : p)) } : layout), [layout, drag]);
  const svg = useMemo(() => roomSvg(shown), [shown]);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
  };
  // Until the first layout pass (and in tests, which have none) the room is drawn at a phone-sized fallback.
  const width = box ? Math.min(box.width, (box.height * CANVAS.width) / CANVAS.height) : FALLBACK_WIDTH;
  const height = (width * CANVAS.height) / CANVAS.width;
  const k = width / CANVAS.width;
  const selected = editor?.selected ? shown.items.find((p) => p.item === editor.selected) : undefined;
  const frame = selected ? placedBox(selected) : null;
  const home = petSpot(shown, pose);
  const canWalk = walkable && !editor && !away && pose === 'rug';
  const walker = useWalker(layout, home, canWalk);
  const spot: Spot = walker.at ? { x: walker.at.x, feet: walker.at.feet, size: home.size } : home;
  // A pet that walked behind furniture is covered by it: the floor items in front of its feet are drawn again on top.
  const front = useMemo(() => (walker.at ? itemsInFront(shown, walker.at.feet) : []), [shown, walker.at]);
  const frontKey = front.map((p) => `${p.item}:${p.x}:${p.y}`).join('|');
  const overlay = useMemo(() => frontSvg(front), [frontKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A tap on the floor (not on the wall, a piece of furniture or the pet, which have their own taps). */
  const onFloorTap = (x: number, y: number) => {
    if (y < CANVAS.floorY) return;
    const hit = itemAt(shown, x, y);
    if (hit && itemArt(hit.item)?.mount === 'floor') return;
    walker.walkTo({ x, feet: y });
  };

  return (
    <View style={s.fill} onLayout={onLayout}>
      {width > 0 ? (
        <View style={[s.scene, { width, height }]} testID="room-scene">
          <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={description}>
            <Picture xml={svg} />
          </View>
          {canWalk ? <FloorTaps k={k} onTap={onFloorTap} /> : null}
          {canWalk && walker.target ? <TargetMark key={walker.target.key} at={walker.target.at} k={k} /> : null}
          {away ? null : <ScenePet pet={pet} spot={spot} k={k} pose={pose} onPress={editor ? undefined : onPetPress} reaction={editor ? null : reaction}
            moving={walker.moving} facing={walker.facing} hearts={editor ? undefined : hearts} />}
          {overlay && !away ? <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="room-front"><Picture xml={overlay} /></View> : null}
          {guest ? <ScenePet pet={guest} spot={GUEST_SPOT} k={k} pose="rug" guest /> : null}
          {editor ? <EditLayer layout={layout} k={k} editor={editor} onDrag={setDrag} frame={frame} /> : null}
          {notice && !editor ? (
            <View style={s.notice} pointerEvents="none" accessibilityLiveRegion="polite">
              <Ionicons name={notice.icon} size={14} color={t.accent} />
              <Text style={s.noticeText}>{notice.text}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
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

/** Touch handling while decorating. Reads the latest props through a ref, since the responder is created once. */
function EditLayer({ layout, k, editor, onDrag, frame }: {
  layout: Layout; k: number; editor: NonNullable<Props['editor']>; onDrag: (p: Placement | null) => void; frame: [number, number, number, number] | null;
}) {
  const latest = useRef({ layout, k, editor, onDrag });
  latest.current = { layout, k, editor, onDrag };
  const gesture = useRef<{ start: Placement; last: Placement; moved: boolean } | null>(null);
  const frameRequest = useRef<number | null>(null);
  const responder = useMemo(() => {
    const flush = () => { frameRequest.current = null; if (gesture.current?.moved) latest.current.onDrag(gesture.current.last); };
    const end = (commit: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      if (frameRequest.current !== null) { cancelAnimationFrame(frameRequest.current); frameRequest.current = null; }
      if (commit && g?.moved) latest.current.editor.onMove(g.start.item, g.last.x, g.last.y);
      latest.current.onDrag(null);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { layout: current, k: scale, editor: ed } = latest.current;
        const hit = itemAt(current, e.nativeEvent.locationX / scale, e.nativeEvent.locationY / scale);
        ed.onSelect(hit?.item ?? null);
        gesture.current = hit ? { start: hit, last: hit, moved: false } : null;
      },
      onPanResponderMove: (_, g) => {
        const current = gesture.current;
        if (!current || (!current.moved && Math.abs(g.dx) + Math.abs(g.dy) < 4)) return;
        const scale = latest.current.k;
        current.moved = true;
        current.last = settle({ ...current.start, x: current.start.x + g.dx / scale, y: current.start.y + g.dy / scale });
        if (frameRequest.current === null) frameRequest.current = requestAnimationFrame(flush);
      },
      onPanResponderRelease: () => end(true),
      onPanResponderTerminate: () => end(false),
    });
  }, []);
  useEffect(() => () => { if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current); }, []);

  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} testID="room-edit-layer">
      {frame ? (
        <View pointerEvents="none" style={[s.frame, {
          left: frame[0] * k - 4, top: frame[1] * k - 4, width: (frame[2] - frame[0]) * k + 8, height: (frame[3] - frame[1]) * k + 8,
        }]} testID="room-selection" />
      ) : null}
    </View>
  );
}

function ScenePet({ pet, spot, k, pose, guest = false, onPress, reaction, moving = false, facing = 1, hearts }: {
  pet: RoomPet; spot: Spot; k: number; pose: Pose; guest?: boolean; onPress?: () => void; reaction?: Props['reaction'];
  /** Walking across the room: its walk strip (or, without one, the still artwork with a light bob), facing its way. */
  moving?: boolean; facing?: 1 | -1; hearts?: number;
}) {
  const reduce = useReduceMotion();
  const hop = useRef(new Animated.Value(0)).current;
  const size = spot.size * k;
  const left = (spot.x - spot.size / 2) * k;
  const top = (spot.feet - spot.size) * k;
  const studying = pose === 'study' && hasSprite(pet.id, pet.level, 'study');
  const resting = pose === 'rest';

  useEffect(() => {
    if (!reaction || reduce) return;
    hop.setValue(0);
    const run = Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 3, tension: 140, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [reaction?.key, reduce, hop]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = pet.name || 'Pet';
  const art = (
    <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.16] }) },
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
          accessibilityLabel={`${name}, chạm để chơi cùng`} testID="room-pet">
          {art}
          {hearts ? <HeartBurst key={hearts} size={size} /> : null}
        </Pressable>
      ) : (
        <View style={[s.pet, { left, top, width: size, height: size }]} pointerEvents="none"
          accessible accessibilityLabel={guest ? `${name}, pet của bạn, đang ghé chơi` : name} testID={guest ? 'room-guest-pet' : 'room-pet'}>
          {art}
        </View>
      )}
      {resting ? <View style={[s.moon, { left: left + size * 0.78, top: top + size * 0.02 }]} pointerEvents="none"><Ionicons name="moon" size={14} color="#8B8EA6" /></View> : null}
      {reaction ? (
        <View key={reaction.key} pointerEvents="none" style={[s.bubbleWrap, { top: Math.max(4, top - 40), left: 0, right: 0 }]}>
          <View style={[s.bubble, { marginLeft: Math.max(0, Math.min(left + size / 2 - 90, k * CANVAS.width - 180)) }]} accessibilityLiveRegion="polite">
            <Text style={s.bubbleText} numberOfLines={2}>{reaction.text}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 },
  scene: { borderRadius: 26, overflow: 'hidden', backgroundColor: '#F6EFE6' },
  pet: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  frame: { position: 'absolute', borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: t.accent, backgroundColor: 'rgba(255,255,255,0.12)' },
  shadow: { position: 'absolute', backgroundColor: 'rgba(110,88,70,0.1)' },
  target: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(31,111,168,0.75)', backgroundColor: 'rgba(255,255,255,0.45)' },
  hearts: { overflow: 'visible' },
  moon: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center' },
  bubbleWrap: { position: 'absolute' },
  bubble: { width: 180, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
    shadowColor: '#0A2438', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  bubbleText: { color: t.ink, fontSize: 13, lineHeight: 17, fontWeight: '700', textAlign: 'center' },
  notice: { position: 'absolute', top: 10, alignSelf: 'center', maxWidth: '88%', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFFE6', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  noticeText: { flexShrink: 1, color: t.ink, fontSize: 12, fontWeight: '800' },
});
