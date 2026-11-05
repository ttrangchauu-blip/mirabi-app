import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, type ImageStyle, type LayoutChangeEvent, Pressable, type PressableProps, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { Text } from '../components/Typography';
import { appTheme } from '../theme';
import { type as typeScale } from '../ui/design';
import { useWorldMotion } from './budget';
import { DURATION, EASE } from './motion';

/**
 * The diorama kit: what Sổ tay kiến thức, Cùng bạn tiến bộ, Nhiệm vụ công việc, Hành trình sự nghiệp and Vườn tài chính
 * share, so five different places read as one world (docs/LIVING_WORLD.md, section "Năm không gian"). The light comes from
 * the upper left in all of them; things stand on a soft contact shadow; a thing you can press sinks when pressed. The
 * scenes are rendered 3D pictures (assets/world, from scripts/render-scenes); what is live is drawn over them. Loops go
 * through world/budget.ts: still with "reduce motion", fewer on a weak device.
 */

/** How long things take: a press, something opening, a change of scene, an achievement. */
export const BEAT = { press: 130, open: 280, scene: 420, triumph: 1200 } as const;

export const ink = { dark: appTheme.ink, soft: appTheme.muted, paper: appTheme.ink, onWood: appTheme.ink, onWoodSoft: appTheme.muted } as const;

// ------------------------------------------------------------------------------------------------ measuring
/** The size this view got from layout; `fallback` until then (and in tests, which have no layout). */
export function useSize(fallback: { width: number; height: number }) {
  const [size, setSize] = useState(fallback);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
  }, []);
  return [size, onLayout] as const;
}

