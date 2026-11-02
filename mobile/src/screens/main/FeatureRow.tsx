import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { radius, type Tone, tones, type as typeScale } from '../../ui/design';
import { Card, IconName } from '../../ui/kit';

type RowProps = { icon: IconName; tone: Tone; title: string; subtitle: string; first?: boolean };

export function FeatureGroup({ children }: { children: React.ReactNode }) {
  return <Card style={s.group}>{children}</Card>;
}

/** One way into a feature, the same everywhere: an illustrated badge, what it is, what it is for. */
export function FeatureRow({ icon, tone, title, subtitle, onPress, testID, first }: RowProps & { onPress?: () => void; testID?: string }) {
  if (!onPress) return null;
  const c = tones[tone];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}: ${subtitle}`} testID={testID}
      style={({ pressed }) => [s.row, !first && s.divider, pressed && s.pressed]}>
      <LinearGradient colors={[c.from, c.to]} style={s.badge}><Ionicons name={icon} size={19} color={c.ink} /></LinearGradient>
      <View style={s.flex}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={t.muted} />
    </Pressable>
  );
}

/** Something to read, not to open: a fact about the app, or what doesn't exist yet (`soon`). It looks and acts like no button. */
export function InfoRow({ icon, tone, title, subtitle, soon, first }: RowProps & { soon?: boolean }) {
  const c = tones[tone];
  return (
    <View style={[s.row, !first && s.divider]} accessible accessibilityLabel={`${title}: ${subtitle}${soon ? '. Sắp có' : ''}`}>
      <LinearGradient colors={[c.from, c.to]} style={[s.badge, soon && s.waiting]}><Ionicons name={icon} size={19} color={c.ink} /></LinearGradient>
      <View style={s.flex}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      {soon ? <View style={s.pill}><Text style={s.pillText}>Sắp có</Text></View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  group: { paddingVertical: 4, paddingHorizontal: 14 },
  pressed: { opacity: 0.88 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: t.tint },
  badge: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  waiting: { opacity: 0.55 },
  title: { ...typeScale.label, color: t.ink },
  subtitle: { ...typeScale.caption, fontWeight: '600', color: t.muted },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: t.tint },
  pillText: { ...typeScale.micro, color: t.accent },
});
