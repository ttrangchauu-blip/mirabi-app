import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { ProjectTheme } from '../../life/types';

/**
 * Work Quest's drawn world: the sky over the desk, the desk itself, project islands that are built up stage by stage,
 * reward chests and the bursts of stars a finished quest gets. Vector art drawn here (no bitmap assets yet, see
 * docs/MIRABI_LIFE.md for the sprite specification that can replace it). Every loop runs on the native driver
 * (transforms and opacity only), stops when its component unmounts and stays still with "reduce motion" on.
 */

/** A looping 0 → 1 → 0 value; null when motion is reduced (callers then draw the still frame). */
export function useLoop(duration: number, enabled = true, delay = 0) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;
  const on = enabled && !reduce;
  useEffect(() => {
    value.setValue(0);
    if (!on) return;
    const ease = Easing.inOut(Easing.sin);
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration, easing: ease, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration, easing: ease, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [on, duration, delay, value]);
  return on ? value : null;
}

const range = (v: Animated.Value | null, from: number, to: number) => (v ? v.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) : from);

/** The sky and hills behind the Focus Desk; its clouds drift slowly. `night` dims it for evening work. */
export function QuestSky({ night = false }: { night?: boolean }) {
  const drift = useLoop(9000);
  const drift2 = useLoop(12000, true, 1500);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height="100%" viewBox="0 0 360 240" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <SvgGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={night ? '#2B3A6B' : '#9FD8F6'} />
            <Stop offset="1" stopColor={night ? '#5B5E9C' : '#E6F6FF'} />
          </SvgGradient>
        </Defs>
        <Rect width="360" height="240" fill="url(#sky)" />
        {night ? [30, 90, 150, 220, 300, 330].map((x, i) => <Circle key={x} cx={x} cy={18 + (i % 3) * 14} r={1.4} fill="#FFF7D6" />) : (
          <Circle cx="300" cy="40" r="20" fill="#FFE59A" opacity={0.9} />
        )}
        <Path d="M0 170 Q60 120 120 160 T240 150 T360 160 V240 H0 Z" fill={night ? '#3E5A7A' : '#9BD3A8'} />
        <Path d="M0 190 Q80 160 170 185 T360 180 V240 H0 Z" fill={night ? '#4C6B88' : '#7DC293'} />
        <Rect x="0" y="200" width="360" height="40" fill={night ? '#6B5A4E' : '#D9B48A'} />
        <Rect x="0" y="200" width="360" height="5" fill={night ? '#5A4A40' : '#C49A6C'} />
      </Svg>
      <Animated.View style={[styles.cloud, { top: 22, left: '8%', transform: [{ translateX: range(drift, 0, 28) }] }]}>
        <Cloud width={70} />
      </Animated.View>
      <Animated.View style={[styles.cloud, { top: 48, left: '52%', transform: [{ translateX: range(drift2, 0, -22) }] }]}>
        <Cloud width={52} />
      </Animated.View>
    </View>
  );
}

function Cloud({ width }: { width: number }) {
  return (
    <Svg width={width} height={width * 0.45} viewBox="0 0 100 45">
      <Path d="M10 40 Q0 40 2 30 Q4 20 18 22 Q22 6 42 10 Q56 0 68 14 Q88 10 90 26 Q100 30 94 40 Z" fill="#FFFFFF" opacity={0.92} />
    </Svg>
  );
}

