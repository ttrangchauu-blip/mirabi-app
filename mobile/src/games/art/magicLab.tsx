import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

// Vector art for the Magic Lab science game: a cosy lab wall with a wooden bench, and the objects and materials the
// child picks up and tries. Every object is drawn in a 0 0 100 100 box, centred, resting on y ≈ 96, so the game can
// place any of them on the bench the same way. Soft pastel gradients, rounded shapes, a dark plum outline.

const INK = '#4A3A58';
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

function Art({ size, children }: { size: number; children: React.ReactNode }) {
  return <Svg width={size} height={size} viewBox="0 0 100 100">{children}</Svg>;
}

/** A soft contact shadow on the bench. */
function Shadow({ rx = 34, cx = 50, cy = 96, opacity = 0.16 }: { rx?: number; cx?: number; cy?: number; opacity?: number }) {
  return <Ellipse cx={cx} cy={cy} rx={rx} ry={3.2} fill="#3A2C48" opacity={opacity} />;
}

/** A four-pointed glint. */
function Sparkle({ x, y, r, color = '#FFFFFF', opacity = 1 }: { x: number; y: number; r: number; color?: string; opacity?: number }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`}
    fill={color} opacity={opacity} />;
}

/** A pointed leaf from (x, y) along `angle` degrees (0 = right, -90 = up). */
function Leaf({ x, y, angle, len, fill = '#5CBF5F' }: { x: number; y: number; angle: number; len: number; fill?: string }) {
  const w = len * 0.42;
  return <G transform={`translate(${x} ${y}) rotate(${angle})`}>
    <Path d={`M0 0 C${len * 0.3} ${-w} ${len * 0.8} ${-w * 0.8} ${len} 0 C${len * 0.8} ${w * 0.8} ${len * 0.3} ${w} 0 0 Z`}
      fill={fill} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
    <Path d={`M${len * 0.12} 0 L${len * 0.78} 0`} stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={1.2} strokeLinecap="round" />
  </G>;
}

/** A 5-point star centred on (cx, cy), squashed vertically by `squash`. */
function starPoints(cx: number, cy: number, r: number, squash = 1) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    points.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a) * squash).toFixed(1)}`);
  }
  return points.join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------
// Backdrop

const STRIPES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const JARS = [[0.06, '#FF9FC3', '#F07BA6'], [0.41, '#9FE6C8', '#5CC79E'], [0.76, '#C7A6FF', '#9F7BEA']] as const;
const BOOKS = [[0.03, 0.09, 0.86, '#FF8F8F'], [0.13, 0.08, 1, '#8FC8FF'], [0.22, 0.1, 0.78, '#FFD86B'],
  [0.33, 0.08, 0.94, '#B79CFF'], [0.42, 0.09, 0.72, '#8FE3B0']] as const;
const HOLES = [0, 1, 2, 3].flatMap((col) => [0, 1, 2, 3, 4].map((row) => [col, row] as const));

/** The lab wall behind the bench: a window onto a sunny sky, a pegboard of tools, shelves of jars and books, and the
 * wooden counter from 66 % of the height down, its front edge and cupboard doors showing. Static, drawn at full size. */
