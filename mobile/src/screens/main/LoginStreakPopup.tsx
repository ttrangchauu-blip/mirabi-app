import React, { useEffect, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { LoginStreakClaim } from '../../auth/AuthContext';
import { appTheme as t } from '../../theme';

const FLAME = '#E77832';

function streakMessage({ current_streak: current, longest_streak: longest }: LoginStreakClaim) {
  if (current === 1) return longest > 1 ? 'Một khởi đầu mới! Cùng nhau giữ lửa mỗi ngày nhé.' : 'Ngày đầu tiên của hành trình. Hẹn gặp lại bạn ngày mai!';
  if (current >= longest) return 'Đây là chuỗi dài nhất của bạn từ trước tới nay. Tiếp tục nhé!';
  return `Bạn đã quay lại ${current} ngày liên tiếp. Giữ vững phong độ nhé!`;
}

/**
 * Once-a-day login streak popup. Every number comes from the login response; closing it changes no streak data.
 * It is an overlay inside the app's own view tree, like ConfirmDialog, so it stays inside the phone frame on web.
 */
export function LoginStreakPopup({ claim, onClose, onOpenJourney }: { claim: LoginStreakClaim; onClose: () => void; onOpenJourney: () => void }) {
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const reward = claim.daily_exp_awarded + claim.milestone_exp_awarded;

  useEffect(() => {
    if (!reduceMotion) Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduceMotion, appear]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Đóng" accessibilityRole="button" />
      <Animated.View accessibilityRole="alert"
        style={[styles.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <View style={styles.flameCircle}><Ionicons name="flame" size={38} color={FLAME} /></View>
        <Text style={styles.eyebrow}>CHUỖI ĐĂNG NHẬP</Text>
        <Text style={styles.count}>{claim.current_streak} <Text style={styles.unit}>ngày liên tiếp</Text></Text>
        <Text style={styles.message}>{streakMessage(claim)}</Text>
        <View style={styles.stats}>
          {reward > 0 ? <View style={styles.pill}><Ionicons name="diamond" size={14} color="#1482B8" /><Text style={styles.pillText}>+{reward} EXP</Text></View> : null}
          <View style={styles.pill}><Ionicons name="trophy-outline" size={14} color="#956317" /><Text style={styles.pillText}>Kỷ lục {claim.longest_streak} ngày</Text></View>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={onOpenJourney} accessibilityRole="button" accessibilityLabel="Xem hành trình"
            style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
            <Text style={[styles.buttonText, { color: t.accent }]}>Xem hành trình</Text>
          </Pressable>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Tiếp tục"
            style={({ pressed }) => [styles.button, { backgroundColor: t.accent }, pressed && styles.pressed]}>
            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Tiếp tục</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,36,56,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 28, padding: 24, alignItems: 'center',
    shadowColor: '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  flameCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#FFF1E6', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  eyebrow: { color: FLAME, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  count: { color: t.ink, fontSize: 38, fontWeight: '900', marginTop: 2 },
  unit: { color: t.muted, fontSize: 16, fontWeight: '800' },
  message: { fontSize: 15, lineHeight: 22, color: t.muted, textAlign: 'center', marginTop: 6 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F4F8FB', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { color: t.ink, fontSize: 12, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' },
  button: { flex: 1, minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: t.tint },
  buttonText: { fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
