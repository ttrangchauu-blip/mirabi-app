import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components/Typography';

/**
 * How a plant's tier looks in Vườn nhà (the tiers and their names are the backend's, garden_catalog.py): grey-green,
 * blue, purple, gold, and a rainbow for legendary. Always the name with the colour, never the colour alone; text keeps
 * at least 4.5:1 contrast on its background. A tier this app version doesn't know looks like a common one.
 */
export type TierLook = { color: string; bg: string; border: string; dot: string; rainbow?: readonly [string, string, ...string[]] };
export const TIER: Record<string, TierLook> = {
  common: { color: '#3D6446', bg: '#E5F1E3', border: '#A9CBA6', dot: '#8DB58A' },
  uncommon: { color: '#145EA0', bg: '#DDEBFA', border: '#8DB8E6', dot: '#4C93DB' },
  rare: { color: '#6531B0', bg: '#EEE5FF', border: '#BFA2EE', dot: '#9A6BE0' },
  epic: { color: '#7A5300', bg: '#FFF1C2', border: '#E6C04F', dot: '#E9B52E' },
  legendary: { color: '#8A2D5E', bg: '#FDEBF4', border: '#E7A6CB', dot: '#E67AB8',
    rainbow: ['#FFD9E0', '#FFF0C2', '#DDF5D6', '#D6ECFF', '#ECDDFF'] },
};
export const tierOf = (id: string | undefined) => TIER[id ?? ''] ?? TIER.common;

/** The tier's name in its colours: a small pill. */
export function TierPill({ tier, label, style, small }: { tier: string | undefined; label: string; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const look = tierOf(tier);
  const text = <Text style={[s.text, small && s.textSmall, { color: look.color }]} numberOfLines={1}>{label}</Text>;
  if (look.rainbow) {
    return <LinearGradient colors={look.rainbow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.pill, small && s.pillSmall, { borderColor: look.border }, style]}>{text}</LinearGradient>;
  }
  return <View style={[s.pill, small && s.pillSmall, { backgroundColor: look.bg, borderColor: look.border }, style]}>{text}</View>;
}

/** "8 phút", "2 giờ", "1 giờ 30 phút": a growing time. */
export function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}
/** How long until `iso`, told from the server's clock when there is one. */
export function timeLeft(iso: string, serverNow?: string) {
  const now = serverNow ? Date.parse(serverNow) : NaN;
  const seconds = (Date.parse(iso) - (Number.isNaN(now) ? Date.now() : now)) / 1000;
  return seconds < 60 ? 'dưới 1 phút' : duration(seconds);
}

const s = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  pillSmall: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  text: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  textSmall: { fontSize: 10, lineHeight: 13 },
});
