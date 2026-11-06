import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, newIdempotencyKey } from '../../api/client';
import { Text } from '../../components/Typography';
import { inventoryApi } from '../../inventory/api';
import type { GardenShop as Shop, ShopItem } from '../../inventory/types';
import { AppModal } from '../../ui/AppModal';
import { formatNumber } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { makeStyles, useTheme } from '../../ui/theme';
import { readyArt } from './gardenArt';
import { duration, TierPill, tierOf } from './tiers';

type Props = { visible: boolean; onClose: () => void;
  /** A purchase the backend confirmed: the garden reloads its seeds and the app its coins. */ onBought: () => void };

/**
 * Vườn nhà's seed shop. Everything shown (prices, growing times, rewards, what is open at the pet's level, the coins) is
 * the backend's answer; a purchase sends only the seed, how many and a request id, kept until the backend answers, so a
 * retry after a lost connection buys once. "Mua" opens the confirmation (how many, the total against the coins); only its
 * button buys. Coins too few are said before, and the backend checks again. (The app's confirm dialog would open under
 * this native modal, so the confirmation is this sheet.)
 */
export function GardenShop({ visible, onClose, onBought }: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { t } = useTheme();
  const s = useStyles();
  const backdrop = useBackdrop();
  const [shop, setShop] = useState<Shop | null>(null);
  const [failed, setFailed] = useState(false);
  const [tier, setTier] = useState('all');
  const [picking, setPicking] = useState<ShopItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const requests = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try { setShop(await inventoryApi.shop()); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => { if (visible) void load(); }, [visible, load]);

  const items = useMemo(() => (shop?.items ?? []).filter((i) => tier === 'all' || i.tier === tier), [shop, tier]);

  async function buy(item: ShopItem, count: number) {
    if (!shop || buying) return;
    const total = (item.seed_price ?? 0) * count;
    if (total > shop.coins) { toast(`Chưa đủ xu: cần ${formatNumber(total)} xu, bạn có ${formatNumber(shop.coins)} xu.`, 'info'); return; }
    const key = `${item.item_id}:${count}`;
    const id = requests.current.get(key) ?? newIdempotencyKey();
    requests.current.set(key, id);
    setBuying(true);
    try {
      const result = await inventoryApi.buy(item.item_id, count, id);
      requests.current.delete(key);
      setShop(result.shop);
      setPicking(null);
      toast(`Đã mua ${count} ${item.seed_name.toLowerCase()}!`, 'success');
      onBought();
    } catch (e) {
      if (e instanceof ApiError) {
        requests.current.delete(key); // a final answer: a new tap is a new purchase
        toast(e.code === 'insufficient_coins' ? 'Chưa đủ xu để mua.' : e.code === 'seed_locked' ? 'Hạt này mở ở cấp pet cao hơn.'
          : e.code === 'too_many' ? 'Mỗi lần mua được ít hạt hơn.' : 'Chưa mua được, bạn thử lại nhé.', 'info');
        void load();
      } else toast('Chưa kết nối được. Chạm Mua lần nữa: hạt chỉ được mua một lần.', 'info');
    } finally { setBuying(false); }
  }

  const max = shop ? Math.max(1, Math.min(shop.max_quantity, picking?.seed_price ? Math.floor(shop.coins / picking.seed_price) || 1 : 1)) : 1;
  const total = picking ? (picking.seed_price ?? 0) * quantity : 0;

  return (
    <AppModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <LinearGradient colors={backdrop} style={[s.fill, { paddingTop: insets.top + 8 }]} testID="garden-shop">
        <View style={s.header}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng cửa hàng" style={s.close}><Ionicons name="close" size={22} color={t.ink} /></Pressable>
          <Text style={s.title} accessibilityRole="header">Cửa hàng hạt giống</Text>
          <View style={s.coins} accessible accessibilityLabel={`${shop?.coins ?? 0} xu`} testID="garden-shop-coins">
            <Ionicons name="cash" size={14} color="#C08A1E" /><Text style={s.coinsText}>{shop ? formatNumber(shop.coins) : '…'}</Text>
          </View>
        </View>
        {shop ? <Text style={s.expLine}>EXP thu hoạch hôm nay: {shop.garden_exp.earned_today}/{shop.garden_exp.daily_cap}{shop.garden_exp.left === 0 ? ' · đã đủ, thu hoạch vẫn nhận xu' : ''}</Text> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} style={s.filterRow} accessibilityRole="tablist">
          {[{ id: 'all', label: 'Tất cả' }, ...(shop?.tiers ?? [])].map((f) => {
            const on = tier === f.id, look = tierOf(f.id === 'all' ? undefined : f.id);
            return <Pressable key={f.id} onPress={() => setTier(f.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={f.label}
              style={[s.filter, on && { backgroundColor: f.id === 'all' ? t.accentFill : look.color, borderColor: 'transparent' }]}>
              {f.id !== 'all' ? <View style={[s.dot, { backgroundColor: on ? t.onPrimary : look.dot }]} /> : null}
              <Text style={[s.filterText, on && s.filterTextOn]}>{f.label}</Text>
            </Pressable>;
          })}
        </ScrollView>
        {!shop ? <View style={s.center}>{failed ? <Pressable onPress={() => { void load(); }} accessibilityRole="button" style={s.retry}><Text style={s.retryText}>Chưa tải được cửa hàng. Chạm để thử lại.</Text></Pressable> : <ActivityIndicator color={t.accent} />}</View> : (
          <ScrollView contentContainerStyle={[s.grid, { paddingBottom: insets.bottom + 24 }]}>
            {items.map((item) => <ShopCard key={item.item_id} item={item} coins={shop.coins} onBuy={() => { setQuantity(1); setPicking(item); }} />)}
          </ScrollView>
        )}
      </LinearGradient>

      <AppModal visible={!!picking} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicking(null)} accessibilityLabel="Đóng" accessibilityRole="button" />
        {picking && shop ? <View style={[s.sheet, { paddingBottom: insets.bottom + 18 }]} accessibilityViewIsModal testID="garden-shop-quantity">
          <View style={s.sheetHead}>
            <Image source={readyArt(picking.art)} resizeMode="contain" style={s.sheetArt} />
            <View style={s.flex}>
              <Text style={s.sheetTitle}>Xác nhận mua {picking.seed_name.toLowerCase()}</Text>
              <TierPill tier={picking.tier} label={picking.tier_label} small />
              <Text style={s.sheetSub}>{formatNumber(picking.seed_price ?? 0)} xu một hạt · bạn có {formatNumber(shop.coins)} xu</Text>
            </View>
          </View>
          <View style={s.stepper}>
            <Pressable onPress={() => setQuantity((n) => Math.max(1, n - 1))} disabled={quantity <= 1} accessibilityRole="button" accessibilityLabel="Bớt một hạt" style={[s.step, quantity <= 1 && s.dim]}><Ionicons name="remove" size={20} color={t.ink} /></Pressable>
            <Text style={s.count} accessibilityLiveRegion="polite" testID="garden-shop-count">{quantity}</Text>
            <Pressable onPress={() => setQuantity((n) => Math.min(max, n + 1))} disabled={quantity >= max} accessibilityRole="button" accessibilityLabel="Thêm một hạt" style={[s.step, quantity >= max && s.dim]}><Ionicons name="add" size={20} color={t.ink} /></Pressable>
          </View>
          <Text style={[s.total, total > shop.coins && s.short]}>{total > shop.coins ? `Chưa đủ xu (cần ${formatNumber(total)})` : `Tổng: ${formatNumber(total)} xu`}</Text>
          <Pressable onPress={() => { void buy(picking, quantity); }} disabled={buying || total > shop.coins} accessibilityRole="button" accessibilityLabel={`Mua ${quantity} hạt`}
            style={({ pressed }) => [s.buyBig, (buying || total > shop.coins) && s.dim, pressed && s.pressed]} testID="garden-shop-confirm">
            {buying ? <ActivityIndicator color={t.onPrimary} /> : <Text style={s.buyBigText}>Mua {quantity} hạt</Text>}
          </Pressable>
        </View> : null}
      </AppModal>
    </AppModal>
  );
}

function ShopCard({ item, coins, onBuy }: { item: ShopItem; coins: number; onBuy: () => void }) {
  const { t, tones } = useTheme();
  const s = useStyles();
  const look = tierOf(item.tier);
  const short = (item.seed_price ?? 0) > coins;
  const art = <Image source={readyArt(item.art)} resizeMode="contain" fadeDuration={0} accessibilityIgnoresInvertColors style={s.cardImage} />;
  return (
    <View style={[s.card, { borderColor: look.border }]} testID={`garden-shop-item-${item.item_id}`}>
      {look.rainbow ? <LinearGradient colors={look.rainbow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cardArt}>{art}</LinearGradient>
        : <View style={[s.cardArt, { backgroundColor: look.bg }]}>{art}</View>}
      {item.owned ? <View style={s.owned}><Text style={s.ownedText}>Có {item.owned}</Text></View> : null}
      <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
      <TierPill tier={item.tier} label={item.tier_label} small />
      <View style={s.facts}>
        <Fact icon="time-outline" text={duration(item.grow_seconds)} />
        <Fact icon="sparkles-outline" text={`+${item.harvest_exp} EXP · +${item.harvest_coins} xu`} />
      </View>
      {item.unlocked ? (
        <Pressable onPress={onBuy} accessibilityRole="button" accessibilityLabel={`Mua ${item.seed_name}, ${item.seed_price} xu${short ? ', chưa đủ xu' : ''}`}
          style={({ pressed }) => [s.buy, short && s.buyShort, pressed && s.pressed]} testID={`garden-shop-buy-${item.item_id}`}>
          <Ionicons name="cash" size={13} color={short ? tones.sun.ink : t.onPrimary} /><Text style={[s.buyText, short && s.buyTextShort]}>{formatNumber(item.seed_price ?? 0)}</Text>
        </Pressable>
      ) : (
        <View style={[s.buy, s.locked]} accessible accessibilityLabel={`${item.seed_name}, mở khi pet đạt cấp ${item.unlock_level}`}>
          <Ionicons name="lock-closed" size={12} color={t.muted} /><Text style={s.lockedText}>Pet cấp {item.unlock_level}</Text>
        </View>
      )}
    </View>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { t } = useTheme();
  const s = useStyles();
  return <View style={s.fact}><Ionicons name={icon} size={11} color={t.muted} /><Text style={s.factText} numberOfLines={1}>{text}</Text></View>;
}

/** The garden's own green: its buy buttons (white on it), the same in light and dark. */
const GREEN = '#2E8C3A';
/** The shop's screen: sky to meadow, the app's night sea on dark. */
const useBackdrop = makeStyles(({ t, dark }): readonly [string, string, ...string[]] => (dark ? t.backdrop : ['#E7F5FF', '#F4FBEF']));

const useStyles = makeStyles(({ t, tones, dark }) => StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0, gap: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 4 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass },
  title: { flex: 1, color: t.ink, fontSize: 18, fontWeight: '900' },
  coins: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 32, borderRadius: 16, backgroundColor: tones.sun.from },
  coinsText: { color: tones.sun.ink, fontSize: 14, fontWeight: '900' },
  expLine: { paddingHorizontal: 16, color: t.muted, fontSize: 11.5, fontWeight: '600' },
  filterRow: { flexGrow: 0, flexShrink: 0, height: 48, marginTop: 8 },
  filters: { gap: 8, paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border },
  filterText: { color: t.ink, fontSize: 12.5, fontWeight: '700' },
  filterTextOn: { color: t.onPrimary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  retry: { padding: 16 },
  retryText: { color: t.accent, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 12, paddingTop: 4 },
  card: { width: '48%', maxWidth: 260, padding: 8, gap: 4, borderRadius: 18, borderWidth: 1.5, backgroundColor: t.card,
    shadowColor: dark ? '#000000' : '#23452A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardArt: { height: 120, borderRadius: 13, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  // The picture's foot is at 79 % of its height: the plant stands near the bottom of the card.
  cardImage: { width: 116, height: 162, marginBottom: -26 },
  owned: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9, backgroundColor: '#FFFFFFE6' },
  ownedText: { color: '#2E6B33', fontSize: 10.5, fontWeight: '800' },
  cardName: { color: t.ink, fontSize: 14, fontWeight: '800', marginTop: 2 },
  facts: { gap: 2, marginTop: 1 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  factText: { flexShrink: 1, color: t.muted, fontSize: 11, fontWeight: '600' },
  buy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, marginTop: 4, borderRadius: 17, backgroundColor: GREEN },
  buyShort: { backgroundColor: tones.sun.from },
  buyText: { color: t.onPrimary, fontSize: 13, fontWeight: '900' },
  buyTextShort: { color: tones.sun.ink },
  locked: { backgroundColor: t.surfaceSecondary },
  lockedText: { color: t.muted, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  dim: { opacity: 0.45 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: t.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: t.card },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetArt: { width: 64, height: 90 },
  sheetTitle: { color: t.ink, fontSize: 16, fontWeight: '900' },
  sheetSub: { color: t.muted, fontSize: 12, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  step: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tones.leaf.from },
  count: { minWidth: 40, textAlign: 'center', color: t.ink, fontSize: 24, fontWeight: '900' },
  total: { textAlign: 'center', color: t.ink, fontSize: 14, fontWeight: '800' },
  short: { color: t.warning },
  buyBig: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: GREEN },
  buyBigText: { color: t.onPrimary, fontSize: 15, fontWeight: '900' },
}));
