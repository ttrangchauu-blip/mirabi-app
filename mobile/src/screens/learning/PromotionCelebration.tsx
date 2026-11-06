import React, { useEffect, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { Sparkles } from '../../components/Sparkles';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { Celebration } from '../../learning/education';
import { makeStyles, useTheme } from '../../ui/theme';

type Props = { celebration: Celebration; petId: string; petLevel: number;
  /** "Khám phá lớp học mới" (or Android's back): records it as seen, so it is shown once per promotion. */
  onExplore: () => void };

const STARS = [
  { x: -118, y: -70, size: 22, delay: 0 }, { x: 112, y: -84, size: 18, delay: 180 }, { x: -96, y: 52, size: 16, delay: 360 },
  { x: 104, y: 46, size: 24, delay: 90 }, { x: 0, y: -116, size: 20, delay: 270 },
];

/** The new school year: the pet in the middle, light and stars around it, "Chúc mừng! Bạn đã lên lớp N!" and the new
 * school year. Like PetHatchedPopup, an overlay inside the app's view tree; still when the OS asks for less motion. */
export function PromotionCelebration({ celebration, petId, petLevel, onExplore }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const stars = useRef(STARS.map(() => new Animated.Value(reduceMotion ? 1 : 0))).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(appear, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(90, stars.map((s, i) => Animated.sequence([Animated.delay(STARS[i].delay),
      Animated.spring(s, { toValue: 1, friction: 4, useNativeDriver: true })]))).start();
    const loops = [
      Animated.loop(Animated.timing(glow, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true })),
      // The pet's happy jumps: two hops, a rest, again.
      Animated.loop(Animated.sequence([
        Animated.timing(hop, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0.6, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(hop, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ])),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduceMotion, appear, glow, hop, stars]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onExplore(); return true; });
    return () => sub.remove();
  }, [onExplore]);

  const completed = celebration.kind === 'completed';
  const spin = glow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]} accessibilityViewIsModal testID="promotion-celebration">
      <Sparkles />
      <Animated.View accessibilityRole="alert" style={[styles.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}>
        <View style={styles.stage} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Animated.View style={[styles.rays, { transform: [{ rotate: spin }] }]}>
            {Array.from({ length: 8 }, (_, i) => <View key={i} style={[styles.ray, { transform: [{ rotate: `${i * 22.5}deg` }] }]} />)}
          </Animated.View>
          <View style={styles.halo} />
          {STARS.map((s, i) => (
            <Animated.View key={i} style={[styles.star, { opacity: stars[i], transform: [{ translateX: s.x }, { translateY: s.y }, { scale: stars[i] }] }]}>
              <Ionicons name="star" size={s.size} color={i % 2 ? '#FFC93C' : '#FF9EC4'} />
            </Animated.View>
          ))}
          <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -22] }) }] }}>
            <PetCompanion pet={petId} size={110} stage={petLevel} />
          </Animated.View>
        </View>
        <Text style={styles.title} accessibilityRole="header">{celebration.message}</Text>
        <View style={styles.year}>
          <Ionicons name={completed ? 'ribbon-outline' : 'school-outline'} size={16} color={t.accent} />
          <Text style={styles.yearText}>{completed ? `Năm học ${celebration.academic_year_label}` : `${celebration.grade_label} · Năm học ${celebration.academic_year_label}`}</Text>
        </View>
        <Text style={styles.message}>
          {completed ? 'Các bài học, kết quả và kiến thức của bạn vẫn được lưu trong Kho lưu trữ học tập.'
            : 'Môn học, bài học và trò chơi đã chuyển sang lớp mới. Kiến thức năm trước được lưu trong Kho lưu trữ học tập.'}
        </Text>
        <Pressable onPress={onExplore} accessibilityRole="button" accessibilityLabel="Khám phá lớp học mới"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Ionicons name="sparkles" size={18} color={t.onPrimary} />
          <Text style={styles.buttonText}>Khám phá lớp học mới</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  backdrop: { backgroundColor: t.scrim, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: t.card, borderRadius: 30, padding: 22, alignItems: 'center',
    shadowColor: dark ? '#000000' : '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  stage: { width: 260, height: 190, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  rays: { position: 'absolute', width: 240, height: 240, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 18, height: 240, borderRadius: 9, backgroundColor: 'rgba(255,214,102,0.22)' },
  halo: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: dark ? 'rgba(255,214,102,0.16)' : '#FFF4CD' },
  star: { position: 'absolute' },
  title: { fontSize: 22, fontWeight: '900', color: t.ink, textAlign: 'center' },
  year: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: t.tint, borderRadius: 14,
    paddingVertical: 8, paddingHorizontal: 12 },
  yearText: { color: t.accent, fontSize: 14, fontWeight: '900' },
  message: { fontSize: 14, lineHeight: 21, color: t.muted, textAlign: 'center', marginTop: 10 },
  button: { alignSelf: 'stretch', minHeight: 52, borderRadius: 16, marginTop: 18, backgroundColor: t.accentFill,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: t.onPrimary, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
