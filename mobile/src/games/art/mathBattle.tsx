import React from 'react';
import { ARENA_ART, Strip } from './rendered';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/* Vector art for the math battle: six monsters (all facing left, towards the pet), four parallax arenas and a few
 * spell effects. Everything is deterministic and hook-free, so the shapes never change between renders. Gradient
 * ids are fixed per component (plus the colour, for effects that take one): identical copies share identical defs,
 * which is harmless even where svg ids are global (web). */

const r1 = (n: number) => Math.round(n * 10) / 10;
const k3 = (n: number) => Math.round(n * 1000) / 1000;
const url = (id: string) => `url(#${id})`;
const tag = (color: string) => color.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();

/** A four-point twinkle around (cx, cy). */
function star4(cx: number, cy: number, r: number) {
  const q = r * 0.2;
  return `M${r1(cx)} ${r1(cy - r)} Q${r1(cx + q)} ${r1(cy - q)} ${r1(cx + r)} ${r1(cy)} Q${r1(cx + q)} ${r1(cy + q)} ${r1(cx)} ${r1(cy + r)}`
    + ` Q${r1(cx - q)} ${r1(cy + q)} ${r1(cx - r)} ${r1(cy)} Q${r1(cx - q)} ${r1(cy - q)} ${r1(cx)} ${r1(cy - r)} Z`;
}

/** A star (or, with outer = inner, a regular polygon) of `points` tips; ry squashes it onto the floor. */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number, rot = -90, squash = 1) {
  let d = '';
  const step = outer === inner ? 360 / points : 180 / points;
  const count = outer === inner ? points : points * 2;
  for (let i = 0; i < count; i++) {
    const r = outer === inner || i % 2 === 0 ? outer : inner;
    const a = ((rot + i * step) * Math.PI) / 180;
    d += `${i ? ' L' : 'M'}${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a) * squash)}`;
  }
  return `${d} Z`;
}

// ---------------------------------------------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------------------------------------------

export type MonsterMood = 'idle' | 'attack' | 'hurt' | 'defeated';
export type MonsterProps = { size: number; mood?: MonsterMood };
export type MonsterId = 'slime' | 'mushroom' | 'golem' | 'shadow' | 'drake' | 'boss';

type Pt = readonly [number, number];
type FaceSpec = {
  eyes: readonly [Pt, Pt];
  eyeR: number;
  iris: string;
  ink: string;
  mouth: Pt;
  mouthW: number;
  sweat: Pt;
  cheeks?: readonly Pt[];
  cheek?: string;
  white?: string;
  glow?: string;
  fang?: boolean;
};

/** Leans the body by mood, pivoting on the feet: forward (left) to attack, back when hurt, slumped when beaten. */
function pose(mood: MonsterMood, lean = 6): string | undefined {
  switch (mood) {
    case 'attack': return `rotate(${-lean} 60 114)`;
    case 'hurt': return `rotate(${lean} 60 114) translate(3 0)`;
    case 'defeated': return 'rotate(5 60 114) translate(0 13.7) scale(1 0.88)';
    default: return undefined;
  }
}

function GroundShadow({ rx, opacity = 0.18, cx = 60 }: { rx: number; opacity?: number; cx?: number }) {
  return <Ellipse cx={cx} cy={114} rx={rx} ry={5} fill="#1E1633" opacity={opacity} />;
}

