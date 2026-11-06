import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { PET_STAGE_NAMES } from '../../components/PetEvolutionProgress';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { makeStyles, useTheme } from '../../ui/theme';

type Props = { petId: string; petName: string; level: number;
  /** Every goal of today is done: the walk starts once this is closed. */ walkNext: boolean;
  confirming: boolean; error: string | null; onConfirm: () => void };

/**
 * The congratulations after the egg has hatched. Closing it is what tells the backend the hatch is done, so the pet's
 * walk can only start afterwards. Like PetRewardPopup, it is an overlay inside the app's view tree.
 */
export function PetHatchedPopup({ petId, petName, level, walkNext, confirming, error, onConfirm }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (!reduceMotion) Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduceMotion, appear]);
  // Closed only with the button, which confirms the hatch.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]} accessibilityViewIsModal>
      <Animated.View accessibilityRole="alert" style={[styles.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <View style={styles.pet}><PetCompanion pet={petId} size={96} stage={level} /></View>
        <Text style={styles.title} accessibilityRole="header">Chúc mừng! {petName} đã nở!</Text>
        <Text style={styles.message}>{`Lv.${level} ${PET_STAGE_NAMES[level] ?? ''}`.trim()} · Hãy cùng {petName} tiến bộ mỗi ngày nhé!</Text>
        {walkNext ? <View style={styles.next}>
          <Ionicons name="footsteps-outline" size={16} color={t.accent} />
          <Text style={styles.nextText}>{petName} sẽ bắt đầu đi khám phá ngay sau đây</Text>
        </View> : null}
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Pressable onPress={onConfirm} disabled={confirming} accessibilityRole="button" accessibilityLabel="Tuyệt vời"
          accessibilityState={{ busy: confirming, disabled: confirming }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, confirming && styles.busy]}>
          {confirming ? <ActivityIndicator color={t.onPrimary} /> : <Ionicons name="sparkles" size={18} color={t.onPrimary} />}
          <Text style={styles.buttonText}>{confirming ? 'Đang lưu…' : 'Tuyệt vời!'}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  backdrop: { backgroundColor: t.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: t.card, borderRadius: 28, padding: 22, alignItems: 'center',
    shadowColor: dark ? t.shadow : '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  pet: { height: 104, justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 21, fontWeight: '900', color: t.ink, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 21, color: t.muted, textAlign: 'center', marginTop: 6 },
  next: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14,
    backgroundColor: t.tint, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  nextText: { flexShrink: 1, color: t.accent, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  error: { color: t.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  button: { alignSelf: 'stretch', minHeight: 50, borderRadius: 16, marginTop: 18, backgroundColor: t.accentFill,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: t.onPrimary, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  busy: { opacity: 0.8 },
}));
