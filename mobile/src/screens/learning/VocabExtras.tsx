import React, { useEffect, useRef } from 'react';
import { Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { VocabCelebrationInfo, VocabProgress } from '../../learning/types';
import { makeStyles, useTheme } from '../../ui/theme';
import { ProgressBar } from '../../ui/kit';
import { OptionRow, OptionSheet } from '../together/ui';

// Khám phá từ mới and Ôn tập of the two vocabulary games: the strip under a game (level, new words, topic, review),
// the topic sheet, and the one-time celebration of a completed level.

/** "Cấp 2 · Dễ: 120/950 từ", the new words left (in the chosen topic) and the two actions. */
export function VocabStrip({ progress, topic, onTopic, onReview, disabled, reviewing }: {
  progress: VocabProgress; topic: string | null; onTopic: () => void; onReview: () => void; disabled: boolean; reviewing: boolean;
}) {
  const { t, tones } = useTheme();
  const s = useStyles();
  const level = progress.levels.find((l) => l.level === progress.current_level);
  const chosen = topic ? progress.topics.find((x) => x.code === topic) : null;
  const left = chosen ? chosen.new_words_left : progress.new_words_left;
  const canReview = progress.discovered > 0;
  return (
    <View style={s.strip}>
      {level ? (
        <View accessible accessibilityLabel={`Cấp ${level.level}, ${level.name}: đã khám phá ${level.discovered} trên ${level.total} từ`}>
          <View style={s.stripRow}>
            <Text style={s.level}>Cấp {level.level} · {level.name}</Text>
            <Text style={s.count}>{level.discovered}/{level.total} từ</Text>
          </View>
          <ProgressBar value={level.total ? level.discovered / level.total : 0} color="#7C6CF0" />
        </View>
      ) : null}
      <View style={s.stripRow}>
        <Pressable onPress={onTopic} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Chủ đề: ${chosen?.name ?? 'Mọi chủ đề'}`}
          hitSlop={4} style={({ pressed }) => [s.chip, pressed && s.pressed]}>
          <Ionicons name="pricetags-outline" size={14} color={t.accent} />
          <Text style={s.chipText} numberOfLines={1}>{chosen?.name ?? 'Mọi chủ đề'}</Text>
        </Pressable>
        <Text style={s.left} numberOfLines={1}>{left > 0 ? `${left} từ mới` : 'Hết từ mới'}</Text>
        <Pressable onPress={onReview} disabled={disabled || !canReview} accessibilityRole="button"
          accessibilityLabel={`Ôn tập${progress.review_due ? `, ${progress.review_due} từ cần ôn` : ''}`}
          accessibilityState={{ disabled: disabled || !canReview, busy: reviewing }}
          hitSlop={4} style={({ pressed }) => [s.chip, s.review, (!canReview) && s.off, pressed && s.pressed]}>
          <Ionicons name="refresh-circle-outline" size={15} color={tones.sea.ink} />
          <Text style={[s.chipText, s.reviewText]}>{reviewing ? 'Đang mở…' : `Ôn tập${progress.review_due ? ` (${progress.review_due})` : ''}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Every topic of the open levels with its new words left; "Mọi chủ đề" draws from all of them. */
export function TopicSheet({ visible, progress, topic, onPick, onClose }: {
  visible: boolean; progress: VocabProgress | null; topic: string | null; onPick: (topic: string | null) => void; onClose: () => void;
}) {
  const s = useStyles();
  return (
    <OptionSheet visible={visible} title="Chọn chủ đề" onClose={onClose}>
      <ScrollView style={s.sheetList} keyboardShouldPersistTaps="handled">
        <OptionRow label="Mọi chủ đề" description={progress ? `${progress.new_words_left} từ mới` : undefined} selected={topic === null}
          onPress={() => onPick(null)} />
        {(progress?.topics ?? []).map((x) => (
          <OptionRow key={x.code} label={x.name} selected={topic === x.code}
            description={x.new_words_left ? `${x.new_words_left} từ mới / ${x.total}` : 'Đã khám phá hết'} onPress={() => onPick(x.code)} />
        ))}
      </ScrollView>
    </OptionSheet>
  );
}

const STARS = [
  { x: -112, y: -64, size: 22 }, { x: 108, y: -78, size: 18 }, { x: -92, y: 50, size: 16 }, { x: 100, y: 44, size: 22 }, { x: 0, y: -112, size: 20 },
];
const CONFETTI = ['#FF9EC4', '#FFC93C', '#7CD3F7', '#9BE7A8', '#B9A6FF', '#FFB38A', '#7CD3F7', '#FF9EC4', '#FFC93C', '#9BE7A8'];

/** A level of a vocabulary game completed: the pet hops, stars and light come up, a little confetti falls (all on the
 * native driver, still with reduced motion). Shown once: it is marked as seen as soon as it is on screen. */
export function VocabCelebration({ info, petId, petLevel, onExplore, onReview, onClose, onSeen }: {
  info: VocabCelebrationInfo; petId: string; petLevel: number;
  onExplore: () => void; onReview: () => void; onClose: () => void; /** Called once when it is shown. */ onSeen: () => void;
}) {
  const { t } = useTheme();
  const s = useStyles();
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const stars = useRef(STARS.map(() => new Animated.Value(reduceMotion ? 1 : 0))).current;
  const fall = useRef(new Animated.Value(0)).current;
  const seen = useRef(onSeen);
  useEffect(() => { seen.current(); }, []);

  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(appear, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.stagger(80, stars.map((v) => Animated.spring(v, { toValue: 1, friction: 4, useNativeDriver: true }))).start();
    Animated.timing(fall, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const jumps = Animated.loop(Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay(700),
    ]));
    jumps.start();
    return () => jumps.stop();
  }, [reduceMotion, appear, hop, stars, fall]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: appear }]} accessibilityViewIsModal testID="vocab-celebration">
      {reduceMotion ? null : CONFETTI.map((color, i) => (
        <Animated.View key={i} pointerEvents="none" style={[s.confetti, { backgroundColor: color, left: `${6 + i * 9.5}%`,
          opacity: fall.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-20, 260 + (i % 3) * 60] }) },
            { rotate: fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(i % 2 ? 1 : -1) * 240}deg`] }) }] }]} />
      ))}
      <Animated.View accessibilityRole="alert" style={[s.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] }]}>
        <View style={s.stage} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={s.halo} />
          {STARS.map((star, i) => (
            <Animated.View key={i} style={[s.star, { opacity: stars[i], transform: [{ translateX: star.x }, { translateY: star.y }, { scale: stars[i] }] }]}>
              <Ionicons name="star" size={star.size} color={i % 2 ? '#FFC93C' : '#FF9EC4'} />
            </Animated.View>
          ))}
          <Animated.View style={{ transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -20] }) }] }}>
            <PetCompanion pet={petId} size={104} stage={petLevel} />
          </Animated.View>
        </View>
        <Text style={s.title} accessibilityRole="header">{info.title}</Text>
        <Text style={s.message}>{info.message}</Text>
        {info.next_level ? (
          <Pressable onPress={onExplore} accessibilityRole="button" accessibilityLabel="Khám phá cấp độ mới"
            style={({ pressed }) => [s.primary, pressed && s.pressed]}>
            <Ionicons name="sparkles" size={18} color={t.onPrimary} />
            <Text style={s.primaryText}>Khám phá cấp độ mới</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onReview} accessibilityRole="button" accessibilityLabel="Ôn tập từ đã học"
          style={({ pressed }) => [info.next_level ? s.secondary : s.primary, pressed && s.pressed]}>
          <Ionicons name="refresh-circle-outline" size={18} color={info.next_level ? t.accent : t.onPrimary} />
          <Text style={info.next_level ? s.secondaryText : s.primaryText}>Ôn tập từ đã học</Text>
        </Pressable>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng" hitSlop={8} style={s.close}>
          <Text style={s.closeText}>Để sau</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  strip: { gap: 8, backgroundColor: tones.lilac.from, borderRadius: 14, padding: 10, marginTop: -4, marginBottom: 12 },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  level: { flex: 1, fontSize: 13, fontWeight: '900', color: tones.lilac.ink },
  count: { fontSize: 12, fontWeight: '800', color: t.muted },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: t.card, maxWidth: '45%' },
  chipText: { fontSize: 12, fontWeight: '800', color: t.accent, flexShrink: 1 },
  review: { backgroundColor: tones.sea.from },
  reviewText: { color: tones.sea.ink },
  off: { opacity: 0.45 },
  left: { flex: 1, fontSize: 12, color: t.muted, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  sheetList: { maxHeight: 420 },
  backdrop: { backgroundColor: t.scrim, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 20 },
  confetti: { position: 'absolute', top: 0, width: 10, height: 14, borderRadius: 3 },
  card: { width: '100%', maxWidth: 380, backgroundColor: t.card, borderRadius: 30, padding: 22, alignItems: 'center',
    shadowColor: dark ? '#000000' : '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  stage: { width: 250, height: 180, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 146, height: 146, borderRadius: 73, backgroundColor: dark ? 'rgba(255,214,102,0.16)' : '#FFF4CD' },
  star: { position: 'absolute' },
  title: { fontSize: 20, fontWeight: '900', color: t.ink, textAlign: 'center' },
  message: { fontSize: 15, lineHeight: 21, color: t.muted, textAlign: 'center', marginTop: 8 },
  primary: { alignSelf: 'stretch', minHeight: 50, borderRadius: 16, marginTop: 16, backgroundColor: t.accentFill,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: t.onPrimary, fontSize: 16, fontWeight: '800' },
  secondary: { alignSelf: 'stretch', minHeight: 48, borderRadius: 16, marginTop: 10, backgroundColor: t.tint,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontSize: 15, fontWeight: '800' },
  close: { marginTop: 12, paddingVertical: 6, paddingHorizontal: 12 },
  closeText: { color: t.muted, fontSize: 14, fontWeight: '700' },
}));