/** The work desk: lamp, laptop, books, a plant and a mug. While focusing the lamp glows and the mug steams. */
export function FocusDeskArt({ focusing }: { focusing: boolean }) {
  const glow = useLoop(1600, focusing);
  const steam = useLoop(2200, focusing);
  return (
    <View style={styles.desk} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[styles.lampGlow, { opacity: focusing ? (glow ? range(glow, 0.35, 0.7) : 0.55) : 0 }]} />
      <Svg width="100%" height="100%" viewBox="0 0 240 120" preserveAspectRatio="xMidYMax meet">
        <Defs>
          <SvgGradient id="wood" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#B87B4B" /><Stop offset="1" stopColor="#8E5A34" />
          </SvgGradient>
          <SvgGradient id="screen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={focusing ? '#BFE9FF' : '#7A93A8'} /><Stop offset="1" stopColor={focusing ? '#7CCBF2' : '#5F7486'} />
          </SvgGradient>
        </Defs>
        {/* lamp */}
        <Path d="M30 72 L44 40 L58 44 Z" fill="#F6C945" />
        <Rect x="42" y="44" width="4" height="34" fill="#6B7A8A" />
        <Ellipse cx="44" cy="80" rx="12" ry="3" fill="#56616E" />
        {/* laptop */}
        <Rect x="92" y="42" width="58" height="38" rx="4" fill="#3D4A5A" />
        <Rect x="96" y="46" width="50" height="30" rx="2" fill="url(#screen)" />
        {focusing ? <G>{[52, 58, 64].map((y, i) => <Rect key={y} x="101" y={y} width={[30, 38, 22][i]} height="3" rx="1.5" fill="#FFFFFF" opacity={0.8} />)}</G> : null}
        <Path d="M84 80 H158 L152 86 H90 Z" fill="#56616E" />
        {/* books */}
        <Rect x="170" y="62" width="34" height="8" rx="2" fill="#E2715E" />
        <Rect x="173" y="54" width="30" height="8" rx="2" fill="#5EA8E2" />
        <Rect x="171" y="46" width="32" height="8" rx="2" fill="#7CC48E" />
        {/* plant */}
        <Path d="M214 60 Q206 40 216 36 Q220 48 218 60 Z" fill="#4FA66A" />
        <Path d="M220 60 Q230 42 236 46 Q230 56 222 62 Z" fill="#62B97B" />
        <Rect x="210" y="60" width="18" height="16" rx="3" fill="#D98C5F" />
        {/* mug */}
        <Rect x="62" y="68" width="14" height="14" rx="3" fill="#FFFFFF" />
        <Path d="M76 71 Q82 75 76 79" stroke="#FFFFFF" strokeWidth="2.5" fill="none" />
        {/* desk */}
        <Rect x="0" y="86" width="240" height="12" rx="3" fill="url(#wood)" />
        <Rect x="14" y="98" width="10" height="22" fill="#7A4B2A" />
        <Rect x="216" y="98" width="10" height="22" fill="#7A4B2A" />
      </Svg>
      {focusing ? (
        <Animated.View style={[styles.steam, { opacity: steam ? range(steam, 0.15, 0.6) : 0.4, transform: [{ translateY: range(steam, 0, -6) }] }]}>
          <Svg width={16} height={20} viewBox="0 0 16 20"><Path d="M8 20 Q2 14 8 10 Q14 6 8 0" stroke="#FFFFFF" strokeWidth="2" fill="none" /></Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const ISLAND: Record<ProjectTheme, { ground: string; edge: string; accent: string; roof: string }> = {
  meadow: { ground: '#8FD18F', edge: '#C9A06B', accent: '#5DAF6A', roof: '#E2715E' },
  beach: { ground: '#F3DDA0', edge: '#D9B677', accent: '#5DBFAE', roof: '#F08A5D' },
  forest: { ground: '#6DBA7A', edge: '#9C7A52', accent: '#3E8D52', roof: '#B5643C' },
  snow: { ground: '#EEF6FB', edge: '#B8CCDA', accent: '#9CC7E4', roof: '#5C8FD6' },
  desert: { ground: '#F0C987', edge: '#C99A5A', accent: '#D9894A', roof: '#9B5DE5' },
  sky: { ground: '#D6E4FF', edge: '#A3B8E8', accent: '#8FA8F0', roof: '#F27BAA' },
};

/** A project island. `stage` 0..5 adds a sign, a hut, a tree, a house, then a flag and lights (`lit`). It pops a
 * little when a stage is added. */
export function ProjectIslandArt({ theme, stage, lit, size = 128 }: { theme: ProjectTheme; stage: number; lit: boolean; size?: number }) {
  const c = ISLAND[theme] ?? ISLAND.meadow;
  const bob = useLoop(2400);
  const glow = useLoop(1400, lit);
  const pop = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const shown = useRef(stage);
  useEffect(() => {
    if (stage <= shown.current) { shown.current = stage; return; }
    shown.current = stage;
    if (reduce) return;
    pop.setValue(0.85);
    const anim = Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [stage, reduce, pop]);
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: range(bob, 0, -3) }, { scale: pop }] }}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {lit ? <Animated.View style={[styles.islandGlow, { width: size, height: size, borderRadius: size / 2, opacity: glow ? range(glow, 0.25, 0.55) : 0.4 }]} /> : null}
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          <RadialGradient id={`sea-${theme}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0.6" stopColor="#7FD0F0" stopOpacity="0.9" /><Stop offset="1" stopColor="#7FD0F0" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx="60" cy="88" rx="56" ry="20" fill={`url(#sea-${theme})`} />
        <Ellipse cx="60" cy="84" rx="44" ry="13" fill={c.edge} />
        <Ellipse cx="60" cy="80" rx="42" ry="12" fill={c.ground} />
        {stage >= 1 ? <G><Rect x="22" y="66" width="3" height="12" fill="#8E5A34" /><Rect x="16" y="62" width="16" height="7" rx="1.5" fill="#C98E5A" /></G> : null}
        {stage >= 1 ? <Path d="M30 84 Q50 76 60 80 T92 78" stroke="#E7D3A8" strokeWidth="3" fill="none" strokeDasharray="4 3" /> : null}
        {stage >= 2 ? <G><Rect x="74" y="62" width="18" height="14" fill="#F2E2C4" /><Polygon points="72,63 83,52 94,63" fill={c.roof} /><Rect x="80" y="68" width="5" height="8" fill="#8E5A34" /></G> : null}
        {stage >= 3 ? <G><Rect x="38" y="60" width="4" height="16" fill="#8E5A34" /><Circle cx="40" cy="54" r="10" fill={c.accent} /><Circle cx="34" cy="58" r="6" fill={c.accent} /></G> : null}
        {stage >= 4 ? <G><Rect x="50" y="46" width="20" height="30" fill="#FFF6E5" /><Polygon points="47,48 60,32 73,48" fill={c.roof} />
          <Rect x="55" y="54" width="5" height="5" fill={lit ? '#FFE27A' : '#9CC7E4'} /><Rect x="62" y="54" width="5" height="5" fill={lit ? '#FFE27A' : '#9CC7E4'} />
          <Rect x="57" y="64" width="6" height="12" fill="#8E5A34" /></G> : null}
        {stage >= 5 ? <G><Rect x="59.5" y="18" width="1.5" height="16" fill="#56616E" /><Path d="M61 18 L74 22 L61 26 Z" fill="#F6C945" /></G> : null}
        {lit ? <G>{[[30, 70], [92, 70], [48, 82], [76, 84]].map(([x, y]) => <Circle key={`${x}`} cx={x} cy={y} r="2" fill="#FFE27A" />)}</G> : null}
      </Svg>
    </Animated.View>
  );
}

/** A reward chest: grey and locked, bouncing and glowing when ready, open with its lid up once opened. */
export function ChestArt({ status, size = 64, opening = false }: { status: 'locked' | 'ready' | 'opened'; size?: number; opening?: boolean }) {
  const bounce = useLoop(700, status === 'ready' && !opening);
  const lid = useRef(new Animated.Value(status === 'opened' ? 1 : 0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    const open = status === 'opened' || opening;
    if (reduce) { lid.setValue(open ? 1 : 0); return; }
    const anim = Animated.spring(lid, { toValue: open ? 1 : 0, friction: 5, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [status, opening, reduce, lid]);
  const locked = status === 'locked';
  const body = locked ? '#A7B4C0' : '#C47A3D';
  const band = locked ? '#7F8C99' : '#F6C945';
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: range(bounce, 0, -5) }] }}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {status === 'ready' ? <View style={[styles.chestGlow, { width: size, height: size, borderRadius: size / 2 }]} /> : null}
      <Svg width={size} height={size} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
        <Rect x="10" y="30" width="44" height="24" rx="4" fill={body} />
        <Rect x="10" y="38" width="44" height="4" fill={band} />
        <Rect x="28" y="34" width="8" height="10" rx="2" fill={band} />
        {locked ? <Circle cx="32" cy="39" r="2" fill="#56616E" /> : null}
        {status === 'opened' ? <G>{[[22, 26], [32, 22], [42, 26]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r="3" fill="#FFE27A" />)}</G> : null}
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [
        { translateY: lid.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.18] }) },
        { rotate: lid.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-28deg'] }) },
      ] }]}>
        <Svg width={size} height={size} viewBox="0 0 64 64">
          <Path d="M10 30 Q10 18 32 18 Q54 18 54 30 Z" fill={locked ? '#8F9CA8' : '#A9632F'} />
          <Rect x="10" y="27" width="44" height="4" fill={band} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

/** Stars bursting out from the centre, once per `burstKey` change (none with reduced motion). */
export function StarBurst({ burstKey, color = '#F6C945' }: { burstKey: number; color?: string }) {
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!burstKey || reduce) return;
    t.setValue(0);
    const anim = Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [burstKey, reduce, t]);
  if (!burstKey || reduce) return null;
  return (
    <View style={styles.burst} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 8;
        return (
          <Animated.Text key={i} style={[styles.star, { color, opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 60] }) },
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 60] }) },
              { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.2, 0.8] }) },
            ] }]}>★</Animated.Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cloud: { position: 'absolute' },
  desk: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  lampGlow: { position: 'absolute', left: '6%', bottom: '18%', width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFE9A8' },
  steam: { position: 'absolute', left: '28%', bottom: '38%' },
  islandGlow: { position: 'absolute', backgroundColor: '#FFE27A' },
  chestGlow: { position: 'absolute', backgroundColor: '#FFE9A8', opacity: 0.55 },
  burst: { position: 'absolute', left: '50%', top: '45%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
  star: { position: 'absolute', fontSize: 20, fontWeight: '900' },
});
