import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { appTheme, authTheme } from '../theme';
import type { ThemeMode } from '../settings/accountSettings';

export type { ThemeMode };
export type Scheme = 'light' | 'dark';

/**
 * Mirabi's interface in light and dark. Every screen reads its colours from here (useTheme / makeStyles), never
 * `isDark ? '#…' : '#…'`. The keys of `t` are the ones of appTheme (bg, card, ink, muted, accent…) plus semantic
 * names (background, surface, textPrimary…) and what a dark interface needs on top (inputs, switches, scrims).
 *
 * This is the interface only. The scenes of the living world (sky, rooms, garden, weather) keep following the clock
 * and the weather: choosing dark in the daytime gives a dark interface over a daytime world, never "night".
 */
const lightApp = {
  ...appTheme,
  /** Text and icons on the primary gradient or a filled accent. */
  onPrimary: '#FFFFFF',
  /** A control filled with the accent (a selected chip, a round play button): white on it stays >= 4.5:1. */
  accentFill: appTheme.accent,
  /** A badge or button filled with the danger colour, with white on it. */
  dangerFill: appTheme.danger,
  surfaceSecondary: '#F4FAFE',
  inputBg: '#FFFFFF',
  inputBorder: '#C5E2F2',
  inputFocus: '#A9D6EE',
  placeholder: '#7F95A8',
  warning: '#7A4D00',
  warningBg: '#FFF4D2',
  info: '#1D5F8F',
  infoBg: '#E1F2FC',
  disabled: '#B9C8D4',
  /** Behind a modal or a bottom sheet. */
  scrim: 'rgba(10,36,56,0.35)',
  switchOn: '#7CC0E6',
  switchOff: '#D6E2EA',
  thumbOff: '#FFFFFF',
  /** A panel over a scene: the world shows through it. */
  glass: 'rgba(255,255,255,0.90)',
  glassBorder: 'rgba(255,255,255,0.95)',
  statusBar: 'dark-content' as 'dark-content' | 'light-content',
};
export type AppPalette = typeof lightApp & { background: string; surface: string; textPrimary: string; textSecondary: string; error: string; errorBg: string };

// Deep sea at night: a navy with a touch of indigo, cards a step lighter, pastel inks that keep Mirabi's colours.
const darkApp: typeof lightApp = {
  bg: '#101A2E',
  card: '#1B2944',
  accent: '#7CC8F2',
  ink: '#EAF3FB',
  muted: '#A8BCD2',
  hero: '#1E3656',
  tint: '#22385A',
  border: '#2C4264',
  track: '#273C5E',
  seaFoam: '#1A3A4C',
  backdrop: ['#0E182C', '#121F36', '#16243D'] as readonly [string, string, string],
  primary: ['#1A7BBF', '#0F76B3'] as readonly [string, string],
  shadow: '#000000',
  danger: '#FF8FA8',
  dangerBg: '#3B2033',
  success: '#6FD6A8',
  successBg: '#173A33',
  onPrimary: '#FFFFFF',
  accentFill: '#1A7BBF',
  dangerFill: '#C93A62',
  surfaceSecondary: '#22324F',
  inputBg: '#15223A',
  inputBorder: '#34507A',
  inputFocus: '#5DB3E6',
  placeholder: '#8296AE',
  warning: '#FFD27A',
  warningBg: '#3A3122',
  info: '#9ED7F7',
  infoBg: '#1C3452',
  disabled: '#4A5D78',
  scrim: 'rgba(0,0,0,0.55)',
  switchOn: '#3D8FC4',
  switchOff: '#3A4C66',
  thumbOff: '#C9D6E2',
  glass: 'rgba(24,37,62,0.92)',
  glassBorder: 'rgba(255,255,255,0.10)',
  statusBar: 'light-content',
};

const darkAuth: typeof authTheme = {
  gradient: ['#0E182C', '#13243E', '#0F2836'] as readonly [string, string, string],
  halo: ['#1A3858', '#1F4870', '#17404F'] as readonly [string, string, string],
  primary: authTheme.primary,
  success: authTheme.success,
  ink: darkApp.ink,
  muted: darkApp.muted,
  link: darkApp.accent,
  glass: 'rgba(27,41,68,0.88)',
  glassBorder: 'rgba(255,255,255,0.10)',
  inputBg: darkApp.inputBg,
  inputBorder: darkApp.inputBorder,
  inputFocus: darkApp.inputFocus,
  error: darkApp.danger,
  errorBg: darkApp.dangerBg,
  info: darkApp.info,
  infoBg: darkApp.infoBg,
  successText: darkApp.success,
  successBg: darkApp.successBg,
  sparkle: ['#FFFFFF', '#7CC8F2', '#5DB3E6', '#9ED7F7'] as readonly [string, string, string, string],
  shadow: '#000000',
};

