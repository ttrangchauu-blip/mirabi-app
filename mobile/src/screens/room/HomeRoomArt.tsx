import React, { memo, useEffect, useMemo, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SvgXml } from 'react-native-svg';
import { carried, drawOrder, homeOf, itemArt, keyOf, liftedSvg, seatCover, variantOf, type Box as ViewBox } from '../../room/art';
import type { Layout, Placement, Pose } from '../../room/types';
import { useSwing, useWorldMotion } from '../../world/budget';
import { GlassSky } from '../../world/GlassSky';
import { HOME_FLOORS, HOME_ITEMS, HOME_WALLS, type Box, type HomePlate, type HomeVariant, type Picture, type SwayPart } from './homePlates';
import type { RoomDrawing } from './RoomScene';

/**
 * Nhà của Pet as rendered 3D pictures (scripts/render-scenes, scene-home.js): a cutaway room seen from a little above, its wall and floor
 * in the colours the owner chose, and each thing as a picture with its own shadow, standing wherever the owner put it, mirrored or tilted
 * as they did. The pictures are on the room's own 420 x 770 canvas, so a saved room is drawn where it always was: nothing about layouts,
 * decorating or the pet changes. Whatever has no picture (a decoration found later) keeps its drawing from the catalog. Curtains, plants
 * and the hanging pot stir; the sky in the windows, the clock's hands, the light of the hour and lamp light are live.
 */

const CW = 420, CH = 770;
const pct = (v: number, of: number) => `${(v / of) * 100}%` as const;
const place = ([x, y, w, h]: Box) => ({ position: 'absolute' as const, left: pct(x, CW), top: pct(y, CH), width: pct(w, CW), height: pct(h, CH) });