/** One eye. `inner` points towards the nose (+1 for the left eye, -1 for the right one). */
function Eye({ x, y, r, inner, mood, spec }: { x: number; y: number; r: number; inner: 1 | -1; mood: MonsterMood; spec: FaceSpec }) {
  const { ink } = spec;
  if (mood === 'hurt') {
    // Squeezed shut: > on the left eye, < on the right, both pointing at the nose.
    const d = inner * r * 0.75;
    return <Path d={`M${r1(x - d)} ${r1(y - r * 0.65)} L${r1(x + d)} ${y} L${r1(x - d)} ${r1(y + r * 0.65)}`}
      stroke={ink} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (mood === 'defeated') {
    const k = r / 5;
    return <G>
      <Circle cx={x} cy={y} r={r} fill={spec.white ?? '#FFFFFF'} stroke={ink} strokeWidth={2} />
      <Path d={`M${x} ${y} a${k3(k)} ${k3(k)} 0 0 1 ${k3(2 * k)} 0 a${k3(2 * k)} ${k3(2 * k)} 0 0 1 ${k3(-4 * k)} 0`
        + ` a${k3(3 * k)} ${k3(3 * k)} 0 0 1 ${k3(6 * k)} 0 a${k3(4 * k)} ${k3(4 * k)} 0 0 1 ${k3(-8 * k)} 0`}
        stroke={ink} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </G>;
  }
  const look = -r * 0.24;  // everyone looks left, at the pet
  const ir = r * (mood === 'attack' ? 0.6 : 0.68);
  const ix = x + look;
  const iy = y + r * 0.1;
  return <G>
    {spec.glow ? <Circle cx={x} cy={y} r={r * 1.7} fill={spec.glow} opacity={0.3} /> : null}
    <Ellipse cx={x} cy={y} rx={r} ry={r * 1.1} fill={spec.white ?? '#FFFFFF'} stroke={ink} strokeWidth={2.2} />
    <Circle cx={ix} cy={iy} r={ir} fill={spec.iris} />
    <Circle cx={ix} cy={iy} r={ir * 0.55} fill="#1B1430" />
    <Circle cx={ix - ir * 0.35} cy={iy - ir * 0.35} r={ir * 0.36} fill="#FFFFFF" />
    <Circle cx={ix + ir * 0.42} cy={iy + ir * 0.42} r={ir * 0.16} fill="#FFFFFF" />
    {mood === 'attack'
      ? <Path d={`M${r1(x - inner * r * 1.15)} ${r1(y - r * 1.6)} L${r1(x + inner * r * 1.05)} ${r1(y - r * 0.95)}`}
        stroke={ink} strokeWidth={3.2} strokeLinecap="round" />
      : null}
  </G>;
}

function Mouth({ mood, spec }: { mood: MonsterMood; spec: FaceSpec }) {
  const [x, y] = spec.mouth;
  const w = spec.mouthW;
  const { ink } = spec;
  switch (mood) {
    case 'attack':
      return <G>
        <Path d={`M${r1(x - w)} ${r1(y - w * 0.3)} Q${x} ${r1(y - w * 0.6)} ${r1(x + w)} ${r1(y - w * 0.3)}`
          + ` Q${r1(x + w * 0.85)} ${r1(y + w * 0.95)} ${x} ${r1(y + w)} Q${r1(x - w * 0.85)} ${r1(y + w * 0.95)} ${r1(x - w)} ${r1(y - w * 0.3)} Z`}
          fill="#5A1E3A" stroke={ink} strokeWidth={2.2} strokeLinejoin="round" />
        <Ellipse cx={x} cy={y + w * 0.58} rx={w * 0.5} ry={w * 0.26} fill="#FF7A9A" />
        {spec.fang !== false
          ? <Path d={`M${r1(x - w * 0.62)} ${r1(y - w * 0.36)} l${r1(w * 0.24)} ${r1(w * 0.42)} l${r1(w * 0.24)} ${r1(-w * 0.46)} Z`} fill="#FFFFFF" />
          : null}
      </G>;
    case 'hurt':
      return <Path d={`M${r1(x - w * 0.8)} ${y} Q${r1(x - w * 0.4)} ${r1(y - w * 0.4)} ${x} ${y} Q${r1(x + w * 0.4)} ${r1(y + w * 0.4)} ${r1(x + w * 0.8)} ${y}`}
        stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
    case 'defeated':
      return <G>
        <Path d={`M${r1(x - w * 0.7)} ${r1(y + w * 0.25)} Q${x} ${r1(y - w * 0.35)} ${r1(x + w * 0.7)} ${r1(y + w * 0.25)}`}
          stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <Ellipse cx={x + w * 0.25} cy={y + w * 0.32} rx={w * 0.22} ry={w * 0.3} fill="#FF8FA8" stroke={ink} strokeWidth={1.4} />
      </G>;
    default:
      return <G>
        <Path d={`M${r1(x - w * 0.7)} ${y} Q${x} ${r1(y + w * 0.7)} ${r1(x + w * 0.7)} ${y}`}
          stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        {spec.fang !== false
          ? <Path d={`M${r1(x - w * 0.42)} ${r1(y + w * 0.2)} l${r1(w * 0.16)} ${r1(w * 0.34)} l${r1(w * 0.18)} ${r1(-w * 0.26)} Z`} fill="#FFFFFF" stroke={ink} strokeWidth={1} strokeLinejoin="round" />
          : null}
      </G>;
  }
}

function Sweat({ x, y }: { x: number; y: number }) {
  return <G>
    <Path d={`M${x} ${y} C${x + 4} ${y + 6} ${x + 5} ${y + 9} ${x + 5} ${y + 11} A5 5 0 0 1 ${x - 5} ${y + 11} C${x - 5} ${y + 9} ${x - 4} ${y + 6} ${x} ${y} Z`}
      fill="#BFE9FF" stroke="#4A90C2" strokeWidth={1.6} strokeLinejoin="round" />
    <Ellipse cx={x - 1.6} cy={y + 10} rx={1.2} ry={2} fill="#FFFFFF" />
  </G>;
}

function Face({ mood, spec }: { mood: MonsterMood; spec: FaceSpec }) {
  return <G>
    {spec.cheeks?.map(([x, y]) =>
      <Ellipse key={`${x},${y}`} cx={x} cy={y} rx={spec.eyeR * 0.62} ry={spec.eyeR * 0.36} fill={spec.cheek ?? '#FF8FB1'} opacity={0.5} />)}
    <Eye x={spec.eyes[0][0]} y={spec.eyes[0][1]} r={spec.eyeR} inner={1} mood={mood} spec={spec} />
    <Eye x={spec.eyes[1][0]} y={spec.eyes[1][1]} r={spec.eyeR} inner={-1} mood={mood} spec={spec} />
    <Mouth mood={mood} spec={spec} />
    {mood === 'hurt' ? <Sweat x={spec.sweat[0]} y={spec.sweat[1]} /> : null}
  </G>;
}

const SLIME_FACE: FaceSpec = {
  eyes: [[44, 76], [67, 76]], eyeR: 8.5, iris: '#3C8F5A', ink: '#2E7044', mouth: [55, 93], mouthW: 7, sweat: [86, 52],
  cheeks: [[35, 89], [77, 89]],
};

/** A round green jelly with a curl on top, bubbles inside and a wet shine. */
export const Slime = React.memo(function Slime({ size, mood = 'idle' }: MonsterProps) {
  const ink = SLIME_FACE.ink;
  const body = url('mb-slime-body');
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <RadialGradient id="mb-slime-body" cx="40%" cy="35%" r="70%">
        <Stop offset="0" stopColor="#DAFFC8" />
        <Stop offset="0.55" stopColor="#82DC7C" />
        <Stop offset="1" stopColor="#43B05E" />
      </RadialGradient>
    </Defs>
    <GroundShadow rx={42} />
    <G transform={pose(mood)}>
      {mood === 'attack'
        ? <Path d="M32 90 C20 86 10 74 14 64 C18 58 26 62 28 70 C30 78 34 82 38 84 Z" fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
        : null}
      <Path d="M20 106 C16 80 32 50 56 46 C57 38 66 33 71 38 C67 40 67 44 70 47 C92 54 104 80 100 106 C99 112 95 114 88 114 L32 114 C25 114 21 112 20 106 Z"
        fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      <Path d="M28 108 Q60 114 92 108" stroke="#3A9A52" strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.5} />
      <Circle cx={82} cy={96} r={3.2} fill="#FFFFFF" opacity={0.4} />
      <Circle cx={88} cy={84} r={2} fill="#FFFFFF" opacity={0.4} />
      <Circle cx={74} cy={104} r={2.2} fill="#FFFFFF" opacity={0.35} />
      <Ellipse cx={33} cy={72} rx={5} ry={10} fill="#FFFFFF" opacity={0.75} transform="rotate(28 33 72)" />
      <Circle cx={41} cy={58} r={2.6} fill="#FFFFFF" opacity={0.85} />
      <Face mood={mood} spec={SLIME_FACE} />
    </G>
  </Svg>;
});

