import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Typography';
import { useReduceMotion } from '../components/useReduceMotion';
import { appTheme as t } from '../theme';
import type { IconName } from './kit';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  /** null shows only the confirm button: a notice rather than a question. */
  cancelLabel?: string | null;
  icon?: IconName;
  /** Red confirm button for destructive actions such as logging out. */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);
let mounted: ((o: ConfirmOptions) => Promise<boolean>) | null = null;

/** For code outside components (e.g. showAlert): opens the in-app dialog, or returns null when none is mounted. */
export function confirmInApp(o: ConfirmOptions): Promise<boolean> | null {
  return mounted ? mounted(o) : null;
}

/** `const confirm = useConfirm(); if (await confirm({...})) doIt();` — shows the in-app dialog. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

/**
 * Hosts the in-app confirmation dialog. It is an overlay inside the app's own view tree (not a native alert or
 * browser confirm), so it looks the same on every platform and stays inside the phone frame on web.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false); // a newer request replaces an open one
    pendingRef.current = { ...o, resolve };
    setPending(pendingRef.current);
  }), []);
  const close = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(ok);
  }, []);
  useEffect(() => {
    mounted = confirm;
    return () => { if (mounted === confirm) mounted = null; };
  }, [confirm]);
  return (
    <ConfirmContext.Provider value={confirm}>
      <View style={styles.fill}>
        {children}
        {pending ? <Dialog options={pending} onClose={close} /> : null}
      </View>
    </ConfirmContext.Provider>
  );
}

function Dialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const reduceMotion = useReduceMotion();
  const insets = useSafeAreaInsets();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const { title, message, confirmLabel, cancelLabel = 'Hủy', icon = 'help-circle-outline', destructive } = options;

  useEffect(() => {
    if (!reduceMotion) Animated.timing(appear, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduceMotion, appear]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(false); return true; });
    return () => sub.remove();
  }, [onClose]);

  const accent = destructive ? t.danger : t.accent;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
      accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose(false)} accessibilityLabel={cancelLabel ?? confirmLabel} accessibilityRole="button" />
      <Animated.View accessibilityRole="alert" style={[styles.card, {
        transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }]}>
        <View style={[styles.iconCircle, { backgroundColor: destructive ? t.dangerBg : t.tint }]}>
          <Ionicons name={icon} size={30} color={accent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        <ScrollView style={styles.messageScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.message}>{message}</Text>
        </ScrollView>
        <View style={styles.actions}>
          {cancelLabel === null ? null : <Pressable onPress={() => onClose(false)} accessibilityRole="button" accessibilityLabel={cancelLabel}
            style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
            <Text style={[styles.buttonText, { color: t.accent }]}>{cancelLabel}</Text>
          </Pressable>}
          <Pressable onPress={() => onClose(true)} accessibilityRole="button" accessibilityLabel={`Xác nhận ${confirmLabel.toLowerCase()}`}
            style={({ pressed }) => [styles.button, { backgroundColor: accent }, pressed && styles.pressed]}>
            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: 'rgba(10,36,56,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 360, maxHeight: '100%', backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center',
    shadowColor: '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 21, fontWeight: '900', color: t.ink, textAlign: 'center' },
  messageScroll: { flexShrink: 1, alignSelf: 'stretch', marginTop: 8 },
  message: { fontSize: 15, lineHeight: 22, color: t.muted, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' },
  button: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: t.tint },
  buttonText: { fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