const Plate = ({ source, box }: { source: ImageSourcePropType; box: Box }) => (
  <Image source={source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors style={place(box)} />
);

/** Stirs around a point of the canvas, `deg` at most: a room to rest in, nothing that pulls the eye. */
function Sway({ origin, deg, ms, children }: { origin: [number, number]; deg: number; ms: number; children: React.ReactNode }) {
  const { level } = useWorldMotion();
  const swing = useSwing({ ms, rest: [400, 3200], enabled: level === 'full' });
  return (
    <Animated.View pointerEvents="none" testID="room-sway" style={[s.fill, { transformOrigin: `${pct(origin[0], CW)} ${pct(origin[1], CH)}`, transform: [
      { rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: [`${-deg}deg`, `${deg}deg`] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** The real time on the clock's hands; once in half a minute is plenty. */
function ClockHands({ x, y }: { x: number; y: number }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const minutes = now.getMinutes() + now.getSeconds() / 60, hours = (now.getHours() % 12) + minutes / 60;
  const hand = (length: number, thick: number, deg: number) => (
    <View key={length} style={{ position: 'absolute', left: pct(x - thick / 2, CW), top: pct(y - length, CH), width: pct(thick, CW), height: pct(length * 2, CH), transform: [{ rotate: `${deg}deg` }] }}>
      <View style={s.hand} />
    </View>
  );
  return <>{hand(10, 2.2, hours * 30)}{hand(15, 1.5, minutes * 6)}</>;
}

/** The pictures of an item, moved from where they were rendered to where it is, mirrored and tilted around its anchor. */
function Placed({ p, plate, children }: { p: Placement; plate: HomePlate; children: React.ReactNode }) {
  const [ax, ay] = plate.anchor;
  return (
    <View pointerEvents="none" style={[s.layer, { left: pct(p.x - ax, CW), top: pct(p.y - ay, CH), transformOrigin: `${pct(ax, CW)} ${pct(ay, CH)}`,
      transform: [{ scaleX: p.flip ? -1 : 1 }, { rotate: `${p.rotate ?? 0}deg` }] }]}>{children}</View>
  );
}

/** The picture of a placed thing in its colour, or null when there is none (it keeps its catalog drawing). */
export function plateOf(p: Placement): { plate: HomePlate; v: HomeVariant } | null {
  const plate = HOME_ITEMS[p.item];
  const v = plate?.variants[p.variant.split('~')[0]];
  return plate && v ? { plate, v } : null;
}
/** A window drawn from its pictures: its curtains are their own layers, so the room's ambience doesn't draw others. */
export const isPlatedHomeWindow = (p: Placement) => (p.item === 'window' || p.item === 'window_round') && !!plateOf(p);

const ItemPlate = memo(function ItemPlate({ p, plate, v }: { p: Placement; plate: HomePlate; v: HomeVariant }) {
  const [ax, ay] = plate.anchor;
  const body = <>
    {plate.glass ? <View style={[place(plate.glass), plate.glassRound && s.round]}><GlassSky idPrefix="home" /></View> : null}
    <Plate source={v.source} box={v.box} />
    {plate.clock ? <ClockHands x={ax + plate.clock[0]} y={ay + plate.clock[1]} /> : null}
    {v.sway?.map((part: SwayPart) => <Sway key={part.box.join()} origin={part.origin} deg={part.deg} ms={part.ms}><Plate source={part.source} box={part.box} /></Sway>)}
  </>;
  return <Placed p={p} plate={plate}>{plate.swayAll ? <Sway {...plate.swayAll}>{body}</Sway> : body}</Placed>;
});

/** Some placed things, back to front, pictures and drawings in the order they stand. */
const Items = memo(function Items({ items }: { items: Placement[] }) {
  const runs = useMemo(() => {
    const out: ({ p: Placement; plate: HomePlate; v: HomeVariant } | { svg: string; key: string })[] = [];
    let pending: Placement[] = [];
    const flush = () => { if (pending.length) out.push({ svg: liftedSvg(pending, 'personal'), key: pending.map(keyOf).join() }); pending = []; };
    for (const p of drawOrder({ wall: '', floor: '', items })) {
      const found = plateOf(p);
      if (found) { flush(); out.push({ p, ...found }); } else if (itemArt(p.item)) pending.push(p);
    }
    flush();
    return out;
  }, [items]);
  return <>{runs.map((run) => ('svg' in run
    ? <View key={run.key} pointerEvents="none" style={s.fill}><SvgXml xml={run.svg} width="100%" height="100%" /></View>
    : <ItemPlate key={keyOf(run.p)} p={run.p} plate={run.plate} v={run.v} />))}</>;
});

/** Daylight (or moonlight) through each window, falling on the floor in front of it: soft, and in the colour of the window's sky. */
function windowLight(layout: Layout): string | null {
  const shapes = layout.items.filter((p) => itemArt(p.item)?.light).map((p, i) => {
    const art = itemArt(p.item)!, colors = variantOf(art, p.variant).colors;
    const w = art.light!.w / 2, len = art.light!.len * 1.9, top = 444, id = `hl${i}`;
    return `<defs><linearGradient id='${id}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${colors.light}' stop-opacity='${colors.lightop}'/>`
      + `<stop offset='1' stop-color='${colors.light}' stop-opacity='0'/></linearGradient></defs>`
      + `<path d='M${p.x - w - 14} ${top}H${p.x + w + 14}L${p.x + w + 70} ${top + len + 12}H${p.x - w + 4}Z' fill='url(#${id})' opacity='.45'/>`
      + `<path d='M${p.x - w} ${top}H${p.x + w}L${p.x + w + 48} ${top + len}H${p.x - w + 16}Z' fill='url(#${id})' opacity='.8'/>`;
  });
  return shapes.length ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none">${shapes.join('')}</svg>` : null;
}

/** What is around the room (above the wall's cap, past the floor's slab): the app's own soft blue. */
const AROUND = ['#D6E9F7', '#E8F2FA', '#F1F6FA'] as const;

const Backdrop = memo(function Backdrop({ layout, view }: { layout: Layout; view?: ViewBox }) {
  const wall = HOME_WALLS[layout.wall] ?? HOME_WALLS.wall_cream;
  const floor = HOME_FLOORS[layout.floor] ?? HOME_FLOORS.floor_wood_honey;
  const [x0, y0, x1, y1] = view ?? [0, 0, CW, CH];
  const vw = x1 - x0, vh = y1 - y0;
  const light = useMemo(() => windowLight(layout), [layout]);
  return (
    <View style={s.fill} pointerEvents="none" testID="home-room-plates">
      <LinearGradient colors={AROUND} style={s.fill} />
      {/* The canvas inside the part of the room shown. */}
      <View style={{ position: 'absolute', left: `${(-x0 / vw) * 100}%`, top: `${(-y0 / vh) * 100}%`, width: `${(CW / vw) * 100}%`, height: `${(CH / vh) * 100}%` }}>
        <Plate source={wall.source} box={wall.box} />
        <Plate source={floor.source} box={floor.box} />
        {light ? <View style={s.fill}><SvgXml xml={light} width="100%" height="100%" /></View> : null}
        <Items items={layout.items} />
      </View>
    </View>
  );
});

/** The desk's front and what stands on it, over the pet at its seat. */
function SeatCover({ layout, pose }: { layout: Layout; pose: Pose }) {
  const home = homeOf(layout, pose);
  const found = home ? plateOf(home) : null;
  if (!home || !found?.v.cover) {
    const cover = seatCover(layout, pose, 'personal');
    return cover ? <SvgXml xml={cover.svg} width="100%" height="100%" /> : null;
  }
  const on = carried(layout.items.filter((p) => itemArt(p.item))).on.get(keyOf(home)) ?? [];
  const cover: Picture = found.v.cover;
  return <>
    <Placed p={home} plate={found.plate}><Plate source={cover.source} box={cover.box} /></Placed>
    <Items items={on} />
  </>;
}

/** An item in the decorating panel: its 3D picture in that colour (or its first), else its catalog drawing. */
export const ItemThumb = memo(function ItemThumb({ id, variant, fallback }: { id: string; variant?: string; fallback: string }) {
  const plate = HOME_ITEMS[id];
  const v = plate ? (variant && plate.variants[variant]) || Object.values(plate.variants)[0] : null;
  return v ? <Image source={v.source} fadeDuration={0} resizeMode="contain" accessibilityIgnoresInvertColors style={s.thumb} testID="item-thumb-3d" />
    : <SvgXml xml={fallback} width="100%" height="100%" />;
});

export const HOME_DRAWING: RoomDrawing = {
  room: (layout, view) => <Backdrop layout={layout} view={view} />,
  items: (items) => <Items items={items} />,
  cover: (layout, pose) => <SeatCover layout={layout} pose={pose} />,
  seatLift: { study: 0, still: 0 },
};
/** Photo mode: the room goes on past its edges, so nothing may end there. */
export const HOME_PHOTO_DRAWING: RoomDrawing = { ...HOME_DRAWING, edgeless: true };

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  layer: { position: 'absolute', width: '100%', height: '100%' },
  hand: { width: '100%', height: '50%', borderRadius: 2, backgroundColor: '#4A3F3A' },
  thumb: { width: '100%', height: '100%' },
  // A round window: the sky in a circle (its frame covers no corner).
  round: { borderRadius: 9999, overflow: 'hidden' },
});
