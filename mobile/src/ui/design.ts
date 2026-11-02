import type { StyleProp, ViewStyle } from 'react-native';
import { appTheme } from '../theme';

/**
 * Mirabi Design System: the one set of sizes, type, surfaces and tones every screen shares (docs/LIVING_WORLD.md).
 * Colours of the app stay in theme.ts; this says how they are used. The kit (ui/kit.tsx) reads from here, so a screen
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

/** Depth, from a card lying on the page to a panel floating over a scene. */
export const elevation = {
  card: { shadowColor: appTheme.shadow, shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  raised: { shadowColor: appTheme.shadow, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  floating: { shadowColor: '#0A2438', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
} as const satisfies Record<string, StyleProp<ViewStyle>>;

/** A panel over a scene: light enough to see the world through it, solid enough for its text at noon and at night. */
export const glass = { backgroundColor: 'rgba(255,255,255,0.90)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.95)' } as const;

/** The six tones of icons and tiles: every illustrated badge is one of these, deep on pastel at >= 4.5:1. */
export const tones = {
  sky: { ink: '#136FA8', from: '#E2F3FC', to: '#C6E6F8' },
  leaf: { ink: '#1F6B36', from: '#E4F6E2', to: '#C5EBC2' },
  sun: { ink: '#7A4D00', from: '#FFF4D2', to: '#FFE3A1' },
  rose: { ink: '#A3326B', from: '#FDE8F2', to: '#F9CEE2' },
  lilac: { ink: '#5141A8', from: '#EFECFF', to: '#DAD3FB' },
  sea: { ink: '#0B6577', from: '#DFF6FA', to: '#BDEBF3' },
} as const;
export type Tone = keyof typeof tones;
