// Mirabi's main color is a light sea blue. Light tints carry the surfaces; text and buttons use deeper
// ocean blues so they keep >= 4.5:1 contrast (white on primary, ink/muted/link on the glass card ~#F4FAFE).
export const authTheme = {
  gradient: ['#E4F6FF', '#CDEDFB', '#DDF6F8'] as const, // morning sea: pale sky -> light sea blue -> sea foam
  halo: ['#C4EAFB', '#9ED9F5', '#D2F3F8'] as const,
  primary: ['#1A7BBF', '#0F76B3'] as const, // white text: 4.5:1 / 4.9:1
  success: ['#1F8A63', '#23966C'] as const,
  ink: '#123B5C',
  muted: '#4A6782',
  link: '#136FA8',
  glass: 'rgba(255,255,255,0.8)',
  glassBorder: 'rgba(255,255,255,0.95)',
  inputBg: '#FFFFFF',
  inputBorder: '#C5E2F2',
  inputFocus: '#2E9AD6',
  error: '#B4234F',
  errorBg: '#FFE7EE',
  info: '#1D5F8F',
  infoBg: '#E1F2FC',
  successText: '#17704F',
  successBg: '#E1F6EC',
  sparkle: ['#FFFFFF', '#9EDBF7', '#7CC8EE', '#C8F0FF'] as const,
  shadow: '#1F6E9E',
};

// Signed-in app palette, same sea-blue family.
export const appTheme = {
  bg: '#EAF7FD',
  card: '#FFFFFF',
  accent: '#136FA8', // text/buttons on white and light tints
  ink: authTheme.ink,
  muted: '#4F6C86',
  hero: '#D3EEFB',
  tint: '#DDF0FA',
  border: '#D6ECF7',
  track: '#DCEFF9',
  seaFoam: '#D8F6FF',
  /** Screen background, top to bottom. */
  backdrop: ['#D9F0FC', '#ECF7FD', '#F7FBFE'] as const,
  primary: authTheme.primary,
  shadow: authTheme.shadow,
  danger: '#B4234F',
  dangerBg: '#FFE7EE',
  success: '#17704F',
  successBg: '#E1F6EC',
};
