import { appTheme } from '../../theme';
import { themes } from '../../ui/theme';

/** Warm materials around Mirabi's existing sea-blue controls. */
export const focusTheme = {
  ink: '#304653', muted: '#61727B', blue: appTheme.accent, paper: '#FFFCF7',
  cream: '#F6F1E9', line: '#E4E7E5', lavender: '#EBE9F3', mint: '#E9F0E9',
  wood: '#BA8C70', shadow: '#657C8A', radius: 24,
};
export type FocusMaterials = typeof focusTheme;

/** The same materials in the dark interface: the deep-sea surfaces of the app, with the warm hues kept as deep tiles. */
const dark = themes.dark.t;
export const focusThemeDark: FocusMaterials = {
  ink: dark.ink, muted: dark.muted, blue: dark.accent, paper: dark.card,
  cream: dark.surfaceSecondary, line: dark.border, lavender: '#2A2652', mint: '#1C3A2E',
  wood: '#BA8C70', shadow: dark.shadow, radius: 24,
};

/** The focus space's materials for the current scheme: `focusThemeOf(theme.dark)` (theme from useTheme / makeStyles). */
export const focusThemeOf = (isDark: boolean): FocusMaterials => (isDark ? focusThemeDark : focusTheme);
