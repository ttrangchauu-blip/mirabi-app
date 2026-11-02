import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Path, Polygon, Rect } from 'react-native-svg';
import { Art, blob, f1, INK, Lin, Rad, SW, Twinkle, url } from './kit';

// Vector art for Treasure Explorer (Địa lí): an old parchment map with a village, snowy mountains, a river and its
// bridge, an old forest, the coast with its lighthouse and the treasure island, joined by a dotted trail; fog clouds over
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

function Mountain({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <G>
      <Path d={`M${x - s} ${y} L${x} ${y - s * 1.3} L${x + s} ${y} Z`} fill="#B79C7A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <Path d={`M${x} ${y - s * 1.3} L${x + s} ${y} L${x + s * 0.2} ${y} Z`} fill="#9A7F5E" />
      <Path d={`M${x - s * 0.38} ${y - s * 0.8} L${x} ${y - s * 1.3} L${x + s * 0.38} ${y - s * 0.8} L${x + s * 0.15} ${y - s * 0.9} L${x} ${y - s * 0.76} L${x - s * 0.18} ${y - s * 0.92} Z`}
        fill="#FFFFFF" stroke={INK} strokeWidth={1} strokeLinejoin="round" />
    </G>
  );
}

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <G>
      <Path d={`M${x} ${y - s * 1.6} L${x + s * 0.6} ${y - s * 0.5} L${x - s * 0.6} ${y - s * 0.5} Z`} fill="#5FA05A" stroke={INK} strokeWidth={1} strokeLinejoin="round" />
      <Path d={`M${x} ${y - s * 1.1} L${x + s * 0.75} ${y} L${x - s * 0.75} ${y} Z`} fill="#4E8F4C" stroke={INK} strokeWidth={1} strokeLinejoin="round" />
    </G>
  );
}

function Hut({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <G>
      <Rect x={x - s * 0.5} y={y - s * 0.7} width={s} height={s * 0.7} fill="#E8C690" stroke={INK} strokeWidth={1.2} />
      <Path d={`M${x - s * 0.7} ${y - s * 0.65} L${x} ${y - s * 1.3} L${x + s * 0.7} ${y - s * 0.65} Z`} fill="#C9504A" stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
      <Rect x={x - s * 0.12} y={y - s * 0.4} width={s * 0.24} height={s * 0.4} fill="#7A4E2E" />
    </G>
  );
}

