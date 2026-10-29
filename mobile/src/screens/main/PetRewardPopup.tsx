import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ItemIcon } from '../../components/ItemIcon';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { rarityOf } from '../../inventory/rarity';
import { appTheme as t } from '../../theme';
import type { PendingPetReward } from './usePetReward';

type Props = {
  reward: PendingPetReward; petId: string; petName: string; petLevel: number; confirming: boolean; error: string | null;
  /** "Đóng" (and Android's back button). */
  onClose: () => void;
  /** "Xem kho đồ": closes it, then opens the inventory. */
  onOpenInventory: () => void;
};

/**
 * The pet back from its walk: it opens its gift bag and shows what it found. Everything listed comes from the backend
 * and is already in the inventory; closing only records that it was seen. Like ConfirmDialog, it is an overlay inside
 * the app's view tree. The bag opens by itself (at once when the OS asks for less motion): nothing has to be watched or
 * tapped for the gifts to be kept.
 */
export function PetRewardPopup({ reward, petId, petName, petLevel, confirming, error, onClose, onOpenInventory }: Props) {
  const reduceMotion = useReduceMotion();
  const appear = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const bag = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const [open, setOpen] = useState(reduceMotion);

  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(appear, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(bag, { toValue: 1, duration: 520, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
    ]).start(() => setOpen(true));
  }, [reduceMotion, appear, bag]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (!confirming) onClose(); return true; });
    return () => sub.remove();
  }, [confirming, onClose]);

  const count = reward.items.reduce((n, item) => n + item.quantity, 0);
  const from = reward.location ? ` từ ${reward.location.name}` : '';
  const message = reward.items.length
    ? `${petName} đã mang về ${count} món quà${from} cho bạn!`
    : `${petName} đã mang về một món quà${from} dành cho bạn!`;
  const wiggle = bag.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: ['0deg', '-12deg', '10deg', '0deg'] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: appear }]} accessibilityViewIsModal>
      <Animated.View accessibilityRole="alert" style={[styles.card, { transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <View style={styles.hero}>
          <View style={styles.pet}><PetCompanion pet={petId} size={84} stage={petLevel} /></View>
          <Animated.View style={[styles.bag, { transform: [{ rotate: wiggle }, { scale: bag.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}
            importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Ionicons name={open ? 'gift-outline' : 'gift'} size={30} color="#FFFFFF" />
          </Animated.View>
        </View>
        <Text style={styles.title} accessibilityRole="header">{petName} đã trở về!</Text>
        <Text style={styles.message}>{message}</Text>
        <ScrollView style={styles.listBox} contentContainerStyle={styles.list}>
          {reward.exp > 0 ? <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: '#FFF4CD' }]}><Ionicons name="sparkles" size={20} color="#A46A0A" /></View>
            <Text style={styles.name}>+{reward.exp} EXP</Text>
          </View> : null}
          {reward.items.map((item, i) => {
            const rarity = rarityOf(item.rarity);
            return (
              <Animated.View key={`${item.slot ?? i}:${item.id}`} style={[styles.row, { borderColor: rarity.border, opacity: bag,
                transform: [{ translateY: bag.interpolate({ inputRange: [0, 1], outputRange: [14 + i * 8, 0] }) }] }]}
                accessible accessibilityLabel={`${item.name} ×${item.quantity}, ${item.rarity_label ?? rarity.label}${item.is_new ? ', Mới' : ''}`}>
                <View style={[styles.icon, { backgroundColor: rarity.bg }]}>
                  <ItemIcon id={item.id} variant={item.variant} art={item.art} emoji={item.emoji} size={34} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>{item.name} <Text style={styles.quantity}>×{item.quantity}</Text></Text>
                  <View style={styles.tags}>
                    <View style={[styles.rarity, { backgroundColor: rarity.bg }]}><Text style={[styles.rarityText, { color: rarity.color }]}>{item.rarity_label ?? rarity.label}</Text></View>
                    {item.is_new ? <View style={styles.new}><Text style={styles.newText}>Mới</Text></View> : null}
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </ScrollView>
        {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable onPress={onClose} disabled={confirming} accessibilityRole="button" accessibilityLabel="Đóng"
            accessibilityState={{ disabled: confirming }} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>Đóng</Text>
          </Pressable>
          <Pressable onPress={onOpenInventory} disabled={confirming} accessibilityRole="button" accessibilityLabel="Xem kho đồ"
            accessibilityState={{ busy: confirming, disabled: confirming }} style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed, confirming && styles.busy]}>
            {confirming ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="cube" size={18} color="#FFFFFF" />}
            <Text style={styles.primaryText}>Xem kho đồ</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10,36,56,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 28, padding: 22, alignItems: 'center',
    shadowColor: '#0A2438', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  hero: { height: 96, width: 150, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  pet: { height: 92, justifyContent: 'center' },
  bag: { position: 'absolute', right: 2, bottom: 2, width: 50, height: 50, borderRadius: 25, backgroundColor: '#E2683C',
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF' },
  title: { fontSize: 21, fontWeight: '900', color: t.ink, textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 21, color: t.muted, textAlign: 'center', marginTop: 6 },
  listBox: { alignSelf: 'stretch', marginTop: 14, flexGrow: 0 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F7FBFE', borderRadius: 16, padding: 9, borderWidth: 1.5, borderColor: '#E3EDF4' },
  icon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  name: { color: t.ink, fontSize: 14, fontWeight: '800' },
  quantity: { color: t.muted, fontWeight: '800' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 4 },
  rarity: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  rarityText: { fontSize: 11, fontWeight: '900' },
  new: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#D6304A' },
  newText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  error: { color: t.danger, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  actions: { alignSelf: 'stretch', flexDirection: 'row', gap: 10, marginTop: 18 },
  button: { flex: 1, minHeight: 50, borderRadius: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: t.accent },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondary: { backgroundColor: '#E6F0F7' },
  secondaryText: { color: t.accent, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  busy: { opacity: 0.8 },
});
