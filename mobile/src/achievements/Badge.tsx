import React, { memo, useRef } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Polygon, RadialGradient, Stop } from 'react-native-svg';
import type { IconName } from '../ui/kit';
import type { Material } from './types';

/**
 * A badge of Thành tựu, drawn as a small clay-like medal lit from the top left, like the app's 3D scenes: a bevelled rim
 * of the tier's material, a domed face, a soft highlight and its shadow on the ground. Đồng, Bạc and Vàng are round,
 * Kim cương is cut in eight facets, Huyền thoại sits on a golden burst. A badge not reached yet is frosted grey.
 */
type Look = { rim: [string, string, string]; face: [string, string]; ink: string };
export const MATERIALS: Record<Material | 'locked', Look> = {
  bronze: { rim: ['#F6CFA8', '#C98A5A', '#7E4B27'], face: ['#FBE3CC', '#D9A272'], ink: '#5E3618' },
  silver: { rim: ['#FFFFFF', '#A9B8C7', '#56687A'], face: ['#FFFFFF', '#C9D5E0'], ink: '#33465A' },
  gold: { rim: ['#FFF3BF', '#F2C232', '#A06F06'], face: ['#FFF8DA', '#F7D46A'], ink: '#6B4A00' },
  diamond: { rim: ['#ECFCFF', '#72D3EE', '#1F7FA8'], face: ['#F6FEFF', '#A9E8F8'], ink: '#0B5A78' },
  legendary: { rim: ['#FFE3F6', '#B88CF2', '#5B3DB8'], face: ['#FFF6FC', '#DCC6FB'], ink: '#4A2C93' },
  locked: { rim: ['#EDF2F6', '#DAE2E9', '#BCC8D3'], face: ['#F6F8FA', '#E9EEF2'], ink: '#9DAFBF' },
};
export const MATERIAL_INK: Record<Material, string> = {
  bronze: MATERIALS.bronze.ink, silver: MATERIALS.silver.ink, gold: MATERIALS.gold.ink, diamond: MATERIALS.diamond.ink,
  legendary: MATERIALS.legendary.ink,
};

const points = (n: number, r: number, turn = 0, inner?: number) => Array.from({ length: inner ? n * 2 : n }, (_, i) => {
  const step = inner ? Math.PI / n : (2 * Math.PI) / n;
  const radius = inner && i % 2 ? inner : r;
  const a = turn + i * step - Math.PI / 2;
  return `${(50 + radius * Math.cos(a)).toFixed(2)},${(50 + radius * Math.sin(a)).toFixed(2)}`;
}).join(' ');

function Shape({ facets, r, fill, dy = 0, opacity }: { facets: boolean; r: number; fill: string; dy?: number; opacity?: number }) {
  return facets
    ? <Polygon points={points(8, r, Math.PI / 8)} fill={fill} opacity={opacity} transform={dy ? `translate(0 ${dy})` : undefined} />
    : <Circle cx={50} cy={50 + dy} r={r} fill={fill} opacity={opacity} />;
}

let uid = 0;

export const Badge = memo(function Badge({ icon, material, locked = false, size = 64, label, testID }: {
  icon: string; material: Material | null; locked?: boolean; size?: number; label?: string; testID?: string;
}) {
  const id = useRef(`ach${++uid}`).current;
  const look = MATERIALS[locked || !material ? 'locked' : material];
  const facets = !locked && material === 'diamond';
  const burst = !locked && material === 'legendary';
  const glyph = (icon in Ionicons.glyphMap ? icon : 'ribbon') as IconName;
  return (
    <View style={{ width: size, height: size * 1.08 }} testID={testID} accessible={!!label} accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}>
      <Svg width={size} height={size * 1.08} viewBox="0 0 100 108">
        <Defs>
          <LinearGradient id={`${id}r`} x1="0.15" y1="0" x2="0.85" y2="1">
            <Stop offset="0" stopColor={look.rim[0]} /><Stop offset="0.5" stopColor={look.rim[1]} /><Stop offset="1" stopColor={look.rim[2]} />
          </LinearGradient>
          <RadialGradient id={`${id}f`} cx="38%" cy="32%" r="72%">
            <Stop offset="0" stopColor={look.face[0]} /><Stop offset="1" stopColor={look.face[1]} />
          </RadialGradient>
          <LinearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} /><Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
          <RadialGradient id={`${id}b`} cx="50%" cy="50%" r="50%">
            <Stop offset="0.55" stopColor="#FFE58A" /><Stop offset="1" stopColor="#F2A93B" />
          </RadialGradient>
        </Defs>
        {/* Its shadow on the ground, wider than the medal is thick. */}
        <Ellipse cx={50} cy={100} rx={31} ry={5.5} fill="#1D4A68" opacity={locked ? 0.1 : 0.2} />
        {burst ? <Polygon points={points(14, 50, 0, 36)} fill={`url(#${id}b)`} /> : null}
        {/* The rim's underside, then the rim, the bevel's inner shade and the domed face (smaller on a burst). */}
        <G opacity={locked ? 0.85 : 1} transform={burst ? 'translate(50 50) scale(0.84) translate(-50 -50)' : undefined}>
          <Shape facets={facets} r={45} fill={look.rim[2]} dy={locked ? 1.4 : 2.6} />
          <Shape facets={facets} r={45} fill={`url(#${id}r)`} />
          <Shape facets={facets} r={36.5} fill={look.rim[2]} dy={1.6} opacity={locked ? 0.25 : 0.45} />
          <Shape facets={facets} r={35} fill={`url(#${id}f)`} />
          <Ellipse cx={41} cy={29} rx={22} ry={11} fill={`url(#${id}h)`} opacity={locked ? 0.35 : 0.8} />
          <Ellipse cx={28} cy={22} rx={5} ry={3} fill="#FFFFFF" opacity={locked ? 0.2 : 0.75} transform="rotate(-30 28 22)" />
        </G>
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={glyph} size={Math.round(size * (burst ? 0.3 : 0.34))} color={look.ink} />
      </View>
      {locked ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: size * 0.04, top: size * 0.62, width: size * 0.3, height: size * 0.3,
          borderRadius: size * 0.15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D6E2EB' }}>
          <Ionicons name="lock-closed" size={Math.max(9, Math.round(size * 0.16))} color="#7D93A6" />
        </View>
      ) : null}
    </View>
  );
});