const MUSHROOM_FACE: FaceSpec = {
  eyes: [[48, 86], [66, 86]], eyeR: 6.5, iris: '#7A45B8', ink: '#5B2D7A', mouth: [57, 99], mouthW: 5, sweat: [92, 74],
  cheeks: [[40, 96], [73, 96]],
};
const MUSHROOM_SPOTS: readonly (readonly [number, number, number])[] = [[38, 36, 7], [64, 26, 6], [88, 42, 7.5], [24, 56, 4], [58, 50, 5], [98, 58, 3.5]];

/** A walking magic mushroom: a purple cap with glowing spots, a face on its stem and two stubby feet. */
export const Mushroom = React.memo(function Mushroom({ size, mood = 'idle' }: MonsterProps) {
  const ink = MUSHROOM_FACE.ink;
  const stem = url('mb-mushroom-stem');
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <RadialGradient id="mb-mushroom-cap" cx="40%" cy="30%" r="75%">
        <Stop offset="0" stopColor="#E8C0FF" />
        <Stop offset="0.5" stopColor="#A968E2" />
        <Stop offset="1" stopColor="#6E35A8" />
      </RadialGradient>
      <LinearGradient id="mb-mushroom-stem" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFF8EA" />
        <Stop offset="1" stopColor="#F0D5B2" />
      </LinearGradient>
      <RadialGradient id="mb-mushroom-glow" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#9CF6FF" stopOpacity={0.9} />
        <Stop offset="1" stopColor="#9CF6FF" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <GroundShadow rx={36} />
    <G transform={pose(mood)}>
      <Ellipse cx={46} cy={109.5} rx={9} ry={4.5} fill="#E2C29A" stroke={ink} strokeWidth={2.5} />
      <Ellipse cx={74} cy={109.5} rx={9} ry={4.5} fill="#E2C29A" stroke={ink} strokeWidth={2.5} />
      <Ellipse cx={89} cy={92} rx={5} ry={7} fill={stem} stroke={ink} strokeWidth={2.5} transform="rotate(-30 89 92)" />
      <Path d="M38 68 C34 84 34 100 40 107 Q60 112 80 107 C86 100 86 84 82 68 Z" fill={stem} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      {mood === 'attack'
        ? <G>
          <Ellipse cx={28} cy={76} rx={5} ry={8} fill={stem} stroke={ink} strokeWidth={2.5} transform="rotate(-50 28 76)" />
          <Path d={star4(18, 66, 6)} fill="#FFF3A0" stroke="#E0A93A" strokeWidth={1} />
        </G>
        : <Ellipse cx={33} cy={92} rx={5} ry={7} fill={stem} stroke={ink} strokeWidth={2.5} transform="rotate(30 33 92)" />}
      <Ellipse cx={60} cy={70} rx={40} ry={5} fill="#8A55B8" stroke={ink} strokeWidth={2} />
      <Path d="M12 62 C10 34 34 14 60 14 C86 14 110 34 108 62 C108 70 96 72 60 72 C24 72 12 70 12 62 Z"
        fill={url('mb-mushroom-cap')} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
      {MUSHROOM_SPOTS.map(([x, y, r]) => <G key={`${x}`}>
        <Circle cx={x} cy={y} r={r * 1.9} fill={url('mb-mushroom-glow')} />
        <Circle cx={x} cy={y} r={r} fill="#F2FDFF" />
      </G>)}
      <Path d="M22 48 Q28 28 50 20" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.45} />
      <Face mood={mood} spec={MUSHROOM_FACE} />
    </G>
  </Svg>;
});

const GOLEM_FACE: FaceSpec = {
  eyes: [[49, 32], [66, 32]], eyeR: 6, iris: '#2BA5C9', ink: '#4A3F36', mouth: [57, 43], mouthW: 4.5, sweat: [86, 18],
  cheeks: [[42, 41], [73, 41]], cheek: '#E8A08A',
};

/** A friendly stone golem: grey-brown blocks, moss on top, a glowing crystal in its chest. */
export const Golem = React.memo(function Golem({ size, mood = 'idle' }: MonsterProps) {
  const ink = GOLEM_FACE.ink;
  const stone = url('mb-golem-stone');
  const dark = url('mb-golem-dark');
  const moss = { fill: '#7DBE5E', stroke: '#3F7A35', strokeWidth: 2, strokeLinejoin: 'round' as const };
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <LinearGradient id="mb-golem-stone" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#D2C5B2" />
        <Stop offset="1" stopColor="#8F8172" />
      </LinearGradient>
      <LinearGradient id="mb-golem-dark" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#ACA08E" />
        <Stop offset="1" stopColor="#6E6257" />
      </LinearGradient>
      <LinearGradient id="mb-golem-crystal" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#E6FFFF" />
        <Stop offset="0.5" stopColor="#5FE3E8" />
        <Stop offset="1" stopColor="#2BA5C9" />
      </LinearGradient>
      <RadialGradient id="mb-golem-glow" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#8FF7FF" stopOpacity={0.9} />
        <Stop offset="1" stopColor="#8FF7FF" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <GroundShadow rx={44} />
    <G transform={pose(mood, 4)}>
      <Rect x={84} y={52} width={18} height={34} rx={8} fill={dark} stroke={ink} strokeWidth={2.5} />
      <Rect x={38} y={92} width={20} height={22} rx={6} fill={dark} stroke={ink} strokeWidth={2.5} />
      <Rect x={64} y={92} width={20} height={22} rx={6} fill={dark} stroke={ink} strokeWidth={2.5} />
      <Rect x={30} y={44} width={62} height={54} rx={14} fill={stone} stroke={ink} strokeWidth={2.5} />
      <Path d="M82 52 l-5 7 l4 5 M38 84 l6 -3 l2 5" stroke={ink} strokeWidth={1.6} fill="none" opacity={0.45} strokeLinecap="round" />
      <Circle cx={60} cy={72} r={18} fill={url('mb-golem-glow')} />
      <Path d="M60 58 L70 71 L60 86 L50 71 Z" fill={url('mb-golem-crystal')} stroke="#1F6F8A" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M50 71 L70 71 M60 58 L60 86" stroke="#FFFFFF" strokeWidth={1.2} opacity={0.55} />
      <Rect x={36} y={14} width={46} height={36} rx={12} fill={stone} stroke={ink} strokeWidth={2.5} />
      <Path d="M38 24 C38 16 46 12 56 12 C68 12 80 14 80 22 C76 24 74 20 70 23 C66 26 62 21 58 24 C54 27 50 22 46 25 C42 28 40 24 38 24 Z" {...moss} />
      <Path d="M30 58 C30 49 36 44 44 44 C51 44 53 48 50 51 C46 53 46 57 42 56 C38 59 34 55 30 58 Z" {...moss} />
      <Circle cx={50} cy={13} r={2.2} fill="#FF9EC4" />
      <Circle cx={66} cy={14} r={1.8} fill="#FFF1A0" />
      <G transform={mood === 'attack' ? 'rotate(150 31 56)' : undefined}>
        <Rect x={22} y={52} width={18} height={34} rx={8} fill={stone} stroke={ink} strokeWidth={2.5} />
        <Path d="M25 80 L37 80" stroke={ink} strokeWidth={1.6} opacity={0.5} strokeLinecap="round" />
      </G>
      <Face mood={mood} spec={GOLEM_FACE} />
    </G>
  </Svg>;
});

