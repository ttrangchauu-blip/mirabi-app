import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ItemIcon } from '../../components/ItemIcon';
import { Text, TextInput } from '../../components/Typography';
import { inventoryApi, inventoryCache } from '../../inventory/api';
import { RARITY_ORDER, rarityOf } from '../../inventory/rarity';
import type { InventoryData, InventoryItem, InventoryTab, ItemDetail, ItemHistory, ItemUse } from '../../inventory/types';
import { countsLabel } from '../../room/found';
import type { RoomKind } from '../../room/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { Button } from '../../ui/kit';
import { EmptyState, ErrorState, LoadingState, OptionRow, OptionSheet } from '../together/ui';

type Sort = 'newest' | 'name';
type Props = {
  /** Whose inventory: the offline copy is kept per account. */
  userId: number;
  onBack: () => void;
  /** Opened while decorating a room: "Đặt vào phòng này" puts a copy into that room's draft (saved with the room). */
  placeInto?: { room: RoomKind; onPlace: (item: InventoryItem) => void };
  /** "Đặt vào phòng" anywhere else: after choosing the room, it opens decorating with the item. */
  onPlace?: (item: InventoryItem, room: RoomKind) => void;
  /** "Trồng": the garden, with this seed ready to plant. */
  onPlant?: (item: InventoryItem) => void;
  /** "Xem trong Album kỷ niệm": the album, on the keepsake's memory when it has one. */
  onOpenAlbum?: (memoryId: number | null) => void;
};

export const ROOM_NAMES: Record<RoomKind, string> = { personal: 'Phòng cá nhân', focus: 'Phòng tập trung' };
const TABS: { id: InventoryTab; label: string }[] = [
  { id: 'all', label: 'Tất cả' }, { id: 'decor', label: 'Trang trí' }, { id: 'seed', label: 'Hạt giống' },
  { id: 'material', label: 'Nguyên liệu' }, { id: 'keepsake', label: 'Kỷ vật' }];
const USES: { id: ItemUse | 'all'; label: string }[] = [
  { id: 'all', label: 'Mọi nơi' }, { id: 'room', label: 'Phòng' }, { id: 'garden', label: 'Vườn nhà' }, { id: 'album', label: 'Album kỷ niệm' },
  { id: 'craft', label: 'Chế tạo' }];
const SORTS: { id: Sort; label: string }[] = [{ id: 'newest', label: 'Mới nhất' }, { id: 'name', label: 'Theo tên' }];

/** Lower case without Vietnamese marks, so "hoa cuc" finds "Hạt hoa cúc". */
export function searchKey(value: string): string {
  const lower = value.toLowerCase().replace(/đ/g, 'd');
  try { return lower.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch { return lower; }
}

export function filterItems(items: InventoryItem[], { tab, rarity, use, query, sort }:
  { tab: InventoryTab; rarity: string; use: ItemUse | 'all'; query: string; sort: Sort }): InventoryItem[] {
  const q = searchKey(query.trim());
  const out = items.filter((i) => (tab === 'all' || i.tab === tab) && (rarity === 'all' || i.rarity === rarity)
    && (use === 'all' || i.use === use) && (!q || searchKey(i.name).includes(q)));
  return out.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'vi') || a.variant.localeCompare(b.variant)
    : (a, b) => Date.parse(b.last_obtained_at) - Date.parse(a.last_obtained_at) || a.name.localeCompare(b.name, 'vi'));
}

const date = (iso: string) => new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const keyOf = (i: Pick<InventoryItem, 'id' | 'variant'>) => `${i.id}.${i.variant}`;

/**
 * Kho đồ: everything the pets brought back, from the backend (the last copy it confirmed is shown offline, read only).
 * Tabs by kind, a search by name, filters by rarity and by where an item is used, newest first or by name; each card
 * shows what is still free ("Còn 1 · Đang đặt 2"). The detail tells where copies are and when they came, and offers
 * what the item is for: a room, the garden, the album. No capacity limit.
 */
