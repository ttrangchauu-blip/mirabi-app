import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

// Vector art for the Word Forest game: parallax forest layers, a brook with a plank bridge, a stone door with runes, a
// treasure chest and the little creature the child frees from a vine cage. Props are drawn in a 0 0 100 100 box unless
// noted; one viewBox unit is size / 100 pixels, so a 0 0 100 40 plank is size × 0.4 px tall. Soft pastel gradients,
// rounded shapes, a dark outline on props (the scrolling layers are left soft, without outlines, to stay in the back).

const INK = '#3F3654';
const SW = 2.5;
const url = (id: string) => `url(#${id})`;

type StopSpec = readonly [offset: number, color: string, opacity?: number];

function Lin({ id, stops, horizontal = false }: { id: string; stops: readonly StopSpec[]; horizontal?: boolean }) {
  return <LinearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
    {stops.map(([offset, color, opacity = 1], i) => <Stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />)}
  </LinearGradient>;
}

function Rad({ id, stops, cx = '50%', cy = '50%' }: { id: string; stops: readonly StopSpec[]; cx?: string; cy?: string }) {
  return <RadialGradient id={id} cx={cx} cy={cy} r="50%" fx={cx} fy={cy}>
    {stops.map(([offset, color, opacity = 1], i) => <Stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />)}
  </RadialGradient>;
}

function Art({ size, w = 100, h = 100, children }: { size: number; w?: number; h?: number; children: React.ReactNode }) {
  return <Svg width={(size * w) / 100} height={(size * h) / 100} viewBox={`0 0 ${w} ${h}`}>{children}</Svg>;
}

function Shadow({ rx = 34, cx = 50, cy = 96, opacity = 0.16 }: { rx?: number; cx?: number; cy?: number; opacity?: number }) {
  return <Ellipse cx={cx} cy={cy} rx={rx} ry={3.2} fill="#2E2740" opacity={opacity} />;
}

