import React from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import { Art, blob, copies, INK, Lin, Rad, seeded, Shadow, SW, Twinkle, url } from './kit';

// Vector art for Time Traveler (Lịch sử): four eras the pet travels through (a scene each, ground at 80% of the height,
// with a drifting cloud strip over it), the time gate (a stone clock ring; its swirl is a separate drawing so the game
// can spin it), the artifacts the pet digs up, the dig mound, and Cú Thời Gian, the owl who guides the trip. Eras are
// generic pictures of daily life (no real person is drawn). Props are drawn in a 0 0 100 100 box.

export type Era = 'stone' | 'bronze' | 'feudal' | 'modern';
export const ERAS: Era[] = ['stone', 'bronze', 'feudal', 'modern'];
export const ERA_NAME: Record<Era, string> = { stone: 'Thời nguyên thuỷ', bronze: 'Thời đồ đồng', feudal: 'Thời phong kiến', modern: 'Thời hiện đại' };

const GROUND = 0.8;

function Tuft({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return <Path d={`M${x - s} ${y} Q${x - s * 0.6} ${y - s * 1.6} ${x} ${y - s * 0.4} Q${x + s * 0.2} ${y - s * 2} ${x + s * 0.5} ${y - s * 0.3} Q${x + s} ${y - s * 1.4} ${x + s * 1.1} ${y} Z`}
    fill={color} />;
}

function Tree({ x, y, r, leaf, trunk = '#9A6B44' }: { x: number; y: number; r: number; leaf: string; trunk?: string }) {
  return (
    <G>
      <Rect x={x - r * 0.12} y={y - r * 1.2} width={r * 0.24} height={r * 1.2} fill={trunk} />
      <Circle cx={x} cy={y - r * 1.5} r={r} fill={leaf} />
      <Circle cx={x - r * 0.55} cy={y - r * 1.2} r={r * 0.6} fill={leaf} />
      <Circle cx={x + r * 0.55} cy={y - r * 1.25} r={r * 0.62} fill={leaf} />
      <Circle cx={x - r * 0.3} cy={y - r * 1.8} r={r * 0.35} fill="#FFFFFF" opacity={0.18} />
    </G>
  );
}

function StoneAge({ w, h }: { w: number; h: number }) {
  const g = h * GROUND;
  return (
    <>
      <Defs>
        <Lin id="era-stone-sky" stops={[[0, '#8FCFF0'], [0.7, '#FFD9AE'], [1, '#FFC491']]} />
        <Lin id="era-stone-ground" stops={[[0, '#D4AB72'], [1, '#B08450']]} />
        <Lin id="era-stone-mtn" stops={[[0, '#C49A78'], [1, '#9C7356']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('era-stone-sky')} />
      <Circle cx={w * 0.8} cy={h * 0.22} r={h * 0.09} fill="#FFF2B8" opacity={0.9} />
      {/* Mountains and a smoking volcano. */}
      <Path d={`M0 ${g} L${w * 0.12} ${h * 0.42} L${w * 0.26} ${h * 0.55} L${w * 0.4} ${h * 0.34} L${w * 0.56} ${g} Z`} fill={url('era-stone-mtn')} />
      <Path d={`M${w * 0.5} ${g} L${w * 0.68} ${h * 0.3} L${w * 0.74} ${h * 0.3} L${w * 0.94} ${g} Z`} fill="#A87C5C" />
      <Path d={`M${w * 0.68} ${h * 0.3} L${w * 0.71} ${h * 0.36} L${w * 0.74} ${h * 0.3} Z`} fill="#FF8A4C" />
      {[0, 1, 2].map((i) => <Circle key={i} cx={w * (0.71 + i * 0.02)} cy={h * (0.24 - i * 0.07)} r={h * (0.035 + i * 0.012)} fill="#E8DDD6" opacity={0.75 - i * 0.18} />)}
      {/* The cave. */}
      <Path d={`M${w * 0.02} ${g} Q${w * 0.02} ${h * 0.46} ${w * 0.17} ${h * 0.44} Q${w * 0.32} ${h * 0.46} ${w * 0.3} ${g} Z`} fill="#8E6A52" stroke={INK} strokeWidth={1.5} />
      <Path d={`M${w * 0.09} ${g} Q${w * 0.1} ${h * 0.58} ${w * 0.17} ${h * 0.57} Q${w * 0.24} ${h * 0.58} ${w * 0.24} ${g} Z`} fill="#3E2E2A" />
      <Rect y={g} width={w} height={h - g} fill={url('era-stone-ground')} />
      <Path d={`M0 ${g} Q${w * 0.25} ${g - h * 0.02} ${w * 0.5} ${g} T${w} ${g}`} stroke="#8DBF5A" strokeWidth={h * 0.02} fill="none" />
      {/* A campfire and standing stones. */}
      <G>
        <Path d={`M${w * 0.6} ${g + h * 0.06} L${w * 0.68} ${g + h * 0.03}`} stroke="#7A4E2E" strokeWidth={h * 0.025} strokeLinecap="round" />
        <Path d={`M${w * 0.6} ${g + h * 0.03} L${w * 0.68} ${g + h * 0.06}`} stroke="#8F5C36" strokeWidth={h * 0.025} strokeLinecap="round" />
        <Path d={`M${w * 0.64} ${g - h * 0.06} Q${w * 0.61} ${g} ${w * 0.64} ${g + h * 0.03} Q${w * 0.67} ${g} ${w * 0.64} ${g - h * 0.06} Z`} fill="#FF8A3D" />
        <Path d={`M${w * 0.64} ${g - h * 0.02} Q${w * 0.625} ${g + h * 0.01} ${w * 0.64} ${g + h * 0.03} Q${w * 0.655} ${g + h * 0.01} ${w * 0.64} ${g - h * 0.02} Z`} fill="#FFE27A" />
      </G>
      <Rect x={w * 0.86} y={g - h * 0.12} width={w * 0.035} height={h * 0.14} rx={3} fill="#A9A0A0" stroke={INK} strokeWidth={1.2} />
      <Rect x={w * 0.91} y={g - h * 0.09} width={w * 0.03} height={h * 0.11} rx={3} fill="#B6AEAE" stroke={INK} strokeWidth={1.2} />
      {[0.36, 0.48, 0.78].map((x, i) => <Tuft key={i} x={w * x} y={g + h * 0.04} s={h * 0.025} color="#7FB24E" />)}
    </>
  );
}

function BronzeAge({ w, h }: { w: number; h: number }) {
  const g = h * GROUND;
  return (
    <>
      <Defs>
        <Lin id="era-bronze-sky" stops={[[0, '#9FDCFF'], [1, '#EAF8FF']]} />
        <Lin id="era-bronze-ground" stops={[[0, '#A4D67E'], [1, '#7DBB5E']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('era-bronze-sky')} />
      <Path d={`M0 ${h * 0.62} Q${w * 0.2} ${h * 0.4} ${w * 0.42} ${h * 0.58} Q${w * 0.62} ${h * 0.42} ${w} ${h * 0.6} L${w} ${g} L0 ${g} Z`} fill="#8FD18A" />
      {[0, 1, 2].map((i) => <Path key={i} d={`M${w * 0.04} ${h * (0.66 + i * 0.045)} Q${w * 0.22} ${h * (0.6 + i * 0.045)} ${w * 0.4} ${h * (0.66 + i * 0.045)}`}
        stroke="#6DB86F" strokeWidth={1.6} fill="none" />)}
      <Rect y={g} width={w} height={h - g} fill={url('era-bronze-ground')} />
      {/* A rice paddy of still water. */}
      <Rect x={w * 0.05} y={g + h * 0.05} width={w * 0.34} height={h * 0.08} rx={h * 0.03} fill="#9EDCF2" stroke="#5FA9C9" strokeWidth={1.2} />
      {[0.1, 0.17, 0.24, 0.31].map((x, i) => <Tuft key={i} x={w * x} y={g + h * 0.1} s={h * 0.018} color="#5FB34F" />)}
      {/* Bamboo. */}
      {[0.44, 0.47, 0.5].map((x, i) => (
        <G key={i}>
          <Rect x={w * x} y={g - h * (0.42 - i * 0.05)} width={w * 0.012} height={h * (0.42 - i * 0.05)} fill="#7BBF5A" />
          {[0.12, 0.24, 0.34].map((y, j) => <Rect key={j} x={w * x - 1} y={g - h * y} width={w * 0.012 + 2} height={2} fill="#5A9A42" />)}
        </G>
      ))}
      {/* A stilt house with a boat-shaped thatched roof, back on the hillside (clear of the gate on the right). */}
      <G transform={`translate(${w * 0.5} ${g - h * 0.07}) scale(${h / 200})`}>
        {[6, 22, 38, 52].map((x, i) => <Rect key={i} x={x} y={-30} width={4} height={30} fill="#8F5C36" />)}
        <Rect x={0} y={-38} width={62} height={9} fill="#B7834F" stroke={INK} strokeWidth={1.3} />
        <Rect x={6} y={-60} width={50} height={22} fill="#D9A86A" stroke={INK} strokeWidth={1.3} />
        <Rect x={25} y={-54} width={12} height={16} fill="#6E4A2C" />
        <Path d="M-8 -98 Q2 -70 6 -60 L56 -60 Q60 -70 70 -98 Q31 -80 -8 -98 Z" fill="#E2B866" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
        {[16, 31, 46].map((x, i) => <Line key={i} x1={x} y1={-80} x2={x} y2={-60} stroke="#C89A4A" strokeWidth={1.2} />)}
        <Path d="M-6 0 L6 -29" stroke="#8F5C36" strokeWidth={2} />
      </G>
    </>
  );
}

function Feudal({ w, h }: { w: number; h: number }) {
  const g = h * GROUND;
  const gx = w * 0.5;
  return (
    <>
      <Defs>
        <Lin id="era-feudal-sky" stops={[[0, '#FFE3A8'], [1, '#FFF6E0']]} />
        <Lin id="era-feudal-wall" stops={[[0, '#C9B9A2'], [1, '#A89478']]} />
        <Lin id="era-feudal-ground" stops={[[0, '#E6CF97'], [1, '#CDB078']]} />
        <Lin id="era-feudal-roof" stops={[[0, '#C9504A'], [1, '#9C3A36']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('era-feudal-sky')} />
      <Path d={`M0 ${h * 0.5} L${w * 0.16} ${h * 0.34} L${w * 0.3} ${h * 0.46} L${w * 0.82} ${h * 0.36} L${w} ${h * 0.48} L${w} ${g} L0 ${g} Z`} fill="#AFC3D6" opacity={0.8} />
      {/* The citadel wall with crenels and its gate tower. */}
      <Rect x={0} y={h * 0.5} width={w} height={g - h * 0.5} fill={url('era-feudal-wall')} stroke={INK} strokeWidth={1.2} />
      {Array.from({ length: 14 }, (_, i) => <Rect key={i} x={(i / 14) * w + 2} y={h * 0.46} width={w / 28} height={h * 0.05} fill="#BCA98E" stroke={INK} strokeWidth={1} />)}
      {[0.58, 0.66, 0.74].map((y, i) => <Line key={i} x1={0} y1={h * y} x2={w} y2={h * y} stroke="#9A876C" strokeWidth={1} opacity={0.6} />)}
      <Rect x={gx - w * 0.11} y={h * 0.38} width={w * 0.22} height={g - h * 0.38} fill="#B8A486" stroke={INK} strokeWidth={1.4} />
      <Path d={`M${gx - w * 0.05} ${g} L${gx - w * 0.05} ${h * 0.6} Q${gx} ${h * 0.52} ${gx + w * 0.05} ${h * 0.6} L${gx + w * 0.05} ${g} Z`} fill="#5A3E2E" />
      <Path d={`M${gx - w * 0.15} ${h * 0.4} Q${gx} ${h * 0.33} ${gx + w * 0.15} ${h * 0.4} L${gx + w * 0.17} ${h * 0.37} Q${gx} ${h * 0.27} ${gx - w * 0.17} ${h * 0.37} Z`}
        fill={url('era-feudal-roof')} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <Rect x={gx - w * 0.07} y={h * 0.25} width={w * 0.14} height={h * 0.06} fill="#C8B394" stroke={INK} strokeWidth={1.2} />
      <Path d={`M${gx - w * 0.11} ${h * 0.26} Q${gx} ${h * 0.2} ${gx + w * 0.11} ${h * 0.26} L${gx + w * 0.12} ${h * 0.23} Q${gx} ${h * 0.14} ${gx - w * 0.12} ${h * 0.23} Z`}
        fill={url('era-feudal-roof')} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <Rect y={g} width={w} height={h - g} fill={url('era-feudal-ground')} />
      {/* Banners, a stone lantern and a lotus pond. */}
      {[0.18, 0.82].map((x, i) => (
        <G key={i}>
          <Line x1={w * x} y1={g + h * 0.02} x2={w * x} y2={h * 0.42} stroke="#6E4A2C" strokeWidth={2} />
          <Path d={`M${w * x} ${h * 0.43} L${w * x + w * 0.06} ${h * 0.45} L${w * x + w * 0.045} ${h * 0.5} L${w * x + w * 0.06} ${h * 0.55} L${w * x} ${h * 0.55} Z`}
            fill={i ? '#F2C14E' : '#E2574C'} stroke={INK} strokeWidth={1} />
        </G>
      ))}
      <Rect x={w * 0.3} y={g - h * 0.1} width={w * 0.03} height={h * 0.1} fill="#B5ADA0" stroke={INK} strokeWidth={1} />
      <Rect x={w * 0.29} y={g - h * 0.13} width={w * 0.05} height={h * 0.035} fill="#C8C0B2" stroke={INK} strokeWidth={1} />
      <Ellipse cx={w * 0.72} cy={g + h * 0.1} rx={w * 0.12} ry={h * 0.045} fill="#8FD0E0" stroke="#5FA9C9" strokeWidth={1.2} />
      <Ellipse cx={w * 0.68} cy={g + h * 0.1} rx={w * 0.025} ry={h * 0.012} fill="#6FBF6A" />
      <Path d={`M${w * 0.75} ${g + h * 0.1} Q${w * 0.745} ${g + h * 0.07} ${w * 0.755} ${g + h * 0.06} Q${w * 0.765} ${g + h * 0.07} ${w * 0.76} ${g + h * 0.1} Z`} fill="#FF9EC2" />
    </>
  );
}

function Modern({ w, h }: { w: number; h: number }) {
  const g = h * GROUND;
  const rnd = seeded(41);
  const towers = Array.from({ length: 9 }, (_, i) => ({ x: (i / 9) * w, wd: w / 9 - 3, ht: h * (0.22 + rnd() * 0.3), c: ['#A9C4E8', '#C7D7F0', '#9DB6DD', '#B8CBEA'][i % 4] }));
  return (
    <>
      <Defs>
        <Lin id="era-modern-sky" stops={[[0, '#BEE7FF'], [1, '#F2FBFF']]} />
        <Lin id="era-modern-road" stops={[[0, '#8E98A8'], [1, '#6F7889']]} />
      </Defs>
      <Rect width={w} height={h} fill={url('era-modern-sky')} />
      {towers.map((t, i) => (
        <G key={i}>
          <Rect x={t.x + 1.5} y={g - t.ht} width={t.wd} height={t.ht} fill={t.c} stroke="#7F93B5" strokeWidth={1} />
          {Array.from({ length: Math.floor(t.ht / (h * 0.06)) }, (_, j) => (
            <Rect key={j} x={t.x + t.wd * 0.25} y={g - t.ht + h * 0.03 + j * h * 0.06} width={t.wd * 0.5} height={h * 0.025} fill="#FFFFFF" opacity={0.7} />
          ))}
        </G>
      ))}
      <Rect y={g} width={w} height={h * 0.04} fill="#D9DEE6" />
      <Rect y={g + h * 0.04} width={w} height={h - g - h * 0.04} fill={url('era-modern-road')} />
      {Array.from({ length: 6 }, (_, i) => <Rect key={i} x={(i / 6) * w + w * 0.03} y={g + h * 0.11} width={w * 0.07} height={h * 0.012} fill="#FFFFFF" opacity={0.85} />)}
      {[0.12, 0.62].map((x, i) => <Tree key={i} x={w * x} y={g} r={h * 0.07} leaf={i ? '#7CCB6A' : '#6BBF73'} />)}
      {[0.36, 0.88].map((x, i) => (
        <G key={i}>
          <Rect x={w * x} y={g - h * 0.26} width={3} height={h * 0.26} fill="#55607A" />
          <Path d={`M${w * x + 1.5} ${g - h * 0.26} Q${w * x + w * 0.03} ${g - h * 0.29} ${w * x + w * 0.04} ${g - h * 0.25}`} stroke="#55607A" strokeWidth={3} fill="none" />
          <Circle cx={w * x + w * 0.04} cy={g - h * 0.24} r={h * 0.018} fill="#FFE98A" />
        </G>
      ))}
    </>
  );
}

/** The scene of an era, `width` × `height` (no scrolling: the pet steps through the gate into the next one). */
export const EraScene = React.memo(function EraScene({ era, width: w, height: h }: { era: Era; width: number; height: number }) {
  if (!w || !h) return null;
  const Scene = { stone: StoneAge, bronze: BronzeAge, feudal: Feudal, modern: Modern }[era];
  return <Svg width={w} height={h}><Scene w={w} h={h} /></Svg>;
});

/** Soft clouds on a strip two widths long whose halves match (for a slow drift). */
export const EraClouds = React.memo(function EraClouds({ width: w, height: h }: { width: number; height: number }) {
  if (!w || !h) return null;
  const clouds = [[0.12, 0.12, 0.07], [0.46, 0.2, 0.05], [0.78, 0.08, 0.06]] as const;
  return (
    <Svg width={w * 2} height={h}>
      {clouds.map(([x, y, r], i) => copies(w, w * x, h * r * 3).map((o) => (
        <G key={`${i}-${o}`} opacity={0.85}>
          <Ellipse cx={w * x + o} cy={h * y} rx={h * r * 2.4} ry={h * r} fill="#FFFFFF" />
          <Circle cx={w * x + o - h * r} cy={h * y - h * r * 0.5} r={h * r} fill="#FFFFFF" />
          <Circle cx={w * x + o + h * r * 0.6} cy={h * y - h * r * 0.7} r={h * r * 1.2} fill="#FFFFFF" />
        </G>
      )))}
    </Svg>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// The time gate

/** The stone clock ring of the time gate on its pedestal (the swirl, `PortalSwirl`, shows through its middle). */
export const TimeGate = React.memo(function TimeGate({ size, lit }: { size: number; lit: boolean }) {
  const id = lit ? 'tg-lit' : 'tg-off';
  return (
    <Art size={size} h={120}>
      <Defs>
        <Lin id={`${id}-stone`} stops={[[0, '#D8D0C4'], [1, '#9F9585']]} />
        <Rad id={`${id}-hole`} stops={[[0, lit ? '#FFFFFF' : '#5C4F7A', lit ? 0.0 : 1], [1, lit ? '#B79CFF' : '#2E2545', lit ? 0.15 : 1]]} />
      </Defs>
      <Circle cx={50} cy={50} r={33} fill={url(`${id}-hole`)} />
      <Path d="M50 4 A46 46 0 1 1 49.99 4 Z M50 17 A33 33 0 1 0 50.01 17 Z" fill={url(`${id}-stone`)} fillRule="evenodd" stroke={INK} strokeWidth={SW} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return <Circle key={i} cx={50 + Math.cos(a) * 39.5} cy={50 + Math.sin(a) * 39.5} r={i % 3 === 0 ? 3 : 1.8} fill={lit ? '#FFE27A' : '#7A6E62'}
          stroke={INK} strokeWidth={0.8} />;
      })}
      <Path d="M24 92 L76 92 L84 112 L16 112 Z" fill={url(`${id}-stone`)} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Rect x={10} y={110} width={80} height={8} rx={3} fill="#8C8273" stroke={INK} strokeWidth={2} />
      {lit ? <Twinkle x={86} y={14} r={6} color="#FFF4A8" /> : null}
    </Art>
  );
});

/** The swirling way through time (spun by the game). */
export const PortalSwirl = React.memo(function PortalSwirl({ size }: { size: number }) {
  return (
    <Art size={size}>
      <Defs><Rad id="ps-core" stops={[[0, '#FFFFFF'], [0.35, '#E8DBFF'], [1, '#8E6CF0']]} /></Defs>
      <Circle cx={50} cy={50} r={48} fill={url('ps-core')} />
      {[0, 1, 2, 3].map((i) => (
        <Path key={i} d="M50 50 Q66 30 92 42" stroke={['#5FD6E0', '#B48CFF', '#FF9ED8', '#FFFFFF'][i]} strokeWidth={6} strokeLinecap="round" fill="none"
          opacity={0.85} transform={`rotate(${i * 90} 50 50)`} />
      ))}
      <Circle cx={50} cy={50} r={9} fill="#FFFFFF" />
    </Art>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Artifacts

export type ArtifactKind = 'axe' | 'drum' | 'jar' | 'coin' | 'seal' | 'scroll' | 'lamp';
export const ARTIFACT_KINDS: ArtifactKind[] = ['axe', 'drum', 'jar', 'coin', 'seal', 'scroll', 'lamp'];
export const ARTIFACT_NAME: Record<ArtifactKind, string> = { axe: 'Rìu đá', drum: 'Trống đồng', jar: 'Bình gốm', coin: 'Đồng xu cổ', seal: 'Con dấu cổ',
  scroll: 'Cuộn thư tịch', lamp: 'Đèn dầu' };
/** The artifacts found in each era, in order. */
export const ERA_ARTIFACTS: Record<Era, ArtifactKind[]> = { stone: ['axe', 'jar'], bronze: ['drum', 'jar'], feudal: ['coin', 'seal', 'scroll'],
  modern: ['lamp', 'scroll'] };

export const Artifact = React.memo(function Artifact({ size, kind }: { size: number; kind: ArtifactKind }) {
  return (
    <Art size={size}>
      <Defs>
        <Lin id="af-bronze" stops={[[0, '#E9BE6A'], [1, '#A9772B']]} />
        <Lin id="af-clay" stops={[[0, '#EE9B62'], [1, '#B8613A']]} />
        <Lin id="af-stone" stops={[[0, '#BDB5AA'], [1, '#857C70']]} />
        <Lin id="af-paper" stops={[[0, '#FFF4D6'], [1, '#E8CF98']]} />
      </Defs>
      <Shadow rx={30} cy={94} />
      {kind === 'axe' ? (
        <>
          <Path d="M46 20 L54 20 L58 90 L48 90 Z" fill="#9A6B44" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Path d="M26 22 Q50 12 70 26 Q72 44 52 48 Q30 46 26 22 Z" fill={url('af-stone')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Path d="M44 30 L60 34 M42 38 L58 40" stroke="#7A6E62" strokeWidth={2} strokeLinecap="round" />
          <Path d="M45 46 L58 52 M45 52 L58 46" stroke="#6E8A4A" strokeWidth={2.4} strokeLinecap="round" />
        </>
      ) : kind === 'drum' ? (
        <>
          <Path d="M16 38 L20 78 Q50 90 80 78 L84 38 Z" fill={url('af-bronze')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          {[52, 62, 70].map((y, i) => <Path key={i} d={`M${18 + i} ${y} Q50 ${y + 10} ${82 - i} ${y}`} stroke="#8A5E22" strokeWidth={1.6} fill="none" />)}
          <Ellipse cx={50} cy={38} rx={34} ry={11} fill="#F2CF84" stroke={INK} strokeWidth={SW} />
          <Ellipse cx={50} cy={38} rx={24} ry={7.5} fill="none" stroke="#B5852F" strokeWidth={1.4} />
          <Polygon points="50,31 52,36.5 58,38 52,39.5 50,45 48,39.5 42,38 48,36.5" fill="#B5852F" />
        </>
      ) : kind === 'jar' ? (
        <>
          <Path d="M36 18 L64 18 L60 30 Q82 40 78 64 Q74 86 50 88 Q26 86 22 64 Q18 40 40 30 Z" fill={url('af-clay')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Rect x={34} y={14} width={32} height={6} rx={3} fill="#D9824B" stroke={INK} strokeWidth={2} />
          <Path d="M26 52 Q50 60 74 52" stroke="#FFE4C8" strokeWidth={2.6} fill="none" />
          <Path d="M28 62 L34 56 L40 62 L46 56 L52 62 L58 56 L64 62 L70 56" stroke="#7A3E22" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
          <Path d="M32 40 Q36 34 44 33" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.55} />
        </>
      ) : kind === 'coin' ? (
        <>
          <Circle cx={50} cy={52} r={36} fill={url('af-bronze')} stroke={INK} strokeWidth={SW} />
          <Circle cx={50} cy={52} r={28} fill="none" stroke="#8A5E22" strokeWidth={1.6} />
          <Rect x={41} y={43} width={18} height={18} fill="#5A3E2E" stroke={INK} strokeWidth={2} />
          {[[50, 30], [50, 74], [28, 52], [72, 52]].map(([x, y], i) => <Rect key={i} x={x - 3} y={y - 3} width={6} height={6} fill="#8A5E22" />)}
          <Path d="M24 38 Q32 24 46 20" stroke="#FFF2C4" strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={0.7} />
        </>
      ) : kind === 'seal' ? (
        <>
          <Rect x={22} y={52} width={56} height={36} rx={4} fill={url('af-bronze')} stroke={INK} strokeWidth={SW} />
          <Path d="M40 52 Q38 30 50 22 Q62 30 60 52 Z" fill="#D9A84E" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Circle cx={50} cy={34} r={5} fill="#F2CF84" stroke={INK} strokeWidth={1.6} />
          <Rect x={32} y={62} width={36} height={18} fill="none" stroke="#8A5E22" strokeWidth={1.6} />
          <Path d="M38 66 L62 66 M38 72 L62 72 M50 64 L50 78" stroke="#8A5E22" strokeWidth={1.6} />
        </>
      ) : kind === 'scroll' ? (
        <>
          <Rect x={22} y={28} width={56} height={48} fill={url('af-paper')} stroke={INK} strokeWidth={SW} />
          {[38, 46, 54, 62].map((y, i) => <Line key={i} x1={30} y1={y} x2={70 - (i % 2) * 10} y2={y} stroke="#B09060" strokeWidth={2} strokeLinecap="round" />)}
          <Rect x={16} y={22} width={68} height={10} rx={5} fill="#B5743A" stroke={INK} strokeWidth={SW} />
          <Rect x={16} y={72} width={68} height={10} rx={5} fill="#B5743A" stroke={INK} strokeWidth={SW} />
          <Path d="M64 76 L70 92 L74 84 L80 90 L74 76" fill="#E2574C" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Path d="M18 66 Q20 86 50 86 Q80 86 82 66 Z" fill={url('af-bronze')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Path d="M82 70 Q94 70 92 60 Q90 54 84 58" stroke={INK} strokeWidth={SW} fill="none" />
          <Path d="M18 66 L8 60 L20 62 Z" fill="#B5852F" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <Path d="M12 58 Q4 44 12 30 Q20 44 12 58 Z" fill="#FF9A3D" />
          <Path d="M12 56 Q8 48 12 40 Q16 48 12 56 Z" fill="#FFE27A" />
          <Ellipse cx={50} cy={66} rx={32} ry={5} fill="#F2CF84" stroke={INK} strokeWidth={1.6} />
        </>
      )}
    </Art>
  );
});

/** The mound where something old is buried (sparkling), or the hole after it was dug up. */
export const DigMound = React.memo(function DigMound({ size, dug }: { size: number; dug: boolean }) {
  return (
    <Art size={size} h={50}>
      <Defs><Lin id="dig-soil" stops={[[0, '#B88A5A'], [1, '#8A6038']]} /></Defs>
      {dug ? (
        <>
          <Ellipse cx={50} cy={36} rx={40} ry={10} fill="#8A6038" stroke={INK} strokeWidth={2} />
          <Ellipse cx={50} cy={36} rx={28} ry={6} fill="#4A3324" />
          {[[14, 28], [84, 30], [22, 44], [78, 44]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={3} fill="#A47A4C" stroke={INK} strokeWidth={1} />)}
        </>
      ) : (
        <>
          <Path d="M8 44 Q20 14 50 12 Q80 14 92 44 Z" fill={url('dig-soil')} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <Path d={blob(40, 30, 4, 5, 0.5, 51)} fill="#A47A4C" />
          <Path d={blob(62, 24, 3, 5, 0.5, 52)} fill="#A47A4C" />
          <Twinkle x={56} y={10} r={7} color="#FFF4A8" />
          <Twinkle x={30} y={18} r={4} color="#FFFFFF" />
        </>
      )}
    </Art>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// The guide

export type OwlMood = 'idle' | 'talk' | 'cheer' | 'worry';

/** Cú Thời Gian: a round owl with spectacles and a little hourglass, who explains each era. */
export const Owl = React.memo(function Owl({ size, mood = 'idle' }: { size: number; mood?: OwlMood }) {
  const cheer = mood === 'cheer';
  return (
    <Art size={size}>
      <Defs>
        <Lin id="owl-body" stops={[[0, '#C99A6B'], [1, '#9C6E46']]} />
        <Lin id="owl-belly" stops={[[0, '#FFF1D8'], [1, '#F2D7AE']]} />
      </Defs>
      <Shadow rx={26} />
      {/* Wings (up when it cheers). */}
      <Path d={cheer ? 'M22 52 Q6 30 14 18 Q24 34 30 46 Z' : 'M24 48 Q10 62 18 80 Q28 70 30 56 Z'} fill="#8F6340" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d={cheer ? 'M78 52 Q94 30 86 18 Q76 34 70 46 Z' : 'M76 48 Q90 62 82 80 Q72 70 70 56 Z'} fill="#8F6340" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M50 18 Q80 18 80 54 Q80 92 50 92 Q20 92 20 54 Q20 18 50 18 Z" fill={url('owl-body')} stroke={INK} strokeWidth={SW} />
      <Path d="M30 22 L26 10 L40 18 Z M70 22 L74 10 L60 18 Z" fill="#9C6E46" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <Path d="M50 50 Q70 52 68 74 Q64 88 50 88 Q36 88 32 74 Q30 52 50 50 Z" fill={url('owl-belly')} />
      {[62, 70, 78].map((y, i) => <Path key={i} d={`M${42 + i} ${y} Q46 ${y + 3} 50 ${y} Q54 ${y + 3} ${58 - i} ${y}`} stroke="#D9B98A" strokeWidth={1.4} fill="none" />)}
      {/* Spectacles and eyes. */}
      <Circle cx={38} cy={40} r={11} fill="#FFFFFF" stroke={INK} strokeWidth={SW} />
      <Circle cx={62} cy={40} r={11} fill="#FFFFFF" stroke={INK} strokeWidth={SW} />
      <Line x1={49} y1={40} x2={51} y2={40} stroke={INK} strokeWidth={SW} />
      {cheer ? (
        <>
          <Path d="M32 42 Q38 35 44 42" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
          <Path d="M56 42 Q62 35 68 42" stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Circle cx={38} cy={41} r={5} fill={INK} />
          <Circle cx={62} cy={41} r={5} fill={INK} />
          <Circle cx={39.6} cy={39.4} r={1.7} fill="#FFFFFF" />
          <Circle cx={63.6} cy={39.4} r={1.7} fill="#FFFFFF" />
        </>
      )}
      {mood === 'worry' ? (
        <>
          <Path d="M29 27 L45 31 M71 27 L55 31" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
          <Path d="M82 26 Q86 34 82 36 Q78 34 82 26 Z" fill="#9FD9FF" stroke={INK} strokeWidth={1} />
        </>
      ) : null}
      {/* Beak (open when it talks or cheers). */}
      {mood === 'talk' || cheer ? (
        <Path d="M45 50 L55 50 L50 60 Z M46 53 L54 53" fill="#F2A93B" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      ) : (
        <Path d="M45 50 L55 50 L50 57 Z" fill="#F2A93B" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      )}
      <Ellipse cx={30} cy={52} rx={4.5} ry={2.6} fill="#FF9FA8" opacity={0.55} />
      <Ellipse cx={70} cy={52} rx={4.5} ry={2.6} fill="#FF9FA8" opacity={0.55} />
      {/* The hourglass it carries. */}
      <G transform="translate(66 64)">
        <Rect x={0} y={0} width={16} height={3} rx={1.5} fill="#8A5E22" />
        <Rect x={0} y={21} width={16} height={3} rx={1.5} fill="#8A5E22" />
        <Path d="M2 3 L14 3 L9 12 L14 21 L2 21 L7 12 Z" fill="#E6F6FF" stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
        <Path d="M4.5 19.5 L11.5 19.5 L8 15 Z" fill="#F2CF84" />
      </G>
    </Art>
  );
});
