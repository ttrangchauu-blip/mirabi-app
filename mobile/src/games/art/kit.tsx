import React from 'react';
import Svg, { Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

// Drawing helpers shared by the game worlds' vector art (space, timeTravel, treasureMap): the same outline ink, soft
// gradients and seamless strips as the Word Forest and Math Battle art. Gradient ids must be unique per variant (on the
// web every SVG shares one id space): put the variant in the id.

export const INK = '#3F3654';
export const SW = 2.5;
export const url = (id: string) => `url(#${id})`;
export const f1 = (v: number) => v.toFixed(1);

type StopSpec = readonly [offset: number, color: string, opacity?: number];

export function Lin({ id, stops, horizontal = false }: { id: string; stops: readonly StopSpec[]; horizontal?: boolean }) {
  return <LinearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
    {stops.map(([offset, color, opacity = 1], i) => <Stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />)}
  </LinearGradient>;
}

export function Rad({ id, stops, cx = '50%', cy = '50%' }: { id: string; stops: readonly StopSpec[]; cx?: string; cy?: string }) {
  return <RadialGradient id={id} cx={cx} cy={cy} r="50%" fx={cx} fy={cy}>
    {stops.map(([offset, color, opacity = 1], i) => <Stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />)}
  </RadialGradient>;
}

/** A prop drawn in a 0 0 w h box (w, h out of 100), size px per 100 units. */
export function Art({ size, w = 100, h = 100, children }: { size: number; w?: number; h?: number; children: React.ReactNode }) {
  return <Svg width={(size * w) / 100} height={(size * h) / 100} viewBox={`0 0 ${w} ${h}`}>{children}</Svg>;
}

export function Shadow({ rx = 34, cx = 50, cy = 96, opacity = 0.16 }: { rx?: number; cx?: number; cy?: number; opacity?: number }) {
  return <Ellipse cx={cx} cy={cy} rx={rx} ry={3.2} fill="#2E2740" opacity={opacity} />;
}

/** A four-pointed twinkle. */
export function Twinkle({ x, y, r, color = '#FFFFFF', opacity = 1 }: { x: number; y: number; r: number; color?: string; opacity?: number }) {
  return <Path d={`M${f1(x)} ${f1(y - r)} Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)} Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + r)} Q${f1(x)} ${f1(y)} ${f1(x - r)} ${f1(y)} Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - r)} Z`}
    fill={color} opacity={opacity} />;
}

/** The offsets at which a piece at x (within one width) reaching r either side must be drawn on a two-width strip so
 * that the strip's second half repeats its first exactly, including pieces that hang over the seam. */
export function copies(width: number, x: number, r: number) {
  return [-width, 0, width, 2 * width].filter((o) => o + x + r > 0 && o + x - r < 2 * width);
}

/** A small deterministic generator (the same scene every time, so a strip's halves can be made to match). */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A closed blob through `n` points around (cx, cy), radius r wobbling by `jag` (0–1), smoothed with quadratic curves. */
export function blob(cx: number, cy: number, r: number, n: number, jag: number, seed: number) {
  const rnd = seeded(seed);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (1 - jag / 2 + rnd() * jag);
    return [cx + Math.cos(a) * k, cy + Math.sin(a) * k] as const;
  });
  const mid = (i: number) => {
    const [ax, ay] = pts[i % n];
    const [bx, by] = pts[(i + 1) % n];
    return [(ax + bx) / 2, (ay + by) / 2] as const;
  };
  let d = `M${f1(mid(0)[0])} ${f1(mid(0)[1])}`;
  for (let i = 1; i <= n; i++) {
    const [px, py] = pts[i % n];
    const [mx, my] = mid(i);
    d += ` Q${f1(px)} ${f1(py)} ${f1(mx)} ${f1(my)}`;
  }
  return `${d} Z`;
}