/** The six tones of icons and tiles (see ui/design.ts): pastel on light, the same hues as deep tiles with pastel ink on dark. */
const lightTones = {
  sky: { ink: '#136FA8', from: '#E2F3FC', to: '#C6E6F8' },
  leaf: { ink: '#1F6B36', from: '#E4F6E2', to: '#C5EBC2' },
  sun: { ink: '#7A4D00', from: '#FFF4D2', to: '#FFE3A1' },
  rose: { ink: '#A3326B', from: '#FDE8F2', to: '#F9CEE2' },
  lilac: { ink: '#5141A8', from: '#EFECFF', to: '#DAD3FB' },
  sea: { ink: '#0B6577', from: '#DFF6FA', to: '#BDEBF3' },
};
const darkTones: typeof lightTones = {
  sky: { ink: '#9ED7F7', from: '#1D3A5A', to: '#24476E' },
  leaf: { ink: '#A3E2AC', from: '#1C3A2E', to: '#234A3A' },
  sun: { ink: '#FFD98A', from: '#3A3022', to: '#4A3D25' },
  rose: { ink: '#F7AACD', from: '#3D2339', to: '#4C2A47' },
  lilac: { ink: '#C6BCFF', from: '#2A2652', to: '#352F66' },
  sea: { ink: '#8FE3EE', from: '#173A47', to: '#1D4856' },
};

const elevationFor = (shadow: string, dark: boolean) => ({
  card: { shadowColor: shadow, shadowOpacity: dark ? 0.32 : 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  raised: { shadowColor: shadow, shadowOpacity: dark ? 0.4 : 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  floating: { shadowColor: dark ? '#000000' : '#0A2438', shadowOpacity: dark ? 0.45 : 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
});

function build(scheme: Scheme) {
  const dark = scheme === 'dark';
  const base = dark ? darkApp : lightApp;
  const t: AppPalette = { ...base, background: base.bg, surface: base.card, textPrimary: base.ink, textSecondary: base.muted, error: base.danger, errorBg: base.dangerBg };
  return {
    scheme,
    dark,
    t,
    auth: dark ? darkAuth : authTheme,
    tones: dark ? darkTones : lightTones,
    elevation: elevationFor(t.shadow, dark),
    glass: { backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassBorder },
  };
}
export const themes = { light: build('light'), dark: build('dark') } as const;
export type Theme = ReturnType<typeof build>;
export type Tone = keyof typeof lightTones;

type Context = Theme & { mode: ThemeMode; setMode: (mode: ThemeMode) => void };
const ThemeContext = createContext<Context>({ ...themes.light, mode: 'system', setMode: () => {} });

/** This device's copy of the mode, so the look is right before sign-in and offline. The account keeps it too. */
export const THEME_KEY = 'mirabi.theme.v1';
const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';
export const resolveScheme = (mode: ThemeMode, system: string | null | undefined): Scheme => (mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode);

/** "Theo thiết bị" follows the device's light or dark setting as it changes, while the app is open. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_KEY).then((raw) => { if (active && isMode(raw)) setModeState(raw); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    if (!isMode(next)) return;
    setModeState(next);
    void AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
  }, []);
  const scheme = resolveScheme(mode, system);
  // The window behind the app (seen while the keyboard opens or a screen slides) takes the same background.
  useEffect(() => { SystemUI.setBackgroundColorAsync(themes[scheme].t.bg).catch(() => {}); }, [scheme]);
  const value = useMemo<Context>(() => ({ ...themes[scheme], mode, setMode }), [scheme, mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current theme: `t` (colours), `auth`, `tones`, `elevation`, `glass`, and the mode the user chose. */
export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Styles that depend on the theme, made once per scheme:
 *   const useStyles = makeStyles(({ t }) => StyleSheet.create({ title: { color: t.ink } }));
 *   function Screen() { const s = useStyles(); … }
 * `useStyles.of(theme)` gives the same styles outside a component (a helper given the theme).
 */
export function makeStyles<T>(factory: (theme: Theme) => T) {
  const cache = new Map<Scheme, T>();
  const of = (theme: Theme) => {
    let styles = cache.get(theme.scheme);
    if (!styles) { styles = factory(theme); cache.set(theme.scheme, styles); }
    return styles;
  };
  const useStyles = () => of(useContext(ThemeContext));
  useStyles.of = of;
  return useStyles;
}
