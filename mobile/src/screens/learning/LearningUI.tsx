import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import type { GameId } from '../../learning/types';
import { GAME_INFO } from '../../learning/labels';
import { appTheme as t } from '../../theme';
import type { IconName } from '../../ui/kit';

// The small building blocks shared by the screens of Học tập: one look for icons, tiles and page changes.

/** A screen of Học tập fades in and rises a few points (about 0.2 s). Nothing moves with reduced motion. */
/** A screen of Học tập comes in (a scene change): quick enough never to make the learner wait. */
export const PAGE_IN_MS = 260;

export function PageIn({ children, reduceMotion, style }: { children: React.ReactNode; reduceMotion?: boolean; style?: StyleProp<ViewStyle> }) {
  const shown = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { shown.setValue(1); return; }
    const animation = Animated.timing(shown, { toValue: 1, duration: PAGE_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [shown, reduceMotion]);
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={[style, { opacity: shown, transform: [{ translateY: rise }] }]}>{children}</Animated.View>;
}

export type Look = { icon: IconName; bg: string; color: string };

/** One pastel per kind of game, so a game looks the same in every list. */
const GAME_TONES: Record<GameId, Omit<Look, 'icon'>> = {
  word_shooter: { bg: '#DDF0FA', color: '#136FA8' }, meteor: { bg: '#DDF0FA', color: '#136FA8' },
  gate: { bg: '#EEEAFF', color: '#5141A8' }, bridge: { bg: '#EEEAFF', color: '#5141A8' }, grammar: { bg: '#EEEAFF', color: '#5141A8' },
  defense: { bg: '#FFF1D6', color: '#B86A00' }, math_bridge: { bg: '#FFF1D6', color: '#B86A00' },
  word_builder: { bg: '#FCE4F0', color: '#A3326B' }, spelling_detective: { bg: '#FCE4F0', color: '#A3326B' },
  sorting: { bg: '#E3F5E6', color: '#22703A' }, code_path: { bg: '#EEEAFF', color: '#5141A8' },
  order: { bg: '#E6F5F2', color: '#1F7A6B' }, match: { bg: '#FFF1D6', color: '#B86A00' }, choice: { bg: '#DDF0FA', color: '#136FA8' },
  lab: { bg: '#EEEAFF', color: '#5141A8' },
  timeline: { bg: '#F7ECD9', color: '#8A5A1E' }, sentence: { bg: '#DDF0FA', color: '#136FA8' },
  geometry: { bg: '#E1ECFB', color: '#2856A3' }, balance: { bg: '#E6F5F2', color: '#1F7A6B' },
  number_line: { bg: '#E0F4F7', color: '#16707F' }, step_solver: { bg: '#FFF1D6', color: '#B86A00' },
  story_detective: { bg: '#EFE8FA', color: '#5B3FA0' }, sentence_xray: { bg: '#FDE8EF', color: '#A8325A' },
};

export const gameLook = (game: GameId): Look =>
  ({ icon: GAME_INFO[game]?.icon ?? 'game-controller-outline', ...(GAME_TONES[game] ?? { bg: t.tint, color: t.accent }) });

/** The picture of a subject or a game: its icon on a soft pastel square. */
export function IconBadge({ look, size = 48 }: { look: Look; size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={Math.round(size * 0.52)} color={look.color} />
    </View>
  );
}

/** A round icon button of a header (Sổ tay, Kho lưu trữ…); `count` shows a number beside the icon. */
export function HeaderIcon({ icon, label, onPress, count, testID }: { icon: IconName; label: string; onPress: () => void; count?: number;
  testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID={testID}
      style={({ pressed }) => [styles.headerIcon, count ? styles.headerPill : null, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={t.accent} />
      {count ? <Text style={styles.count}>{count > 99 ? '99+' : count}</Text> : null}
    </Pressable>
  );
}

/** Shorter names for the grid tiles; the full name stays the title of the subject's screen and what is read aloud. */
const SHORT_NAMES: Record<string, string> = {
  'Giáo dục thể chất': 'Thể dục',
  'Giáo dục công dân': 'GDCD',
  'Giáo dục kinh tế và pháp luật': 'Kinh tế – Pháp luật',
  'Giáo dục quốc phòng và an ninh': 'Quốc phòng – An ninh',
  'Hoạt động trải nghiệm': 'Trải nghiệm',
  'Hoạt động trải nghiệm, hướng nghiệp': 'Trải nghiệm – Hướng nghiệp',
  'Tin học và Công nghệ': 'Tin học – Công nghệ',
  'Chuyên đề học tập lựa chọn': 'Chuyên đề',
  'Tiếng dân tộc thiểu số': 'Tiếng dân tộc',
};
export const shortSubjectName = (name: string) => SHORT_NAMES[name] ?? name;

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  headerIcon: { minWidth: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 4, shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  headerPill: { paddingHorizontal: 10 },
  count: { fontSize: 13, fontWeight: '900', color: t.accent },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
});