const SHADOW_FACE: FaceSpec = {
  eyes: [[44, 50], [64, 50]], eyeR: 8, iris: '#3FD8F0', ink: '#231B4A', mouth: [54, 68], mouthW: 5, sweat: [82, 26],
  cheeks: [[35, 62], [73, 62]], cheek: '#B07CFF', white: '#F0FDFF', glow: '#7FF6FF', fang: false,
};

/** A floating dark-indigo spirit with glowing eyes and a wispy tail curling away behind it. */
export const ShadowSpirit = React.memo(function ShadowSpirit({ size, mood = 'idle' }: MonsterProps) {
  const ink = SHADOW_FACE.ink;
  const body = url('mb-shadow-body');
  const lift = mood === 'defeated' ? 'translate(0 8)' : 'translate(0 -4)';
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <LinearGradient id="mb-shadow-body" x1="0" y1="0" x2="0.4" y2="1">
        <Stop offset="0" stopColor="#8E7FE8" />
        <Stop offset="0.55" stopColor="#4B3A9E" />
        <Stop offset="1" stopColor="#2A1F5E" stopOpacity={0.8} />
      </LinearGradient>
      <RadialGradient id="mb-shadow-aura" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#A99BFF" stopOpacity={0.45} />
        <Stop offset="1" stopColor="#A99BFF" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <GroundShadow rx={mood === 'defeated' ? 32 : 24} opacity={0.14} />
    <G transform={lift}>
      <G transform={pose(mood, 7)}>
        <Ellipse cx={62} cy={58} rx={52} ry={48} fill={url('mb-shadow-aura')} />
        <Path d="M90 62 C100 60 106 66 104 74 C100 70 96 70 92 72 Z" fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
        <Path d="M26 58 C26 32 44 16 62 16 C84 16 96 32 94 54 C93 68 96 78 104 84 C112 90 108 100 98 98 C90 96 84 102 74 100 C62 98 56 92 48 88 C34 82 26 72 26 58 Z"
          fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
        <Path d="M100 97 C110 101 116 93 112 86" stroke="#7B6BDA" strokeWidth={3} fill="none" strokeLinecap="round" />
        <Path d="M36 54 C36 38 48 26 62 26" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.35} />
        {mood === 'attack'
          ? <G>
            <Path d="M30 62 C18 56 10 46 14 38 C18 44 24 50 34 54 Z" fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />
            <Path d={star4(10, 32, 6)} fill="#BFF8FF" />
            <Circle cx={20} cy={28} r={2} fill="#BFF8FF" />
          </G>
          : <Path d="M32 70 C22 72 18 80 22 88 C24 82 28 79 35 78 Z" fill={body} stroke={ink} strokeWidth={2.5} strokeLinejoin="round" />}
        <Circle cx={16} cy={24} r={2} fill="#C9C1FF" />
        <Circle cx={104} cy={30} r={1.6} fill="#C9C1FF" />
        <Circle cx={112} cy={64} r={1.4} fill="#C9C1FF" />
        <Face mood={mood} spec={SHADOW_FACE} />
      </G>
    </G>
  </Svg>;
});

const DRAKE_FACE: FaceSpec = {
  eyes: [[42, 38], [60, 37]], eyeR: 7, iris: '#E2532E', ink: '#8A2D1B', mouth: [31, 56], mouthW: 6, sweat: [88, 30],
  cheeks: [[62, 52]],
};

/** A little orange-red dragon: big head, cream horns, tiny wings and a spade-tipped tail. */
export const Drake = React.memo(function Drake({ size, mood = 'idle' }: MonsterProps) {
  const ink = DRAKE_FACE.ink;
  const skin = url('mb-drake-skin');
  const line = { stroke: ink, strokeWidth: 2.5, strokeLinejoin: 'round' as const };
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <RadialGradient id="mb-drake-skin" cx="35%" cy="30%" r="75%">
        <Stop offset="0" stopColor="#FFC98A" />
        <Stop offset="0.5" stopColor="#FF8A4C" />
        <Stop offset="1" stopColor="#E2532E" />
      </RadialGradient>
      <LinearGradient id="mb-drake-wing" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFA582" />
        <Stop offset="1" stopColor="#C8442E" />
      </LinearGradient>
    </Defs>
    <GroundShadow rx={40} />
    <G transform={pose(mood)}>
      <Path d="M84 92 C96 96 104 92 106 80 L112 82 C112 98 100 108 82 106 Z" fill={skin} {...line} />
      <Path d="M103 82 L108 66 L116 80 Q110 78 103 82 Z" fill="#FFB25C" {...line} />
      <G transform={mood === 'attack' ? 'rotate(-18 80 70)' : mood === 'defeated' ? 'rotate(14 80 70)' : undefined}>
        <Path d="M76 70 C78 52 92 40 108 42 C103 48 105 52 100 56 C106 58 104 64 97 65 C99 70 92 74 84 74 Z" fill={url('mb-drake-wing')} {...line} />
        <Path d="M84 70 L100 48 M88 72 L101 60" stroke={ink} strokeWidth={1.4} opacity={0.5} strokeLinecap="round" />
      </G>
      <Ellipse cx={74} cy={109.5} rx={9} ry={4.5} fill={skin} {...line} />
      <Path d="M40 104 C34 88 40 70 56 66 C72 62 88 72 90 88 C92 102 86 112 74 112 L50 112 C44 112 41 108 40 104 Z" fill={skin} {...line} />
      <Path d="M78 67 L87 61 L86 72 Z M87 78 L96 74 L92 85 Z" fill="#FFD27A" {...line} strokeWidth={2} />
      <Ellipse cx={58} cy={92} rx={13} ry={15} fill="#FFE9B0" />
      <Path d="M48 86 Q58 89 68 86 M47 95 Q58 98 69 95" stroke="#E9B864" strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Ellipse cx={50} cy={109.5} rx={9} ry={4.5} fill={skin} {...line} />
      {mood === 'attack'
        ? <G>
          <Ellipse cx={36} cy={72} rx={5} ry={8} fill={skin} {...line} transform="rotate(-45 36 72)" />
          <Path d="M28 64 l-3 -3 M31 62 l-1 -4 M33 63 l1 -4" stroke={ink} strokeWidth={1.8} strokeLinecap="round" />
        </G>
        : <Ellipse cx={44} cy={88} rx={5} ry={7} fill={skin} {...line} transform="rotate(25 44 88)" />}
      <Path d="M60 20 C62 10 68 6 74 4 C70 10 70 16 68 22 Z" fill="#FFF4D6" {...line} strokeWidth={2.2} />
      <Path d="M72 27 C78 19 86 16 92 16 C86 22 84 26 80 33 Z" fill="#FFF4D6" {...line} strokeWidth={2.2} />
      <Path d="M18 52 C14 44 20 36 30 36 C32 24 44 16 56 16 C72 16 84 28 82 44 C80 58 68 66 54 66 L32 66 C22 66 18 60 18 52 Z" fill={skin} {...line} />
      <Ellipse cx={48} cy={24} rx={8} ry={3.5} fill="#FFFFFF" opacity={0.4} transform="rotate(-15 48 24)" />
      <Circle cx={21} cy={47} r={1.5} fill={ink} />
      <Circle cx={26} cy={46} r={1.5} fill={ink} />
      <Face mood={mood} spec={DRAKE_FACE} />
    </G>
  </Svg>;
});

