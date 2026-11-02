import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { type ArcPoint, type Light, moonAt, sunAt } from '../components/daylight';

/** The pieces of sky every outdoor scene shares, all read from one clock (daylight.ts): WalkLandscape, the garden and the
 * exploration. Each is drawn for the height it is given, so the small walk card and a whole screen look alike. */

export const round = (value: number, step: number) => Math.round(value / step) * step;

/** A sine-topped band over a strip two scene-widths long. Whole periods per width make the second half repeat the first
 * exactly, so scrolling by one width loops without a jump. It runs past both ends so the SVG clips it cleanly. */
export function wave(width: number, base: number, amp: number, periods: number, bottom: number, phase = 0, step = 6) {
  const y = (x: number) => (base + amp * Math.sin((x / width) * periods * 2 * Math.PI + phase)).toFixed(1);
  const end = width * 2 + 4;
  let d = `M-4 ${bottom}`;
  for (let x = -4; x < end; x += step) d += ` L${x} ${y(x)}`;
  return `${d} L${end} ${y(end)} L${end} ${bottom} Z`;
}

/** Shadows fall away from the sun: long and to one side when it is low, short and under things at noon, and gone (just
 * a faint soft patch) while it is below the horizon. */
export function castBy(sun: ArcPoint) {
  const up = Math.max(0, Math.min(1, sun.altitude / 0.2));
  const low = 1 - Math.max(0, sun.altitude);
  return { dx: round(-(sun.x - 0.5) * 16 * low * up, 0.5), stretch: round(1 + 0.4 * low * up, 0.05) };
}
export type Cast = ReturnType<typeof castBy>;

const STARS = [[0.06, 14, 1.2], [0.14, 34, 0.8], [0.27, 10, 1], [0.36, 28, 1.4], [0.47, 16, 0.8], [0.55, 40, 1],
  [0.63, 8, 1.2], [0.71, 30, 0.8], [0.93, 44, 1], [0.97, 18, 0.8]];

/** Stars stay put in the sky (they are far away); they come out at dusk and fade as the sky gets light. */
export const Stars = React.memo(function Stars({ width, height, opacity, scale = 1, testID }: { width: number; height: number; opacity: number; scale?: number; testID?: string }) {
  return <Svg width={width} height={height} style={[StyleSheet.absoluteFill, { opacity }]} testID={testID}>
    {STARS.map(([f, y, r]) => <Circle key={f} cx={width * f} cy={y * scale} r={r * Math.min(scale, 1.4)} fill="#FFFFFF" opacity={0.55 + r * 0.25} />)}
  </Svg>;
});

/** A soft light that fades out to its edge. */
export function Glow({ id, color, opacity = 1, cx, cy, rx, ry }: { id: string; color: string; opacity?: number; cx: number; cy: number; rx: number; ry: number }) {
  return <>
    <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={opacity} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
    <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${id})`} />
  </>;
}

/** Below this altitude a body is well under the clip line, so it is not drawn at all. */
const SET = -0.45;

/** The sun and moon on their arcs, with a warm band of light on the horizon around the sun while it is low. Clipped just
 * under `horizon`, so they rise and set behind the hills. A soft glow only: never bright enough to glare.
 * `body` is the sun's or moon's square, glow included. */
export function SkyBodies({ width, hours, c, horizon, zenith, clip, body = 72, idPrefix = 'walk' }: {
  width: number; hours: number; c: Light; horizon: number; zenith: number; clip: number; body?: number; idPrefix?: string;
}) {
  const sun = sunAt(hours);
  const moon = moonAt(hours);
  const dawnGlow = round(Math.max(0, 1 - Math.abs(sun.altitude) / 0.45) * 0.6, 0.01);
  const place = (at: ArcPoint) => ({ transform: [
    { translateX: round(width * (0.07 + 0.86 * at.x) - body / 2, 0.1) },
    { translateY: round(horizon - at.altitude * (horizon - zenith) - body / 2, 0.1) },
  ] });
  const k = body / 72;
  return <View pointerEvents="none" style={[styles.bodies, { height: clip }]}>
    {dawnGlow > 0 ? <Svg width={width} height={clip} style={StyleSheet.absoluteFill}>
      <Glow id={`${idPrefix}-horizon`} color={c.horizon} opacity={dawnGlow} cx={width * (0.07 + 0.86 * sun.x)} cy={horizon} rx={width * 0.5} ry={36 * k} />
    </Svg> : null}
    {c.moonOpacity > 0 && moon.altitude > SET ? <Svg width={body} height={body} viewBox="-36 -36 72 72"
      style={[styles.body, { opacity: c.moonOpacity }, place(moon)]} testID={`${idPrefix}-moon`}>
      <Glow id={`${idPrefix}-moon-glow`} color={c.moon} opacity={0.35} cx={0} cy={0} rx={26} ry={26} />
      <Path d="M4 -12.4 A13 13 0 1 0 4 12.4 A16 16 0 0 1 4 -12.4 Z" fill={c.moon} />
    </Svg> : null}
    {sun.altitude > SET ? <Svg width={body} height={body} viewBox="-36 -36 72 72" style={[styles.body, place(sun)]} testID={`${idPrefix}-sun`}>
      <Glow id={`${idPrefix}-sun-glow`} color={c.sunGlow} opacity={0.5} cx={0} cy={0} rx={36} ry={36} />
      <Circle cx={0} cy={0} r={12} fill={c.sun} />
    </Svg> : null}
  </View>;
}

const styles = StyleSheet.create({
  bodies: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  body: { position: 'absolute', left: 0, top: 0 },
});
