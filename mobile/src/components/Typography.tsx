import React, { createContext, forwardRef, useContext } from 'react';
import { Platform, StyleProp, StyleSheet, Text as RNText, TextInput as RNTextInput, TextInputProps, TextProps, TextStyle } from 'react-native';
import { nunito } from '../fonts';
import { useTheme } from '../ui/theme';

/** Swap `fontWeight` for the matching Nunito file. An explicit `fontFamily` is left alone. */
function withNunito(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: nunito(fontWeight) };
}

/**
 * Drop-in replacements for React Native's Text/TextInput that render in Nunito. Use these for all UI text. Text with no
 * colour of its own takes the theme's ink, so nothing is left black on a dark screen.
 */
// A Text inside another inherits its colour, as React Native does: only the outermost one gets the default.
const InText = createContext(false);
export const Text = forwardRef<RNText, TextProps>(function Text({ style, children, ...props }, ref) {
  const { t } = useTheme();
  const nested = useContext(InText);
  const text = <RNText ref={ref} {...props} style={withNunito(nested ? style : [{ color: t.ink }, style])}>{children}</RNText>;
  // The provider goes around the text, not inside it, so the text's own children stay exactly what was passed.
  return nested ? text : <InText.Provider value>{text}</InText.Provider>;
});

// Web browsers draw a heavy focus ring on inputs; every input in the app shows its own soft focus border instead.
// Chrome's ring uses `outline-style: auto`, which ignores outline-width, so the style itself must be 'none'
// (valid CSS that react-native-web passes through, but missing from React Native's types).
const noWebOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, placeholderTextColor, keyboardAppearance, ...props }, ref) {
  const { t, dark } = useTheme();
  return <RNTextInput ref={ref} {...props} placeholderTextColor={placeholderTextColor ?? t.placeholder} keyboardAppearance={keyboardAppearance ?? (dark ? 'dark' : 'light')}
    style={[withNunito([{ color: t.ink }, style]), noWebOutline]} />;
});