const BOSS_FACE: FaceSpec = {
  eyes: [[49, 38], [65, 38]], eyeR: 6.5, iris: '#C04AFF', ink: '#2E1A4F', mouth: [56, 50], mouthW: 4.5, sweat: [84, 26],
  cheeks: [[42, 47], [71, 47]], cheek: '#E28BFF',
};

/** The boss: a crowned crystal king with a royal cape, crystal shoulders, a glowing chest gem and an aura. */
export const CrystalKing = React.memo(function CrystalKing({ size, mood = 'idle' }: MonsterProps) {
  const ink = BOSS_FACE.ink;
  const body = url('mb-boss-body');
  const line = { stroke: ink, strokeWidth: 2.5, strokeLinejoin: 'round' as const };
  const fist: Pt = mood === 'attack' ? [18, 42] : mood === 'defeated' ? [22, 96] : [18, 86];
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <LinearGradient id="mb-boss-cape" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#A63A82" />
        <Stop offset="1" stopColor="#4A1446" />
      </LinearGradient>
      <RadialGradient id="mb-boss-body" cx="40%" cy="30%" r="80%">
        <Stop offset="0" stopColor="#D8BEFF" />
        <Stop offset="0.5" stopColor="#9563E4" />
        <Stop offset="1" stopColor="#5A2FA8" />
      </RadialGradient>
      <LinearGradient id="mb-boss-teal" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#D6FFF8" />
        <Stop offset="0.5" stopColor="#4FE0D0" />
        <Stop offset="1" stopColor="#1E9E9E" />
      </LinearGradient>
      <LinearGradient id="mb-boss-violet" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#F0D6FF" />
        <Stop offset="0.5" stopColor="#B07CFF" />
        <Stop offset="1" stopColor="#6B3FC4" />
      </LinearGradient>
      <LinearGradient id="mb-boss-gold" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFF3A6" />
        <Stop offset="0.6" stopColor="#FFC93C" />
        <Stop offset="1" stopColor="#D9922A" />
      </LinearGradient>
      <RadialGradient id="mb-boss-aura" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#C59BFF" stopOpacity={0.5} />
        <Stop offset="1" stopColor="#C59BFF" stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id="mb-boss-gem" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#7FFFF0" stopOpacity={0.9} />
        <Stop offset="1" stopColor="#7FFFF0" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Ellipse cx={60} cy={60} rx={60} ry={58} fill={url('mb-boss-aura')} opacity={mood === 'defeated' ? 0.4 : 1} />
    <GroundShadow rx={54} opacity={0.25} />
    <G transform={pose(mood, 3)}>
      <Path d="M30 40 C20 60 10 90 4 114 L116 114 C110 90 100 60 90 40 Z" fill={url('mb-boss-cape')} {...line} />
      <Path d="M18 104 Q22 82 31 64 M102 104 Q98 82 89 64 M60 112 L60 104" stroke="#2E0F2E" strokeWidth={2} opacity={0.4} fill="none" strokeLinecap="round" />
      <Path d="M30 40 L20 26 L42 36 Z M90 40 L100 26 L78 36 Z" fill="#C04A92" {...line} strokeWidth={2} />
      <Circle cx={99} cy={84} r={11} fill={body} {...line} />
      <Path d="M100 74 L106 62 L108 76 Z" fill={url('mb-boss-teal')} {...line} strokeWidth={1.8} />
      <Rect x={40} y={100} width={16} height={14} rx={5} fill="#5A2FA8" {...line} />
      <Rect x={64} y={100} width={16} height={14} rx={5} fill="#5A2FA8" {...line} />
      <Path d="M32 54 Q32 44 44 44 L76 44 Q88 44 88 54 L92 92 Q92 104 80 104 L40 104 Q28 104 28 92 Z" fill={body} {...line} />
      <Path d="M44 44 L52 70 L40 104 M76 44 L68 70 L80 104 M52 70 L68 70" stroke="#E7D6FF" strokeWidth={1.4} opacity={0.45} fill="none" />
      <Rect x={29} y={84} width={62} height={7} rx={3} fill={url('mb-boss-gold')} stroke={ink} strokeWidth={2} />
      <Circle cx={60} cy={69} r={19} fill={url('mb-boss-gem')} opacity={mood === 'defeated' ? 0.3 : 1} />
      <Path d="M60 56 L71 67 L60 82 L49 67 Z" fill={url('mb-boss-teal')} stroke="#0F5E66" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M54 65 L60 59 L64 63" stroke="#FFFFFF" strokeWidth={1.6} fill="none" opacity={0.85} strokeLinecap="round" />
      <Path d="M76 50 L82 24 L87 46 L95 28 L99 54 Z" fill={url('mb-boss-teal')} {...line} strokeWidth={2.2} />
      <Path d="M98 56 L106 40 L105 60 Z" fill={url('mb-boss-violet')} {...line} strokeWidth={2} />
      <Ellipse cx={90} cy={54} rx={12} ry={8} fill={body} {...line} />
      <Path d={`M30 58 L${fist[0]} ${fist[1]}`} stroke={ink} strokeWidth={16} strokeLinecap="round" />
      <Path d={`M30 58 L${fist[0]} ${fist[1]}`} stroke="#8A5BDC" strokeWidth={11} strokeLinecap="round" />
      <Path d="M21 52 L24 26 L33 46 L38 24 L44 50 Z" fill={url('mb-boss-violet')} {...line} strokeWidth={2.2} />
      <Path d="M18 58 L13 42 L26 52 Z" fill={url('mb-boss-teal')} {...line} strokeWidth={2} />
      <Ellipse cx={30} cy={54} rx={12} ry={8} fill={body} {...line} />
      {mood === 'attack' ? <Circle cx={fist[0]} cy={fist[1]} r={18} fill={url('mb-boss-gem')} /> : null}
      <Circle cx={fist[0]} cy={fist[1]} r={11} fill={body} {...line} />
      <Path d={`M${fist[0] - 6} ${fist[1] - 8} L${fist[0] - 9} ${fist[1] - 18} L${fist[0]} ${fist[1] - 10} Z`} fill={url('mb-boss-teal')} {...line} strokeWidth={1.8} />
      <Path d="M38 30 Q38 20 48 20 L66 20 Q76 20 76 30 L77 46 Q76 58 64 58 L50 58 Q38 58 37 46 Z" fill={body} {...line} />
      <G transform={mood === 'defeated' ? 'translate(6 3) rotate(16 57 20)' : undefined}>
        <Path d="M38 22 L36 6 L46 14 L57 2 L68 14 L78 6 L76 22 Z" fill={url('mb-boss-gold')} {...line} strokeWidth={2.2} />
        <Rect x={37} y={18} width={40} height={6} rx={2} fill="#E8A93A" stroke={ink} strokeWidth={1.8} />
        <Circle cx={57} cy={11} r={3} fill="#4FE0D0" stroke={ink} strokeWidth={1.2} />
        <Circle cx={47} cy={21} r={1.8} fill="#FF6FA8" />
        <Circle cx={67} cy={21} r={1.8} fill="#FF6FA8" />
        <Circle cx={36} cy={6} r={2} fill="#FFF3A6" stroke={ink} strokeWidth={1.2} />
        <Circle cx={57} cy={2.5} r={2} fill="#FFF3A6" stroke={ink} strokeWidth={1.2} />
        <Circle cx={78} cy={6} r={2} fill="#FFF3A6" stroke={ink} strokeWidth={1.2} />
      </G>
      <Face mood={mood} spec={BOSS_FACE} />
    </G>
  </Svg>;
});

