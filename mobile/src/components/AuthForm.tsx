import React, { forwardRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput as RNTextInput, TextInputProps, View } from 'react-native';
import { Text, TextInput } from './Typography';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { authTheme } from '../theme';
import type { IconName } from '../ui/kit';

type FieldProps = Omit<TextInputProps, 'style'> & { label: string; error?: string; hint?: string; password?: boolean; /** Leading icon. */ icon?: IconName };

export const AuthTextField = forwardRef<RNTextInput, FieldProps>(function AuthTextField({ label, error, hint, password, icon, ...input }, ref) {
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, focused && styles.inputFocused, !!error && styles.inputError]}>
        {icon ? <Ionicons name={icon} size={20} color={error ? authTheme.error : focused ? authTheme.link : '#6F8BA3'} style={styles.icon} /> : null}
        <TextInput
          ref={ref}
          {...input}
          style={[styles.input, !!icon && styles.inputWithIcon]}
          placeholderTextColor="#7F95A8"
          secureTextEntry={password && !visible}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
        />
        {password && (
          <Pressable onPress={() => setVisible((v) => !v)} hitSlop={10} style={styles.toggle}
            accessibilityRole="button" accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
            <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={21} color={authTheme.link} />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
});

type ButtonProps = { title: string; onPress: () => void; loading?: boolean; loadingTitle?: string; disabled?: boolean };

export function GradientButton({ title, onPress, loading, loadingTitle, disabled }: ButtonProps) {
  const inactive = disabled || loading;
  const label = loading ? (loadingTitle ?? 'Đang xử lý…') : title;
  return (
    <Pressable onPress={onPress} disabled={inactive} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [styles.buttonWrap, pressed && !inactive && styles.pressed]}>
      <LinearGradient colors={authTheme.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[styles.button, disabled && !loading && styles.dimmed]}>
        {loading && <ActivityIndicator color="#FFFFFF" style={styles.spinner} />}
        <Text style={styles.buttonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function FormBanner({ tone, message }: { tone: 'error' | 'info' | 'success'; message: string }) {
  const palette = tone === 'error' ? [authTheme.errorBg, authTheme.error] : tone === 'success' ? [authTheme.successBg, authTheme.successText] : [authTheme.infoBg, authTheme.info];
  return (
    <View style={[styles.banner, { backgroundColor: palette[0] }]} accessibilityRole={tone === 'error' ? 'alert' : 'text'} accessibilityLiveRegion="assertive">
      <Text style={[styles.bannerText, { color: palette[1] }]}>{tone === 'error' ? '⚠︎ ' : tone === 'success' ? '✓ ' : 'ⓘ '}{message}</Text>
    </View>
  );
}

export function TextLink({ title, onPress, accessibilityLabel, align = 'center' }: { title: string; onPress: () => void; accessibilityLabel?: string; align?: 'center' | 'right' }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? title}
      style={[styles.link, align === 'right' && styles.linkRight]}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '800', color: authTheme.ink, marginBottom: 6, marginLeft: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4FAFE', borderRadius: 16, borderWidth: 1.5, borderColor: '#D7EAF5', minHeight: 54 },
  icon: { marginLeft: 14 },
  inputFocused: { backgroundColor: '#FFFFFF', borderColor: '#A9D6EE' },
  inputError: { borderColor: authTheme.error },
  input: { flex: 1, paddingHorizontal: 15, paddingVertical: 14, fontSize: 16, color: authTheme.ink },
  inputWithIcon: { paddingLeft: 10 },
  toggle: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  toggleText: { color: authTheme.link, fontWeight: '800', fontSize: 14 },
  error: { color: authTheme.error, fontSize: 13, marginTop: 5, marginLeft: 2 },
  hint: { color: authTheme.muted, fontSize: 12, marginTop: 5, marginLeft: 2 },
  buttonWrap: { borderRadius: 18, marginTop: 8, shadowColor: authTheme.shadow, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  button: { minHeight: 54, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  dimmed: { opacity: 0.6 },
  spinner: { marginRight: 10 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900', letterSpacing: 0.2 },
  banner: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  bannerText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  linkRight: { alignSelf: 'flex-end' },
  linkText: { color: authTheme.link, fontWeight: '800', fontSize: 14 },
});