function Sparkle({ x, y, r, color = '#FFFFFF', opacity = 1 }: { x: number; y: number; r: number; color?: string; opacity?: number }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`}
    fill={color} opacity={opacity} />;
}

function Leaf({ x, y, angle, len, fill = '#5CBF5F', sw = 1.6 }: { x: number; y: number; angle: number; len: number; fill?: string; sw?: number }) {
  const w = len * 0.42;
  return <G transform={`translate(${x} ${y}) rotate(${angle})`}>
    <Path d={`M0 0 C${len * 0.3} ${-w} ${len * 0.8} ${-w * 0.8} ${len} 0 C${len * 0.8} ${w * 0.8} ${len * 0.3} ${w} 0 0 Z`}
      fill={fill} stroke={INK} strokeWidth={sw} strokeLinejoin="round" />
  </G>;
}

const f1 = (v: number) => v.toFixed(1);

/** A sine-topped band from x = -4 to len + 4. `unit` periods per unit length, so a strip two units long whose
 * periods are whole repeats exactly in its second half. `bottom` may be 0 to fill the region above the line. */
function wave(len: number, unit: number, base: number, amp: number, periods: number, bottom: number, phase = 0) {
  const y = (x: number) => f1(base + amp * Math.sin((x / unit) * periods * 2 * Math.PI + phase));
  const end = len + 4;
  let d = `M-4 ${f1(bottom)}`;
  for (let x = -4; x < end; x += 6) d += ` L${x} ${y(x)}`;
  return `${d} L${end} ${y(end)} L${end} ${f1(bottom)} Z`;
}

/** The offsets at which a piece at x (within one width) reaching r either side must be drawn on a two-width strip so
 * that the strip's second half repeats its first exactly, including pieces that hang over the seam. */
function copies(width: number, x: number, r: number) {
  return [-width, 0, width, 2 * width].filter((o) => o + x + r > 0 && o + x - r < 2 * width);
}

// ---------------------------------------------------------------------------------------------------------------------
// Parallax layers

const SKY_RAYS = [[0.5, 0.06, 0.12, 0.1], [0.66, 0.04, 0.38, 0.07], [0.8, 0.05, 0.6, 0.09], [0.94, 0.03, 0.86, 0.06]] as const;
const SKY_SPARKS = [[0.12, 0.16, 2], [0.3, 0.3, 1.4], [0.46, 0.12, 1.8], [0.58, 0.38, 1.2], [0.2, 0.46, 1.4], [0.9, 0.42, 1.6]] as const;

function SkyLayer({ width, height }: { width: number; height: number }) {
  return <Svg width={width} height={height}>
    <Defs>
      <Lin id="wf-sky" stops={[[0, '#8FD3E8'], [0.55, '#CDEFDC'], [1, '#FFF0C9']]} />
      <Lin id="wf-sky-ray" stops={[[0, '#FFFFFF', 0.5], [1, '#FFFFFF', 0]]} />
      <Rad id="wf-sky-sun" stops={[[0, '#FFF8D6', 0.95], [0.4, '#FFF2B8', 0.5], [1, '#FFF2B8', 0]]} />
    </Defs>
    <Rect x={0} y={0} width={width} height={height} fill={url('wf-sky')} />
    <Ellipse cx={width * 0.8} cy={height * 0.06} rx={width * 0.38} ry={height * 0.32} fill={url('wf-sky-sun')} />
    {SKY_RAYS.map(([top, topW, bottom, bottomW]) => <Polygon key={top} fill={url('wf-sky-ray')}
      points={`${f1(width * (top - topW / 2))},0 ${f1(width * (top + topW / 2))},0 ${f1(width * (bottom + bottomW / 2))},${f1(height)} ${f1(width * (bottom - bottomW / 2))},${f1(height)}`} />)}
    {[[0.18, 0.2, 1], [0.6, 0.26, 0.8]].map(([x, y, s]) => <G key={x} opacity={0.75}>
      <Ellipse cx={width * x} cy={height * y} rx={width * 0.09 * s} ry={height * 0.035 * s} fill="#FFF5FA" />
      <Ellipse cx={width * x + width * 0.03 * s} cy={height * y - height * 0.03 * s} rx={width * 0.05 * s} ry={height * 0.04 * s} fill="#FFF5FA" />
    </G>)}
    {SKY_SPARKS.map(([x, y, r]) => <Sparkle key={x} x={width * x} y={height * y} r={r * Math.max(1, height / 200)} opacity={0.8} />)}
  </Svg>;
}

const FAR_TREES = [[0.04, 0.9, 0], [0.14, 1.1, 1], [0.25, 0.8, 0], [0.34, 1.2, 0], [0.46, 0.95, 1], [0.57, 1.05, 0], [0.69, 0.85, 1],
  [0.8, 1.15, 0], [0.91, 0.9, 1]] as const;

function pine(x: number, base: number, ht: number, hw: number) {
  return `M${f1(x)} ${f1(base - ht)} L${f1(x + hw * 0.55)} ${f1(base - ht * 0.55)} L${f1(x + hw * 0.35)} ${f1(base - ht * 0.55)} L${f1(x + hw)} ${f1(base)}`
    + ` L${f1(x - hw)} ${f1(base)} L${f1(x - hw * 0.35)} ${f1(base - ht * 0.55)} L${f1(x - hw * 0.55)} ${f1(base - ht * 0.55)} Z`;
}

function FarLayer({ width, height }: { width: number; height: number }) {
  const base = height * 0.73;
  return <Svg width={width * 2} height={height}>
    <Defs><Lin id="wf-far-mist" stops={[[0, '#FFFFFF', 0], [0.5, '#F4FBF6', 0.2], [1, '#F4FBF6', 0.6]]} /></Defs>
    <Path d={wave(width * 2, width, height * 0.6, height * 0.035, 2, height, 0.5)} fill="#C2E3D8" />
    {FAR_TREES.flatMap(([f, s, round], i) => {
      const x = width * f;
      const ht = height * 0.26 * s;
      const hw = ht * 0.34;
      const fill = i % 2 ? '#9CCBBE' : '#AAD4C8';
      return copies(width, x, round ? ht * 0.38 : hw).map((o) => round
        ? <Circle key={`${i}:${o}`} cx={f1(o + x)} cy={f1(base - ht * 0.3)} r={f1(ht * 0.38)} fill={fill} />
        : <Path key={`${i}:${o}`} d={pine(o + x, base, ht, hw)} fill={fill} />);
    })}
    <Path d={wave(width * 2, width, height * 0.71, height * 0.025, 3, height, 1.7)} fill="#B1D8CB" />
    <Rect x={0} y={0} width={width * 2} height={height} fill={url('wf-far-mist')} />
  </Svg>;
}

const MID_TREES = [[0.2, 1, 0], [0.68, 0.86, 1]] as const;
const CANOPY = [['#9BE08E', '#5DB36E', '#D4F7C4'], ['#8EDDC9', '#4AA596', '#CDF7EC']] as const;
const MID_MUSHROOMS = [[0.43, '#FF8A9A'], [0.9, '#B994FF']] as const;
const MID_GLOWS = [[0.34, '#FFB8EC'], [0.53, '#A6F3FF'], [0.82, '#FFE98F']] as const;

function MidLayer({ width, height }: { width: number; height: number }) {
  const ground = height * 0.84;
  const nodes: React.ReactNode[] = [];
  MID_TREES.forEach(([f, s, k], i) => {
    const x = width * f;
    const th = height * 0.62 * s;
    const w = th * 0.14;
    const [light, dark, shine] = CANOPY[k];
    copies(width, x, th * 0.5).forEach((o) => {
      const cx = o + x;
      nodes.push(<G key={`tree${i}:${o}`}>
        <Path d={`M${f1(cx - w * 0.85)} ${f1(ground)} Q${f1(cx - w * 0.5)} ${f1(ground - th * 0.2)} ${f1(cx - w * 0.5)} ${f1(ground - th * 0.55)} L${f1(cx + w * 0.5)} ${f1(ground - th * 0.55)} Q${f1(cx + w * 0.5)} ${f1(ground - th * 0.2)} ${f1(cx + w * 0.85)} ${f1(ground)} Z`} fill="#A9775A" />
        <Circle cx={f1(cx - th * 0.22)} cy={f1(ground - th * 0.56)} r={f1(th * 0.24)} fill={dark} />
        <Circle cx={f1(cx + th * 0.22)} cy={f1(ground - th * 0.6)} r={f1(th * 0.25)} fill={dark} />
        <Circle cx={f1(cx)} cy={f1(ground - th * 0.75)} r={f1(th * 0.3)} fill={light} />
        <Circle cx={f1(cx - th * 0.1)} cy={f1(ground - th * 0.86)} r={f1(th * 0.11)} fill={shine} opacity={0.6} />
      </G>);
    });
  });
  const m = height * 0.13;
  MID_MUSHROOMS.forEach(([f, color], i) => {
    const x = width * f;
    copies(width, x, m * 0.5).forEach((o) => {
      const cx = o + x;
      const capY = ground + height * 0.01 - m * 0.5;
      nodes.push(<G key={`mush${i}:${o}`}>
        <Rect x={f1(cx - m * 0.13)} y={f1(capY - 1)} width={f1(m * 0.26)} height={f1(m * 0.6)} rx={f1(m * 0.1)} fill="#FFF4E3" />
        <Path d={`M${f1(cx - m * 0.5)} ${f1(capY)} Q${f1(cx)} ${f1(capY - m * 0.75)} ${f1(cx + m * 0.5)} ${f1(capY)} Z`} fill={color} />
        <Circle cx={f1(cx - m * 0.17)} cy={f1(capY - m * 0.13)} r={f1(m * 0.06)} fill="#FFFFFF" />
        <Circle cx={f1(cx + m * 0.14)} cy={f1(capY - m * 0.2)} r={f1(m * 0.05)} fill="#FFFFFF" />
      </G>);
    });
  });
  MID_GLOWS.forEach(([f, color], i) => {
    const x = width * f;
    const y = ground - height * 0.03;
    copies(width, x, height * 0.05).forEach((o) => nodes.push(<G key={`glow${i}:${o}`}>
      <Circle cx={f1(o + x)} cy={f1(y)} r={f1(height * 0.05)} fill={color} opacity={0.35} />
      <Circle cx={f1(o + x)} cy={f1(y)} r={f1(height * 0.018)} fill={color} />
    </G>));
  });
  return <Svg width={width * 2} height={height}>
    <Path d={wave(width * 2, width, height * 0.8, height * 0.02, 2, height, 2.4)} fill="#86CC8E" />
    {nodes}
  </Svg>;
}

/** A fern frond: a toothed blade rising from (x, y), curving sideways by `lean`. */
function frond(x: number, y: number, len: number, lean: number) {
  const n = 8;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const cx = x + lean * len * 0.55 * t * t;
    const cy = y - len * t;
    const tx = lean * 1.1 * t;
    const m = Math.hypot(tx, 1);
    const nx = 1 / m;
    const ny = tx / m;
    const w = len * 0.2 * (1 - t) * (i % 2 ? 1 : 0.45);
    left.push(`${f1(cx - nx * w)} ${f1(cy - ny * w)}`);
    right.push(`${f1(cx + nx * w)} ${f1(cy + ny * w)}`);
  }
  return `M${left.join(' L')} L${right.reverse().join(' L')} Z`;
}

const NEAR_FERNS = [0.08, 0.47, 0.79];
const NEAR_PEBBLES = [[0.22, 1], [0.31, 0.7], [0.6, 1.2], [0.93, 0.8]] as const;
const NEAR_GLOWS = [[0.17, '#FFB8EC'], [0.56, '#A6F3FF'], [0.69, '#FFE98F']] as const;

function NearLayer({ width, height }: { width: number; height: number }) {
  const nodes: React.ReactNode[] = [];
  const fernLen = height * 0.11;
  NEAR_FERNS.forEach((f, i) => {
    const x = width * f;
    copies(width, x, fernLen * 0.8).forEach((o) => nodes.push(<G key={`fern${i}:${o}`}>
      <Path d={frond(o + x - 2, height * 0.875, fernLen * 0.9, -1)} fill="#4E9F58" />
      <Path d={frond(o + x + 2, height * 0.875, fernLen * 0.85, 1)} fill="#4E9F58" />
      <Path d={frond(o + x, height * 0.875, fernLen, 0.2)} fill="#5DB566" />
    </G>));
  });
  NEAR_PEBBLES.forEach(([f, s], i) => {
    const x = width * f;
    const rx = height * 0.017 * s;
    copies(width, x, rx).forEach((o) => nodes.push(<Ellipse key={`peb${i}:${o}`} cx={f1(o + x)} cy={f1(height * (0.915 + (i % 2) * 0.015))}
      rx={f1(rx)} ry={f1(rx * 0.55)} fill="#CFC6DD" />));
  });
  NEAR_GLOWS.forEach(([f, color], i) => {
    const x = width * f;
    const y = height * 0.86;
    copies(width, x, height * 0.04).forEach((o) => nodes.push(<G key={`glow${i}:${o}`}>
      <Circle cx={f1(o + x)} cy={f1(y)} r={f1(height * 0.04)} fill={color} opacity={0.4} />
      <Circle cx={f1(o + x)} cy={f1(y)} r={f1(height * 0.014)} fill="#FFFFFF" />
    </G>));
  });
  return <Svg width={width * 2} height={height}>
    <Path d={wave(width * 2, width, height * 0.82, height * 0.012, 3, height, 0.3)} fill="#74C273" />
    <Path d={wave(width * 2, width, height * 0.885, height * 0.008, 2, height * 0.96, 1)} fill="#EBD3A0" />
    <Path d={wave(width * 2, width, height * 0.955, height * 0.006, 4, height, 2)} fill="#62B266" />
    {nodes}
  </Svg>;
}

export type ForestLayerKind = 'sky' | 'far' | 'mid' | 'near';

/** One depth of the forest. `sky` is a still full-size sky with soft light rays. `far` (misty distant trees), `mid` (big
 * round trees, glowing flowers, mushrooms) and `near` (the grass and path band from 82 % of the height down, with
 * ferns, pebbles and small glowing flowers) are strips `width * 2` wide whose second half repeats the first, to be
 * scrolled by one width and looped. */
export const ForestLayer = React.memo(function ForestLayer({ layer, width, height }: { layer: ForestLayerKind; width: number; height: number }) {
  if (!width || !height) return null;
  if (layer === 'sky') return <SkyLayer width={width} height={height} />;
  if (layer === 'far') return <FarLayer width={width} height={height} />;
  if (layer === 'mid') return <MidLayer width={width} height={height} />;
  return <NearLayer width={width} height={height} />;
});

// ---------------------------------------------------------------------------------------------------------------------
// The brook and the bridge

const RIPPLES = [[0.08, 0.36], [0.22, 0.6], [0.36, 0.42], [0.5, 0.68], [0.63, 0.38], [0.76, 0.6], [0.9, 0.46], [0.3, 0.76]] as const;
const STREAM_STONES = [[0.14, 0.7, 1], [0.45, 0.32, 0.8], [0.7, 0.76, 1.1], [0.88, 0.3, 0.9]] as const;
const STREAM_SPARKS = [[0.18, 0.46], [0.41, 0.56], [0.58, 0.5], [0.82, 0.68], [0.95, 0.56]] as const;

/** A horizontal brook across the whole width × height: grassy banks top and bottom, blue water with ripples, sparkles
 * and a few mossy stones. */
export const Stream = React.memo(function Stream({ width, height }: { width: number; height: number }) {
  if (!width || !height) return null;
  const u = Math.min(height, width) / 100;
  return <Svg width={width} height={height}>
    <Defs><Lin id="wf-stream-water" stops={[[0, '#A2EAF0'], [0.5, '#5CC3DB'], [1, '#3A9CC4']]} /></Defs>
    <Rect x={0} y={0} width={width} height={height} fill={url('wf-stream-water')} />
    <Path d={`M0 ${f1(height * 0.45)} Q${f1(width * 0.25)} ${f1(height * 0.4)} ${f1(width * 0.5)} ${f1(height * 0.46)} T${f1(width)} ${f1(height * 0.44)}`}
      stroke="#C9F4FA" strokeWidth={Math.max(2, u * 2.5)} fill="none" opacity={0.5} />
    {RIPPLES.map(([x, y]) => {
      const l = Math.max(6, width * 0.035);
      return <Path key={x} d={`M${f1(width * x - l)} ${f1(height * y)} Q${f1(width * x)} ${f1(height * y - l * 0.3)} ${f1(width * x + l)} ${f1(height * y)}`}
        stroke="#FFFFFF" strokeWidth={Math.max(1.5, u * 1.6)} strokeLinecap="round" fill="none" opacity={0.7} />;
    })}
    {STREAM_STONES.map(([x, y, s]) => {
      const rx = Math.max(8, height * 0.12) * s;
      return <G key={x}>
        <Ellipse cx={width * x} cy={height * y + rx * 0.3} rx={rx * 1.35} ry={rx * 0.45} fill="#FFFFFF" opacity={0.45} />
        <Ellipse cx={width * x} cy={height * y} rx={rx} ry={rx * 0.62} fill="#B9B3CB" stroke={INK} strokeWidth={Math.max(1.5, u * 1.8)} />
        <Ellipse cx={width * x - rx * 0.15} cy={height * y - rx * 0.32} rx={rx * 0.6} ry={rx * 0.22} fill="#8ACB7E" />
      </G>;
    })}
    {STREAM_SPARKS.map(([x, y]) => <Sparkle key={x} x={width * x} y={height * y} r={Math.max(2.5, u * 3)} />)}
    <Path d={wave(width, width, height * 0.17, height * 0.03, 2, 0, 0.4)} fill="#B98D62" />
    <Path d={wave(width, width, height * 0.13, height * 0.03, 2, 0, 0.4)} fill="#7CC48A" />
    <Path d={wave(width, width, height * 0.84, height * 0.03, 3, height, 1.3)} fill="#B98D62" />
    <Path d={wave(width, width, height * 0.88, height * 0.03, 3, height, 1.3)} fill="#6CBF6E" />
  </Svg>;
});

/** One wooden bridge plank seen from the side. viewBox 0 0 100 40: size × 0.4 px. */
export const Plank = React.memo(function Plank({ size }: { size: number }) {
  return <Art size={size} h={40}>
    <Defs><Lin id="wf-plank" stops={[[0, '#E7B57E'], [1, '#B57A47']]} /></Defs>
    <Ellipse cx={50} cy={36.5} rx={46} ry={2.5} fill="#2E2740" opacity={0.15} />
    <Rect x={3} y={10} width={94} height={23} rx={5} fill={url('wf-plank')} stroke={INK} strokeWidth={SW} />
    <Rect x={6} y={12} width={88} height={4.5} rx={2.25} fill="#F6CF9C" opacity={0.8} />
    <Path d="M14 22 Q30 19.5 48 22 T84 21 M20 27.5 Q40 25.5 60 27.5 T90 26.5" stroke="#9C6538" strokeWidth={1.4} fill="none" opacity={0.6} />
    <Ellipse cx={66} cy={22} rx={4} ry={2.2} fill="none" stroke="#9C6538" strokeWidth={1.4} />
    <Circle cx={10} cy={21.5} r={1.8} fill="#6E7682" stroke={INK} strokeWidth={0.8} />
    <Circle cx={90} cy={21.5} r={1.8} fill="#6E7682" stroke={INK} strokeWidth={0.8} />
  </Art>;
});

/** A rope-tied wooden bridge post. viewBox 0 0 30 100: size × 0.3 px wide, size px tall. */
export const BridgePost = React.memo(function BridgePost({ size }: { size: number }) {
  return <Art size={size} w={30}>
    <Defs><Lin id="wf-post" horizontal stops={[[0, '#E2AE78'], [1, '#A46D40']]} /></Defs>
    <Path d="M7 98 L7 16 Q7 6 15 6 Q23 6 23 16 L23 98 Z" fill={url('wf-post')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={9.5} y={14} width={3} height={78} rx={1.5} fill="#FFFFFF" opacity={0.3} />
    <Path d="M17 50 Q19 60 17 70 M14 76 Q12 84 14 92" stroke="#8A5A33" strokeWidth={1.2} fill="none" opacity={0.7} />
    <Path d="M23 37 Q29 46 26 55" stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
    <Path d="M23 37 Q29 46 26 55" stroke="#E8D2A0" strokeWidth={2.4} fill="none" strokeLinecap="round" />
    <Rect x={5} y={28} width={20} height={12} rx={4} fill="#E8D2A0" stroke={INK} strokeWidth={2} />
    <Path d="M8.5 28.5 L11.5 39.5 M13.5 28.5 L16.5 39.5 M18.5 28.5 L21.5 39.5" stroke="#B99A62" strokeWidth={1.4} />
    <Rect x={6} y={62} width={18} height={8} rx={3} fill="#E8D2A0" stroke={INK} strokeWidth={2} />
    <Path d="M10 62.5 L12 69.5 M15 62.5 L17 69.5 M20 62.5 L22 69.5" stroke="#B99A62" strokeWidth={1.2} />
    <Path d="M6 98 Q6 90 11 91 Q13 86 17 90 Q22 87 24 98 Z" fill="#7CC48A" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// The rune door

/** Where the two DoorLeaf halves go over a DoorFrame of the same `size`, as fractions of that size: the left leaf's
 * top-left corner is at (left, top), the right leaf's at (left + leafWidth, top); each leaf is drawn with the frame's
 * `size` and comes out leafWidth × leafHeight. */
export const DOOR_OPENING = { left: 0.16, top: 0.452, leafWidth: 0.34, leafHeight: 0.748 } as const;

const DOOR_HOLE = 'M16 120 L16 79.2 A34 34 0 0 1 84 79.2 L84 120 Z';
const ARCH_JOINTS = [196, 222, 248, 292, 318, 344].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return `M${f1(50 + 34 * Math.cos(a))} ${f1(79.2 + 34 * Math.sin(a))} L${f1(50 + 45 * Math.cos(a))} ${f1(79.2 + 45 * Math.sin(a))}`;
}).join(' ');
const KEYSTONE = [[258, 33], [258, 48], [282, 48], [282, 33]].map(([deg, r]) => {
  const a = (deg * Math.PI) / 180;
  return `${f1(50 + r * Math.cos(a))},${f1(79.2 + r * Math.sin(a))}`;
}).join(' ');
const DOOR_GLYPHS = 'M30 14.5 L33.5 19.5 L30 24.5 L26.5 19.5 Z M30 18 L30 21 M38.5 15 L45.5 15 L42 22 Z M42 22 L42 24.5'
  + ' M51 15 L57 18 L51 21 L57 24 M65 19.5 L71 19.5 M68 15 L68 24 M65.5 16.5 L70.5 22.5';

/** A stone archway set into a mossy hill, with a carved rune band above. viewBox 0 0 100 120 (size × 1.2 px tall).
 * The doorway is a hole: whatever is behind shows through, and DoorLeaf halves fit it (see DOOR_OPENING). */
export const DoorFrame = React.memo(function DoorFrame({ size }: { size: number }) {
  return <Art size={size} h={120}>
    <Defs>
      <Lin id="wf-door-hill" stops={[[0, '#9ADB93'], [1, '#4E9A5E']]} />
      <Lin id="wf-door-stone" stops={[[0, '#DCD6EA'], [1, '#A49DBA']]} />
    </Defs>
    <Path d={`M0 120 L0 52 C0 20 22 4 50 4 C78 4 100 20 100 52 L100 120 Z ${DOOR_HOLE}`} fillRule="evenodd" fill={url('wf-door-hill')} stroke={INK} strokeWidth={SW} />
    <Path d="M14 22 l2 -5 l2 5 M80 20 l2 -5 l2 5 M48 6 l2 -5 l2 5" stroke="#3E7F4C" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={10} cy={70} r={2.2} fill="#FFB8EC" stroke={INK} strokeWidth={1} />
    <Circle cx={92} cy={62} r={2.2} fill="#FFE98F" stroke={INK} strokeWidth={1} />
    <Path d={`M5 120 L5 79.2 A45 45 0 0 1 95 79.2 L95 120 Z ${DOOR_HOLE}`} fillRule="evenodd" fill={url('wf-door-stone')} stroke={INK} strokeWidth={SW} />
    <Path d={`${ARCH_JOINTS} M5 94 L16 94 M84 94 L95 94 M5 108 L16 108 M84 108 L95 108`} stroke="#7D7596" strokeWidth={1.6} />
    <Polygon points={KEYSTONE} fill="#E8E3F4" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    <Path d={DOOR_HOLE} fill="none" stroke="#5E5878" strokeWidth={3} opacity={0.5} />
    <Path d="M14 56 Q18 48 24 50 Q22 56 16 60 Z M76 50 Q84 48 86 56 Q80 56 76 54 Z" fill="#7CC48A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
    <Rect x={24} y={11} width={52} height={15} rx={5} fill="#C3BBD8" stroke={INK} strokeWidth={SW} />
    <Path d={DOOR_GLYPHS} stroke="#7FF0FF" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.35} />
    <Path d={DOOR_GLYPHS} stroke="#3FB7D0" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M2 120 Q4 112 10 116 M98 120 Q96 112 90 116" stroke="#8A5A33" strokeWidth={2.4} fill="none" strokeLinecap="round" />
  </Art>;
});

const LEAF_SHAPE = 'M1.5 108.5 L1.5 50 A48.5 48.5 0 0 1 50 1.5 L50 108.5 Z';

/** One half of the carved wooden double door that fills DoorFrame's opening. viewBox 0 0 50 110. Pass the frame's
 * `size`: the leaf comes out size × 0.34 wide and size × 0.748 tall (see DOOR_OPENING for where it goes). */
export const DoorLeaf = React.memo(function DoorLeaf({ size, side }: { size: number; side: 'left' | 'right' }) {
  const id = `wf-door-leaf-${side}`;
  return <Svg width={size * DOOR_OPENING.leafWidth} height={size * DOOR_OPENING.leafHeight} viewBox="0 0 50 110">
    <Defs><Lin id={id} horizontal stops={[[0, '#C98A55'], [1, '#94603A']]} /></Defs>
    <G transform={side === 'right' ? 'translate(50 0) scale(-1 1)' : undefined}>
      <Path d={LEAF_SHAPE} fill={url(id)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M17 15 L17 108 M33 5 L33 108" stroke="#7A4B2A" strokeWidth={1.6} opacity={0.7} />
      <Path d="M6 22 A44 44 0 0 1 40 7" stroke="#E6B987" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.6} />
      <Rect x={4} y={36} width={46} height={6} fill="#6E6A80" stroke={INK} strokeWidth={1.5} />
      <Rect x={1.5} y={88} width={48.5} height={6} fill="#6E6A80" stroke={INK} strokeWidth={1.5} />
      {[[9, 39], [25, 39], [41, 39], [9, 91], [25, 91], [41, 91]].map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.3} fill="#C9C3D8" />)}
      <Path d="M26 72 C17 72 17 58 26 58 C33 58 33 67 27 67 C24 67 24 63 27 63" stroke="#7A4B2A" strokeWidth={2} fill="none" strokeLinecap="round" />
      <Leaf x={20} y={78} angle={-120} len={9} fill="#B07A4A" sw={1.2} />
      <Circle cx={43} cy={62} r={2.2} fill="#E0B84A" stroke={INK} strokeWidth={1.2} />
      <Circle cx={43} cy={67} r={4} fill="none" stroke={INK} strokeWidth={3.4} />
      <Circle cx={43} cy={67} r={4} fill="none" stroke="#E0B84A" strokeWidth={1.8} />
    </G>
  </Svg>;
});

const RUNE_STONE = 'M22 92 Q12 92 14 76 L18 34 Q20 16 40 12 L62 12 Q82 14 84 34 L88 78 Q90 92 76 92 Z';
const RUNE_GLYPH = 'M50 26 L50 78 M37 34 L50 47 L63 34 M37 56 L50 69 L63 56';

/** A carved glyph stone. Lit: the glyph glows cyan with a halo and sparkles. */
export const Rune = React.memo(function Rune({ size, lit }: { size: number; lit: boolean }) {
  const v = lit ? 'lit' : 'dim';
  return <Art size={size}>
    <Defs>
      <Lin id={`wf-rune-stone-${v}`} stops={lit ? [[0, '#C4E6F0'], [1, '#7E9AB4']] : [[0, '#D3CDE2'], [1, '#8F88A6']]} />
      {lit ? <Rad id="wf-rune-halo-lit" stops={[[0, '#9FF8FF', 0.75], [0.6, '#7FF0FF', 0.25], [1, '#7FF0FF', 0]]} /> : null}
    </Defs>
    {lit ? <Circle cx={50} cy={52} r={48} fill={url('wf-rune-halo-lit')} /> : null}
    <Shadow rx={36} />
    <Path d={RUNE_STONE} fill={url(`wf-rune-stone-${v}`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M20 30 Q24 16 40 13 Q36 22 28 24 Q26 30 20 30 Z" fill="#7CC48A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
    <Path d="M76 70 L80 78 L78 84" stroke="#6E6787" strokeWidth={1.4} fill="none" strokeLinecap="round" opacity={0.7} />
    {lit ? <>
      <Path d={RUNE_GLYPH} stroke="#7FF6FF" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.35} />
      <Path d={RUNE_GLYPH} stroke="#9FF8FF" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={RUNE_GLYPH} stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Sparkle x={20} y={14} r={4} color="#BFFBFF" />
      <Sparkle x={86} y={22} r={3} color="#BFFBFF" />
      <Sparkle x={88} y={62} r={2.5} color="#BFFBFF" />
    </> : <>
      <Path d={RUNE_GLYPH} stroke="#EDEAF5" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" transform="translate(0.9 0.9)" />
      <Path d={RUNE_GLYPH} stroke="#555A6E" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>}
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Treasure and the forest friend

const CHEST_COINS = [[30, 50], [42, 45], [56, 46], [68, 51], [49, 52]] as const;

/** A wooden treasure chest with gold bands. Open: the lid tips back, gold is heaped inside and light spills out. */
export const Chest = React.memo(function Chest({ size, open }: { size: number; open: boolean }) {
  const v = open ? 'open' : 'shut';
  return <Art size={size}>
    <Defs>
      <Lin id={`wf-chest-wood-${v}`} stops={[[0, '#C98A55'], [1, '#8E5A34']]} />
      <Lin id={`wf-chest-gold-${v}`} stops={[[0, '#FFE58A'], [1, '#D99A2B']]} />
      {open ? <Rad id="wf-chest-glow-open" stops={[[0, '#FFF6B8', 0.95], [0.6, '#FFE066', 0.35], [1, '#FFE066', 0]]} /> : null}
    </Defs>
    <Shadow rx={42} />
    {open ? <>
      <Ellipse cx={50} cy={40} rx={48} ry={36} fill={url('wf-chest-glow-open')} />
      <Path d="M12 50 L16 22 Q20 10 50 10 Q80 10 84 22 L88 50 Z" fill="#6E4229" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M18 46 L21 24 Q25 15 50 15 Q75 15 79 24 L82 46 Z" fill="#8E5A34" />
      <Polygon points="40,52 28,6 44,6" fill="#FFF6C2" opacity={0.55} />
      <Polygon points="50,52 46,2 58,2" fill="#FFF6C2" opacity={0.6} />
      <Polygon points="60,52 64,6 78,8" fill="#FFF6C2" opacity={0.5} />
      <Path d="M14 57 Q28 40 50 42 Q72 40 86 57 Z" fill={url('wf-chest-gold-open')} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {CHEST_COINS.map(([x, y]) => <Ellipse key={x} cx={x} cy={y} rx={5} ry={3.6} fill="#FFE066" stroke="#C8901E" strokeWidth={1.4} />)}
      <Polygon points="60,40 64,44 60,50 56,44" fill="#FF7A9A" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <Sparkle x={34} y={36} r={4} />
      <Sparkle x={70} y={32} r={3.5} />
    </> : null}
    <Rect x={12} y={54} width={76} height={40} rx={6} fill={url(`wf-chest-wood-${v}`)} stroke={INK} strokeWidth={SW} />
    <Path d="M12 68 L88 68 M12 81 L88 81" stroke="#6E4229" strokeWidth={1.4} opacity={0.6} />
    <Rect x={22} y={54} width={7} height={40} fill={url(`wf-chest-gold-${v}`)} stroke={INK} strokeWidth={1.8} />
    <Rect x={71} y={54} width={7} height={40} fill={url(`wf-chest-gold-${v}`)} stroke={INK} strokeWidth={1.8} />
    {open ? null : <>
      <Path d="M12 56 L12 44 Q12 28 50 28 Q88 28 88 44 L88 56 Z" fill={url('wf-chest-wood-shut')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M22 56 L22 33.4 Q25 32.3 29 31.6 L29 56 Z M71 31.6 Q75 32.3 78 33.4 L78 56 L71 56 Z" fill={url('wf-chest-gold-shut')} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M20 40 Q30 33 46 32" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.45} />
    </>}
    <Rect x={43} y={open ? 54 : 50} width={14} height={15} rx={3} fill={url(`wf-chest-gold-${v}`)} stroke={INK} strokeWidth={2} />
    <Circle cx={50} cy={open ? 59.5 : 55.5} r={2} fill={INK} />
    <Rect x={49} y={open ? 60 : 56} width={2} height={5} rx={1} fill={INK} />
  </Art>;
});

/** A cute round fawn-owl with little antlers. Trapped: worried brows, a tear, wings hugged in. Happy: mid-jump with
 * wings up, closed smiling eyes and an open smile. */
export const Creature = React.memo(function Creature({ size, mood }: { size: number; mood: 'trapped' | 'happy' }) {
  const happy = mood === 'happy';
  const fur = `wf-creature-fur-${mood}`;
  const belly = `wf-creature-belly-${mood}`;
  const ear = happy ? 30 : -12;
  const wing = happy ? 55 : -8;
  return <Art size={size}>
    <Defs>
      <Lin id={fur} stops={[[0, '#F4BE85'], [1, '#C98345']]} />
      <Lin id={belly} stops={[[0, '#FFF8E8'], [1, '#F7DDB4']]} />
    </Defs>
    <Shadow rx={happy ? 18 : 26} opacity={happy ? 0.1 : 0.16} />
    {happy ? <>
      <Path d="M38 89 L36 93 M50 90 L50 94 M62 89 L64 93" stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.35} />
      <Sparkle x={16} y={30} r={5} color="#FFE066" />
      <Sparkle x={86} y={24} r={4} color="#FFE066" />
      <Sparkle x={84} y={54} r={3} color="#FFB8EC" />
    </> : null}
    <G transform={happy ? 'translate(0 -10)' : undefined}>
      <Path d="M41 38 Q39 29 35 24 M38.5 31 Q34 30 31 32 M59 38 Q61 29 65 24 M61.5 31 Q66 30 69 32" stroke={INK} strokeWidth={4.6} fill="none" strokeLinecap="round" />
      <Path d="M41 38 Q39 29 35 24 M38.5 31 Q34 30 31 32 M59 38 Q61 29 65 24 M61.5 31 Q66 30 69 32" stroke="#A9775A" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      <G transform={`rotate(${ear} 34 46)`}>
        <Path d="M34 46 C22 42 12 42 8 46 C14 52 24 54 34 50 Z" fill={url(fur)} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <Path d="M30 47 C22 45 16 45 13 46.5 C18 50 24 50 30 49 Z" fill="#FFB3BF" />
      </G>
      <G transform={`rotate(${-ear} 66 46)`}>
        <Path d="M66 46 C78 42 88 42 92 46 C86 52 76 54 66 50 Z" fill={url(fur)} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <Path d="M70 47 C78 45 84 45 87 46.5 C82 50 76 50 70 49 Z" fill="#FFB3BF" />
      </G>
      <G transform={`rotate(${wing} 30 64)`}>
        <Path d="M30 62 C18 60 10 70 12 80 C18 76 24 76 30 74 Z" fill="#D9925A" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      </G>
      <G transform={`rotate(${-wing} 70 64)`}>
        <Path d="M70 62 C82 60 90 70 88 80 C82 76 76 76 70 74 Z" fill="#D9925A" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      </G>
      <Ellipse cx={41} cy={92} rx={6} ry={3.2} fill="#B06C3A" stroke={INK} strokeWidth={1.8} />
      <Ellipse cx={59} cy={92} rx={6} ry={3.2} fill="#B06C3A" stroke={INK} strokeWidth={1.8} />
      <Ellipse cx={50} cy={64} rx={27} ry={28} fill={url(fur)} stroke={INK} strokeWidth={SW} />
      <Ellipse cx={50} cy={75} rx={16} ry={15} fill={url(belly)} />
      {[[30, 52, 2.2], [33.5, 44, 1.6], [70, 52, 2.2], [66.5, 44, 1.6]].map(([x, y, r]) => <Circle key={`${x}`} cx={x} cy={y} r={r} fill="#FFFFFF" opacity={0.85} />)}
      <Ellipse cx={33} cy={68} rx={5} ry={3} fill="#FF9AA8" opacity={0.55} />
      <Ellipse cx={67} cy={68} rx={5} ry={3} fill="#FF9AA8" opacity={0.55} />
      <Ellipse cx={50} cy={67} rx={3} ry={2.2} fill="#5A3A2E" />
      {happy ? <>
        <Path d="M33 60 Q40 52 47 60 M53 60 Q60 52 67 60" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
        <Path d="M42 71 Q50 84 58 71 Q50 74 42 71 Z" fill="#E8667A" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <Ellipse cx={50} cy={77.5} rx={3.5} ry={2} fill="#FFA3B4" />
      </> : <>
        {[40, 60].map((x) => <G key={x}>
          <Circle cx={x} cy={57} r={8.5} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
          <Circle cx={x + 0.5} cy={55} r={5} fill="#3A2E3F" />
          <Circle cx={x + 2.4} cy={53} r={1.8} fill="#FFFFFF" />
          <Circle cx={x - 1.5} cy={57.5} r={0.9} fill="#FFFFFF" />
        </G>)}
        <Path d="M31 46 Q37 47 44 43 M69 46 Q63 47 56 43" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <Path d="M45 76 Q50 72.5 55 76" stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <Path d="M30 64 Q27 69 30 71 Q33 69 30 64 Z" fill="#8FD3FF" stroke="#4F8FC0" strokeWidth={1} />
      </>}
    </G>
  </Art>;
});

type Pt = readonly [number, number];
type Seg = readonly [Pt, Pt, Pt, Pt];

function bez(s: Seg, t: number): Pt {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [k[0] * s[0][0] + k[1] * s[1][0] + k[2] * s[2][0] + k[3] * s[3][0], k[0] * s[0][1] + k[1] * s[1][1] + k[2] * s[2][1] + k[3] * s[3][1]];
}

function heading(s: Seg, t: number) {
  const u = 1 - t;
  const dx = 3 * u * u * (s[1][0] - s[0][0]) + 6 * u * t * (s[2][0] - s[1][0]) + 3 * t * t * (s[3][0] - s[2][0]);
  const dy = 3 * u * u * (s[1][1] - s[0][1]) + 6 * u * t * (s[2][1] - s[1][1]) + 3 * t * t * (s[3][1] - s[2][1]);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

const segPath = (segs: readonly Seg[]) => segs.map((s, i) => `${i ? '' : `M${s[0][0]} ${s[0][1]} `}C${s[1][0]} ${s[1][1]} ${s[2][0]} ${s[2][1]} ${s[3][0]} ${s[3][1]}`).join(' ');

/** Thorns along a vine at fixed spots, alternating sides, pointing outward from it. */
function thornsOf(segs: readonly Seg[]) {
  return segs.flatMap((s, i) => [0.2, 0.5, 0.8].map((t, j) => {
    const [x, y] = bez(s, t);
    const flip = (i + j) % 2 ? 180 : 0;
    return { x: +f1(x), y: +f1(y), angle: +f1(heading(s, t) + flip) };
  }));
}

const VINE_LAYERS: readonly (readonly (readonly Seg[])[])[] = [
  [
    [[[12, 96], [8, 52], [28, 16], [50, 12]], [[50, 12], [72, 16], [92, 52], [88, 96]]],
    [[[28, 96], [22, 62], [30, 26], [50, 12]]],
    [[[72, 96], [78, 62], [70, 26], [50, 12]]],
    [[[50, 96], [44, 70], [56, 40], [50, 12]]],
  ],
  [
    [[[8, 84], [30, 64], [60, 52], [92, 30]]],
    [[[8, 30], [40, 44], [62, 66], [92, 86]]],
    [[[14, 60], [36, 48], [62, 40], [86, 56]]],
  ],
  [
    [[[6, 88], [26, 76], [40, 96], [56, 84]], [[56, 84], [72, 72], [84, 84], [94, 90]]],
    [[[10, 52], [28, 40], [44, 62], [60, 48]], [[60, 48], [76, 36], [84, 50], [92, 54]]],
    [[[22, 28], [36, 18], [50, 34], [64, 24]], [[64, 24], [72, 18], [80, 24], [84, 32]]],
  ],
];
const VINE_LOOK = [
  { color: '#5E8C3A', thorn: '#E9D9B0' },
  { color: '#8A6A44', thorn: '#F2E2C0' },
  { color: '#4E7A4A', thorn: '#D9B8FF' },
] as const;
const VINE_ART = VINE_LAYERS.map((vines) => vines.map((segs) => ({ d: segPath(segs), thorns: thornsOf(segs) })));
const VINE_LEAVES = [[30, 81, -120], [74, 77, -60], [36, 49, -130], [70, 42, -50], [56, 29, -100]] as const;
const VINE_BERRIES = [[46, 89], [82, 50], [42, 30]] as const;

/** A cage of thorny vines that sits over the Creature (same box). Each layer looks different, so stacking 0, 1 and 2
 * reads as a thick tangle: 0 = arching dome bars, 1 = brown brambles criss-crossing, 2 = winding leafy runners. */
export const Vines = React.memo(function Vines({ size, layer }: { size: number; layer: 0 | 1 | 2 }) {
  const look = VINE_LOOK[layer];
  return <Art size={size}>
    {VINE_ART[layer].map(({ d, thorns }) => <G key={d}>
      <Path d={d} stroke={INK} strokeWidth={7} fill="none" strokeLinecap="round" />
      <Path d={d} stroke={look.color} strokeWidth={4.4} fill="none" strokeLinecap="round" />
      {thorns.map(({ x, y, angle }) => <Path key={`${x}-${y}`} d="M-2.4 -1.6 L0 -7.5 L2.4 -1.6 Z" fill={look.thorn} stroke={INK} strokeWidth={1.1}
        strokeLinejoin="round" transform={`translate(${x} ${y}) rotate(${angle})`} />)}
    </G>)}
    {layer === 2 ? <>
      {VINE_LEAVES.map(([x, y, a]) => <Leaf key={`${x}-${y}`} x={x} y={y} angle={a} len={11} fill="#6CC46E" sw={1.4} />)}
      {VINE_BERRIES.map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={2.6} fill="#B36BE0" stroke={INK} strokeWidth={1.2} />)}
    </> : null}
    {layer === 0 ? <Path d="M30 30 Q38 20 48 17" stroke="#9CCB6E" strokeWidth={1.4} fill="none" strokeLinecap="round" /> : null}
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Little forest things

export type MushroomColor = 'red' | 'blue' | 'purple' | 'gold';
const MUSHROOM_COLORS: Record<MushroomColor, readonly [string, string]> = {
  red: ['#FF9A9A', '#E0485A'], blue: ['#A6D2FF', '#4A86E0'], purple: ['#D9B0FF', '#9050DB'], gold: ['#FFE79A', '#E6A92E'],
};

/** A cute glowing toadstool with a smiling stem. */
export const Mushroom = React.memo(function Mushroom({ size, color }: { size: number; color: MushroomColor }) {
  const [light, dark] = MUSHROOM_COLORS[color] ?? MUSHROOM_COLORS.red;
  const cap = `wf-mushroom-cap-${color}`;
  const glow = `wf-mushroom-glow-${color}`;
  return <Art size={size}>
    <Defs>
      <Lin id={cap} stops={[[0, light], [1, dark]]} />
      <Rad id={glow} stops={[[0, light, 0.55], [1, light, 0]]} />
    </Defs>
    <Circle cx={50} cy={44} r={48} fill={url(glow)} />
    <Shadow rx={26} />
    <Path d="M40 94 Q37 72 42 56 L58 56 Q63 72 60 94 Z" fill="#FFF4E3" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Circle cx={45.5} cy={74} r={2} fill={INK} />
    <Circle cx={54.5} cy={74} r={2} fill={INK} />
    <Path d="M46.5 79 Q50 82 53.5 79" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    <Ellipse cx={50} cy={57} rx={30} ry={5} fill="#F2DCC4" stroke={INK} strokeWidth={2} />
    <Path d="M14 56 Q14 22 50 18 Q86 22 86 56 Q50 63 14 56 Z" fill={url(cap)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    {[[34, 38, 6, 4.5], [56, 29, 5, 4], [69, 45, 4.5, 3.5], [45, 50, 3.5, 2.6]].map(([cx, cy, rx, ry]) =>
      <Ellipse key={cx} cx={cx} cy={cy} rx={rx} ry={ry} fill="#FFFFFF" opacity={0.95} />)}
    <Path d="M23 45 Q25 31 39 24" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" fill="none" opacity={0.55} />
  </Art>;
});

const PETALS = [0, 60, 120, 180, 240, 300];

/** A magic flower. Closed: a glowing pink bud. Open: six petals around a bright glowing centre. */
export const Flower = React.memo(function Flower({ size, open }: { size: number; open: boolean }) {
  const v = open ? 'open' : 'bud';
  return <Art size={size}>
    <Defs>
      <Rad id={`wf-flower-halo-${v}`} stops={[[0, '#FFD6F2', 0.85], [0.6, '#FFC2EC', 0.3], [1, '#FFC2EC', 0]]} />
      <Lin id={`wf-flower-petal-${v}`} stops={[[0, '#FFE0F5'], [1, '#FF8CCB']]} />
    </Defs>
    <Circle cx={50} cy={36} r={open ? 42 : 28} fill={url(`wf-flower-halo-${v}`)} />
    <Shadow rx={18} />
    <Path d="M50 95 C46 78 54 66 50 48" stroke={INK} strokeWidth={5.4} fill="none" strokeLinecap="round" />
    <Path d="M50 95 C46 78 54 66 50 48" stroke="#5DBB63" strokeWidth={3} fill="none" strokeLinecap="round" />
    <Leaf x={49} y={82} angle={-155} len={18} />
    <Leaf x={51} y={72} angle={-25} len={16} />
    {open ? <>
      {PETALS.map((deg) => <Ellipse key={deg} cx={50} cy={24} rx={8} ry={12} fill={url('wf-flower-petal-open')} stroke={INK} strokeWidth={2}
        transform={`rotate(${deg} 50 36)`} />)}
      <Circle cx={50} cy={36} r={7.5} fill="#FFE97A" stroke={INK} strokeWidth={2} />
      <Circle cx={50} cy={36} r={3.6} fill="#FFFFFF" opacity={0.85} />
      <Sparkle x={20} y={18} r={4} color="#FFF6B0" />
      <Sparkle x={82} y={14} r={3.5} color="#FFF6B0" />
      <Sparkle x={84} y={48} r={2.5} color="#FFFFFF" />
    </> : <>
      <Path d="M50 20 C61 31 61 45 50 50 C39 45 39 31 50 20 Z" fill={url('wf-flower-petal-bud')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M50 22 C46 32 46 42 50 49" stroke="#FF8CCB" strokeWidth={1.4} fill="none" />
      <Path d="M41 44 Q46 50 50 52 Q54 50 59 44 Q55 47 50 47 Q45 47 41 44 Z" fill="#5DBB63" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <Ellipse cx={46} cy={32} rx={2.4} ry={5} fill="#FFFFFF" opacity={0.75} />
    </>}
  </Art>;
});

/** A round, mossy, softly glowing stone token. The game prints a letter over it: the middle stays clear and light. */
export const LetterStone = React.memo(function LetterStone({ size }: { size: number }) {
  return <Art size={size}>
    <Defs>
      <Lin id="wf-letterstone-rock" stops={[[0, '#E6E0F2'], [1, '#A99FC2']]} />
      <Rad id="wf-letterstone-halo" stops={[[0.75, '#9FF3FF', 0.45], [1, '#9FF3FF', 0]]} />
      <Rad id="wf-letterstone-core" stops={[[0, '#FFFFFF'], [0.75, '#FFFDF4'], [1, '#F5EEDC']]} />
    </Defs>
    <Circle cx={50} cy={50} r={50} fill={url('wf-letterstone-halo')} />
    <Ellipse cx={50} cy={94} rx={30} ry={3} fill="#2E2740" opacity={0.15} />
    <Circle cx={50} cy={50} r={42} fill={url('wf-letterstone-rock')} stroke={INK} strokeWidth={SW} />
    <Circle cx={50} cy={50} r={35.5} fill="none" stroke="#9FF3FF" strokeWidth={2} opacity={0.8} />
    <Circle cx={50} cy={50} r={31} fill={url('wf-letterstone-core')} />
    {[[50, 11.5], [88.5, 50], [50, 88.5], [11.5, 50]].map(([x, y]) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill="#7FE6F5" />)}
    <Path d="M12 42 Q14 22 32 12 Q30 21 23 25 Q24 33 12 42 Z" fill="#7CC48A" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    <Path d="M88 60 Q86 78 70 88 Q72 80 78 76 Q77 68 88 60 Z" fill="#7CC48A" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
    <Leaf x={30} y={14} angle={-30} len={7} fill="#9BE08E" sw={1.1} />
    <Path d="M22 34 Q26 26 33 21" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.5} />
  </Art>;
});
