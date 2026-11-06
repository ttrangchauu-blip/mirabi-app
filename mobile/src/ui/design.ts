import type { StyleProp, ViewStyle } from 'react-native';
import { type Tone, themes } from './theme';

/**
 * Mirabi Design System: the one set of sizes, type, surfaces and tones every screen shares (docs/LIVING_WORLD.md).
 * Colours are in ui/theme.tsx (light and dark); this says how they are used. The kit (ui/kit.tsx) reads from here, so a screen
 * built with the kit follows it without knowing it.
 */

/** Corners: a card is always `lg`, a control inside it `md`, a badge `sm`. */
export const radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Touch targets (Android 48, iOS 44: 44 with hit slop where a row is tight). */
export const touch = { min: 44, control: 48 } as const;

/** One scale of text; every size is readable with Vietnamese diacritics (the line height leaves room for them). */
export const type = {
  display: { fontSize: 24, lineHeight: 31, fontWeight: '900' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
} as const;

/**
 * Depth, panels over a scene and the six tones depend on light or dark: a screen takes them from useTheme() /
 * makeStyles (ui/theme.tsx). These are the light ones, for code that has no theme at hand (tests, art).
 */
export const elevation = themes.light.elevation satisfies Record<string, StyleProp<ViewStyle>>;
export const glass = themes.light.glass;
export const tones = themes.light.tones;
export type { Tone };