/** The same number for the same text, so a book or a note keeps its size and tilt across reloads. */
export function hashOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ------------------------------------------------------------------------------------------------ pictures
/** A rendered picture at exactly this size. (On the web an image takes its file's own size unless it is told otherwise.) */
export const Plate = memo(function Plate({ source, width, height, opacity, style }: {
  source: ImageSourcePropType; width: number; height: number; opacity?: number; style?: StyleProp<ImageStyle>;
}) {
  return <Image source={source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors style={[s.plate, { width, height, opacity }, style]} />;
});

/** A rendered square as wide as this, repeating downwards until `height`: the pictures are made to meet without a seam. */
export const Tiles = memo(function Tiles({ source, width, height }: { source: ImageSourcePropType; width: number; height: number }) {
  const count = width > 0 ? Math.ceil(height / width) : 0;
  return (
    <View pointerEvents="none" style={[s.tiles, { width, height }]}>
      {Array.from({ length: count }, (_, i) => <Plate key={i} source={source} width={width} height={width + 1} style={{ top: i * width }} />)}
    </View>
  );
});

// ------------------------------------------------------------------------------------------------ objects
type HitProps = Omit<PressableProps, 'style' | 'children'> & { children: React.ReactNode; style?: StyleProp<ViewStyle>; sink?: number };

/** A thing in the scene you can press: it sinks a little under the finger and comes back. Only `transform` moves, so
 * what stands around it never shifts. */
export function Hit({ children, style, sink = 0.95, onPressIn, onPressOut, disabled, ...rest }: HitProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const { level } = useWorldMotion();
  const to = (value: number) => {
    if (level === 'still') return;
    Animated.timing(scale, { toValue: value, duration: BEAT.press, easing: EASE.ui, useNativeDriver: true }).start();
  };
  return (
    <Pressable disabled={disabled} {...rest}
      onPressIn={(e) => { to(sink); onPressIn?.(e); }} onPressOut={(e) => { to(1); onPressOut?.(e); }}>
      <Animated.View style={[style, disabled ? s.off : null, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** The soft shadow a thing leaves where it touches the ground: darkest under it, fading to nothing at its edge. */
export const ContactShadow = memo(function ContactShadow({ width, height, opacity = 0.3, color = '#22384A', style }: {
  width: number; height: number; opacity?: number; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const id = useMemo(() => `dio-shadow-${color.slice(1)}`, [color]);
  return (
    <View pointerEvents="none" style={[{ width, height }, style]}>
      <Svg width={width} height={height}>
        <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={1} /><Stop offset="0.55" stopColor={color} stopOpacity={0.55} /><Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient></Defs>
        <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={`url(#${id})`} opacity={opacity} />
      </Svg>
    </View>
  );
});

// ------------------------------------------------------------------------------------------------ what floats over a scene
/** The place's name and the way back, over the scene: one round knob and a small plaque, not a bar across it. */
export function SceneHeader({ title, subtitle, onBack, right, leading, tone = 'wood' }: {
  title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode; /** A small picture before the title. */ leading?: React.ReactNode; tone?: 'wood' | 'sky';
}) {
  return (
    <View style={s.header}>
      <Hit onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.knob}>
        <Ionicons name="chevron-back" size={22} color={appTheme.ink} />
      </Hit>
      <View style={[s.plaque, tone === 'sky' && s.plaqueSky, !!leading && s.plaqueRow]}>
        {leading}
        <View style={s.plaqueText}>
          <Text style={s.plaqueTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.plaqueSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </View>
      {right}
    </View>
  );
}

/** A round knob on the scene's header, or on the desk. `on` lights it. */
export function Knob({ icon, label, hint, on = false, onPress, disabled, testID, dot = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; hint?: string; on?: boolean; onPress: () => void; disabled?: boolean; testID?: string; dot?: boolean;
}) {
  return (
    <Hit onPress={onPress} disabled={disabled} hitSlop={6} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }} style={[s.knob, on && s.knobOn]}>
      <Ionicons name={icon} size={19} color={appTheme.accent} />
      {dot ? <View style={s.knobDot} /> : null}
    </Hit>
  );
}

/** A label cut from paper, lying on a scene: a name and its numbers, nothing more. */
export function Tag({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View style={[s.tag, style]} testID={testID}>{children}</View>;
}

/** A sheet of paper with a soft shadow: where text that has to be read lives in a scene. */
export function Paper({ children, style, testID, tint = '#FFFFFF' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; tint?: string }) {
  return <View style={[s.paper, { backgroundColor: tint }, style]} testID={testID}>{children}</View>;
}

/** The name of a part of a scene. */
export function Carved({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={s.carvedRow}>
      <Text style={s.carved} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ moments
/** A scene arriving: it fades and settles from a little below. Nothing moves with reduced motion. */
export function SceneIn({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { level } = useWorldMotion();
  const run = useRef(new Animated.Value(level === 'still' ? 1 : 0)).current;
  useEffect(() => {
    if (level === 'still') { run.setValue(1); return; }
    const anim = Animated.timing(run, { toValue: 1, duration: BEAT.scene, easing: EASE.ui, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={[style, { opacity: run, transform: [{ translateY: run.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{children}</Animated.View>;
}

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
/**
 * An achievement, once per new `play` number: a ring of light opens, sparks fly out and drift down (about 1.2 s). With
 * reduced motion only the soft glow fades in and out, so the moment is still seen. `play` 0 draws nothing.
 */
export const Triumph = memo(function Triumph({ play, color = '#FFD66B', size = 180, style }: { play: number; color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const { level } = useWorldMotion();
  const still = level === 'still';
  const t = useRef(new Animated.Value(0)).current;
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    if (!play) return;
    setShowing(true);
    t.setValue(0);
    const anim = Animated.timing(t, { toValue: 1, duration: still ? DURATION.slow : BEAT.triumph, easing: EASE.ui, useNativeDriver: true });
    anim.start(({ finished }) => { if (finished) setShowing(false); });
    return () => anim.stop();
  }, [play, still, t]);
  if (!play || !showing) return null;
  const half = size / 2;
  return (
    <View pointerEvents="none" style={[s.triumph, style]} testID="triumph" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={{ position: 'absolute', left: -half, top: -half, width: size, height: size, opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.85, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] }) }] }}>
        <Svg width={size} height={size}>
          <Defs><RadialGradient id="dio-triumph" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={color} stopOpacity={0.9} /><Stop offset="1" stopColor={color} stopOpacity={0} /></RadialGradient></Defs>
          <Ellipse cx={half} cy={half} rx={half} ry={half} fill="url(#dio-triumph)" />
        </Svg>
      </Animated.View>
      {still ? null : RAYS.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        const reach = half * (i % 2 ? 0.72 : 1);
        return <Animated.View key={deg} style={[s.spark, { backgroundColor: i % 3 === 2 ? '#FFFFFF' : color, opacity: t.interpolate({ inputRange: [0, 0.12, 0.75, 1], outputRange: [0, 1, 1, 0] }), transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * reach] }) },
          // The sparks fly out, slow down and start to fall.
          { translateY: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, Math.sin(rad) * reach, Math.sin(rad) * reach + 26] }) },
          { rotate: `${deg}deg` },
          { scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.2, 0.6] }) },
        ] }]} />;
      })}
    </View>
  );
});

const s = StyleSheet.create({
  plate: { position: 'absolute', left: 0, top: 0 },
  tiles: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  off: { opacity: 0.55 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  knob: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D6ECF7',
    shadowColor: appTheme.shadow, shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  knobOn: { backgroundColor: '#C6E6F8', borderColor: '#9ED9F5' },
  knobDot: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: '#7CE0A3', borderWidth: 1, borderColor: '#FFFFFF' },
  plaque: { flexShrink: 1, flexGrow: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 3, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)' },
  plaqueSky: { backgroundColor: 'rgba(255,255,255,0.92)' },
  plaqueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8, paddingHorizontal: 10 },
  plaqueText: { flexShrink: 1, minWidth: 0 },
  plaqueTitle: { ...typeScale.label, color: ink.onWood },
  plaqueSub: { ...typeScale.micro, fontWeight: '700', color: ink.onWoodSoft },
  tag: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#D6ECF7',
    shadowColor: appTheme.shadow, shadowOpacity: 0.14, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  paper: { borderRadius: 18, padding: 14, shadowColor: appTheme.shadow, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  carvedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  carved: { ...typeScale.label, color: appTheme.ink, flexShrink: 1 },
  triumph: { position: 'absolute', left: '50%', top: '42%', width: 0, height: 0 },
  spark: { position: 'absolute', left: -4, top: -4, width: 8, height: 8, borderRadius: 2 },
});
