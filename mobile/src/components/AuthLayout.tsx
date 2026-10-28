import React from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appTheme as t } from '../theme';
import { useViewportSize } from './MobileViewport';
import { PetCompanion } from './PetCompanion';
import { Sparkles } from './Sparkles';
import { Text } from './Typography';

type Props = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Pinned to the bottom of the screen, above the home indicator. */
  footer?: React.ReactNode;
  /** The app logo is only shown on the login screen. */
  showLogo?: boolean;
  /** Pet preview above the form (pet adoption). */
  showCompanion?: boolean;
  pet?: string;
  /** Shows a back button in the top-left corner. */
  onBack?: () => void;
};

/**
 * Shared shell for the signed-out and onboarding screens. Login (logo) and pet adoption (companion) center their
 * header; secondary screens (register, password reset) get a back button and a left-aligned title like the main app.
 */
export function AuthLayout({ title, subtitle, children, footer, showLogo = false, showCompanion = false, pet, onBack }: Props) {
  const { height, width } = useViewportSize();
  const insets = useSafeAreaInsets();
  const compact = height < 760;
  const centered = showLogo || showCompanion;
  const petSize = Math.min(compact ? 104 : 136, width * 0.34);
  const logoSize = compact ? 96 : 120;
  return (
    <LinearGradient colors={t.backdrop} style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      <Sparkles />
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
            <View style={styles.column}>
              {onBack ? (
                <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại" style={styles.back}>
                  <Ionicons name="chevron-back" size={24} color={t.ink} />
                </Pressable>
              ) : <View style={styles.topSpacer} />}
              <View style={[styles.main, centered && styles.mainCentered]}>
                <View style={[styles.hero, centered && styles.heroCentered]}>
                  {showLogo && <Image source={require('../../assets/logo.png')} accessibilityRole="image" accessibilityLabel="Mirabi"
                    style={[styles.logo, { width: logoSize, height: logoSize }]} />}
                  {showCompanion && <PetCompanion pet={pet} size={petSize} stage={0} interactive />}
                  <Text style={[styles.title, centered && styles.textCentered, compact && styles.titleCompact]} accessibilityRole="header">{title}</Text>
                  <Text style={[styles.subtitle, centered && styles.textCentered]}>{subtitle}</Text>
                </View>
                <View style={styles.card}>{children}</View>
              </View>
              {footer ? <View style={styles.footer}>{footer}</View> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  column: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: t.shadow, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  topSpacer: { height: 16 },
  main: { flexGrow: 1, paddingTop: 16 },
  mainCentered: { justifyContent: 'center', paddingTop: 0 },
  hero: { marginBottom: 20 },
  heroCentered: { alignItems: 'center' },
  logo: { marginBottom: 18 },
  title: { fontSize: 30, fontWeight: '900', color: t.ink, letterSpacing: -0.3 },
  titleCompact: { fontSize: 26 },
  subtitle: { fontSize: 15, lineHeight: 22, color: t.muted, marginTop: 6 },
  textCentered: { textAlign: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 20,
    shadowColor: t.shadow, shadowOpacity: 0.1, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  footer: { alignItems: 'center', paddingTop: 20, paddingBottom: 4 },
});
