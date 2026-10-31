import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { Art, f1, INK, Lin, Rad, Shadow, SW, Twinkle, url } from './kit';

// The shared effects of the visual feedback (games/engine/feedback.ts): what a right or wrong answer leaves in the world,
// drawn, never an emoji or a glyph. Each takes a size (and a colour where it can be any): the scenes move, scale and
// fade them with transforms. Deterministic and hook-free like the rest of the art; gradient ids carry the colour.

const tag = (color: string) => color.replace(/[^0-9a-zA-Z]/g, '').toLowerCase();

/** A monster's counter-attack: three curved claw marks. */
export const Slash = React.memo(function Slash({ size, color = '#FF6B6B' }: { size: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    {[0, 1, 2].map((i) => {
      const o = i * 7 - 7;
      return <G key={i}>
        <Path d={`M${8 + o} ${6 - o * 0.2} Q${22 + o} ${16 + o * 0.2} ${30 + o} ${34 - o * 0.2}`} stroke="#FFFFFF" strokeWidth={5.2} strokeLinecap="round" fill="none" opacity={0.85} />
        <Path d={`M${8 + o} ${6 - o * 0.2} Q${22 + o} ${16 + o * 0.2} ${30 + o} ${34 - o * 0.2}`} stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </G>;
    })}
  </Svg>;
});

/** A ring of runes gathering magic around the caster before a spell. */
export const MagicCircle = React.memo(function MagicCircle({ size, color = '#8FD3FF' }: { size: number; color?: string }) {
  const id = `fx-circle-${tag(color)}`;
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Defs><Rad id={id} stops={[[0, color, 0], [0.7, color, 0.15], [1, color, 0.45]]} /></Defs>
    <Circle cx={20} cy={20} r={19} fill={url(id)} />
    <Circle cx={20} cy={20} r={17} stroke={color} strokeWidth={1.4} fill="none" />
    <Circle cx={20} cy={20} r={12.5} stroke={color} strokeWidth={0.9} fill="none" strokeDasharray="2 2.4" />
    {[0, 60, 120, 180, 240, 300].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return <Circle key={deg} cx={20 + Math.cos(a) * 14.8} cy={20 + Math.sin(a) * 14.8} r={1.5} fill="#FFFFFF" />;
    })}
    <Path d="M20 8 L30.4 26 L9.6 26 Z" stroke={color} strokeWidth={0.9} fill="none" opacity={0.8} />
  </Svg>;
});

/** A broken piece of something (a meteor, vines, a crystal): a jagged chip in `color`, `variant` 0–3 for its shape. */
export const Shard = React.memo(function Shard({ size, color = '#B08A6A', variant = 0 }: { size: number; color?: string; variant?: number }) {
  const shapes = ['M4 14 L14 3 L30 8 L36 24 L22 36 L8 30 Z', 'M6 8 L26 4 L36 20 L28 34 L10 30 L3 18 Z',
    'M10 4 L32 10 L34 30 L16 36 L4 22 Z', 'M3 12 L20 3 L37 14 L30 33 L12 37 Z'];
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Path d={shapes[variant % shapes.length]} fill={color} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    <Path d="M12 12 L20 9" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" opacity={0.45} />
  </Svg>;
});

