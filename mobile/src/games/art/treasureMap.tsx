import React from 'react';
import { StyleSheet } from 'react-native';
import { Plate } from '../../world/diorama';
import { MAP_ART } from './rendered';
import Svg, { Defs, Ellipse, Path, Rect } from 'react-native-svg';
import { Art, f1, INK, Lin, SW, Twinkle, url } from './kit';

// Art for Treasure Explorer (Địa lí): a rendered old map with a village, snowy mountains, a river and its
// bridge, an old forest, the coast with its lighthouse and the treasure island, joined by a drawn dotted trail; fog clouds over
// the places not explored yet, flags for the ones reached, and a compass. The trail is a Catmull-Rom curve through
// MAP_STOPS sampled into a dense polyline: the same points draw it and move the pet along it (`routeAt`), so the pet
// never leaves the path. Coordinates are fractions of the map's width and height.

export type MapStop = { u: number; v: number; name: string; landmark: Landmark | null };
export type Landmark = 'village' | 'mountain' | 'bridge' | 'forest' | 'lighthouse' | 'island';

export const MAP_STOPS: MapStop[] = [
  { u: 0.07, v: 0.84, name: 'Bến xuất phát', landmark: null },
  { u: 0.18, v: 0.6, name: 'Làng ven đồi', landmark: 'village' },
  { u: 0.24, v: 0.3, name: 'Núi tuyết', landmark: 'mountain' },
  { u: 0.45, v: 0.48, name: 'Cầu qua sông', landmark: 'bridge' },
  { u: 0.64, v: 0.24, name: 'Rừng già', landmark: 'forest' },
  { u: 0.74, v: 0.62, name: 'Ngọn hải đăng', landmark: 'lighthouse' },
  { u: 0.9, v: 0.8, name: 'Đảo kho báu', landmark: 'island' },
];

type P = { x: number; y: number };
const SAMPLES = 16;

/** The trail as a dense polyline (fractions), through every stop. */
export const ROUTE: P[] = (() => {
  const pts = MAP_STOPS.map((s) => ({ x: s.u, y: s.v }));
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const out: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
})();

/** Each stop's place along the trail, 0 → 1 (by length on a map `aspect` = width / height). */
export function stopFractions(aspect: number): number[] {
  const len = cumulative(aspect);
  return MAP_STOPS.map((_, i) => len[i * SAMPLES] / len[len.length - 1]);
}

function cumulative(aspect: number): number[] {
  const len = [0];
  for (let i = 1; i < ROUTE.length; i++) {
    const dx = (ROUTE[i].x - ROUTE[i - 1].x) * aspect;
    const dy = ROUTE[i].y - ROUTE[i - 1].y;
    len.push(len[i - 1] + Math.hypot(dx, dy));
  }
  return len;
}

/** The point at fraction f (0 → 1) of the trail's length, in fractions of the map. */
export function routeAt(f: number, aspect: number): P {
  const len = cumulative(aspect);
  const target = Math.max(0, Math.min(1, f)) * len[len.length - 1];
  let i = 1;
  while (i < len.length - 1 && len[i] < target) i++;
  const seg = len[i] - len[i - 1] || 1;
  const k = Math.max(0, Math.min(1, (target - len[i - 1]) / seg));
  return { x: ROUTE[i - 1].x + (ROUTE[i].x - ROUTE[i - 1].x) * k, y: ROUTE[i - 1].y + (ROUTE[i].y - ROUTE[i - 1].y) * k };
}

// ---------------------------------------------------------------------------------------------------------------------
// The board

/** The parchment map, `width` × `height`: land, sea, river, the places and the dotted trail. */
export const MapBoard = React.memo(function MapBoard({ width: w, height: h }: { width: number; height: number }) {
  if (!w || !h) return null;
  const X = (u: number) => u * w;
  const Y = (v: number) => v * h;
  const trail = ROUTE.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.x))} ${f1(Y(p.y))}`).join(' ');
  return (
    <>
      <Plate source={MAP_ART} width={w} height={h} />
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Path d={trail} stroke="#FFF4D6" strokeWidth={3.2} strokeDasharray="6 6" strokeLinecap="round" fill="none" opacity={0.95} />
        <Path d={trail} stroke="#9C5B2E" strokeWidth={1.8} strokeDasharray="6 6" strokeLinecap="round" fill="none" />
      </Svg>
    </>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Props over the map

/** A puff of fog over a place not explored yet. */
export const FogCloud = React.memo(function FogCloud({ size }: { size: number }) {
  return (
    <Art size={size} h={60}>
      <Defs><Lin id="fog" stops={[[0, '#FFFFFF'], [1, '#DCE3EE']]} /></Defs>
      <Path d="M14 48 Q4 48 6 38 Q8 28 20 30 Q22 14 40 16 Q50 4 64 14 Q82 10 84 28 Q98 30 94 42 Q92 50 82 48 Z" fill={url('fog')} stroke="#B9C3D3"
        strokeWidth={2} strokeLinejoin="round" />
      <Path d="M28 36 Q36 30 46 34 M56 28 Q64 24 72 30" stroke="#C6CFDD" strokeWidth={2} strokeLinecap="round" fill="none" />
    </Art>
  );
});

/** A little pennant planted at a place reached. */
export const MapFlag = React.memo(function MapFlag({ size }: { size: number }) {
  return (
    <Art size={size}>
      <Ellipse cx={30} cy={94} rx={14} ry={3} fill="#2E2740" opacity={0.18} />
      <Rect x={28} y={14} width={4} height={80} rx={2} fill="#7A4E2E" />
      <Path d="M32 16 Q56 10 76 22 Q56 30 32 38 Z" fill="#E2574C" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Twinkle x={80} y={10} r={7} color="#FFF4A8" />
    </Art>
  );
});