export const MONSTER_ART: Record<MonsterId, { name: string; Art: React.ComponentType<MonsterProps>; color: string }> = {
  slime: { name: 'Slime', Art: Slime, color: '#6CCF6E' },
  mushroom: { name: 'Nấm phép thuật', Art: Mushroom, color: '#A764E0' },
  golem: { name: 'Golem đá', Art: Golem, color: '#9C8E7E' },
  shadow: { name: 'Tinh linh bóng tối', Art: ShadowSpirit, color: '#5B4BB5' },
  drake: { name: 'Rồng nhỏ', Art: Drake, color: '#FF8A4C' },
  boss: { name: 'Vua Pha Lê', Art: CrystalKing, color: '#8E5BE0' },
};

// ---------------------------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------------------------

type EffectProps = { size: number; color?: string };

/** A round glowing orb of magic with sparkles around it. */
export const MagicBolt = React.memo(function MagicBolt({ size, color = '#8FD3FF' }: EffectProps) {
  const id = `mb-bolt-${tag(color)}`;
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Defs>
      <RadialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={color} stopOpacity={0.75} />
        <Stop offset="1" stopColor={color} stopOpacity={0} />
      </RadialGradient>
      <RadialGradient id={`${id}-core`} cx="40%" cy="40%" r="60%">
        <Stop offset="0" stopColor="#FFFFFF" />
        <Stop offset="0.55" stopColor={color} />
        <Stop offset="1" stopColor={color} />
      </RadialGradient>
    </Defs>
    <Circle cx={20} cy={20} r={19} fill={url(`${id}-glow`)} />
    <Circle cx={20} cy={20} r={9} fill={url(`${id}-core`)} stroke="#FFFFFF" strokeWidth={1.2} strokeOpacity={0.7} />
    <Ellipse cx={17} cy={16.5} rx={3} ry={2} fill="#FFFFFF" opacity={0.9} />
    <Path d={star4(6, 8, 4)} fill="#FFFFFF" />
    <Path d={star4(34, 10, 3)} fill="#FFFFFF" opacity={0.9} />
    <Path d={star4(33, 32, 3.5)} fill="#FFFFFF" />
    <Path d={star4(8, 32, 2.5)} fill="#FFFFFF" opacity={0.85} />
  </Svg>;
});

/** A star-shaped hit burst. */
export const Impact = React.memo(function Impact({ size, color = '#FFC93C' }: EffectProps) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Path d={starPath(20, 20, 19, 9, 8, -90)} fill={color} stroke="#B5531E" strokeWidth={1.4} strokeOpacity={0.8} strokeLinejoin="round" />
    <Path d={starPath(20, 20, 12, 6, 8, -68)} fill="#FFF6C8" />
    <Circle cx={20} cy={20} r={4} fill="#FFFFFF" />
    <Circle cx={4} cy={6} r={1.6} fill={color} />
    <Circle cx={36} cy={8} r={1.4} fill={color} />
    <Circle cx={37} cy={33} r={1.8} fill={color} />
    <Circle cx={5} cy={35} r={1.4} fill={color} />
  </Svg>;
});