export function InventoryScreen({ userId, onBack, placeInto, onPlace, onPlant, onOpenAlbum }: Props) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<InventoryData | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<InventoryTab>(placeInto ? 'decor' : 'all');
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState('all');
  const [use, setUse] = useState<ItemUse | 'all'>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [picker, setPicker] = useState<'rarity' | 'use' | 'sort' | null>(null);
  const [open, setOpen] = useState<InventoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await inventoryApi.list();
      if (!Array.isArray(fresh?.items)) throw new Error('Unexpected inventory');
      setData(fresh); setOffline(false); setError(null);
      void inventoryCache.store(userId, fresh);
    } catch (e) {
      const cached = await inventoryCache.load(userId);
      if (cached) { setData((current) => current ?? cached); setOffline(true); } else setError(e);
    } finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => (data ? filterItems(data.items, { tab, rarity, use, query, sort }) : []), [data, tab, rarity, use, query, sort]);
  const fresh = data?.items.filter((i) => i.is_new).length ?? 0;
  const seen = (item: InventoryItem) => setData((d) => (d ? { ...d, items: d.items.map((i) => (keyOf(i) === keyOf(item) ? { ...i, is_new: false } : i)) } : d));
  const filtered = rarity !== 'all' || use !== 'all' || !!query.trim();

  const header = (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.back}>
        <Ionicons name={placeInto ? 'close' : 'chevron-back'} size={22} color={t.ink} />
      </Pressable>
      <View style={s.flex}>
        <Text style={s.title} accessibilityRole="header">Kho đồ</Text>
        <Text style={s.subtitle} numberOfLines={1}>
          {placeInto ? `Chọn đồ để đặt vào ${ROOM_NAMES[placeInto.room]}` : data ? `${data.items.length} món${fresh ? ` · ${fresh} mới` : ''}` : 'Đồ pet mang về từ những chuyến khám phá'}
        </Text>
      </View>
    </View>
  );

  if (!data) {
    return <View style={[s.fill, { paddingTop: placeInto ? insets.top + 10 : 0 }]} testID="inventory-screen">{header}
      {loading && !error ? <LoadingState label="Đang mở kho đồ…" /> : <ErrorState error={error} onRetry={() => { setError(null); void load(); }} />}
    </View>;
  }

  return (
    <View style={[s.fill, { paddingTop: placeInto ? insets.top + 10 : 0 }]} testID="inventory-screen">
      {header}
      {offline ? (
        <Pressable onPress={() => { void load(); }} style={s.offline} accessibilityRole="button" accessibilityLabel="Đang ngoại tuyến, chạm để thử lại">
          <Ionicons name="cloud-offline-outline" size={15} color={t.muted} />
          <Text style={s.offlineText}>Đang ngoại tuyến · hiển thị kho đồ đã lưu. Cần kết nối để dùng đồ. Chạm để thử lại.</Text>
        </Pressable>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bar} contentContainerStyle={s.chips} accessibilityRole="tablist">
        {TABS.map((tb) => {
          const on = tb.id === tab;
          const n = tb.id === 'all' ? data.items.length : data.items.filter((i) => i.tab === tb.id).length;
          return <Pressable key={tb.id} onPress={() => setTab(tb.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={`${tb.label}, ${n} món`} style={[s.tab, on && s.tabOn]}>
            <Text style={[s.tabText, on && s.tabTextOn]}>{tb.label}</Text>
            <Text style={[s.tabCount, on && s.tabTextOn]}>{n}</Text>
          </Pressable>;
        })}
      </ScrollView>
      <View style={s.search}>
        <Ionicons name="search" size={17} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Tìm theo tên" placeholderTextColor="#7F95A8" style={s.searchInput}
          accessibilityLabel="Tìm theo tên" returnKeyType="search" />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm">
          <Ionicons name="close-circle" size={18} color={t.muted} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bar} contentContainerStyle={s.chips}>
        <Filter icon="swap-vertical" label={SORTS.find((o) => o.id === sort)!.label} on={false} onPress={() => setPicker('sort')} name="Sắp xếp" />
        <Filter icon="diamond-outline" label={rarity === 'all' ? 'Độ hiếm' : rarityOf(rarity).label} on={rarity !== 'all'} onPress={() => setPicker('rarity')} name="Lọc độ hiếm" />
        <Filter icon="location-outline" label={use === 'all' ? 'Nơi sử dụng' : USES.find((u) => u.id === use)!.label} on={use !== 'all'} onPress={() => setPicker('use')} name="Lọc nơi sử dụng" />
        {filtered ? <Filter icon="close" label="Bỏ lọc" on={false} onPress={() => { setRarity('all'); setUse('all'); setQuery(''); }} name="Bỏ lọc" /> : null}
      </ScrollView>
      {!data.items.length ? (
        <EmptyState icon="cube-outline" title="Kho đồ còn trống" body="Hoàn thành nhiệm vụ mỗi ngày để pet đi khám phá và mang quà về nhé." />
      ) : !items.length ? (
        <EmptyState icon="search-outline" title="Không tìm thấy món nào" body="Thử đổi tab, từ khóa hoặc bộ lọc nhé." />
      ) : (
        <FlatList data={items} keyExtractor={keyOf} numColumns={3} columnWrapperStyle={s.row} contentContainerStyle={[s.grid, { paddingBottom: insets.bottom + 24 }]}
          refreshing={loading} onRefresh={() => { void load(); }}
          renderItem={({ item }) => <ItemCard item={item} onPress={() => setOpen(item)} />} />
      )}
      <OptionSheet visible={picker === 'sort'} title="Sắp xếp" onClose={() => setPicker(null)}>
        {SORTS.map((o) => <OptionRow key={o.id} label={o.label} selected={sort === o.id} onPress={() => { setSort(o.id); setPicker(null); }} />)}
      </OptionSheet>
      <OptionSheet visible={picker === 'rarity'} title="Độ hiếm" onClose={() => setPicker(null)}>
        <OptionRow label="Mọi độ hiếm" selected={rarity === 'all'} onPress={() => { setRarity('all'); setPicker(null); }} />
        {RARITY_ORDER.map((r) => <OptionRow key={r} label={rarityOf(r).label} selected={rarity === r} onPress={() => { setRarity(r); setPicker(null); }} />)}
      </OptionSheet>
      <OptionSheet visible={picker === 'use'} title="Nơi sử dụng" onClose={() => setPicker(null)}>
        {USES.map((u) => <OptionRow key={u.id} label={u.label} selected={use === u.id} onPress={() => { setUse(u.id); setPicker(null); }} />)}
      </OptionSheet>
      <ItemSheet item={open} offline={offline} placeInto={placeInto} onClose={() => setOpen(null)} onSeen={seen}
        onPlace={onPlace} onPlant={onPlant} onOpenAlbum={onOpenAlbum} />
    </View>
  );
}

function Filter({ icon, label, on, onPress, name }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; on: boolean; onPress: () => void; name: string }) {
  return <Pressable onPress={onPress} style={[s.filter, on && s.filterOn]} accessibilityRole="button" accessibilityLabel={`${name}: ${label}`}>
    <Ionicons name={icon} size={14} color={on ? '#FFFFFF' : t.accent} />
    <Text style={[s.filterText, on && s.filterTextOn]}>{label}</Text>
  </Pressable>;
}

