import React, { forwardRef } from 'react';
import { Platform, StyleProp, StyleSheet, Text as RNText, TextInput as RNTextInput, TextInputProps, TextProps, TextStyle } from 'react-native';
import { nunito } from '../fonts';

/** Swap `fontWeight` for the matching Nunito file. An explicit `fontFamily` is left alone. */
function withNunito(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const { fontWeight, ...rest } = flat;
  return { ...rest, fontFamily: nunito(fontWeight) };
}

/** Drop-in replacements for React Native's Text/TextInput that render in Nunito. Use these for all UI text. */
export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...props }, ref) {
  return <RNText ref={ref} {...props} style={withNunito(style)} />;
});

// Web browsers draw a heavy focus ring on inputs; every input in the app shows its own soft focus border instead.
// Chrome's ring uses `outline-style: auto`, which ignores outline-width, so the style itself must be 'none'
// (valid CSS that react-native-web passes through, but missing from React Native's types).
const noWebOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} {...props} style={[withNunito(style), noWebOutline]} />;
});
