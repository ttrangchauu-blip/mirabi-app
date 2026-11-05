import React, { memo, useEffect, useMemo, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { carried, drawOrder, homeOf, itemArt, keyOf, liftedSvg, seatCover } from '../../room/art';
import type { Layout, Placement, Pose } from '../../room/types';
import { useSwing, useWorldMotion } from '../../world/budget';
import { GlassSky } from '../../world/GlassSky';
import { FOCUS_EXTRAS, FOCUS_FLOORS, FOCUS_FORE, FOCUS_ITEMS, FOCUS_WALLS, type Box, type FocusPlate } from './focusPlates';
import type { RoomDrawing } from '../room/RoomScene';

/**
 * The focus room as rendered 3D pictures (scripts/render-scenes, scene-focus.js), in layers: its wall and floor in the colours the
 * owner chose, and each thing of the starting layout as a picture with its own shadow, standing wherever the owner put it, mirrored
 * or tilted as they did. Whatever has no such picture (anything found later, another colour of a thing) keeps its drawing from the
 * catalog, so all of decorating works as it always has. Curtains, leaves, the clock and the sky are their own layers and move on their own.
 */

const CW = 640, CH = 440;
const WHOLE: Box = [0, 0, CW, CH];
const pct = (v: number, of: number) => `${(v / of) * 100}%` as const;
const place = ([x, y, w, h]: Box) => ({ position: 'absolute' as const, left: pct(x, CW), top: pct(y, CH), width: pct(w, CW), height: pct(h, CH) });

const Plate = ({ source, box }: { source: ImageSourcePropType; box: Box }) => (
  <Image source={source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors style={place(box)} />
);

/** A layer that stirs around a point of the canvas. `deg` is how far at most: nothing here may draw the eye from studying. */
function Swaying({ source, box, origin, deg, ms }: { source: ImageSourcePropType; box: Box; origin: [number, number]; deg: number; ms: number }) {
  const { level } = useWorldMotion();
  const swing = useSwing({ ms, rest: [400, 3200], enabled: level === 'full' });
  const [x, y, w, h] = box;
  return (
    <Animated.Image source={source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors testID="room-sway"
      style={[place(box), { transformOrigin: `${((origin[0] - x) / w) * 100}% ${((origin[1] - y) / h) * 100}%`, transform: [
        { rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: [`${-deg}deg`, `${deg}deg`] }) }] }]} />
  );
}

/** The real time, on the wall clock's hands. Once in half a minute is plenty, and nothing else redraws for it. */
function ClockHands({ x, y }: { x: number; y: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const minutes = now.getMinutes() + now.getSeconds() / 60, hours = (now.getHours() % 12) + minutes / 60;
  const hand = (length: number, thick: number, deg: number) => (
    <View key={length} style={{ position: 'absolute', left: pct(x - thick / 2, CW), top: pct(y - length, CH), width: pct(thick, CW), height: pct(length * 2, CH), transform: [{ rotate: `${deg}deg` }] }}>
      <View style={s.hand} />
    </View>
  );
  return <>{hand(11, 2.2, hours * 30)}{hand(16, 1.5, minutes * 6)}</>;
}

/** Where the plate of an item is drawn: moved from where the picture has it, mirrored and tilted around its anchor. */
function Placed({ p, plate, children }: { p: Placement; plate: FocusPlate; children: React.ReactNode }) {
  const [ax, ay] = plate.anchor;
  return (
    <View pointerEvents="none" style={[s.layer, { left: pct(p.x - ax, CW), top: pct(p.y - ay, CH), transformOrigin: `${pct(ax, CW)} ${pct(ay, CH)}`,
      transform: [{ scaleX: p.flip ? -1 : 1 }, { rotate: `${p.rotate ?? 0}deg` }] }]}>{children}</View>
  );
}

/** The picture of a placed thing, or null when it has none (and keeps its catalog drawing). */
const plateOf = (p: Placement): FocusPlate | null => {
  const plate = FOCUS_ITEMS[p.item];
  return plate && p.variant.split('~')[0] === plate.variant ? plate : null;
};
/** Whether this window is the picture of one (its curtains are their own layers), for what draws around windows. */
export const isPlatedWindow = (p: Placement) => p.item === 'window' && !!plateOf(p);

const ItemPlate = memo(function ItemPlate({ p, plate }: { p: Placement; plate: FocusPlate }) {
  const [ax, ay] = plate.anchor;
  return (
    <Placed p={p} plate={plate}>
      {plate.glass ? <View style={place(plate.glass)}><GlassSky idPrefix="focus" /></View> : null}
      <Plate source={plate.source} box={plate.box} />
      {plate.clock ? <ClockHands x={ax + plate.clock[0]} y={ay + plate.clock[1]} /> : null}
      {plate.sway?.map((part) => <Swaying key={part.box.join()} source={part.source} box={part.box} origin={part.origin} deg={part.deg} ms={part.ms} />)}
    </Placed>
  );
});

/** Some placed things, back to front, with their pictures and drawings in the order they stand. */
const Items = memo(function Items({ items }: { items: Placement[] }) {
  const runs = useMemo(() => {
    const out: ({ plate: FocusPlate; p: Placement } | { svg: string; key: string })[] = [];
    let pending: Placement[] = [];
    const flush = () => { if (pending.length) out.push({ svg: liftedSvg(pending, 'focus'), key: pending.map(keyOf).join() }); pending = []; };
    for (const p of drawOrder({ wall: '', floor: '', items })) {
      const plate = plateOf(p);
      if (plate) { flush(); out.push({ plate, p }); } else if (itemArt(p.item)) pending.push(p);
    }
    flush();
    return out;
  }, [items]);
  return <>{runs.map((run) => ('svg' in run
    ? <View key={run.key} pointerEvents="none" style={StyleSheet.absoluteFill}><SvgXml xml={run.svg} width="100%" height="100%" /></View>
    : <ItemPlate key={keyOf(run.p)} p={run.p} plate={run.plate} />))}</>;
});

const Backdrop = memo(function Backdrop({ layout }: { layout: Layout }) {
  const wall = FOCUS_WALLS[layout.wall] ?? FOCUS_WALLS.wall_lilac;
  const floor = FOCUS_FLOORS[layout.floor] ?? FOCUS_FLOORS.floor_wood_honey;
  return (
    <View style={s.fill} pointerEvents="none" testID="focus-room-plates">
      <Plate source={wall.source} box={WHOLE} />
      <Plate source={floor.source} box={floor.box} />
      <Plate source={FOCUS_EXTRAS.source} box={FOCUS_EXTRAS.box} />
      <Items items={layout.items} />
    </View>
  );
});

/** The desk's top and front and what stands on it, over the seated pet. */
function SeatCover({ layout, pose }: { layout: Layout; pose: Pose }) {
  const home = homeOf(layout, pose);
  const plate = home ? plateOf(home) : null;
  if (!home || !plate?.cover) {
    const cover = seatCover(layout, pose, 'focus');
    return cover ? <SvgXml xml={cover.svg} width="100%" height="100%" /> : null;
  }
  const on = carried(layout.items.filter((p) => itemArt(p.item))).on.get(keyOf(home)) ?? [];
  return <>
    <Placed p={home} plate={plate}><Plate source={plate.cover} box={plate.coverBox!} /></Placed>
    <Items items={on} />
  </>;
}

/** Leaves close to the camera. They stir, stay in the corners and never cover the desk, the pet or anything placed. */
function Foreground() {
  return <View pointerEvents="none" style={s.fill} testID="focus-room-fore">
    {FOCUS_FORE.map((part) => <Swaying key={part.box.join()} source={part.source} box={part.box} origin={part.origin} deg={part.deg} ms={part.ms} />)}
  </View>;
}

export const FOCUS_DRAWING: RoomDrawing = {
  room: (layout) => <Backdrop layout={layout} />,
  items: (items) => <Items items={items} />,
  cover: (layout, pose) => <SeatCover layout={layout} pose={pose} />,
  front: <Foreground />,
  // The rendered desk's top starts higher than the catalog's, and it would hide the book.
  seatLift: { study: 18, still: 34 },
};
/** In photo mode the room goes on above and below the picture, so nothing may end at its edges. */
export const FOCUS_PHOTO_DRAWING: RoomDrawing = { ...FOCUS_DRAWING, front: null, edgeless: true };

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  layer: { position: 'absolute', width: '100%', height: '100%' },
  hand: { width: '100%', height: '50%', borderRadius: 2, backgroundColor: '#35524A' },
});