function ItemCard({ item, onPress }: { item: InventoryItem; onPress: () => void }) {
  const rarity = rarityOf(item.rarity);
  const counts = countsLabel(item.available, item.placed);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, { borderColor: rarity.border }, pressed && s.pressed]}
      accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.rarity_label}, ${counts}${item.is_new ? ', Mới' : ''}`}>
      <View style={[s.cardArt, { backgroundColor: rarity.bg }]}>
        <ItemIcon id={item.id} variant={item.variant} art={item.art} size={56} />
        {item.is_new ? <View style={s.newBadge}><Text style={s.newText}>Mới</Text></View> : null}
      </View>
      <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
      <View style={[s.pill, { backgroundColor: rarity.bg }]}><Text style={[s.pillText, { color: rarity.color }]} numberOfLines={1}>{item.rarity_label}</Text></View>
      <Text style={s.cardCount} numberOfLines={2}>{counts}</Text>
    </Pressable>
  );
}

function historyLine(h: ItemHistory): string {
  if (h.kind === 'walk_reward') return `Nhận ${h.delta} từ chuyến khám phá${h.location ? ` ${h.location.name}` : ''}`;
  if (h.kind === 'legacy') return `Nhận ${h.delta} từ những chuyến đi trước`;
  if (h.kind === 'plant') return 'Đã trồng 1 ở Vườn nhà';
  const room = h.ref === 'room:focus' ? ROOM_NAMES.focus : ROOM_NAMES.personal;
  return h.kind === 'place' ? `Đặt 1 vào ${room}` : `Cất 1 về kho từ ${room}`;
}

/** One item: its picture, description, how many are owned, placed and free, where its copies are, when it came, and
 * what to do with it. Opening it clears its "Mới" label. */
function ItemSheet({ item, offline, placeInto, onClose, onSeen, onPlace, onPlant, onOpenAlbum }: {
  item: InventoryItem | null; offline: boolean; onClose: () => void; onSeen: (item: InventoryItem) => void;
} & Pick<Props, 'placeInto' | 'onPlace' | 'onPlant' | 'onOpenAlbum'>) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [rooms, setRooms] = useState(false);
  useEffect(() => {
    setDetail(null); setFailed(false); setRooms(false);
    if (!item || offline) return;
    let live = true;
    inventoryApi.detail(item.id, item.variant).then((d) => { if (live) setDetail(d); }).catch(() => { if (live) setFailed(true); });
    if (item.is_new) inventoryApi.seen(item.id, item.variant).then(() => onSeen(item)).catch(() => {});
    return () => { live = false; };
  }, [item?.id, item?.variant, offline]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  const shown = detail?.item ?? item;
  const rarity = rarityOf(shown.rarity);
  const where = detail ? (['personal', 'focus'] as RoomKind[]).map((r) => [r, detail.placements.filter((p) => p.room === r).length] as const).filter(([, n]) => n) : [];
  const need = offline ? 'Cần kết nối mạng để dùng món này.' : null;

  let action: React.ReactNode = null;
  if (shown.use === 'room') {
    action = placeInto
      ? <Button title="Đặt vào phòng này" icon="add-circle-outline" disabled={!!need} onPress={() => { placeInto.onPlace(shown); onClose(); }} />
      : <Button title="Đặt vào phòng" icon="home-outline" disabled={!!need || shown.available < 1} onPress={() => setRooms(true)} />;
  } else if (shown.use === 'garden') {
    action = placeInto ? null : <Button title="Trồng" icon="leaf-outline" disabled={!!need || shown.available < 1} onPress={() => { onClose(); onPlant?.(shown); }} />;
  } else if (shown.use === 'album') {
    action = placeInto ? null : <Button title="Xem trong Album kỷ niệm" icon="images-outline" disabled={!!need} onPress={() => { onClose(); onOpenAlbum?.(detail?.memory_id ?? null); }} />;
  }
  const note = need ?? (shown.use === 'craft' ? 'Dùng để chế tạo trong tương lai.'
    : shown.use === 'room' && !placeInto && shown.available < 1 ? 'Đã đặt hết. Cất bớt một món trong phòng để đặt ở chỗ khác.'
    : placeInto && shown.use !== 'room' ? 'Mở Kho đồ từ Phòng cá nhân để dùng món này.' : null);

  return (
    <AppModal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.sheetBackdrop} onPress={onClose} accessibilityLabel="Đóng" accessibilityRole="button" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 18 }]} accessibilityViewIsModal testID="item-detail">
        <ScrollView contentContainerStyle={s.sheetBody}>
          <View style={s.sheetHead}>
            <View style={[s.bigArt, { backgroundColor: rarity.bg, borderColor: rarity.border }]}><ItemIcon id={shown.id} variant={shown.variant} art={shown.art} size={84} /></View>
            <View style={s.flex}>
              <Text style={s.sheetTitle} accessibilityRole="header">{shown.name}</Text>
              <View style={s.tags}>
                <View style={[s.pill, { backgroundColor: rarity.bg, borderColor: rarity.border, borderWidth: 1 }]}><Text style={[s.pillText, { color: rarity.color }]}>{shown.rarity_label}</Text></View>
                <View style={[s.pill, s.groupPill]}><Text style={s.groupText}>{shown.group_label}</Text></View>
              </View>
              <Text style={s.useText}>{`Dùng ở: ${shown.use === 'room' ? 'Phòng cá nhân, Phòng tập trung' : shown.use_label}`}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng chi tiết" style={s.close}>
              <Ionicons name="close" size={20} color={t.muted} />
            </Pressable>
          </View>
          <Text style={s.description}>{shown.description}</Text>
          <View style={s.stats}>
            <Stat label="Tổng sở hữu" value={shown.owned} />
            <Stat label="Đang sử dụng" value={shown.placed} />
            <Stat label="Còn lại" value={shown.available} strong />
          </View>
          {where.length ? <Text style={s.where}>{`Đang đặt: ${where.map(([r, n]) => `${ROOM_NAMES[r]} ×${n}`).join(' · ')}`}</Text> : null}
          {note ? <View style={s.note}><Ionicons name="information-circle-outline" size={16} color={t.accent} /><Text style={s.noteText}>{note}</Text></View> : null}
          {action}
          <Text style={s.section}>Lịch sử nhận</Text>
          {detail ? detail.history.length ? detail.history.map((h, i) => (
            <View key={i} style={s.history}>
              <Ionicons name={h.kind === 'walk_reward' || h.kind === 'legacy' ? 'gift-outline' : h.kind === 'plant' ? 'leaf-outline' : 'home-outline'} size={16} color={t.accent} />
              <Text style={s.historyText}>{historyLine(h)}</Text>
              <Text style={s.historyDate}>{date(h.at)}</Text>
            </View>
          )) : <Text style={s.muted}>Chưa có lịch sử.</Text>
            : failed || offline ? <Text style={s.muted}>{`Nhận lần đầu ${date(shown.first_obtained_at)}. Cần kết nối để xem đầy đủ.`}</Text>
            : <ActivityIndicator color={t.accent} />}
        </ScrollView>
        {/* Inside the sheet marked as modal, so screen readers reach it. */}
        <OptionSheet visible={rooms} title="Đặt vào phòng nào?" onClose={() => setRooms(false)}>
          {shown.rooms.map((r) => <OptionRow key={r} icon={r === 'personal' ? 'home-outline' : 'book-outline'} label={ROOM_NAMES[r]}
            description="Mở chế độ trang trí với món này" onPress={() => { setRooms(false); onClose(); onPlace?.(shown, r); }} />)}
        </OptionSheet>
      </View>
    </AppModal>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return <View style={[s.stat, strong && s.statStrong]} accessible accessibilityLabel={`${label}: ${value}`}>
    <Text style={[s.statValue, strong && s.statValueStrong]}>{value}</Text>
    <Text style={s.statLabel}>{label}</Text>
  </View>;
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 10 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { color: t.ink, fontSize: 22, fontWeight: '900' },
  subtitle: { color: t.muted, fontSize: 13, fontWeight: '700', marginTop: 1 },
  offline: { marginHorizontal: 20, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 14, backgroundColor: '#FFF3DF' },
  offlineText: { flexShrink: 1, color: '#6B4A12', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  bar: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  tab: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#BBD6E8' },
  tabOn: { backgroundColor: t.accent, borderColor: t.accent },
  tabText: { color: t.accent, fontSize: 13, fontWeight: '800' },
  tabCount: { color: t.muted, fontSize: 12, fontWeight: '800' },
  tabTextOn: { color: '#FFFFFF' },
  search: { marginHorizontal: 20, marginBottom: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#C5E2F2' },
  searchInput: { flex: 1, minWidth: 0, color: t.ink, fontSize: 14, paddingVertical: 8 },
  filter: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#E4F0F8' },
  filterOn: { backgroundColor: t.accent },
  filterText: { color: t.accent, fontSize: 12, fontWeight: '800' },
  filterTextOn: { color: '#FFFFFF' },
  grid: { paddingHorizontal: 16, gap: 10 },
  row: { gap: 10 },
  card: { flex: 1 / 3, maxWidth: '32%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 8, borderWidth: 2, alignItems: 'center',
    shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardArt: { alignSelf: 'stretch', height: 76, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  newBadge: { position: 'absolute', top: 5, left: 5, borderRadius: 99, backgroundColor: '#D6304A', paddingHorizontal: 7, paddingVertical: 2 },
  newText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  cardName: { color: t.ink, fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center', marginTop: 6, minHeight: 32 },
  pill: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 },
  pillText: { fontSize: 10, fontWeight: '900' },
  cardCount: { color: t.muted, fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(10,36,56,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheetBody: { padding: 20, gap: 12 },
  sheetHead: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  bigArt: { width: 104, height: 104, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  sheetTitle: { color: t.ink, fontSize: 20, lineHeight: 25, fontWeight: '900' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  groupPill: { backgroundColor: '#EEF4F8' },
  groupText: { color: t.ink, fontSize: 10, fontWeight: '800' },
  useText: { color: t.muted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  close: { alignSelf: 'flex-start', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF4F8' },
  description: { color: t.ink, fontSize: 14, lineHeight: 21 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 16, backgroundColor: '#F1F6FA', paddingVertical: 10, alignItems: 'center' },
  statStrong: { backgroundColor: '#DDF0FA' },
  statValue: { color: t.ink, fontSize: 20, fontWeight: '900' },
  statValueStrong: { color: t.accent },
  statLabel: { color: t.muted, fontSize: 11, fontWeight: '800', marginTop: 2 },
  where: { color: t.ink, fontSize: 13, fontWeight: '700' },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: '#EEF6FC', borderRadius: 14, padding: 10 },
  noteText: { flex: 1, color: t.ink, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  section: { color: t.muted, fontSize: 12, fontWeight: '900', marginTop: 4, textTransform: 'uppercase' },
  history: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  historyText: { flex: 1, color: t.ink, fontSize: 13, fontWeight: '700' },
  historyDate: { color: t.muted, fontSize: 12, fontWeight: '700' },
  muted: { color: t.muted, fontSize: 13 },
});
