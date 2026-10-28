import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Typography';
import { useReduceMotion } from '../components/useReduceMotion';
import { appTheme as t } from '../theme';
import type { IconName } from './kit';

export type ToastTone = 'success' | 'info' | 'error';
export type ToastAction = { label: string; onPress: () => void };
type Toast = { id: number; message: string; tone: ToastTone; action?: ToastAction };

const TONES: Record<ToastTone, { icon: IconName; color: string }> = {
  success: { icon: 'checkmark-circle', color: '#1F9D6A' },
  info: { icon: 'information-circle', color: t.accent },
  error: { icon: 'alert-circle', color: t.danger },
};
const VISIBLE_MS = 2600;

const ToastContext = createContext<((message: string, tone?: ToastTone, action?: ToastAction) => void) | null>(null);
const MuteContext = createContext<((muted: boolean) => void) | null>(null);

/** `const toast = useToast(); toast('Đã lưu!');` — a small notice that floats at the top and hides itself. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** `useMuteToasts()(true)` drops new toasts and hides the current one, e.g. while focus mode is on. */
export function useMuteToasts() {
  const ctx = useContext(MuteContext);
  if (!ctx) throw new Error('useMuteToasts must be used inside <ToastProvider>');
  return ctx;
}

/** Hosts toasts above every screen, so a toast survives navigation (e.g. from login to home). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(1);
  const muted = useRef(false);
  const show = useCallback((message: string, tone: ToastTone = 'success', action?: ToastAction) => {
    if (!muted.current) setToast({ id: nextId.current++, message, tone, action });
  }, []);
  const mute = useCallback((value: boolean) => { muted.current = value; if (value) setToast(null); }, []);
  return (
    <ToastContext.Provider value={show}><MuteContext.Provider value={mute}>
      <View style={styles.fill}>
        {children}
        {toast ? <ToastView key={toast.id} toast={toast} onHide={() => setToast((cur) => (cur?.id === toast.id ? null : cur))} /> : null}
      </View>
    </MuteContext.Provider></ToastContext.Provider>
  );
}

function ToastView({ toast, onHide }: { toast: Toast; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const tone = TONES[toast.tone];
  // Parent re-renders pass a new callback; keep the latest without restarting the hide timer.
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    const animate = (toValue: number, done?: () => void) => {
      if (reduceMotion) { anim.setValue(toValue); done?.(); return; }
      Animated.timing(anim, { toValue, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => done?.());
    };
    animate(1);
    const timer = setTimeout(() => animate(0, () => onHideRef.current()), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [anim, reduceMotion]);

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }}>
        <View style={styles.toast}>
          {/* The message is one accessible alert; its button stays a separate element screen readers can reach. */}
          <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={toast.message} style={styles.message}>
            <Ionicons name={tone.icon} size={20} color={tone.color} />
            <Text style={styles.text}>{toast.message}</Text>
          </View>
          {toast.action ? <Pressable onPress={() => { toast.action?.onPress(); onHide(); }} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.text, { color: t.accent, fontWeight: '900' }]}>{toast.action.label}</Text>
          </Pressable> : <Pressable onPress={onHide} accessibilityRole="button" accessibilityLabel="Đóng thông báo" hitSlop={8}>
            <Ionicons name="close" size={17} color={t.muted} />
          </Pressable>}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 999,
    paddingVertical: 10, paddingLeft: 12, paddingRight: 16,
    shadowColor: '#0A2438', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  text: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: t.ink },
});
