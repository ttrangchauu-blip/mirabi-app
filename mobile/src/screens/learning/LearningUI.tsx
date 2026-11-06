import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import type { GameId } from '../../learning/types';
import { GAME_INFO } from '../../learning/labels';
import { appTheme } from '../../theme';
import { makeStyles, useTheme, type Theme, type Tone } from '../../ui/theme';
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

/** `tone` is the look's family on dark (a deep tile with pastel ink); without one it is guessed from `color`. */
export type Look = { icon: IconName; bg: string; color: string; tone?: Tone | 'neutral' };

/** One pastel per kind of game, so a game looks the same in every list. */
const GAME_TONES: Record<GameId, Omit<Look, 'icon'>> = {
  word_shooter: { bg: '#DDF0FA', color: '#136FA8', tone: 'sky' }, meteor: { bg: '#DDF0FA', color: '#136FA8', tone: 'sky' },
  gate: { bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' }, bridge: { bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' },
  grammar: { bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' },
  defense: { bg: '#FFF1D6', color: '#B86A00', tone: 'sun' }, math_bridge: { bg: '#FFF1D6', color: '#B86A00', tone: 'sun' },
  word_builder: { bg: '#FCE4F0', color: '#A3326B', tone: 'rose' }, spelling_detective: { bg: '#FCE4F0', color: '#A3326B', tone: 'rose' },
  sorting: { bg: '#E3F5E6', color: '#22703A', tone: 'leaf' }, code_path: { bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' },
  order: { bg: '#E6F5F2', color: '#1F7A6B', tone: 'sea' }, match: { bg: '#FFF1D6', color: '#B86A00', tone: 'sun' },
  choice: { bg: '#DDF0FA', color: '#136FA8', tone: 'sky' },
  lab: { bg: '#EEEAFF', color: '#5141A8', tone: 'lilac' },
  timeline: { bg: '#F7ECD9', color: '#8A5A1E', tone: 'sun' }, sentence: { bg: '#DDF0FA', color: '#136FA8', tone: 'sky' },
  geometry: { bg: '#E1ECFB', color: '#2856A3', tone: 'sky' }, balance: { bg: '#E6F5F2', color: '#1F7A6B', tone: 'sea' },
  number_line: { bg: '#E0F4F7', color: '#16707F', tone: 'sea' }, step_solver: { bg: '#FFF1D6', color: '#B86A00', tone: 'sun' },
  story_detective: { bg: '#EFE8FA', color: '#5B3FA0', tone: 'lilac' }, sentence_xray: { bg: '#FDE8EF', color: '#A8325A', tone: 'rose' },
};

export const gameLook = (game: GameId): Look =>
  ({ icon: GAME_INFO[game]?.icon ?? 'game-controller-outline', ...(GAME_TONES[game] ?? { bg: appTheme.tint, color: appTheme.accent, tone: 'sky' }) });

/** The hue of each tone's ink, to place a colour that has no tone (a subject's colours come from the backend). */
const TONE_HUES: [Tone, number][] = [['sky', 203], ['leaf', 138], ['sun', 38], ['rose', 330], ['lilac', 249], ['sea', 190]];
function toneOf(hex: string): Tone | 'neutral' {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'sky';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!max || d / max < 0.25) return 'neutral';
  const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const hue = (h + 360) % 360;
  const gap = (x: number) => Math.min(Math.abs(hue - x), 360 - Math.abs(hue - x));
  return TONE_HUES.reduce((best, cur) => (gap(cur[1]) < gap(best[1]) ? cur : best))[0];
}

/** A look as drawn in the current theme: its own pastel on light; on dark, its tone as a deep tile with pastel ink. */
export function themedLook(look: Look, theme: Pick<Theme, 'dark' | 't' | 'tones'>): Look {
  if (!theme.dark) return look;
  const tone = look.tone ?? toneOf(look.color);
  if (tone === 'neutral') return { ...look, bg: theme.t.surfaceSecondary, color: theme.t.muted };
  return { ...look, bg: theme.tones[tone].from, color: theme.tones[tone].ink };
}

/** The picture of a subject or a game: its icon on a soft pastel square. */
export function IconBadge({ look: given, size = 48 }: { look: Look; size?: number }) {
  const theme = useTheme();
  const styles = useStyles();
  const look = themedLook(given, theme);
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={Math.round(size * 0.52)} color={look.color} />
    </View>
  );
}

/** A round icon button of a header (Sổ tay, Kho lưu trữ…); `count` shows a number beside the icon. */
export function HeaderIcon({ icon, label, onPress, count, testID }: { icon: IconName; label: string; onPress: () => void; count?: number;
  testID?: string }) {
  const { t } = useTheme();
  const styles = useStyles();
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

const useStyles = makeStyles(({ t }) => StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  headerIcon: { minWidth: 40, height: 40, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 4, shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  headerPill: { paddingHorizontal: 10 },
  count: { fontSize: 13, fontWeight: '900', color: t.accent },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
}));
