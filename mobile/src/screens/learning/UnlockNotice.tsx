import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { unlockNotice } from '../../learning/lessonOrder';
import type { UnlockedContent } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';

export const NOTICE_MS = 8000;

type Props = { news: UnlockedContent[]; petId: string; petLevel: number; reduceMotion?: boolean;
  /** Shown: recorded by the backend, so it does not come back. */ onSeen: (ids: number[]) => void;
  /** "Khám phá ngay": opens what has just opened. */ onExplore: (lesson: string) => void; onClose: () => void };

/** Something has just opened: a small notice at the bottom (never a popup over the screen), with the pet jumping for joy.
 * The screen behind it stays in use; it leaves on its own. */
export function UnlockNotice({ news, petId, petLevel, reduceMotion, onSeen, onExplore, onClose }: Props) {
  const { t } = useTheme();
  const styles = useStyles();
  const notice = unlockNotice(news);
  const rise = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const key = news.map((u) => u.id).join(',');
  useEffect(() => {
    onSeen(news.map((u) => u.id));
    const leave = setTimeout(onClose, NOTICE_MS);
    if (reduceMotion) return () => clearTimeout(leave);
    const jump = (height: number) => Animated.sequence([
      Animated.timing(hop, { toValue: height, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    const run = Animated.parallel([
      Animated.timing(rise, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([Animated.delay(220), jump(1), jump(0.6)]),
    ]);
    run.start();
    return () => { clearTimeout(leave); run.stop(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- once for each set of unlocks
  if (!notice) return null;
  const lesson = notice.lesson;
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Animated.View accessibilityLiveRegion="polite" testID="unlock-notice" style={[styles.card, { opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
        <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
          style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }] }}>
          <PetCompanion pet={petId} size={46} stage={petLevel} />
        </Animated.View>
        <View style={styles.flex}>
          <View style={styles.row}>
            <Ionicons name="lock-open" size={13} color={t.warning} />
            <Text style={styles.kicker}>Vừa mở khóa</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{notice.title}</Text>
          {notice.more ? <Text style={styles.more}>và {notice.more} bài khác</Text> : null}
        </View>
        {lesson ? (
          <Pressable onPress={() => onExplore(lesson)} accessibilityRole="button" accessibilityLabel={`Khám phá ngay: ${notice.title}`}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>Khám phá ngay</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng thông báo" hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={16} color={t.muted} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  flex: { flex: 1 },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center', paddingHorizontal: 14, zIndex: 10 },
  card: { width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.card, borderRadius: 18, paddingVertical: 8,
    paddingLeft: 8, paddingRight: 6, shadowColor: dark ? '#000000' : '#0A2438', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kicker: { fontSize: 11, fontWeight: '800', color: t.warning },
  title: { fontSize: 14, fontWeight: '900', color: t.ink, lineHeight: 18 },
  more: { fontSize: 12, color: t.muted },
  button: { minHeight: 40, justifyContent: 'center', backgroundColor: t.accentFill, borderRadius: 12, paddingHorizontal: 10 },
  buttonText: { color: t.onPrimary, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  close: { width: 26, height: 40, alignItems: 'center', justifyContent: 'center' },
}));
