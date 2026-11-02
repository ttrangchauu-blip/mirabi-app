import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { Art, blob, copies, INK, Lin, Rad, seeded, SW, Twinkle, url } from './kit';

// Vector art for Space Adventure (Tiếng Anh): a deep-space backdrop in three depths, the pet's rocket (the pet rides
// in its glass dome: the game draws the pet between `Rocket` and `RocketGlass`), its thruster flame, asteroids and their
// rubble, laser shots, and the little planets the pet saves (grey and asleep until rescued, then bright and smiling).
// Props are drawn in a 0 0 100 100 box unless noted.

// ---------------------------------------------------------------------------------------------------------------------
// Backdrop

export type SpaceLayerKind = 'sky' | 'far' | 'near';

function SkyLayer({ width: w, height: h }: { width: number; height: number }) {
  return (
    <Svg width={w} height={h}>
      <Defs>
        <Lin id="space-sky" stops={[[0, '#1A1A46'], [0.55, '#33296B'], [1, '#5B3F8C']]} />
        <Rad id="space-neb-a" stops={[[0, '#FF8FC8', 0.55], [1, '#FF8FC8', 0]]} />
        <Rad id="space-neb-b" stops={[[0, '#5FE0E6', 0.45], [1, '#5FE0E6', 0]]} />
        <Rad id="space-neb-c" stops={[[0, '#B48CFF', 0.5], [1, '#B48CFF', 0]]} />
        <Lin id="space-giant" stops={[[0, '#FFC48A'], [1, '#E57C6B']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('space-sky')} />
      <Ellipse cx={w * 0.22} cy={h * 0.3} rx={w * 0.34} ry={h * 0.3} fill={url('space-neb-a')} />
      <Ellipse cx={w * 0.72} cy={h * 0.68} rx={w * 0.4} ry={h * 0.32} fill={url('space-neb-b')} />
      <Ellipse cx={w * 0.55} cy={h * 0.15} rx={w * 0.3} ry={h * 0.22} fill={url('space-neb-c')} />
      {/* A big ringed planet far away in the corner. */}
      <G opacity={0.85}>
        <Circle cx={w * 0.93} cy={h * 0.14} r={h * 0.16} fill={url('space-giant')} />
        <Path d={`M${w * 0.93 - h * 0.16} ${h * 0.1} Q${w * 0.93} ${h * 0.06} ${w * 0.93 + h * 0.16} ${h * 0.1}`} stroke="#FFE1BE" strokeWidth={h * 0.025}
          fill="none" opacity={0.6} />
        <Ellipse cx={w * 0.93} cy={h * 0.16} rx={h * 0.3} ry={h * 0.045} stroke="#FFE7C9" strokeWidth={h * 0.018} fill="none" opacity={0.85} />
      </G>
    </Svg>
  );
}

/** Small stars and two distant planets: a strip two widths long whose halves match. */
function FarLayer({ width: w, height: h }: { width: number; height: number }) {
  const rnd = seeded(7);
  const stars = Array.from({ length: 34 }, () => ({ x: rnd() * w, y: rnd() * h * 0.92, r: 0.6 + rnd() * 1.1, o: 0.45 + rnd() * 0.5 }));
  return (
    <Svg width={w * 2} height={h}>
      <Defs>
        <Lin id="space-far-p1" stops={[[0, '#9FD8FF'], [1, '#5A8BE0']]} />
        <Lin id="space-far-p2" stops={[[0, '#C9F2B5'], [1, '#6DBF8F']]} />
      </Defs>
      {stars.map((s, i) => copies(w, s.x, s.r).map((o) => <Circle key={`${i}-${o}`} cx={s.x + o} cy={s.y} r={s.r} fill="#FFFFFF" opacity={s.o} />))}
      {copies(w, w * 0.3, h * 0.06).map((o) => (
        <G key={`p1-${o}`}>
          <Circle cx={w * 0.3 + o} cy={h * 0.62} r={h * 0.05} fill={url('space-far-p1')} opacity={0.9} />
          <Ellipse cx={w * 0.3 + o} cy={h * 0.62} rx={h * 0.09} ry={h * 0.016} stroke="#D7ECFF" strokeWidth={1.2} fill="none" opacity={0.7} />
        </G>
      ))}
      {copies(w, w * 0.78, h * 0.04).map((o) => <Circle key={`p2-${o}`} cx={w * 0.78 + o} cy={h * 0.36} r={h * 0.032} fill={url('space-far-p2')} opacity={0.85} />)}
    </Svg>
  );
}

/** Bright twinkles and a few small drifting rocks close by. */
function NearLayer({ width: w, height: h }: { width: number; height: number }) {
  const rnd = seeded(23);
  const twinkles = Array.from({ length: 9 }, () => ({ x: rnd() * w, y: rnd() * h * 0.9, r: 2.5 + rnd() * 3 }));
  const rocks = Array.from({ length: 5 }, (_, i) => ({ x: (i + 0.3 + rnd() * 0.4) * (w / 5), y: h * (0.12 + rnd() * 0.76), r: 3 + rnd() * 4, s: 11 + i }));
  return (
    <Svg width={w * 2} height={h}>
      {twinkles.map((s, i) => copies(w, s.x, s.r).map((o) => <Twinkle key={`t${i}-${o}`} x={s.x + o} y={s.y} r={s.r} color="#FFF6C9" opacity={0.9} />))}
      {rocks.map((k, i) => copies(w, k.x, k.r).map((o) => (
        <Path key={`r${i}-${o}`} d={blob(k.x + o, k.y, k.r, 7, 0.45, k.s)} fill="#7A6E86" stroke="#4E4560" strokeWidth={1} opacity={0.8} />
      )))}
    </Svg>
  );
}

export const SpaceLayer = React.memo(function SpaceLayer({ layer, width, height }: { layer: SpaceLayerKind; width: number; height: number }) {
  if (!width || !height) return null;
  if (layer === 'sky') return <SkyLayer width={width} height={height} />;
  if (layer === 'far') return <FarLayer width={width} height={height} />;
  return <NearLayer width={width} height={height} />;
});

// ---------------------------------------------------------------------------------------------------------------------
// The rocket

/** Where the pet sits in the rocket's dome, as fractions of the rocket's size (left, top, the pet's size). */
export const ROCKET_SEAT = { left: 0.3, top: 0.08, size: 0.46 } as const;
const DOME = { cx: 52, cy: 36, r: 23 };

/** The rocket's body, fins and the inside of its dome (drawn first; the pet goes over it, then `RocketGlass`). Faces right. */
export const Rocket = React.memo(function Rocket({ size, color = '#FF6F7D' }: { size: number; color?: string }) {
  const id = color.replace('#', '');
  return (
    <Art size={size}>
      <Defs>
        <Lin id={`rk-body-${id}`} stops={[[0, '#FFFFFF'], [0.55, '#E9E4FA'], [1, '#B9B0DA']]} />
        <Lin id={`rk-trim-${id}`} stops={[[0, color], [1, '#C2405A']]} />
        <Rad id="rk-dome-in" stops={[[0, '#E6F7FF'], [1, '#9ED4F2']]} cy="35%" />
      </Defs>
      {/* Fins, behind the body. */}
      <Path d="M30 60 L14 42 Q12 38 17 39 L44 58 Z" fill={url(`rk-trim-${id}`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M30 84 L14 98 Q12 101 17 100 L44 84 Z" fill={url(`rk-trim-${id}`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      {/* Body. */}
      <Path d="M20 60 Q50 52 78 58 Q96 65 98 72 Q96 79 78 86 Q50 92 20 84 Q13 72 20 60 Z" fill={url(`rk-body-${id}`)} stroke={INK} strokeWidth={SW}
        strokeLinejoin="round" />
      <Path d="M80 58.6 Q96 65 98 72 Q96 79 80 85.4 Q85 72 80 58.6 Z" fill={url(`rk-trim-${id}`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M24 66 Q50 60 72 64" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" fill="none" opacity={0.8} />
      <Rect x={20} y={70} width={58} height={5} rx={2.5} fill={url(`rk-trim-${id}`)} opacity={0.9} />
      <Circle cx={70} cy={78} r={3.2} fill="#7FD3F7" stroke={INK} strokeWidth={1.6} />
      {/* Exhaust ring. */}
      <Path d="M19 62 Q12 72 19 82 L14 80 Q9 72 14 64 Z" fill="#8A84A8" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {/* The dome's inside and its metal collar. */}
      <Circle cx={DOME.cx} cy={DOME.cy} r={DOME.r} fill={url('rk-dome-in')} />
      <Ellipse cx={DOME.cx} cy={58} rx={25} ry={4.5} fill="#CFC8EA" stroke={INK} strokeWidth={2} />
    </Art>
  );
});

/** The dome's glass and shine, drawn over the pet. */
export const RocketGlass = React.memo(function RocketGlass({ size }: { size: number }) {
  return (
    <Art size={size}>
      <Defs><Rad id="rk-glass" stops={[[0, '#FFFFFF', 0], [0.75, '#CFEFFF', 0.08], [1, '#9FD9FF', 0.35]]} /></Defs>
      <Path d={`M${DOME.cx - DOME.r} 56 A${DOME.r} ${DOME.r} 0 1 1 ${DOME.cx + DOME.r} 56`} fill={url('rk-glass')} stroke={INK} strokeWidth={SW} />
      <Path d="M38 28 Q42 18 52 16" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" fill="none" opacity={0.85} />
      <Circle cx={36} cy={35} r={1.8} fill="#FFFFFF" opacity={0.85} />
    </Art>
  );
});

/** The thruster's flame, pointing left (0 0 100 40). The game stretches it (scaleX) to flicker or boost. */
export const Thruster = React.memo(function Thruster({ size }: { size: number }) {
  return (
    <Art size={size} h={40}>
      <Defs>
        <Lin id="th-out" horizontal stops={[[0, '#FF6B3D', 0], [0.5, '#FF8A3D', 0.85], [1, '#FFB74A']]} />
        <Lin id="th-in" horizontal stops={[[0, '#FFE27A', 0], [0.6, '#FFF0A8'], [1, '#FFFFFF']]} />
      </Defs>
      <Path d="M100 6 Q60 4 4 20 Q60 36 100 34 Z" fill={url('th-out')} />
      <Path d="M100 12 Q70 12 34 20 Q70 28 100 28 Z" fill={url('th-in')} />
    </Art>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Asteroids and shots

export type AsteroidVariant = 0 | 1 | 2;
const ROCK = [
  { seed: 3, fill: ['#A8927E', '#6E5B4E'] },
  { seed: 9, fill: ['#9C9AB3', '#5F5C7A'] },
  { seed: 15, fill: ['#B48A73', '#7A5244'] },
] as const;

/** A lumpy space rock with craters. */
export const Asteroid = React.memo(function Asteroid({ size, variant = 0 }: { size: number; variant?: AsteroidVariant }) {
  const r = ROCK[variant];
  return (
    <Art size={size}>
      <Defs><Lin id={`ast-${variant}`} stops={[[0, r.fill[0]], [1, r.fill[1]]]} /></Defs>
      <Path d={blob(50, 52, 40, 9, 0.32, r.seed)} fill={url(`ast-${variant}`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d={blob(44, 42, 26, 7, 0.3, r.seed + 1)} fill="#FFFFFF" opacity={0.1} />
      <Ellipse cx={36} cy={44} rx={8} ry={6} fill="#000000" opacity={0.18} />
      <Ellipse cx={37} cy={45.5} rx={6} ry={4} fill={r.fill[1]} />
      <Ellipse cx={62} cy={62} rx={10} ry={7} fill="#000000" opacity={0.16} />
      <Ellipse cx={63} cy={63.5} rx={7.5} ry={5} fill={r.fill[1]} />
      <Circle cx={58} cy={34} r={4} fill="#000000" opacity={0.15} />
      <Circle cx={44} cy={70} r={3} fill="#000000" opacity={0.15} />
      <Path d="M26 36 Q32 26 44 22" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.5} />
    </Art>
  );
});

/** A piece of a broken asteroid. */
export const Rubble = React.memo(function Rubble({ size, variant = 0 }: { size: number; variant?: AsteroidVariant }) {
  const r = ROCK[variant];
  return (
    <Art size={size}>
      <Path d={blob(50, 50, 38, 5, 0.5, r.seed + 40)} fill={r.fill[0]} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
    </Art>
  );
});

/** A laser shot flying right (0 0 100 30). */
export const Laser = React.memo(function Laser({ size, color = '#7DF9FF' }: { size: number; color?: string }) {
  const id = color.replace('#', '');
  return (
    <Art size={size} h={30}>
      <Defs><Lin id={`lz-${id}`} horizontal stops={[[0, color, 0], [0.4, color, 0.9], [1, '#FFFFFF']]} /></Defs>
      <Rect x={0} y={5} width={100} height={20} rx={10} fill={color} opacity={0.25} />
      <Rect x={8} y={10} width={92} height={10} rx={5} fill={url(`lz-${id}`)} />
      <Circle cx={92} cy={15} r={6} fill="#FFFFFF" />
    </Art>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Planets to rescue

export type PlanetKind = 'ocean' | 'jungle' | 'candy' | 'ice';
export const PLANET_KINDS: PlanetKind[] = ['ocean', 'jungle', 'candy', 'ice'];
export const PLANET_NAME: Record<PlanetKind, string> = { ocean: 'Hành tinh Đại Dương', jungle: 'Hành tinh Rừng Xanh', candy: 'Hành tinh Kẹo Ngọt',
  ice: 'Hành tinh Băng Giá' };
const PLANET_COLORS: Record<PlanetKind, { base: [string, string]; detail: string; ring?: string }> = {
  ocean: { base: ['#6CC4FF', '#2F6FD1'], detail: '#7ED67A' },
  jungle: { base: ['#93DB6A', '#3E9B49'], detail: '#B07B45' },
  candy: { base: ['#FFC2DD', '#EE73AA'], detail: '#FFF4FA', ring: '#FFE08A' },
  ice: { base: ['#E2F8FF', '#7FC8EB'], detail: '#FFFFFF', ring: '#BFE6FF' },
};
const GREY = { base: ['#B9BCC8', '#7C7F8E'] as [string, string], detail: '#CDD0D9', ring: '#C9CCD6' };

/** A little planet with a face: asleep and grey until it is rescued, then bright, smiling and twinkling. */
export const Planet = React.memo(function Planet({ size, kind, rescued }: { size: number; kind: PlanetKind; rescued: boolean }) {
  const c = rescued ? PLANET_COLORS[kind] : { ...GREY, ring: PLANET_COLORS[kind].ring ? GREY.ring : undefined };
  const id = `pl-${kind}-${rescued ? 1 : 0}`;
  return (
    <Art size={size}>
      <Defs>
        <Lin id={id} stops={[[0, c.base[0]], [1, c.base[1]]]} />
        <Rad id={`${id}-glow`} stops={[[0.6, rescued ? '#FFF6B0' : '#FFFFFF', rescued ? 0.55 : 0], [1, '#FFF6B0', 0]]} />
      </Defs>
      {rescued ? <Circle cx={50} cy={50} r={49} fill={url(`${id}-glow`)} /> : null}
      {c.ring ? <Path d="M10 58 Q50 40 90 50" stroke={c.ring} strokeWidth={6} strokeLinecap="round" fill="none" opacity={0.9} /> : null}
      <Circle cx={50} cy={52} r={32} fill={url(id)} stroke={INK} strokeWidth={SW} />
      {/* Its land, bands or ice caps. */}
      {kind === 'ocean' || kind === 'jungle' ? (
        <>
          <Path d={blob(38, 38, 9, 6, 0.5, kind === 'ocean' ? 31 : 32)} fill={c.detail} opacity={0.95} />
          <Path d={blob(66, 64, 7, 6, 0.5, kind === 'ocean' ? 33 : 34)} fill={c.detail} opacity={0.95} />
        </>
      ) : kind === 'candy' ? (
        <>
          <Path d="M20 44 Q50 36 80 44" stroke={c.detail} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.85} />
          <Path d="M20 64 Q50 72 80 64" stroke={c.detail} strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.85} />
        </>
      ) : (
        <>
          <Path d="M32 26 Q50 18 68 26 Q60 32 50 30 Q40 32 32 26 Z" fill={c.detail} />
          <Path d="M34 78 Q50 86 66 78 Q58 74 50 76 Q42 74 34 78 Z" fill={c.detail} />
        </>
      )}
      {c.ring ? <Path d="M14 62 Q50 76 86 56" stroke={c.ring} strokeWidth={6} strokeLinecap="round" fill="none" /> : null}
      {/* The face. */}
      {rescued ? (
        <>
          <Ellipse cx={40} cy={50} rx={3.6} ry={4.6} fill={INK} />
          <Ellipse cx={60} cy={50} rx={3.6} ry={4.6} fill={INK} />
          <Circle cx={41.2} cy={48.4} r={1.3} fill="#FFFFFF" />
          <Circle cx={61.2} cy={48.4} r={1.3} fill="#FFFFFF" />
          <Path d="M44 58 Q50 64 56 58" stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Ellipse cx={33} cy={58} rx={4.5} ry={2.6} fill="#FF8FA8" opacity={0.6} />
          <Ellipse cx={67} cy={58} rx={4.5} ry={2.6} fill="#FF8FA8" opacity={0.6} />
          <Twinkle x={84} y={22} r={6} color="#FFF4A8" />
          <Twinkle x={16} y={30} r={4} color="#FFFFFF" />
        </>
      ) : (
        <>
          <Path d="M36 51 Q40 54 44 51" stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Path d="M56 51 Q60 54 64 51" stroke={INK} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          <Path d="M46 61 L54 61" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          <Path d="M70 30 L76 30 L70 36 L76 36" stroke="#9AA0B8" strokeWidth={1.8} strokeLinejoin="round" fill="none" />
        </>
      )}
    </Art>
  );
});