/** A four-point twinkle. */
export const Sparkle = React.memo(function Sparkle({ size, color = '#FFF1A8' }: EffectProps) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Circle cx={20} cy={20} r={11} fill={color} opacity={0.3} />
    <Path d={star4(20, 20, 18)} fill={color} />
    <Path d={star4(20, 20, 8)} fill="#FFFFFF" />
    <Path d={star4(33, 8, 4)} fill={color} />
  </Svg>;
});

/** A translucent, hexagon-faceted crystal bubble to lay over a monster (same 120 box as the monsters). */
export const CrystalShield = React.memo(function CrystalShield({ size }: { size: number }) {
  const cx = 60;
  const cy = 62;
  const R = 54;
  const corner = (i: number): Pt => {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    return [r1(cx + R * Math.cos(a)), r1(cy + R * Math.sin(a))];
  };
  const corners = [0, 1, 2, 3, 4, 5].map(corner);
  return <Svg width={size} height={size} viewBox="0 0 120 120">
    <Defs>
      <RadialGradient id="mb-shield-fill" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#E6FFFF" stopOpacity={0.1} />
        <Stop offset="0.7" stopColor="#7FE8FF" stopOpacity={0.22} />
        <Stop offset="1" stopColor="#5BC8FF" stopOpacity={0.45} />
      </RadialGradient>
    </Defs>
    <Path d={starPath(cx, cy, R, R, 6)} fill={url('mb-shield-fill')} />
    {corners.map(([x, y], i) => {
      const [nx, ny] = corners[(i + 1) % 6];
      return <Path key={i} d={`M${cx} ${cy} L${x} ${y} L${nx} ${ny} Z`} fill="#FFFFFF" opacity={i % 2 ? 0.05 : 0.13} />;
    })}
    <Path d={corners.map(([x, y]) => `M${cx} ${cy} L${x} ${y}`).join(' ')} stroke="#CFFBFF" strokeWidth={1.2} opacity={0.45} />
    <Path d={starPath(cx, cy, 30, 30, 6)} stroke="#CFFBFF" strokeWidth={1.5} opacity={0.5} fill="none" />
    <Path d={starPath(cx, cy, R, R, 6)} fill="none" stroke="#8FEFFF" strokeWidth={3} strokeLinejoin="round" opacity={0.9} />
    <Path d="M22 40 Q34 18 58 12" stroke="#FFFFFF" strokeWidth={4} fill="none" strokeLinecap="round" opacity={0.8} />
    <Path d={star4(corners[1][0], corners[1][1], 6)} fill="#FFFFFF" />
    <Path d={star4(corners[4][0], corners[4][1], 5)} fill="#FFFFFF" opacity={0.9} />
    <Path d={star4(corners[3][0], corners[3][1], 4)} fill="#FFFFFF" opacity={0.8} />
  </Svg>;
});

// ---------------------------------------------------------------------------------------------------------------
// Arenas
// ---------------------------------------------------------------------------------------------------------------

export type Zone = 'forest' | 'cave' | 'castle' | 'boss';
export type ArenaLayerName = 'sky' | 'far' | 'mid' | 'near';
type StripLayer = Exclude<ArenaLayerName, 'sky'>;
export type ArenaLayerProps = { zone: Zone; layer: ArenaLayerName; width: number; height: number };

/** Scenery is drawn for a 260-tall scene and scaled; x positions are shares of the width. */
const scaleOf = (height: number) => height / 260;
const moveTo = (x: number, y: number, k: number) => `translate(${r1(x)} ${r1(y)}) scale(${k3(k)})`;

function Cloud({ x, y, k, color, opacity }: { x: number; y: number; k: number; color: string; opacity: number }) {
  return <G transform={moveTo(x, y, k)} opacity={opacity}>
    <Ellipse cx={0} cy={0} rx={26} ry={9} fill={color} />
    <Ellipse cx={-9} cy={-6} rx={12} ry={9} fill={color} />
    <Ellipse cx={8} cy={-8} rx={15} ry={11} fill={color} />
  </G>;
}

