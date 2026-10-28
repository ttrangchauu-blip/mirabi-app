import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { RewardItemArt } from '../../components/RewardItemArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { appTheme as t } from '../../theme';
import type { PendingPetReward } from './usePetReward';

const RARITY: Record<string, { label: string; color: string; bg: string }> = {
  common: { label: 'Phổ biến', color: '#4F6C86', bg: '#EEF3F7' },
  rare: { label: 'Hiếm', color: '#136FA8', bg: '#DDF0FA' },
  epic: { label: 'Sử thi', color: '#6B3FB0', bg: '#F0E8FF' },
};

type Props = { reward: PendingPetReward; petId: string; petName: string; petLevel: number; confirming: boolean; error: string | null; onConfirm: () => void };

/**
 * Shown when the pet is back from its walk. Every gift listed here comes from the backend and is already in the
 * user's account; "Nhận quà" only confirms the popup. Like ConfirmDialog, it is an overlay inside the app's view tree.
 */
export function PetRewardPopup({ reward, petId, petName, petLevel, confirming, error, onConfirm }: Props) {
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (!reduceMotion) Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduceMotion, appear]);
  // The gifts must be confirmed with the button, so Android's back button doesn't close the popup.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]} accessibilityViewIsModal>
      <Animated.View accessibilityRole="alert" style={[styles.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <View style={styles.pet}><PetCompanion pet={petId} size={84} stage={petLevel} /></View>
        <Text style={styles.title} accessibilityRole="header">{petName} đã trở về!</Text>
        <Text style={styles.message}>{petName} đã mang về một món quà dành cho bạn!</Text>
        <View style={styles.list}>
          {reward.exp > 0 ? <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: '#FFF4CD' }]}><Ionicons name="sparkles" size={20} color="#A46A0A" /></View>
            <Text style={styles.name}>+{reward.exp} EXP</Text>
          </View> : null}
          {reward.items.map((item) => {
            const rarity = RARITY[item.rarity];
            return <View key={item.id} style={styles.row} accessible accessibilityLabel={`${item.name} ×${item.quantity}${rarity ? `, ${rarity.label}` : ''}`}>
              <View style={styles.icon}><RewardItemArt id={item.id} emoji={item.emoji} /></View>
              <Text style={styles.name} numberOfLines={1}>{item.name} <Text style={styles.quantity}>×{item.quantity}</Text></Text>
              {rarity ? <View style={[styles.rarity, { backgroundColor: rarity.bg }]}><Text style={[styles.rarityText, { color: rarity.color }]}>{rarity.label}</Text></View> : null}
            </View>;
          })}
        </View>
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Pressable onPress={onConfirm} disabled={confirming} accessibilityRole="button" accessibilityLabel="Nhận quà"
          accessibilityState={{ busy: confirming, disabled: confirming }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, confirming && styles.busy]}>
          {confirming ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="gift" size={18} color="#FFFFFF" />}
          <Text style={styles.buttonText}>{confirming ? 'Đang nhận…' : 'Nhận quà'}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,36,56,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 28, padding: 22, alignItems: 'center',
    shadowColor: '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  pet: { height: 92, justifyContent: 'center', marginBottom: 6 },
  title: { fontSize: 21, fontWeight: '900', color: t.ink, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 21, color: t.muted, textAlign: 'center', marginTop: 6 },
  list: { alignSelf: 'stretch', gap: 8, marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F7FBFE', borderRadius: 16, padding: 9 },
  icon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: t.ink, fontSize: 14, fontWeight: '800' },
  quantity: { color: t.muted, fontWeight: '800' },
  rarity: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 },
  rarityText: { fontSize: 10, fontWeight: '900' },
  error: { color: t.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  button: { alignSelf: 'stretch', minHeight: 50, borderRadius: 16, marginTop: 18, backgroundColor: t.accent,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  busy: { opacity: 0.8 },
});
