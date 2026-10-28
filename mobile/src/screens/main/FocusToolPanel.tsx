import React, { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { focusTheme as f } from './focusSpaceTheme';
import { useViewportSize } from '../../components/MobileViewport';
import { AppModal } from '../../ui/AppModal';

type Props = { title: string; subtitle: string; desktop: boolean; onClose: () => void; children: React.ReactNode };

/** Inline desktop companion; modal sheet inside the app on narrow screens. Neither owns the timer. */
export function FocusToolPanel({ title, subtitle, desktop, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { height } = useViewportSize();
  const close = useRef<View>(null);
  useEffect(() => {
    if (!desktop || Platform.OS !== 'web') return;
    close.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    // Capture before TextInput consumes Escape, so keyboard users can always close the drawer.
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [desktop, onClose]);
  const content = <>
    <View style={s.header}>
      <View style={s.heading}><Text accessibilityRole="header" style={s.title}>{title}</Text><Text style={s.subtitle}>{subtitle}</Text></View>
      <Pressable ref={close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng công cụ" style={s.close}>
        <Ionicons name="close" size={20} color={f.ink} />
      </Pressable>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[s.body, { paddingBottom: Math.max(insets.bottom, 20) }]}>{children}</ScrollView>
  </>;
  if (desktop) return <View testID="focus-side-panel" style={[s.side, { height: Math.max(300, Math.min(700, height - 180)) }]} accessibilityLabel={title}>{content}</View>;
  return <AppModal visible transparent animationType={reduce ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng bảng công cụ" />
      <View testID="focus-bottom-sheet" accessibilityViewIsModal style={[s.sheet, { paddingTop: 8, marginTop: insets.top + 20 }]}>
        <View style={s.handle} />{content}
      </View>
    </KeyboardAvoidingView>
  </AppModal>;
}

const s = StyleSheet.create({
  side: { width: 350, height: 700, flexShrink: 0, minWidth: 0, maxHeight: 760, backgroundColor: f.paper, borderRadius: f.radius,
    borderWidth: 1, borderColor: '#FFFFFF', overflow: 'hidden', shadowColor: f.shadow, shadowOpacity: .07, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30,49,65,.28)' },
  sheet: { backgroundColor: f.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '86%', minHeight: '55%', overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#CDD4D6', alignSelf: 'center', marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 22, borderBottomWidth: 1, borderBottomColor: f.line },
  heading: { flex: 1, minWidth: 0 }, title: { color: f.ink, fontSize: 19, fontWeight: '800' }, subtitle: { color: f.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: f.cream },
  body: { padding: 22, gap: 14 },
});