function Fade({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  return <RadialGradient id={id} cx="50%" cy="50%" r="50%">
    <Stop offset="0" stopColor={color} stopOpacity={opacity} />
    <Stop offset="1" stopColor={color} stopOpacity={0} />
  </RadialGradient>;
}

function Vertical({ id, stops }: { id: string; stops: readonly (readonly [number, string])[] }) {
  return <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
    {stops.map(([offset, color]) => <Stop key={offset} offset={`${offset}`} stopColor={color} />)}
  </LinearGradient>;
}

type Draw = (w: number, h: number) => React.ReactNode;

// --- Forest -----------------------------------------------------------------------------------------------------

const forestSky: Draw = (w, h) => {
  const s = scaleOf(h);
  return <>
    <Defs>
      <Vertical id="mb-forest-sky-bg" stops={[[0, '#B9E4FF'], [0.6, '#DDF4EC'], [1, '#FFF4D6']]} />
      <Fade id="mb-forest-sky-sun" color="#FFF7C9" opacity={0.95} />
      <LinearGradient id="mb-forest-sky-shaft" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
        <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
      </LinearGradient>
    </Defs>
    <Rect x={0} y={0} width={w} height={h} fill={url('mb-forest-sky-bg')} />
    <Ellipse cx={w * 0.8} cy={h * 0.12} rx={w * 0.32} ry={h * 0.32} fill={url('mb-forest-sky-sun')} />
    <Circle cx={w * 0.8} cy={h * 0.12} r={15 * s} fill="#FFF4B8" />
    {[[0.58, 0.66, 0.3, 0.44], [0.72, 0.77, 0.52, 0.6], [0.86, 0.9, 0.7, 0.78]].map(([a, b, c, d]) =>
      <Path key={a} d={`M${r1(w * a)} 0 L${r1(w * b)} 0 L${r1(w * d)} ${r1(h * 0.85)} L${r1(w * c)} ${r1(h * 0.85)} Z`} fill={url('mb-forest-sky-shaft')} />)}
    <Cloud x={w * 0.2} y={h * 0.15} k={s} color="#FFFFFF" opacity={0.85} />
    <Cloud x={w * 0.5} y={h * 0.08} k={s * 0.7} color="#FFFFFF" opacity={0.7} />
  </>;
};

const caveSky: Draw = (w, h) => {
  const glints = [[0.08, 0.2], [0.22, 0.36], [0.35, 0.14], [0.5, 0.42], [0.62, 0.22], [0.74, 0.38], [0.86, 0.12], [0.95, 0.3]];
  return <>
    <Defs>
      <Vertical id="mb-cave-sky-bg" stops={[[0, '#191632'], [0.55, '#2B2550'], [1, '#3A3166']]} />
      <Fade id="mb-cave-sky-cyan" color="#4FD8E8" opacity={0.35} />
      <Fade id="mb-cave-sky-violet" color="#A46BFF" opacity={0.35} />
    </Defs>
    <Rect x={0} y={0} width={w} height={h} fill={url('mb-cave-sky-bg')} />
    <Ellipse cx={w * 0.2} cy={h * 0.45} rx={w * 0.28} ry={h * 0.3} fill={url('mb-cave-sky-cyan')} />
    <Ellipse cx={w * 0.65} cy={h * 0.3} rx={w * 0.3} ry={h * 0.32} fill={url('mb-cave-sky-violet')} />
    <Ellipse cx={w * 0.92} cy={h * 0.55} rx={w * 0.2} ry={h * 0.25} fill={url('mb-cave-sky-cyan')} />
    {glints.map(([f, y], i) => <Circle key={f} cx={w * f} cy={h * y} r={i % 2 ? 1.2 : 1.8} fill="#BFF6FF" opacity={0.55} />)}
  </>;
};

const castleSky: Draw = (w, h) => {
  const s = scaleOf(h);
  const stars = [[0.06, 0.08], [0.18, 0.2], [0.33, 0.06], [0.46, 0.16], [0.6, 0.05], [0.94, 0.18]];
  return <>
    <Defs>
      <Vertical id="mb-castle-sky-bg" stops={[[0, '#2E2457'], [0.55, '#6B4A8C'], [1, '#E09A8E']]} />
      <Fade id="mb-castle-sky-moon" color="#FFF0D0" opacity={0.55} />
    </Defs>
    <Rect x={0} y={0} width={w} height={h} fill={url('mb-castle-sky-bg')} />
    {stars.map(([f, y]) => <Circle key={f} cx={w * f} cy={h * y} r={1.4 * s} fill="#FFFFFF" opacity={0.8} />)}
    <Ellipse cx={w * 0.78} cy={h * 0.17} rx={46 * s} ry={46 * s} fill={url('mb-castle-sky-moon')} />
    <Circle cx={w * 0.78} cy={h * 0.17} r={18 * s} fill="#FFF0D0" />
    <Circle cx={w * 0.78 - 6 * s} cy={h * 0.17 - 4 * s} r={3.5 * s} fill="#F1DDB8" />
    <Circle cx={w * 0.78 + 6 * s} cy={h * 0.17 + 6 * s} r={2.5 * s} fill="#F1DDB8" />
    <Cloud x={w * 0.25} y={h * 0.3} k={s * 1.1} color="#8A5E9E" opacity={0.6} />
    <Cloud x={w * 0.62} y={h * 0.36} k={s * 0.8} color="#9C6AA6" opacity={0.5} />
  </>;
};

const BOSS_STARS = [[0.04, 0.1, 1.2], [0.11, 0.3, 0.8], [0.17, 0.06, 1], [0.24, 0.22, 1.4], [0.31, 0.4, 0.8], [0.38, 0.12, 1.1],
  [0.45, 0.32, 0.9], [0.52, 0.05, 1.3], [0.58, 0.24, 0.8], [0.66, 0.44, 1], [0.72, 0.08, 0.9], [0.79, 0.36, 1.2],
  [0.85, 0.16, 0.8], [0.91, 0.42, 1], [0.96, 0.06, 1.3], [0.07, 0.48, 0.9]] as const;

const bossSky: Draw = (w, h) => {
  const s = scaleOf(h);
  const mx = w * 0.7;
  const my = h * 0.2;
  return <>
    <Defs>
      <Vertical id="mb-boss-sky-bg" stops={[[0, '#0F0824'], [0.55, '#251248'], [1, '#45206E']]} />
      <Fade id="mb-boss-sky-violet" color="#B05CFF" opacity={0.35} />
      <Fade id="mb-boss-sky-teal" color="#4FE0D0" opacity={0.2} />
      <Fade id="mb-boss-sky-moon" color="#E8C8FF" opacity={0.6} />
    </Defs>
    <Rect x={0} y={0} width={w} height={h} fill={url('mb-boss-sky-bg')} />
    <Ellipse cx={w * 0.3} cy={h * 0.3} rx={w * 0.4} ry={h * 0.25} fill={url('mb-boss-sky-violet')} />
    <Ellipse cx={w * 0.85} cy={h * 0.5} rx={w * 0.3} ry={h * 0.2} fill={url('mb-boss-sky-teal')} />
    {BOSS_STARS.map(([f, y, r]) => <Circle key={`${f}-${y}`} cx={w * f} cy={h * y} r={r * s} fill="#FFFFFF" opacity={0.5 + r * 0.3} />)}
    <Path d={star4(w * 0.14, h * 0.16, 5 * s)} fill="#F3E6FF" />
    <Path d={star4(w * 0.48, h * 0.4, 4 * s)} fill="#F3E6FF" opacity={0.8} />
    <Path d={star4(w * 0.93, h * 0.28, 4.5 * s)} fill="#F3E6FF" />
    <Ellipse cx={mx} cy={my} rx={44 * s} ry={44 * s} fill={url('mb-boss-sky-moon')} />
    <Circle cx={mx} cy={my} r={20 * s} fill="#2A1550" stroke="#F0D8FF" strokeWidth={3 * s} />
  </>;
};

/** A periodic zigzag ridge (n peaks per width). */
const SKIES: Record<Zone, Draw> = { forest: forestSky, cave: caveSky, castle: castleSky, boss: bossSky };
/** One parallax layer of a battle arena. `sky` is a still width x height backdrop; `far`, `mid` and `near` are strips
 * two widths long whose halves are identical, so sliding one left by `width` and starting over loops without a seam.
 * The ground line is at 80% of the height; `near` carries the ground from there down. */
export const ArenaLayer = React.memo(function ArenaLayer({ zone, layer, width, height }: ArenaLayerProps) {
  if (!(width > 0) || !(height > 0)) return null;
  if (layer === 'sky') return <Svg width={width} height={height}>{SKIES[zone](width, height)}</Svg>;
  return <Strip source={ARENA_ART[zone][layer as StripLayer]} width={width} height={height} />;
});
