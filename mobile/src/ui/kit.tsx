import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleProp, StyleSheet, TextInputProps, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { avatarById } from '../avatars';
import { Text, TextInput } from '../components/Typography';
import { appTheme as t } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** 12450 -> "12.450" (Vietnamese grouping). */
export const formatNumber = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {action ? <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button"><Text style={styles.sectionAction}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

type ButtonProps = { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> };

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style }: ButtonProps) {
  const inactive = disabled || loading;
  const color = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? t.danger : t.accent;
  const content = (
    <>
      {loading ? <ActivityIndicator color={color} /> : icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </>
  );
  return (
    <Pressable onPress={onPress} disabled={inactive} accessibilityRole="button" accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [styles.buttonWrap, variant === 'primary' && styles.buttonShadow, pressed && !inactive && styles.pressed, inactive && styles.dimmed, style]}>
      {variant === 'primary'
        ? <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.button}>{content}</LinearGradient>
        : <View style={[styles.button, variant === 'secondary' && styles.secondary, variant === 'danger' && styles.dangerBtn]}>{content}</View>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={!onPress ? 'text' : selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected }}
      accessibilityLabel={label} style={[styles.chip, selected && styles.chipSelected]}>
      {icon ? <Ionicons name={icon} size={14} color={selected ? '#FFFFFF' : t.accent} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, color = t.accent, track = t.track, animated = false }: { value: number; color?: string; track?: string; animated?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const animatedPct = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    if (!animated) { animatedPct.setValue(pct); return; }
    const animation = Animated.timing(animatedPct, { toValue: pct, duration: 500, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [animated, animatedPct, pct]);
  const fill = animated
    ? <Animated.View style={[styles.fill, { width: animatedPct.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: color }]} />
    : <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />;
  return <View style={[styles.track, { backgroundColor: track }]}>{fill}</View>;
}

/** `theme` is a preset id from src/avatars.ts (users.avatar_theme); emoji presets replace the initial. */
export function Avatar({ name, size = 44, theme }: { name: string; size?: number; theme?: string | null }) {
  const preset = avatarById(theme);
  const initial = (name.trim()[0] ?? 'M').toUpperCase();
  return (
    <LinearGradient colors={preset.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      {preset.emoji
        ? <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.68 }}>{preset.emoji}</Text>
        : <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: size * 0.42 }}>{initial}</Text>}
    </LinearGradient>
  );
}

export function IconCircle({ name, color = t.accent, bg = t.tint, size = 44 }: { name: IconName; color?: string; bg?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2.6, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}

/** Multiline text box with a soft focus border, used for free-text inputs in the main app. */
export function SoftInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput {...props} placeholderTextColor="#7F95A8"
      onFocus={(e) => { setFocused(true); onFocus?.(e); }} onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[styles.softInput, focused && styles.softInputFocused, style]} />
  );
}

/** Two-option (or more) pill switch. `compact` uses smaller text so three labels fit on a phone. */
export function Segmented<T extends string>({ options, value, onChange, compact }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; compact?: boolean }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            accessibilityLabel={o.label} style={[styles.segment, active && styles.segmentActive]}>
            <Text numberOfLines={1} style={[styles.segmentText, compact && styles.segmentCompact, active && styles.segmentTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { backgroundColor: t.card, borderRadius: 24, padding: 18, marginBottom: 14,
    shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 12 },
  title: { fontSize: 30, fontWeight: '900', color: t.ink, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: t.muted, marginTop: 2 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: '900', color: t.ink },
  sectionAction: { fontSize: 14, fontWeight: '800', color: t.accent },
  buttonWrap: { borderRadius: 16, marginTop: 10 },
  buttonShadow: { shadowColor: t.shadow, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  button: { minHeight: 50, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  secondary: { backgroundColor: t.tint },
  dangerBtn: { backgroundColor: t.dangerBg },
  buttonText: { fontSize: 16, fontWeight: '800' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  dimmed: { opacity: 0.55 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: t.tint, minHeight: 38 },
  chipSelected: { backgroundColor: t.accent },
  chipText: { fontSize: 14, fontWeight: '700', color: t.accent },
  chipTextSelected: { color: '#FFFFFF' },
  track: { height: 8, borderRadius: 8, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 8 },
  softInput: { backgroundColor: t.bg, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent', paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 84, fontSize: 15, color: t.ink, textAlignVertical: 'top' },
  softInputFocused: { backgroundColor: '#FFFFFF', borderColor: '#A9D6EE' },
  segmented: { flexDirection: 'row', backgroundColor: t.tint, borderRadius: 16, padding: 4, marginBottom: 16 },
  segment: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: '#FFFFFF', shadowColor: t.shadow, shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segmentText: { fontSize: 15, fontWeight: '700', color: t.muted },
  segmentCompact: { fontSize: 13, paddingHorizontal: 4 },
  segmentTextActive: { color: t.accent, fontWeight: '800' },
});