/** The parchment map, `width` × `height`: land, sea, river, the places and the dotted trail. */
export const MapBoard = React.memo(function MapBoard({ width: w, height: h }: { width: number; height: number }) {
  if (!w || !h) return null;
  const X = (u: number) => u * w;
  const Y = (v: number) => v * h;
  const s = Math.min(w, h * 1.6) * 0.06; // the size of a drawn place
  const trail = ROUTE.map((p, i) => `${i ? 'L' : 'M'}${f1(X(p.x))} ${f1(Y(p.y))}`).join(' ');
  const river = `M${X(0.34)} ${Y(-0.02)} C${X(0.3)} ${Y(0.2)} ${X(0.52)} ${Y(0.3)} ${X(0.46)} ${Y(0.48)} S${X(0.6)} ${Y(0.74)} ${X(0.72)} ${Y(0.8)}`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <Lin id="map-paper" stops={[[0, '#F8EACB'], [1, '#EAD2A0']]} />
        <Rad id="map-burn" stops={[[0.6, '#000000', 0], [1, '#8A5A20', 0.35]]} />
        <Lin id="map-sea" stops={[[0, '#A6DDF0'], [1, '#6FBFE0']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('map-paper')} />
      {/* The sea (bottom right) with waves, and the treasure island. */}
      <Path d={`M${X(0.58)} ${h} Q${X(0.62)} ${Y(0.74)} ${X(0.8)} ${Y(0.66)} Q${X(0.9)} ${Y(0.48)} ${w} ${Y(0.42)} L${w} ${h} Z`} fill={url('map-sea')} />
      {[[0.84, 0.6], [0.7, 0.9], [0.95, 0.66]].map(([u, v], i) => (
        <Path key={i} d={`M${X(u) - s * 0.5} ${Y(v)} q${s * 0.25} ${-s * 0.25} ${s * 0.5} 0 t${s * 0.5} 0`} stroke="#FFFFFF" strokeWidth={1.4} fill="none" opacity={0.85} />
      ))}
      <Path d={blob(X(0.9), Y(0.82), s * 0.9, 7, 0.35, 61)} fill="#F2D59A" stroke={INK} strokeWidth={1.4} />
      <Path d={`M${X(0.9)} ${Y(0.82)} q${-s * 0.1} ${-s * 0.9} ${s * 0.2} ${-s * 1.1}`} stroke="#8F5C36" strokeWidth={2} fill="none" />
      <Path d={`M${X(0.9) + s * 0.2} ${Y(0.82) - s * 1.1} q${s * 0.5} ${-s * 0.1} ${s * 0.7} ${s * 0.3} M${X(0.9) + s * 0.2} ${Y(0.82) - s * 1.1} q${-s * 0.5} ${-s * 0.1} ${-s * 0.6} ${s * 0.35}`}
        stroke="#5FA05A" strokeWidth={3} strokeLinecap="round" fill="none" />
      {/* The river, from the mountains to the sea. */}
      <Path d={river} stroke="#7CC3E6" strokeWidth={s * 0.5} strokeLinecap="round" fill="none" />
      <Path d={river} stroke="#BFE6F6" strokeWidth={s * 0.16} strokeLinecap="round" fill="none" opacity={0.9} />
      {/* Mountains, the old forest, the village. */}
      <Mountain x={X(0.12)} y={Y(0.34)} s={s * 1.1} />
      <Mountain x={X(0.24)} y={Y(0.24)} s={s * 1.4} />
      <Mountain x={X(0.36)} y={Y(0.32)} s={s} />
      {[[0.58, 0.2], [0.64, 0.14], [0.7, 0.2], [0.76, 0.14], [0.62, 0.3], [0.7, 0.3], [0.82, 0.24]].map(([u, v], i) => <Pine key={i} x={X(u)} y={Y(v)} s={s * 0.8} />)}
      <Hut x={X(0.13)} y={Y(0.66)} s={s * 0.9} />
      <Hut x={X(0.22)} y={Y(0.7)} s={s * 0.8} />
      {/* The bridge over the river. */}
      <Rect x={X(0.45) - s * 0.9} y={Y(0.48) - s * 0.25} width={s * 1.8} height={s * 0.5} rx={s * 0.1} fill="#B7834F" stroke={INK} strokeWidth={1.4} />
      {[-0.6, -0.2, 0.2, 0.6].map((k, i) => <Rect key={i} x={X(0.45) + k * s - 1} y={Y(0.48) - s * 0.25} width={2} height={s * 0.5} fill="#8F5C36" />)}
      {/* The lighthouse on the coast. */}
      <Path d={`M${X(0.74) - s * 0.3} ${Y(0.62)} L${X(0.74) - s * 0.18} ${Y(0.62) - s * 1.4} L${X(0.74) + s * 0.18} ${Y(0.62) - s * 1.4} L${X(0.74) + s * 0.3} ${Y(0.62)} Z`}
        fill="#FFFFFF" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      <Rect x={X(0.74) - s * 0.26} y={Y(0.62) - s * 0.8} width={s * 0.52} height={s * 0.22} fill="#E2574C" />
      <Rect x={X(0.74) - s * 0.22} y={Y(0.62) - s * 1.7} width={s * 0.44} height={s * 0.3} fill="#FFE27A" stroke={INK} strokeWidth={1.2} />
      <Path d={`M${X(0.74) - s * 0.3} ${Y(0.62) - s * 1.7} L${X(0.74)} ${Y(0.62) - s * 2} L${X(0.74) + s * 0.3} ${Y(0.62) - s * 1.7} Z`} fill="#C9504A" stroke={INK} strokeWidth={1.2} />
      {/* The trail. */}
      <Path d={trail} stroke="#9C5B2E" strokeWidth={2.4} strokeDasharray="6 6" strokeLinecap="round" fill="none" />
      {/* The X on the island. */}
      <Path d={`M${X(0.9) - s * 0.3} ${Y(0.8) - s * 0.3} L${X(0.9) + s * 0.3} ${Y(0.8) + s * 0.3} M${X(0.9) + s * 0.3} ${Y(0.8) - s * 0.3} L${X(0.9) - s * 0.3} ${Y(0.8) + s * 0.3}`}
        stroke="#C2342E" strokeWidth={3.4} strokeLinecap="round" />
      {/* The compass rose. */}
      <G transform={`translate(${X(0.92)} ${Y(0.16)})`}>
        <Circle r={s * 0.9} fill="#FFF6E0" stroke={INK} strokeWidth={1.2} />
        <Polygon points={`0,${-s * 0.8} ${s * 0.18},0 0,${s * 0.8} ${-s * 0.18},0`} fill="#C2342E" stroke={INK} strokeWidth={0.8} />
        <Polygon points={`${-s * 0.8},0 0,${s * 0.18} ${s * 0.8},0 0,${-s * 0.18}`} fill="#8A6A3A" stroke={INK} strokeWidth={0.8} />
        <Circle r={s * 0.12} fill="#FFFFFF" stroke={INK} strokeWidth={0.8} />
      </G>
      {/* Old edges. */}
      <Rect width={w} height={h} fill={url('map-burn')} />
      <Rect x={2} y={2} width={w - 4} height={h - 4} rx={10} stroke="#B98B4E" strokeWidth={2} fill="none" opacity={0.7} />
    </Svg>
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