export const LabBackdrop = React.memo(function LabBackdrop({ width, height }: { width: number; height: number }) {
  if (!width || !height) return null;
  const X = (f: number) => width * f;
  const Y = (f: number) => height * f;
  const sw = Math.max(1.5, Math.min(width, height) * 0.008);
  const bench = Y(0.66);
  const lip = Math.max(6, height * 0.05);
  // Window
  const wx = X(0.05), wy = Y(0.08), ww = X(0.25), wh = Y(0.4);
  const pad = Math.max(4, ww * 0.06);
  const ix = wx + pad, iy = wy + pad, iw = ww - pad * 2, ih = wh - pad * 2;
  // Pegboard
  const px = X(0.35), py = Y(0.1), pw = X(0.18), ph = Y(0.36);
  // Shelves
  const sx = X(0.58), sWide = X(0.38);
  const shelf1 = Y(0.28), shelf2 = Y(0.52);
  const board = Math.max(5, height * 0.025);
  const jarH = Y(0.12), jarW = sWide * 0.16;
  const bookMax = Y(0.15);
  const flaskR = Math.min(sWide * 0.09, Y(0.05));
  // Cupboards in the bench front
  const doorTop = bench + lip + Math.max(5, height * 0.03);
  const doorH = height - doorTop - Math.max(5, height * 0.03);
  return <Svg width={width} height={height}>
    <Defs>
      <Lin id="lb-wall" stops={[[0, '#FFF4E3'], [1, '#FCE1D4']]} />
      <Lin id="lb-sky" stops={[[0, '#8FD3FF'], [1, '#E2F5FF']]} />
      <Lin id="lb-wood" stops={[[0, '#D9A26A'], [1, '#B47642']]} />
      <Lin id="lb-top" stops={[[0, '#F3C58E'], [1, '#E0A86C']]} />
      <Lin id="lb-flask" stops={[[0, '#EAF7FF'], [0.5, '#EAF7FF'], [0.5, '#A7E59A'], [1, '#5CC06A']]} />
    </Defs>
    <Rect x={0} y={0} width={width} height={height} fill={url('lb-wall')} />
    {STRIPES.map((i) => <Rect key={i} x={X(i * 0.1 + 0.03)} y={0} width={X(0.04)} height={bench} fill="#FFFFFF" opacity={0.32} />)}

    {/* Window with a sunny sky */}
    <Rect x={wx} y={wy} width={ww} height={wh} rx={10} fill="#D79A66" stroke={INK} strokeWidth={sw} />
    <Rect x={ix} y={iy} width={iw} height={ih} rx={6} fill={url('lb-sky')} />
    <Circle cx={ix + iw * 0.74} cy={iy + ih * 0.24} r={Math.min(iw, ih) * 0.12} fill="#FFE27A" />
    <G opacity={0.95}>
      <Ellipse cx={ix + iw * 0.3} cy={iy + ih * 0.3} rx={iw * 0.16} ry={ih * 0.07} fill="#FFFFFF" />
      <Ellipse cx={ix + iw * 0.24} cy={iy + ih * 0.25} rx={iw * 0.08} ry={ih * 0.07} fill="#FFFFFF" />
    </G>
    <Path d={`M${ix} ${iy + ih} L${ix} ${iy + ih * 0.78} Q${ix + iw * 0.3} ${iy + ih * 0.6} ${ix + iw * 0.6} ${iy + ih * 0.76} Q${ix + iw * 0.82} ${iy + ih * 0.68} ${ix + iw} ${iy + ih * 0.74} L${ix + iw} ${iy + ih} Z`}
      fill="#9EDB8F" />
    <Line x1={ix + iw / 2} y1={iy} x2={ix + iw / 2} y2={iy + ih} stroke="#D79A66" strokeWidth={Math.max(3, pad * 0.7)} />
    <Line x1={ix} y1={iy + ih / 2} x2={ix + iw} y2={iy + ih / 2} stroke="#D79A66" strokeWidth={Math.max(3, pad * 0.7)} />
    <Rect x={wx - 6} y={wy + wh - 3} width={ww + 12} height={Math.max(6, height * 0.03)} rx={3} fill="#C4865A" stroke={INK} strokeWidth={sw} />
    {/* A little cactus on the sill */}
    <Ellipse cx={wx + ww * 0.78} cy={wy + wh - 3 - Y(0.04)} rx={X(0.012)} ry={Y(0.035)} fill="#7CCB7E" stroke={INK} strokeWidth={sw * 0.8} />
    <Path d={`M${wx + ww * 0.7} ${wy + wh - 3} L${wx + ww * 0.72} ${wy + wh - 3 - Y(0.035)} L${wx + ww * 0.84} ${wy + wh - 3 - Y(0.035)} L${wx + ww * 0.86} ${wy + wh - 3} Z`}
      fill="#F08F6A" stroke={INK} strokeWidth={sw * 0.8} strokeLinejoin="round" />

    {/* Pegboard with a magnifier, a ruler and goggles */}
    <Rect x={px} y={py} width={pw} height={ph} rx={8} fill="#F2C98E" stroke={INK} strokeWidth={sw} />
    {HOLES.map(([col, row]) => <Circle key={`${col}-${row}`} cx={px + pw * (0.14 + col * 0.24)} cy={py + ph * (0.1 + row * 0.2)} r={Math.max(1.2, pw * 0.02)} fill="#B98950" />)}
    <Line x1={px + pw * 0.38} y1={py + ph * 0.4} x2={px + pw * 0.5} y2={py + ph * 0.56} stroke={INK} strokeWidth={Math.max(3, pw * 0.06)} strokeLinecap="round" />
    <Circle cx={px + pw * 0.28} cy={py + ph * 0.28} r={pw * 0.17} fill="#DFF3FF" stroke="#8B6FD6" strokeWidth={Math.max(2.5, pw * 0.05)} />
    <Rect x={px + pw * 0.68} y={py + ph * 0.12} width={pw * 0.14} height={ph * 0.5} rx={2} fill="#FFE07A" stroke={INK} strokeWidth={sw * 0.8} />
    <Path d={`M${px + pw * 0.68} ${py + ph * 0.2} h${pw * 0.06} M${px + pw * 0.68} ${py + ph * 0.3} h${pw * 0.04} M${px + pw * 0.68} ${py + ph * 0.4} h${pw * 0.06} M${px + pw * 0.68} ${py + ph * 0.5} h${pw * 0.04}`}
      stroke={INK} strokeWidth={sw * 0.6} />
    <Path d={`M${px + pw * 0.14} ${py + ph * 0.8} Q${px + pw * 0.5} ${py + ph * 0.7} ${px + pw * 0.86} ${py + ph * 0.8}`} stroke="#8B6FD6" strokeWidth={Math.max(2, pw * 0.03)} fill="none" />
    <Circle cx={px + pw * 0.34} cy={py + ph * 0.82} r={pw * 0.12} fill="#BFF0E6" stroke={INK} strokeWidth={sw * 0.8} />
    <Circle cx={px + pw * 0.66} cy={py + ph * 0.82} r={pw * 0.12} fill="#BFF0E6" stroke={INK} strokeWidth={sw * 0.8} />

    {/* Shelves: jars on top, books and a round flask below */}
    {JARS.map(([f, liquid, lid]) => {
      const jx = sx + sWide * f;
      return <G key={f}>
        <Rect x={jx} y={shelf1 - jarH} width={jarW} height={jarH} rx={jarW * 0.25} fill="#EAF7FF" stroke={INK} strokeWidth={sw} />
        <Rect x={jx + sw} y={shelf1 - jarH * 0.58} width={jarW - sw * 2} height={jarH * 0.58 - sw} rx={jarW * 0.2} fill={liquid} />
        <Rect x={jx - 2} y={shelf1 - jarH - jarH * 0.18} width={jarW + 4} height={jarH * 0.22} rx={3} fill={lid} stroke={INK} strokeWidth={sw} />
        <Rect x={jx + jarW * 0.18} y={shelf1 - jarH * 0.85} width={jarW * 0.12} height={jarH * 0.5} rx={2} fill="#FFFFFF" opacity={0.7} />
      </G>;
    })}
    <Rect x={sx - 4} y={shelf1} width={sWide + 8} height={board} rx={2} fill="#C98B57" stroke={INK} strokeWidth={sw} />
    {BOOKS.map(([f, w, h, color]) => <Rect key={f} x={sx + sWide * f} y={shelf2 - bookMax * h} width={sWide * w} height={bookMax * h} rx={2}
      fill={color} stroke={INK} strokeWidth={sw} />)}
    <Rect x={sx + sWide * 0.53} y={shelf2 - bookMax * 0.8} width={sWide * 0.08} height={bookMax * 0.8} rx={2} fill="#FFB27A" stroke={INK} strokeWidth={sw}
      transform={`rotate(18 ${sx + sWide * 0.61} ${shelf2})`} />
    <Rect x={sx + sWide * 0.8 - flaskR * 0.35} y={shelf2 - flaskR * 3.4} width={flaskR * 0.7} height={flaskR * 1.8} fill="#EAF7FF" stroke={INK} strokeWidth={sw} />
    <Circle cx={sx + sWide * 0.8} cy={shelf2 - flaskR} r={flaskR} fill={url('lb-flask')} stroke={INK} strokeWidth={sw} />
    <Rect x={sx - 4} y={shelf2} width={sWide + 8} height={board} rx={2} fill="#C98B57" stroke={INK} strokeWidth={sw} />

    {/* The bench */}
    <Rect x={0} y={bench - 6} width={width} height={6} fill="#5A3A28" opacity={0.08} />
    <Rect x={0} y={bench} width={width} height={height - bench} fill={url('lb-wood')} />
    {[0.04, 0.36, 0.68].map((f) => doorH > 8 ? <G key={f}>
      <Rect x={X(f)} y={doorTop} width={X(0.28)} height={doorH} rx={6} fill="#C88B54" stroke="#8A5A33" strokeWidth={sw} />
      <Circle cx={X(f + 0.14)} cy={doorTop + Math.min(10, doorH * 0.3)} r={Math.max(2.5, doorH * 0.08)} fill="#F4D58A" stroke={INK} strokeWidth={sw * 0.8} />
    </G> : null)}
    <Rect x={-4} y={bench} width={width + 8} height={lip} rx={3} fill={url('lb-top')} stroke={INK} strokeWidth={sw} />
    <Rect x={0} y={bench + lip} width={width} height={Math.max(3, lip * 0.4)} fill="#7A4A2A" opacity={0.3} />
    <Path d={`M${X(0.08)} ${bench + lip * 0.45} Q${X(0.3)} ${bench + lip * 0.25} ${X(0.5)} ${bench + lip * 0.5} T${X(0.92)} ${bench + lip * 0.4}`}
      stroke="#C98B57" strokeWidth={sw * 0.6} fill="none" opacity={0.7} />
  </Svg>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Circuit parts

/** An AA battery lying on its side: green body, gold + cap with a nub on the right, flat − plate on the left. */
export const Battery = React.memo(function Battery({ size }: { size: number }) {
  return <Art size={size}>
    <Defs>
      <Lin id="ml-battery-body" stops={[[0, '#8AE6B2'], [0.5, '#45C285'], [1, '#2A9461']]} />
      <Lin id="ml-battery-cap" stops={[[0, '#FFE58A'], [1, '#E0A63A']]} />
      <Lin id="ml-battery-metal" stops={[[0, '#F2F4F7'], [1, '#A7AFBC']]} />
    </Defs>
    <Shadow rx={42} />
    <Rect x={86} y={73} width={8} height={14} rx={2.5} fill={url('ml-battery-metal')} stroke={INK} strokeWidth={SW} />
    <Rect x={4} y={70} width={6} height={20} rx={2} fill={url('ml-battery-metal')} stroke={INK} strokeWidth={2} />
    <Rect x={8} y={66} width={80} height={28} rx={7} fill={url('ml-battery-body')} stroke={INK} strokeWidth={SW} />
    <Path d="M62 66 L81 66 Q88 66 88 73 L88 87 Q88 94 81 94 L62 94 Z" fill={url('ml-battery-cap')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={73} y={74} width={4} height={12} rx={1} fill="#8A4B12" />
    <Rect x={69} y={78} width={12} height={4} rx={1} fill="#8A4B12" />
    <Rect x={18} y={78} width={12} height={4} rx={1} fill="#FFFFFF" />
    <Polygon points="46,70 38,82 45,82 41,91 52,77 45,77 49,70" fill="#FFF6B0" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
    <Rect x={13} y={69.5} width={46} height={3.5} rx={1.75} fill="#FFFFFF" opacity={0.5} />
  </Art>;
});

const BULB_GLASS = 'M38 64 C38 56 25 51 25 37 A25 25 0 1 1 75 37 C75 51 62 56 62 64 Z';
const BULB_RAYS = [180, 210, 240, 270, 300, 330, 0].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [50 + 32 * Math.cos(a), 37 + 32 * Math.sin(a), 50 + 41 * Math.cos(a), 37 + 41 * Math.sin(a)].map((v) => +v.toFixed(1));
});

/** A light bulb on a screw base. Lit: warm yellow glass, a glow halo and rays. Unlit: pale glass, a grey filament. */
export const Bulb = React.memo(function Bulb({ size, lit }: { size: number; lit: boolean }) {
  const v = lit ? 'on' : 'off';
  return <Art size={size}>
    <Defs>
      {lit ? <Rad id="ml-bulb-halo-on" stops={[[0, '#FFF3A8', 0.95], [0.5, '#FFE066', 0.4], [1, '#FFD23F', 0]]} /> : null}
      <Rad id={`ml-bulb-glass-${v}`} cx="42%" cy="38%" stops={lit
        ? [[0, '#FFFDE8'], [0.55, '#FFE877'], [1, '#FFC23A']]
        : [[0, '#FFFFFF', 0.95], [0.7, '#E4F0FA', 0.8], [1, '#C9DCEC', 0.85]]} />
      <Lin id="ml-bulb-base" horizontal stops={[[0, '#E9EDF2'], [0.5, '#C4CBD6'], [1, '#8E97A6']]} />
    </Defs>
    {lit ? <>
      <Circle cx={50} cy={37} r={44} fill={url('ml-bulb-halo-on')} />
      {BULB_RAYS.map(([x1, y1, x2, y2], i) => <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB92E" strokeWidth={3.5} strokeLinecap="round" />)}
    </> : null}
    <Shadow rx={16} />
    <Rect x={37} y={64} width={26} height={20} rx={3} fill={url('ml-bulb-base')} stroke={INK} strokeWidth={SW} />
    <Path d="M38 69 L62 71 M38 74 L62 76 M38 79 L62 81" stroke="#7C8494" strokeWidth={1.6} strokeLinecap="round" />
    <Path d="M41 84 L59 84 L55 91 L45 91 Z" fill="#6B6F7C" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={46} y={90} width={8} height={5} rx={2} fill="#D9B24E" stroke={INK} strokeWidth={1.8} />
    <Path d={BULB_GLASS} fill={url(`ml-bulb-glass-${v}`)} />
    {lit ? <Circle cx={50} cy={44} r={10} fill="#FFFFFF" opacity={0.55} /> : null}
    <Path d="M44 64 L44 46 M56 64 L56 46" stroke={lit ? '#B8860B' : '#8C8C99'} strokeWidth={1.8} strokeLinecap="round" />
    <Path d="M44 46 Q46 39 48 46 Q50 39 52 46 Q54 39 56 46" fill="none" stroke={lit ? '#FFFFFF' : '#6E625A'} strokeWidth={lit ? 2.6 : 2} strokeLinecap="round" />
    <Path d={BULB_GLASS} fill="none" stroke={INK} strokeWidth={SW} />
    <Path d="M33 31 Q35 21 45 16" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.85} />
  </Art>;
});

/** A knife switch on a wooden base. On: the lever lies flat in the clip (circuit closed). Off: the lever is raised. */
export const Switch = React.memo(function Switch({ size, on }: { size: number; on: boolean }) {
  return <Art size={size}>
    <Defs>
      <Lin id="ml-switch-wood" stops={[[0, '#EDBB82'], [1, '#C3844C']]} />
      <Lin id="ml-switch-brass" stops={[[0, '#FFE08A'], [1, '#D19A35']]} />
      <Lin id="ml-switch-blade" stops={[[0, '#F4F6FA'], [1, '#A3ACBA']]} />
    </Defs>
    <Shadow rx={44} />
    <Rect x={8} y={80} width={84} height={15} rx={5} fill={url('ml-switch-wood')} stroke={INK} strokeWidth={SW} />
    <Rect x={14} y={74} width={72} height={8} rx={3} fill="#F7F3EA" stroke={INK} strokeWidth={SW} />
    <Circle cx={17} cy={88} r={3} fill={url('ml-switch-brass')} stroke={INK} strokeWidth={1.6} />
    <Circle cx={83} cy={88} r={3} fill={url('ml-switch-brass')} stroke={INK} strokeWidth={1.6} />
    <Rect x={20} y={60} width={10} height={16} rx={2} fill={url('ml-switch-brass')} stroke={INK} strokeWidth={SW} />
    <Rect x={70} y={58} width={12} height={18} rx={2} fill={url('ml-switch-brass')} stroke={INK} strokeWidth={SW} />
    <Rect x={72} y={62} width={8} height={6} rx={1} fill="#8A5A1C" opacity={0.6} />
    <G transform={on ? undefined : 'rotate(-55 25 66)'}>
      <Rect x={25} y={63} width={58} height={6} rx={3} fill={url('ml-switch-blade')} stroke={INK} strokeWidth={SW} />
      <Rect x={80} y={59.5} width={14} height={13} rx={5} fill="#FF7A7A" stroke={INK} strokeWidth={SW} />
      <Rect x={83} y={61.5} width={8} height={3} rx={1.5} fill="#FFFFFF" opacity={0.6} />
    </G>
    <Circle cx={25} cy={66} r={4.5} fill={url('ml-switch-brass')} stroke={INK} strokeWidth={2} />
    {on ? <Circle cx={50} cy={86} r={2.6} fill="#6EE08A" stroke={INK} strokeWidth={1.2} /> : <Circle cx={50} cy={86} r={2.6} fill="#C9C3D3" stroke={INK} strokeWidth={1.2} />}
  </Art>;
});

const WIRE_LOOPS = [36, 43, 50, 57, 64];

/** A coil of copper wire with two stripped ends. */
export const Wire = React.memo(function Wire({ size }: { size: number }) {
  const leads = ['M34 70 C20 70 12 80 16 90', 'M66 70 C80 68 90 76 86 89'];
  return <Art size={size}>
    <Defs><Lin id="ml-wire-cu" stops={[[0, '#FFB27A'], [0.5, '#E0844A'], [1, '#A9532A']]} /></Defs>
    <Shadow rx={34} />
    {leads.map((d) => <G key={d}>
      <Path d={d} stroke={INK} strokeWidth={7.5} fill="none" strokeLinecap="round" />
      <Path d={d} stroke="#E0844A" strokeWidth={4.5} fill="none" strokeLinecap="round" />
    </G>)}
    <Path d="M16 90 L17 95 M86 89 L85 94" stroke="#C9CFDA" strokeWidth={3.4} strokeLinecap="round" />
    {WIRE_LOOPS.map((cx) => <G key={cx}>
      <Ellipse cx={cx} cy={73} rx={13} ry={20} fill="none" stroke={INK} strokeWidth={7.5} />
      <Ellipse cx={cx} cy={73} rx={13} ry={20} fill="none" stroke={url('ml-wire-cu')} strokeWidth={4.5} />
    </G>)}
    <Path d="M56 56 Q62 55 66 60" stroke="#FFD2B0" strokeWidth={1.4} fill="none" strokeLinecap="round" />
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Heat and water

export type BeakerState = 'empty' | 'ice' | 'water' | 'boiling' | 'steam';
const BEAKER_GLASS = 'M17 19 L80 19 Q77 21 76 25 L76 87 Q76 94 69 94 L31 94 Q24 94 24 87 L24 27 Q22 22 17 19 Z';
const ICE_CUBES = [[28, 76, -6], [46, 76, 4], [36, 61, -10], [53, 62, 8]] as const;
const BUBBLES = [[34, 0.8, 3], [46, 0.55, 2.2], [58, 0.78, 3.4], [66, 0.4, 2], [40, 0.3, 2.6], [54, 0.22, 1.8]] as const;
const STEAM = ['M38 18 C31 12 45 8 38 1', 'M52 15 C45 9 59 5 52 -2', 'M65 18 C58 12 72 8 65 1'];

/** A glass beaker. `level` (0..1) sets the liquid height. Ice: cubes (with meltwater at `level`). Water: blue liquid
 * with a meniscus. Boiling: liquid full of bubbles. Steam: liquid with wavy vapour rising above the rim. */
export const Beaker = React.memo(function Beaker({ size, state, level }: { size: number; state: BeakerState; level: number }) {
  const amount = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const hasLiquid = state !== 'empty' && amount > 0.01;
  const top = Math.min(84, 92 - amount * 58);
  const liquid = `M26 ${top - 2} Q50 ${top + 3} 74 ${top - 2} L74 86 Q74 92 68 92 L32 92 Q26 92 26 86 Z`;
  const boiling = state === 'boiling';
  return <Art size={size}>
    <Defs>
      <Lin id={`ml-beaker-liquid-${state}`} stops={boiling
        ? [[0, '#A8DEFF'], [1, '#5AAEEB']]
        : state === 'ice' ? [[0, '#C9ECFF'], [1, '#8CCBF0']] : [[0, '#8CD2FF'], [1, '#3E9BE8']]} />
    </Defs>
    <Shadow rx={30} />
    <Path d={BEAKER_GLASS} fill="#E8F6FF" fillOpacity={0.55} />
    {hasLiquid ? <>
      <Path d={liquid} fill={url(`ml-beaker-liquid-${state}`)} />
      <Path d={`M30 ${top - 0.5} Q50 ${top + 3.5} 70 ${top - 0.5}`} stroke="#DDF4FF" strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </> : null}
    {state === 'ice' ? ICE_CUBES.map(([x, y, r]) => <G key={x} transform={`rotate(${r} ${x + 7.5} ${y + 7.5})`}>
      <Rect x={x} y={y} width={15} height={15} rx={3.5} fill="#E6F8FF" stroke="#5FA8D1" strokeWidth={2} />
      <Rect x={x + 3} y={y + 3} width={6} height={3} rx={1.5} fill="#FFFFFF" />
    </G>) : null}
    {boiling && hasLiquid ? <>
      {BUBBLES.map(([x, f, r]) => <Circle key={x} cx={x} cy={top + (92 - top) * f} r={r} fill="#FFFFFF" fillOpacity={0.45} stroke="#FFFFFF" strokeWidth={1} />)}
      <Circle cx={44} cy={top - 3} r={3} fill="none" stroke="#FFFFFF" strokeWidth={1.4} />
      <Circle cx={60} cy={top - 4} r={2.2} fill="none" stroke="#FFFFFF" strokeWidth={1.2} />
    </> : null}
    {boiling ? <Path d="M42 16 C38 12 46 9 42 5 M58 16 C54 12 62 9 58 5" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.75} /> : null}
    {state === 'steam' ? <>
      {STEAM.map((d) => <G key={d}>
        <Path d={d} stroke="#B9CDE2" strokeWidth={8} strokeLinecap="round" fill="none" />
        <Path d={d} stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" />
      </G>)}
      <Ellipse cx={50} cy={top - 8} rx={16} ry={4} fill="#FFFFFF" opacity={0.5} />
    </> : null}
    <Path d={BEAKER_GLASS} fill="none" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M65 40 L72 40 M67 52 L72 52 M65 64 L72 64 M67 76 L72 76" stroke="#7FA7C9" strokeWidth={1.8} strokeLinecap="round" />
    <Rect x={29} y={30} width={4} height={52} rx={2} fill="#FFFFFF" opacity={0.65} />
  </Art>;
});

/** An electric hot plate. On: the coil ring glows orange (no flames) and the light is lit. */
export const HotPlate = React.memo(function HotPlate({ size, on }: { size: number; on: boolean }) {
  const coil = on ? '#FF8A3D' : '#7F8698';
  return <Art size={size}>
    <Defs>
      <Lin id="ml-hotplate-body" stops={[[0, '#C3CEF6'], [1, '#8E9FDE']]} />
      {on ? <Rad id="ml-hotplate-glow-on" stops={[[0, '#FFB15A', 0.8], [0.6, '#FF8A3D', 0.25], [1, '#FF8A3D', 0]]} /> : null}
    </Defs>
    <Shadow rx={44} />
    <Rect x={15} y={87} width={10} height={8} rx={2} fill="#5E6475" stroke={INK} strokeWidth={2} />
    <Rect x={75} y={87} width={10} height={8} rx={2} fill="#5E6475" stroke={INK} strokeWidth={2} />
    <Rect x={8} y={63} width={84} height={27} rx={8} fill={url('ml-hotplate-body')} stroke={INK} strokeWidth={SW} />
    <Rect x={14} y={73} width={72} height={12} rx={4} fill="#F5F3FF" opacity={0.75} />
    {on ? <Circle cx={26} cy={79} r={6} fill="#FF9B5A" opacity={0.4} /> : null}
    <Circle cx={26} cy={79} r={3.2} fill={on ? '#FF6B3D' : '#9AA0AE'} stroke={INK} strokeWidth={1.5} />
    <Circle cx={74} cy={79} r={5.5} fill="#FFFFFF" stroke={INK} strokeWidth={2} />
    <Line x1={74} y1={79} x2={on ? 77.5 : 70.5} y2={75.5} stroke={INK} strokeWidth={2} strokeLinecap="round" />
    <Ellipse cx={50} cy={62} rx={40} ry={9} fill="#5E6475" stroke={INK} strokeWidth={SW} />
    <Ellipse cx={50} cy={61} rx={34} ry={7} fill={on ? '#6E4A44' : '#4E5363'} />
    {on ? <Ellipse cx={50} cy={58} rx={48} ry={20} fill={url('ml-hotplate-glow-on')} /> : null}
    {[[28, 5.6], [19, 3.8], [10, 2]].map(([rx, ry]) => <Ellipse key={rx} cx={50} cy={61} rx={rx} ry={ry} fill="none" stroke={coil} strokeWidth={2.6} />)}
    {on ? [[28, 5.6], [19, 3.8], [10, 2]].map(([rx, ry]) => <Ellipse key={`hot${rx}`} cx={50} cy={60.6} rx={rx} ry={ry} fill="none" stroke="#FFD27A" strokeWidth={0.9} />) : null}
    {on ? <Path d="M36 46 C32 40 40 36 36 30 M50 44 C46 38 54 34 50 28 M64 46 C60 40 68 36 64 30" stroke="#FFB27A" strokeWidth={2.2} strokeLinecap="round" fill="none" opacity={0.5} /> : null}
    <Rect x={14} y={66} width={18} height={3} rx={1.5} fill="#FFFFFF" opacity={0.5} />
  </Art>;
});

const SNOWFLAKE = [0, 60, 120];

/** A small freezer box dusted with frost. Open: the door swings out to the left and cold mist spills out. */
export const ColdBox = React.memo(function ColdBox({ size, open = false }: { size: number; open?: boolean }) {
  const frost = 'M18 38 L18 36 Q18 28 28 28 L72 28 Q82 28 82 36 L82 38 Q77 44 72 38 Q66 45 60 38 Q54 44 48 38 Q42 45 36 38 Q30 44 24 38 Q21 42 18 38 Z';
  return <Art size={size}>
    <Defs>
      <Lin id="ml-coldbox-body" stops={[[0, '#DDF3FF'], [1, '#9FD3F2']]} />
      {open ? <Lin id="ml-coldbox-inside-open" stops={[[0, '#7FBDE6'], [1, '#4C93C9']]} /> : null}
    </Defs>
    <Shadow rx={38} />
    <Rect x={24} y={90} width={8} height={6} rx={2} fill="#7FA9C9" stroke={INK} strokeWidth={1.8} />
    <Rect x={68} y={90} width={8} height={6} rx={2} fill="#7FA9C9" stroke={INK} strokeWidth={1.8} />
    <Rect x={18} y={28} width={64} height={64} rx={10} fill={url('ml-coldbox-body')} />
    {open ? <>
      <Rect x={23} y={44} width={54} height={44} rx={6} fill={url('ml-coldbox-inside-open')} stroke={INK} strokeWidth={2} />
      <Line x1={25} y1={66} x2={75} y2={66} stroke="#EAF7FF" strokeWidth={2.4} />
      <Rect x={30} y={53} width={12} height={12} rx={3} fill="#E6F8FF" stroke="#5FA8D1" strokeWidth={1.8} />
      <Rect x={46} y={55} width={10} height={10} rx={3} fill="#E6F8FF" stroke="#5FA8D1" strokeWidth={1.8} />
      <Path d="M23 50 Q30 47 36 50 Q44 46 52 50 Q60 46 68 50 Q73 47 77 50" stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.8} />
    </> : null}
    <Path d={frost} fill="#FFFFFF" />
    <Path d="M30 41 L31 46 L32 41 M56 41 L57 47 L58 41 M70 41 L71 45 L72 41" fill="#FFFFFF" stroke="#BFE3F7" strokeWidth={0.8} />
    <Rect x={18} y={28} width={64} height={64} rx={10} fill="none" stroke={INK} strokeWidth={SW} />
    {open ? <>
      <Path d="M22 44 L7 49 L7 93 L22 90 Z" fill="#E9F7FF" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Rect x={10} y={60} width={3.5} height={16} rx={1.75} fill="#7FA9C9" stroke={INK} strokeWidth={1.4} />
      {[[34, 87, 11], [52, 90, 12], [69, 86, 10]].map(([cx, cy, rx]) => <Ellipse key={cx} cx={cx} cy={cy} rx={rx} ry={5} fill="#FFFFFF" opacity={0.75} />)}
      <Ellipse cx={44} cy={80} rx={8} ry={4} fill="#FFFFFF" opacity={0.55} />
    </> : <>
      <Rect x={22} y={44} width={56} height={45} rx={6} fill="#EAF7FF" stroke={INK} strokeWidth={2} />
      <Rect x={69} y={52} width={4} height={20} rx={2} fill="#7FA9C9" stroke={INK} strokeWidth={1.6} />
      {SNOWFLAKE.map((deg) => <G key={deg} transform={`rotate(${deg} 45 66)`}>
        <Line x1={45} y1={57} x2={45} y2={75} stroke="#7CC3EE" strokeWidth={2.6} strokeLinecap="round" />
        <Path d="M42 59.5 L45 62 L48 59.5 M42 72.5 L45 70 L48 72.5" stroke="#7CC3EE" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      </G>)}
      <Rect x={26} y={48} width={3} height={36} rx={1.5} fill="#FFFFFF" opacity={0.7} />
    </>}
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Light

/** A flashlight lying on its side, pointing right. On: the lens glows (the beam itself is drawn by the game). */
export const Torch = React.memo(function Torch({ size, on }: { size: number; on: boolean }) {
  const v = on ? 'on' : 'off';
  return <Art size={size}>
    <Defs>
      <Lin id="ml-torch-body" stops={[[0, '#9FD0FF'], [1, '#4F8FE0']]} />
      <Lin id="ml-torch-head" stops={[[0, '#FFE38A'], [1, '#F0AE36']]} />
      <Rad id={`ml-torch-lens-${v}`} stops={on ? [[0, '#FFFFFF'], [0.6, '#FFF7C2'], [1, '#FFE066']] : [[0, '#F4FAFF'], [1, '#B9CCDD']]} />
      {on ? <Rad id="ml-torch-glow-on" stops={[[0, '#FFF6B0', 0.9], [0.5, '#FFE877', 0.35], [1, '#FFE066', 0]]} /> : null}
    </Defs>
    <Shadow rx={42} />
    {on ? <Ellipse cx={88} cy={76} rx={14} ry={26} fill={url('ml-torch-glow-on')} /> : null}
    <Rect x={6} y={67} width={8} height={16} rx={3} fill="#3D74BE" stroke={INK} strokeWidth={2} />
    <Rect x={40} y={58.5} width={11} height={7} rx={2.5} fill={on ? '#7CF29A' : '#FF8A8A'} stroke={INK} strokeWidth={2} />
    <Rect x={10} y={64} width={54} height={22} rx={8} fill={url('ml-torch-body')} stroke={INK} strokeWidth={SW} />
    <Path d="M20 65 L20 85 M25 65 L25 85 M30 65 L30 85" stroke="#3D74BE" strokeWidth={1.8} />
    <Rect x={14} y={67.5} width={44} height={3.5} rx={1.75} fill="#FFFFFF" opacity={0.5} />
    <Path d="M60 65 Q60 63 62 63 L80 57 Q84 57 84 61 L84 91 Q84 95 80 95 L62 87 Q60 87 60 85 Z" fill={url('ml-torch-head')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Ellipse cx={85} cy={76} rx={4.5} ry={18} fill={url(`ml-torch-lens-${v}`)} stroke={INK} strokeWidth={2} />
    {on ? <Ellipse cx={86} cy={76} rx={2.4} ry={12} fill="#FFFFFF" opacity={0.9} /> : <Path d="M84.5 64 Q86 69 85.5 73" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" fill="none" />}
    <Path d="M65 66 L78 61" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" opacity={0.6} />
  </Art>;
});

/** A white projection screen on a tripod stand. */
export const Screen = React.memo(function Screen({ size }: { size: number }) {
  return <Art size={size}>
    <Defs><Lin id="ml-screen-face" stops={[[0, '#FFFFFF'], [1, '#EBEFF7']]} /></Defs>
    <Shadow rx={30} />
    <Path d="M50 74 L33 95 M50 74 L67 95 M50 74 L50 95" stroke={INK} strokeWidth={5.5} strokeLinecap="round" fill="none" />
    <Path d="M50 74 L33 95 M50 74 L67 95 M50 74 L50 95" stroke="#A9B1C3" strokeWidth={2.8} strokeLinecap="round" fill="none" />
    <Rect x={47.5} y={14} width={5} height={62} fill="#A9B1C3" stroke={INK} strokeWidth={2} />
    <Rect x={12} y={15} width={76} height={54} rx={2} fill={url('ml-screen-face')} stroke={INK} strokeWidth={2.2} />
    <Rect x={15.5} y={18.5} width={69} height={47} fill="none" stroke="#DCE2EE" strokeWidth={1.5} />
    <Rect x={7} y={8} width={86} height={8} rx={4} fill="#C9CFDC" stroke={INK} strokeWidth={SW} />
    <Circle cx={8} cy={12} r={3} fill="#8B6FD6" stroke={INK} strokeWidth={1.5} />
    <Circle cx={92} cy={12} r={3} fill="#8B6FD6" stroke={INK} strokeWidth={1.5} />
    <Rect x={11} y={67} width={78} height={5} rx={2.5} fill="#A9B1C3" stroke={INK} strokeWidth={2} />
    <Path d="M20 24 L32 24" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Plants

export type PotStage = 0 | 1 | 2 | 3 | 4 | 5;

function Stem({ d }: { d: string }) {
  return <>
    <Path d={d} stroke={INK} strokeWidth={5.4} fill="none" strokeLinecap="round" />
    <Path d={d} stroke="#5DBB63" strokeWidth={3} fill="none" strokeLinecap="round" />
  </>;
}

function SeedLeaves({ x, y, spread, rx }: { x: number; y: number; spread: number; rx: number }) {
  return <>
    <Ellipse cx={x - rx * 0.9} cy={y} rx={rx} ry={rx * 0.55} fill="#B5E57A" stroke={INK} strokeWidth={1.8} transform={`rotate(${-spread} ${x} ${y})`} />
    <Ellipse cx={x + rx * 0.9} cy={y} rx={rx} ry={rx * 0.55} fill="#B5E57A" stroke={INK} strokeWidth={1.8} transform={`rotate(${spread} ${x} ${y})`} />
  </>;
}

function Plant({ stage }: { stage: PotStage }) {
  if (stage === 2) return <>
    <Stem d="M50 61 C49 56 51 52 50 47" />
    <SeedLeaves x={50} y={46} spread={18} rx={7.5} />
  </>;
  if (stage === 3) return <>
    <Stem d="M50 61 C48 52 52 44 50 34" />
    <SeedLeaves x={50.5} y={51} spread={8} rx={6} />
    <Leaf x={50} y={35} angle={-140} len={15} />
    <Leaf x={50} y={35} angle={-40} len={15} />
  </>;
  if (stage === 4 || stage === 5) return <>
    <Stem d="M50 61 C46 48 54 36 50 24 C49 20 50 18 50 15" />
    <Leaf x={49} y={52} angle={-165} len={17} />
    <Leaf x={51} y={46} angle={-15} len={17} />
    <Leaf x={50} y={38} angle={-160} len={16} />
    <Leaf x={51} y={31} angle={-20} len={15} />
    <Leaf x={50} y={24} angle={-150} len={12} />
    <Leaf x={50} y={24} angle={-30} len={12} />
    {stage === 4 ? <>
      <Leaf x={50} y={16} angle={-120} len={9} fill="#7FD07A" />
      <Leaf x={50} y={16} angle={-60} len={9} fill="#7FD07A" />
    </> : <>
      {[0, 72, 144, 216, 288].map((deg) => <Circle key={deg} cx={50 + 6 * Math.cos(((deg - 90) * Math.PI) / 180)}
        cy={12 + 6 * Math.sin(((deg - 90) * Math.PI) / 180)} r={5} fill="#FF9CC2" stroke={INK} strokeWidth={1.5} />)}
      <Circle cx={50} cy={12} r={4.2} fill="#FFD54A" stroke={INK} strokeWidth={1.5} />
      <Circle cx={48.8} cy={10.8} r={1.3} fill="#FFFFFF" opacity={0.8} />
    </>}
  </>;
  return null;
}

/** A terracotta pot with a cut-away window showing the soil. 0: soil only. 1: a seed under a little bump. 2: a sprout
 * with a root and two seed leaves. 3: a seedling with its first true leaves. 4: a young plant. 5: in flower.
 * `wet`: just watered (darker, glistening soil). */
export const Pot = React.memo(function Pot({ size, stage, wet = false }: { size: number; stage: PotStage; wet?: boolean }) {
  return <Art size={size}>
    <Defs>
      <Lin id="ml-pot-clay" stops={[[0, '#F5AE84'], [1, '#C9693F']]} />
      <Lin id="ml-pot-soil" stops={[[0, '#8A5A36'], [1, '#5E3B22']]} />
    </Defs>
    <Shadow rx={24} />
    <Path d="M25 71 L75 71 L69 93 Q68 96 64 96 L36 96 Q32 96 31 93 Z" fill={url('ml-pot-clay')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={35} y={75} width={30} height={15} rx={5} fill={url('ml-pot-soil')} stroke="#5A3620" strokeWidth={1.5} />
    <Circle cx={40} cy={86} r={0.9} fill="#C79A6E" /><Circle cx={60} cy={84} r={0.9} fill="#C79A6E" /><Circle cx={57} cy={78} r={0.8} fill="#C79A6E" />
    {wet ? <Rect x={35} y={75} width={30} height={15} rx={5} fill="#2E1A0D" opacity={0.42} /> : null}
    {stage === 1 ? <Ellipse cx={50} cy={81} rx={4.5} ry={3} fill="#E8C27A" stroke={INK} strokeWidth={1.5} /> : null}
    {stage === 2 ? <>
      <Path d="M50 75 L50 84 M50 79 Q47 82 45 86 M50 80 Q53 83 55 87" stroke="#F4E3C3" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Ellipse cx={47} cy={77} rx={2.6} ry={1.6} fill="#E8C27A" stroke={INK} strokeWidth={1} />
    </> : null}
    {stage >= 3 ? <Path d="M50 75 L50 89 M50 78 Q45 82 40 87 M50 80 Q55 83 60 88 M50 84 Q47 86 45 89 M50 83 Q53 85 54 89"
      stroke="#F4E3C3" strokeWidth={1.6} fill="none" strokeLinecap="round" /> : null}
    <Rect x={20} y={60} width={60} height={12} rx={4} fill={url('ml-pot-clay')} stroke={INK} strokeWidth={SW} />
    <Ellipse cx={50} cy={61.5} rx={27} ry={3.5} fill={wet ? '#4A2C17' : '#6B4428'} stroke={INK} strokeWidth={2} />
    {wet ? <>
      <Ellipse cx={40} cy={61} rx={3} ry={0.9} fill="#BFE6FF" opacity={0.8} />
      <Ellipse cx={60} cy={62} rx={2.4} ry={0.8} fill="#BFE6FF" opacity={0.7} />
    </> : null}
    {stage === 1 ? <Ellipse cx={50} cy={59.6} rx={6} ry={2.6} fill="#7A4E2E" stroke={INK} strokeWidth={1.4} /> : null}
    <Rect x={24} y={64} width={14} height={3} rx={1.5} fill="#FFFFFF" opacity={0.4} />
    <Plant stage={stage} />
  </Art>;
});

/** A teal watering can with a sprinkler rose on its spout. */
export const WateringCan = React.memo(function WateringCan({ size }: { size: number }) {
  return <Art size={size}>
    <Defs><Lin id="ml-can-body" stops={[[0, '#93E6D3'], [1, '#3FB59C']]} /></Defs>
    <Shadow rx={36} />
    <Path d="M64 76 L86 50 L91 54 L70 86 Z" fill={url('ml-can-body')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <G transform="rotate(-40 89 51)">
      <Rect x={84} y={43} width={10} height={15} rx={3} fill="#FFD45E" stroke={INK} strokeWidth={SW} />
      <Circle cx={92} cy={47} r={0.9} fill={INK} /><Circle cx={92} cy={51} r={0.9} fill={INK} /><Circle cx={92} cy={55} r={0.9} fill={INK} />
    </G>
    <Path d="M30 56 C30 34 62 34 64 52" stroke={INK} strokeWidth={9} fill="none" strokeLinecap="round" />
    <Path d="M30 56 C30 34 62 34 64 52" stroke="#5CC8B0" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M24 56 Q24 52 28 52 L66 52 Q70 52 70 56 L72 90 Q72 94 68 94 L28 94 Q24 94 24 90 Z" fill={url('ml-can-body')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Ellipse cx={47} cy={53} rx={18} ry={3} fill="#2F8C78" stroke={INK} strokeWidth={2} />
    <Rect x={25} y={66} width={46} height={5} fill="#FFFFFF" opacity={0.35} />
    <Path d="M48 72 Q42 80 48 85 Q54 80 48 72 Z" fill="#FFFFFF" opacity={0.9} />
    <Rect x={29} y={58} width={4} height={30} rx={2} fill="#FFFFFF" opacity={0.5} />
  </Art>;
});

/** A student microscope: tilted eyepiece tube, a stage with a glass slide, a light and a focus knob. */
export const Microscope = React.memo(function Microscope({ size }: { size: number }) {
  return <Art size={size}>
    <Defs>
      <Lin id="ml-microscope-body" stops={[[0, '#D6CBFA'], [1, '#9A86E0']]} />
      <Lin id="ml-microscope-tube" stops={[[0, '#6E6587'], [1, '#433B58']]} horizontal />
    </Defs>
    <Shadow rx={34} />
    <Path d="M18 94 L18 88 Q18 82 26 82 L74 82 Q82 82 82 88 L82 94 Z" fill={url('ml-microscope-body')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M60 84 C74 74 74 40 62 24 L53 31 C61 44 61 70 51 82 Z" fill={url('ml-microscope-body')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Circle cx={43} cy={74} r={4} fill="#FFF3A8" stroke={INK} strokeWidth={1.6} />
    <G transform="rotate(-25 46 40)">
      <Rect x={41} y={43} width={8} height={9} rx={1.5} fill="#C9CFDC" stroke={INK} strokeWidth={2} />
      <Rect x={38} y={14} width={14} height={31} rx={3} fill={url('ml-microscope-tube')} stroke={INK} strokeWidth={SW} />
      <Rect x={40} y={4} width={10} height={12} rx={2} fill="#3E3850" stroke={INK} strokeWidth={SW} />
      <Rect x={38} y={30} width={14} height={4} fill="#FFFFFF" opacity={0.35} />
    </G>
    <Rect x={22} y={58} width={44} height={6} rx={2} fill="#5C5470" stroke={INK} strokeWidth={SW} />
    <Rect x={30} y={55.5} width={22} height={3} rx={1} fill="#BFE6FF" stroke={INK} strokeWidth={1.2} />
    <Circle cx={41} cy={57} r={1.4} fill="#FF8FB8" />
    <Circle cx={65} cy={56} r={6} fill="#FFD45E" stroke={INK} strokeWidth={2} />
    <Circle cx={65} cy={56} r={2} fill="#E0A63A" />
    <Path d="M64 34 Q68 46 67 60" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.5} />
  </Art>;
});

/** A red and blue horseshoe magnet with silver pole tips, standing on its tips. */
export const Magnet = React.memo(function Magnet({ size }: { size: number }) {
  return <Art size={size}>
    <Defs>
      <Lin id="ml-magnet-red" stops={[[0, '#FF8A8A'], [1, '#DD4545']]} />
      <Lin id="ml-magnet-blue" stops={[[0, '#8AB8FF'], [1, '#3E73D9']]} />
      <Lin id="ml-magnet-tip" stops={[[0, '#F2F4F7'], [1, '#A3ACBA']]} />
    </Defs>
    <Shadow rx={36} />
    <Path d="M18 82 L18 50 A32 32 0 0 1 50 18 L50 36 A14 14 0 0 0 36 50 L36 82 Z" fill={url('ml-magnet-red')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M82 82 L82 50 A32 32 0 0 0 50 18 L50 36 A14 14 0 0 1 64 50 L64 82 Z" fill={url('ml-magnet-blue')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={18} y={80} width={18} height={15} rx={2} fill={url('ml-magnet-tip')} stroke={INK} strokeWidth={SW} />
    <Rect x={64} y={80} width={18} height={15} rx={2} fill={url('ml-magnet-tip')} stroke={INK} strokeWidth={SW} />
    <Path d="M23 54 A27 27 0 0 1 44 24" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.55} />
    <Path d="M70 30 A27 27 0 0 1 77 44" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.45} />
  </Art>;
});

// ---------------------------------------------------------------------------------------------------------------------
// Materials

export type MaterialKind = 'nail' | 'spoon' | 'clip' | 'foil' | 'coin' | 'copper' | 'ruler' | 'rubber' | 'wood' | 'wool' | 'eraser' | 'glass'
  | 'book' | 'paper' | 'cardboard' | 'cup';

export const MATERIAL_KINDS: MaterialKind[] = ['nail', 'spoon', 'clip', 'foil', 'coin', 'copper', 'ruler', 'rubber', 'wood', 'wool', 'eraser',
  'glass', 'book', 'paper', 'cardboard', 'cup'];

const CLIP_PATH = 'M40 74 L72 74 A5 5 0 0 1 72 84 L26 84 A9 9 0 0 1 26 66 L78 66 A13 13 0 0 1 78 92 L34 92';
const COPPER_PATH = 'M12 84 C26 58 42 98 56 76 S80 58 90 78';
const RUBBER_PATH = 'M20 80 C20 66 46 68 60 70 C78 72 84 84 72 88 C58 92 20 94 20 80 Z';
const RULER_TICKS = Array.from({ length: 16 }, (_, i) => `M${12 + i * 5} 70 L${12 + i * 5} ${i % 2 ? 74 : 77}`).join(' ');
const CORRUGATION = Array.from({ length: 9 }, (_, i) => `${i ? '' : 'M24 24 '}Q${27 + i * 6} 20.5 ${30 + i * 6} 24`).join(' ');
const GLASS_STROKE = '#4F7FA6';

function stroked(d: string, color: string, width: number, highlight?: string) {
  return <>
    <Path d={d} stroke={INK} strokeWidth={width + 2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d={d} stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {highlight ? <Path d={d} stroke={highlight} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.85} transform="translate(-0.6 -0.9)" /> : null}
  </>;
}

const MATERIAL_ART: Record<MaterialKind, React.ReactNode> = {
  nail: <>
    <Defs><Lin id="ml-mat-nail" stops={[[0, '#D9DEE6'], [0.5, '#9AA2AE'], [1, '#6B7380']]} /></Defs>
    <Shadow rx={40} />
    <Path d="M20 74 L80 74 L92 78.5 L80 83 L20 83 Z" fill={url('ml-mat-nail')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Rect x={12} y={64} width={9} height={29} rx={3} fill={url('ml-mat-nail')} stroke={INK} strokeWidth={SW} />
    <Path d="M28 74 L28 83 M33 74 L33 83" stroke="#7C8491" strokeWidth={1.2} />
    <Path d="M38 76.5 L78 76.5" stroke="#FFFFFF" strokeOpacity={0.75} strokeWidth={1.6} strokeLinecap="round" />
  </>,
  spoon: <>
    <Defs><Lin id="ml-mat-spoon" stops={[[0, '#F4F6FA'], [1, '#A3ACBA']]} /></Defs>
    <Shadow rx={42} />
    <Path d="M40 78 C52 76 74 72 90 70 Q94 70 94 73.5 Q94 77 90 77 C74 80 54 82 40 84 Z" fill={url('ml-mat-spoon')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Ellipse cx={26} cy={80} rx={18} ry={11} fill={url('ml-mat-spoon')} stroke={INK} strokeWidth={SW} />
    <Ellipse cx={23} cy={77.5} rx={9} ry={4.5} fill="#FFFFFF" opacity={0.7} />
    <Path d="M50 77.5 L86 72.5" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
  </>,
  clip: <>
    <Shadow rx={38} />
    {stroked(CLIP_PATH, '#C7CFDA', 3.4, '#FFFFFF')}
  </>,
  foil: <>
    <Defs><Lin id="ml-mat-foil" stops={[[0, '#F7F9FC'], [0.5, '#C3CAD5'], [1, '#8E97A6']]} /></Defs>
    <Shadow rx={32} />
    <Path d="M30 93 L21 78 L28 63 L40 57 L54 60 L66 55 L79 66 L81 80 L72 93 Z" fill={url('ml-mat-foil')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Polygon points="40,74 54,60 62,76" fill="#FFFFFF" opacity={0.45} />
    <Polygon points="28,63 40,57 40,74" fill="#FFFFFF" opacity={0.3} />
    <Polygon points="62,76 79,66 81,80" fill="#6E7682" opacity={0.18} />
    <Path d="M21 78 L40 74 L54 60 M40 74 L46 93 M40 74 L62 76 L79 66 M62 76 L72 93 M28 63 L40 74 M62 76 L66 55" stroke="#8E97A6" strokeWidth={1.3} fill="none" strokeLinejoin="round" />
    <Sparkle x={50} y={66} r={4} />
    <Sparkle x={70} y={72} r={3} />
  </>,
  coin: <>
    <Defs><Lin id="ml-mat-coin" stops={[[0, '#FFE89A'], [1, '#E0A631']]} /></Defs>
    <Shadow rx={30} />
    <Ellipse cx={50} cy={83} rx={26} ry={12} fill="#C98A1E" stroke={INK} strokeWidth={SW} />
    <Ellipse cx={50} cy={78} rx={26} ry={12} fill={url('ml-mat-coin')} stroke={INK} strokeWidth={SW} />
    <Ellipse cx={50} cy={78} rx={19} ry={8.5} fill="none" stroke="#C98A1E" strokeWidth={1.6} />
    <Polygon points={starPoints(50, 78, 9, 0.5)} fill="#FFF3B8" stroke="#C98A1E" strokeWidth={1.2} strokeLinejoin="round" />
    <Path d="M30 74 Q36 69 46 68" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.8} />
  </>,
  copper: <>
    <Shadow rx={40} />
    {stroked(COPPER_PATH, '#E0874A', 4.6, '#FFC08F')}
    <Circle cx={12} cy={84} r={2.4} fill="#F2B48A" stroke={INK} strokeWidth={1.4} />
    <Circle cx={90} cy={78} r={2.4} fill="#F2B48A" stroke={INK} strokeWidth={1.4} />
  </>,
  ruler: <>
    <Shadow rx={42} />
    <G transform="rotate(-8 50 80)">
      <Rect x={6} y={70} width={88} height={18} rx={3} fill="#9FE0FF" fillOpacity={0.8} stroke={INK} strokeWidth={SW} />
      <Path d={RULER_TICKS} stroke="#2F6F96" strokeWidth={1.3} />
      <Rect x={10} y={82} width={80} height={2.5} rx={1.25} fill="#FFFFFF" opacity={0.65} />
      <Circle cx={87} cy={81} r={2.4} fill="#FFFFFF" fillOpacity={0.6} stroke={INK} strokeWidth={1.2} />
    </G>
  </>,
  rubber: <>
    <Shadow rx={34} />
    {stroked(RUBBER_PATH, '#FF8A5C', 4.2, '#FFC2A3')}
  </>,
  wood: <>
    <Defs><Lin id="ml-mat-wood" stops={[[0, '#ECBE88'], [1, '#B97D4A']]} /></Defs>
    <Shadow rx={42} />
    <G transform="rotate(-6 50 80)">
      <Rect x={8} y={72} width={84} height={14} rx={7} fill={url('ml-mat-wood')} stroke={INK} strokeWidth={SW} />
      <Path d="M16 77 Q40 75 60 78 T88 77 M20 82 Q44 80 70 83" stroke="#A0683A" strokeWidth={1.3} fill="none" opacity={0.7} />
      <Ellipse cx={46} cy={79} rx={3.5} ry={2} fill="none" stroke="#A0683A" strokeWidth={1.4} />
      <Rect x={14} y={74} width={60} height={2.4} rx={1.2} fill="#FFFFFF" opacity={0.35} />
    </G>
  </>,
  wool: <>
    <Defs><Lin id="ml-mat-wool" stops={[[0, '#FFB8D4'], [1, '#E06A9E']]} /></Defs>
    <Shadow rx={30} />
    {stroked('M64 86 C76 95 84 86 92 92', '#F28DB8', 3)}
    <Circle cx={48} cy={72} r={22} fill={url('ml-mat-wool')} stroke={INK} strokeWidth={SW} />
    <Path d="M30 62 Q48 54 66 64 M27 72 Q48 62 70 74 M30 82 Q50 72 68 84 M40 52 Q34 72 42 93 M56 52 Q64 70 58 93"
      stroke="#C8578A" strokeWidth={1.6} fill="none" opacity={0.8} />
    <Path d="M35 58 Q41 53 48 53" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.75} />
  </>,
  eraser: <>
    <Shadow rx={36} />
    <Polygon points="18,70 30,60 84,60 72,70" fill="#FFD3DC" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
    <Polygon points="72,70 84,60 84,82 72,92" fill="#F08DA2" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
    <Rect x={18} y={70} width={54} height={22} rx={2} fill="#FFB8C6" stroke={INK} strokeWidth={2.2} />
    <Polygon points="44,70 56,60 84,60 72,70" fill="#A6CBFF" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
    <Polygon points="72,70 84,60 84,82 72,92" fill="#5D93E6" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
    <Rect x={44} y={70} width={28} height={22} fill="#7FB2FF" stroke={INK} strokeWidth={2.2} />
    <Path d="M49 78 L67 78 M49 83 L62 83" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" opacity={0.85} />
    <Rect x={22} y={73} width={4} height={14} rx={2} fill="#FFFFFF" opacity={0.5} />
  </>,
  glass: <>
    <Shadow rx={30} />
    <Rect x={26} y={14} width={48} height={78} rx={3} fill="#CDEBFF" fillOpacity={0.4} stroke={GLASS_STROKE} strokeWidth={SW} />
    <Rect x={29} y={17} width={42} height={72} rx={1.5} fill="none" stroke="#FFFFFF" strokeWidth={1.2} opacity={0.6} />
    <Path d="M34 32 L48 21 M34 44 L60 24 M54 82 L67 71" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
    <Rect x={22} y={88} width={16} height={7} rx={2} fill="#D9A26A" stroke={INK} strokeWidth={2} />
    <Rect x={62} y={88} width={16} height={7} rx={2} fill="#D9A26A" stroke={INK} strokeWidth={2} />
  </>,
  book: <>
    <Defs><Lin id="ml-mat-book" stops={[[0, '#86D3C2'], [1, '#3F9C8C']]} /></Defs>
    <Shadow rx={32} />
    <Path d="M70 22 L78 26 L78 94 L70 92 Z" fill="#FFF6E0" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    <Path d="M72.5 30 L72.5 90 M75.5 31 L75.5 91" stroke="#E0CFA8" strokeWidth={1} />
    <Rect x={24} y={18} width={48} height={76} rx={4} fill={url('ml-mat-book')} stroke={INK} strokeWidth={SW} />
    <Rect x={25.5} y={19.5} width={8} height={73} rx={3} fill="#2F7F71" opacity={0.55} />
    <Rect x={40} y={32} width={24} height={14} rx={3} fill="#FFF6E0" stroke={INK} strokeWidth={1.6} />
    <Polygon points={starPoints(52, 67, 9)} fill="#FFD86B" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
  </>,
  paper: <>
    <Shadow rx={28} />
    <Path d="M28 16 L66 16 L74 24 L74 92 L28 92 Z" fill="#FFFFFF" fillOpacity={0.55} stroke="#8593A6" strokeWidth={2.2} strokeLinejoin="round" />
    <Path d="M66 16 L66 24 L74 24 Z" fill="#E8EDF3" fillOpacity={0.9} stroke="#8593A6" strokeWidth={1.8} strokeLinejoin="round" />
    <Path d="M34 32 L60 32 M34 44 L66 44 M34 56 L62 56 M34 68 L66 68 M34 80 L58 80" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.7} />
    <Rect x={30} y={89} width={12} height={6} rx={2} fill="#C9CFDC" stroke={INK} strokeWidth={1.6} />
    <Rect x={60} y={89} width={12} height={6} rx={2} fill="#C9CFDC" stroke={INK} strokeWidth={1.6} />
  </>,
  cardboard: <>
    <Shadow rx={32} />
    <Rect x={24} y={22} width={52} height={72} rx={2} fill="#D9A86C" stroke={INK} strokeWidth={SW} />
    <Path d={CORRUGATION} stroke="#B5814A" strokeWidth={1.4} fill="none" />
    <Rect x={25} y={80} width={50} height={12.5} fill="#B5814A" opacity={0.25} />
    <Rect x={40} y={18} width={20} height={12} fill="#F6E7B5" opacity={0.85} />
    <Path d="M32 60 L44 60 M32 66 L40 66" stroke="#9A6A3A" strokeWidth={2} strokeLinecap="round" />
    <Path d="M60 52 L66 46 L72 52 M66 46 L66 60" stroke="#9A6A3A" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  cup: <>
    <Shadow rx={22} />
    <Path d="M26 30 L74 30 L66 92 Q66 94 64 94 L36 94 Q34 94 34 92 Z" fill="#DFF3FF" fillOpacity={0.45} stroke={GLASS_STROKE} strokeWidth={2.4} strokeLinejoin="round" />
    <Ellipse cx={50} cy={30} rx={24} ry={4} fill="#EFF9FF" fillOpacity={0.7} stroke={GLASS_STROKE} strokeWidth={2} />
    <Path d="M33.5 80 L66.5 80 M34.2 85 L65.8 85" stroke="#9CC7E3" strokeWidth={1.3} />
    <Path d="M33 38 L38 86" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
    <Path d="M63 40 L61.5 52" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" opacity={0.6} />
  </>,
};

/** One test material, drawn so a child recognises it: iron nail, steel spoon, paper clip, crumpled foil, coin, bare
 * copper wire, plastic ruler, rubber band, wooden stick, yarn ball, eraser, glass pane, closed book, tracing paper,
 * cardboard, clear plastic cup. The flat screens (glass, paper, cardboard, book) stand upright so a beam can hit them. */
export const Material = React.memo(function Material({ kind, size }: { kind: MaterialKind; size: number }) {
  return <Art size={size}>{MATERIAL_ART[kind] ?? null}</Art>;
});