/** A soft grey puff: something that did not work. */
export const Puff = React.memo(function Puff({ size, color = '#B9B4C8' }: { size: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Circle cx={14} cy={24} r={9} fill={color} opacity={0.85} />
    <Circle cx={24} cy={18} r={11} fill={color} opacity={0.9} />
    <Circle cx={29} cy={27} r={8} fill={color} opacity={0.85} />
    <Circle cx={21} cy={28} r={8} fill={color} />
    <Circle cx={21} cy={15} r={4} fill="#FFFFFF" opacity={0.35} />
  </Svg>;
});

/** An electric spark: a zigzag bolt with a glow (`dead`: a short, grey fizzle). */
export const ZapSpark = React.memo(function ZapSpark({ size, dead = false }: { size: number; dead?: boolean }) {
  const color = dead ? '#A9A3B8' : '#FFD84A';
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    {!dead ? <Circle cx={20} cy={20} r={16} fill="#FFF3B0" opacity={0.45} /> : null}
    <Path d="M22 3 L12 21 L20 21 L15 37 L30 15 L21 15 Z" fill={color} stroke={dead ? '#6E6880' : '#C77A12'} strokeWidth={1.8} strokeLinejoin="round" />
    {!dead ? <Path d="M19 10 L15 18" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" /> : null}
  </Svg>;
});

/** A drop of water. */
export const WaterDrop = React.memo(function WaterDrop({ size }: { size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Defs><Lin id="fx-drop" stops={[[0, '#B8E6FF'], [1, '#3E9BE0']]} /></Defs>
    <Path d="M20 4 C26 14 31 20 31 27 A11 11 0 0 1 9 27 C9 20 14 14 20 4 Z" fill={url('fx-drop')} stroke="#2569A8" strokeWidth={1.8} />
    <Ellipse cx={15.5} cy={26} rx={2.4} ry={4} fill="#FFFFFF" opacity={0.7} />
  </Svg>;
});

/** A small heart: a thank-you. */
export const HeartFx = React.memo(function HeartFx({ size, color = '#FF6F91' }: { size: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 40 40">
    <Path d="M20 35 C8 26 3 19 3 12.5 A8.5 8.5 0 0 1 20 9 A8.5 8.5 0 0 1 37 12.5 C37 19 32 26 20 35 Z" fill={color} stroke="#B33A5B" strokeWidth={2} strokeLinejoin="round" />
    <Ellipse cx={11.5} cy={13} rx={3} ry={2} fill="#FFFFFF" opacity={0.7} />
  </Svg>;
});

/** A faceted reward gem. */
export const Gem = React.memo(function Gem({ size, color = '#5FD3F3' }: { size: number; color?: string }) {
  const id = `fx-gem-${tag(color)}`;
  return <Art size={size}>
    <Defs><Lin id={id} stops={[[0, '#FFFFFF'], [0.35, color], [1, color]]} /></Defs>
    <Shadow rx={24} />
    <Path d="M30 22 L70 22 L86 42 L50 88 L14 42 Z" fill={url(id)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M14 42 L86 42 M30 22 L40 42 L50 88 L60 42 L70 22 M40 42 L50 22 L60 42" stroke={INK} strokeWidth={1.4} fill="none" strokeLinejoin="round" opacity={0.6} />
    <Path d="M33 28 L40 38" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" opacity={0.8} />
    <Twinkle x={80} y={18} r={7} />
  </Art>;
});

/** A boulder on the robot's grid. */
export const Boulder = React.memo(function Boulder({ size }: { size: number }) {
  return <Art size={size}>
    <Defs><Lin id="fx-boulder" stops={[[0, '#B9B2A6'], [1, '#7C7468']]} /></Defs>
    <Shadow rx={38} cy={90} opacity={0.22} />
    <Path d="M14 86 Q8 62 22 44 Q34 22 56 24 Q80 26 88 52 Q94 74 84 88 Z" fill={url('fx-boulder')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
    <Path d="M40 40 Q48 50 44 62 M64 46 Q60 58 68 66" stroke="#5E574D" strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.7} />
    <Path d="M30 46 Q38 34 52 32" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" fill="none" opacity={0.45} />
  </Art>;
});

/** The robot's goal: a flag on a pole (`reached`: raised, with a star burst). */
export const GoalFlag = React.memo(function GoalFlag({ size, reached = false }: { size: number; reached?: boolean }) {
  return <Art size={size}>
    <Defs><Lin id="fx-flag" stops={[[0, '#FF8B6B'], [1, '#E2453A']]} /></Defs>
    <Shadow rx={20} cx={34} cy={92} />
    <Ellipse cx={34} cy={90} rx={14} ry={4} fill="#8A6B4A" stroke={INK} strokeWidth={2} />
    <Rect x={31} y={14} width={6} height={77} rx={3} fill="#D9DEE6" stroke={INK} strokeWidth={2} />
    <Circle cx={34} cy={12} r={5} fill="#FFD54A" stroke={INK} strokeWidth={2} />
    <Path d={reached ? 'M37 18 Q58 12 82 22 Q64 30 82 42 Q58 46 37 40 Z' : 'M37 40 Q52 36 70 44 Q56 50 70 60 Q52 62 37 58 Z'}
      fill={url('fx-flag')} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
    {reached ? <>
      <Twinkle x={16} y={22} r={8} color="#FFE27A" />
      <Twinkle x={88} y={54} r={7} color="#FFE27A" />
    </> : null}
  </Art>;
});

/** The lines of a magnet's field: arcs from pole to pole, drawn over the magnet's box (viewBox 100). */
export const FieldLines = React.memo(function FieldLines({ size, color = '#7C6CF2' }: { size: number; color?: string }) {
  return <Art size={size}>
    {[0, 1, 2].map((i) => {
      const r = 22 + i * 12;
      return <Path key={i} d={`M${f1(27 - i * 2)} 92 Q${f1(50 - r * 2.2)} ${f1(92 - r * 0.2)} ${f1(50 - r)} 92`}
        stroke={color} strokeWidth={1.6} strokeDasharray="3 3" fill="none" opacity={0.75 - i * 0.18} />;
    })}
    {[0, 1, 2].map((i) => {
      const r = 22 + i * 12;
      return <Path key={`r${i}`} d={`M${f1(73 + i * 2)} 92 Q${f1(50 + r * 2.2)} ${f1(92 - r * 0.2)} ${f1(50 + r)} 92`}
        stroke={color} strokeWidth={1.6} strokeDasharray="3 3" fill="none" opacity={0.75 - i * 0.18} />;
    })}
  </Art>;
});
