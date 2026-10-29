import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, newIdempotencyKey } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { ItemIcon } from '../../components/ItemIcon';
import { Text } from '../../components/Typography';
import { gardenCache, inventoryApi } from '../../inventory/api';
import { rarityOf } from '../../inventory/rarity';
import type { CareKind, GardenData, GardenPlot, InventoryItem, PlantedPlot } from '../../inventory/types';
import { togetherApi } from '../../studyTogether/api';
import type { Friend } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { useToast } from '../../ui/Toast';
import { FriendDirectory } from '../together/friendsUi';
import { ErrorState, LoadingState, OptionRow, OptionSheet } from '../together/ui';
import { CARE, careActions, careOf, careText, hoursLeft, planted, PlotDetail, PlotGrid, SummaryBar, ToolBar, type Tool } from './gardenUi';

type Seed = Pick<InventoryItem, 'id' | 'variant'>;
export type GardenTab = 'mine' | 'friends';
type Props = { user: User; onBack: () => void; onOpenInventory: () => void;
  /** A seed chosen with "Trồng" in the inventory: the next empty plot tapped plants it. */ initialSeed?: Seed | null;
  /** "Thăm vườn" on a friend in "Vườn bạn bè". */ onVisitGarden?: (userId: number) => void;
  tab?: GardenTab; onTabChange?: (tab: GardenTab) => void };
type ToolId = 'plant' | CareKind;

const sameSeed = (a: Seed | null, b: Seed) => !!a && a.id === b.id && a.variant === b.variant;
const TABS: { id: GardenTab; label: string }[] = [{ id: 'mine', label: 'Vườn của tôi' }, { id: 'friends', label: 'Vườn bạn bè' }];

/**
 * Vườn nhà, one screen for every way in (Tiện ích, Phòng cá nhân → Cài đặt, "Trồng" in Kho đồ), with two tabs:
 * "Vườn của tôi" and "Vườn bạn bè" (friends, each with "Thăm vườn").
 *
 * Your garden: a small summary bar, the tools (Trồng, Tưới, Chăm sóc) and the six plots. A chosen tool acts on the
 * plots tapped next; with none, a tap opens the plant's detail and what can be done with it. A seed leaves the inventory
 * only once the backend has planted it, and each tap keeps its request id until the backend answers, so a retry never
 * plants or waters twice. Plants grow by themselves; a grown one can be cleared to free its plot. Offline it shows the
 * last garden the server confirmed, and changes wait.
 */
export function GardenScreen({ user, onBack, onOpenInventory, initialSeed = null, onVisitGarden, tab: shownTab, onTabChange }: Props) {
  const [ownTab, setOwnTab] = useState<GardenTab>(shownTab ?? 'mine');
  const tab = shownTab ?? ownTab;
  const setTab = (next: GardenTab) => { setOwnTab(next); onTabChange?.(next); };

  return (
    <View style={s.fill} testID="garden-screen">
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.round}>
          <Ionicons name="chevron-back" size={20} color={t.ink} />
        </Pressable>
        <Text style={[s.title, s.flex]} accessibilityRole="header" numberOfLines={1}>Vườn nhà</Text>
        <Pressable onPress={onOpenInventory} style={s.inventory} hitSlop={4} accessibilityRole="button" accessibilityLabel="Kho đồ">
          <Ionicons name="cube-outline" size={16} color={t.accent} /><Text style={s.inventoryText}>Kho đồ</Text>
        </Pressable>
      </View>
      <View style={s.tabs} accessibilityRole="tablist">
        {TABS.map((x) => (
          <Pressable key={x.id} onPress={() => setTab(x.id)} accessibilityRole="tab" accessibilityState={{ selected: tab === x.id }}
            style={[s.tab, tab === x.id && s.tabOn]}>
            <Text style={[s.tabText, tab === x.id && s.tabTextOn]}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'mine' ? <MyGarden user={user} onOpenInventory={onOpenInventory} initialSeed={initialSeed} />
        : <FriendGardens onVisit={(f) => onVisitGarden?.(f.id)} />}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ Vườn của tôi
function MyGarden({ user, onOpenInventory, initialSeed }: { user: User; onOpenInventory: () => void; initialSeed: Seed | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<GardenData | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tool, setTool] = useState<ToolId | null>(initialSeed ? 'plant' : null);
  const [seed, setSeed] = useState<Seed | null>(initialSeed);
  const [busy, setBusy] = useState<number | null>(null);
  // An empty plot waiting for a seed to be chosen, or the plant whose detail is open.
  const [choosing, setChoosing] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  // One request id per plot and action, kept until the backend answers, so a retry never plants or waters twice.
  const requests = useRef(new Map<string, string>());

  const show = useCallback((next: GardenData) => { setData(next); setOffline(false); setError(null); void gardenCache.store(user.id, next); }, [user.id]);
  const load = useCallback(async () => {
    try {
      const fresh = await inventoryApi.garden();
      if (!Array.isArray(fresh?.plots)) throw new Error('Unexpected garden');
      show(fresh);
    } catch (e) {
      const cached = await gardenCache.load(user.id);
      if (cached) { setData((current) => current ?? cached); setOffline(true); } else setError(e);
    }
  }, [user.id, show]);
  useEffect(() => { void load(); }, [load]);

  const chosen = seed ? data?.seeds.find((x) => sameSeed(seed, x)) : undefined;
  const requestId = (key: string) => { const id = requests.current.get(key) ?? newIdempotencyKey(); requests.current.set(key, id); return id; };

  async function plant(plot: number, s: Seed) {
    if (offline) { toast('Cần kết nối mạng để trồng cây.', 'info'); return; }
    const key = `plant:${plot}:${s.id}.${s.variant}`;
    setBusy(plot);
    try {
      const result = await inventoryApi.plant(plot, s.id, s.variant, requestId(key));
      requests.current.delete(key);
      show(result.garden);
      const now = result.garden.plots[plot];
      toast(`Đã trồng ${now && !now.empty ? now.name : 'hạt giống'}!`, 'success');
      if (!result.garden.seeds.some((x) => sameSeed(s, x))) setSeed(null);
    } catch (e) {
      if (e instanceof ApiError) {
        requests.current.delete(key); // a final answer: a new tap is a new request
        toast(e.code === 'plot_taken' ? 'Ô đất này đã có cây rồi.' : e.code === 'not_enough_items' ? 'Bạn đã dùng hết hạt giống này.' : 'Chưa trồng được, bạn thử lại nhé.', 'info');
        void load();
      } else toast('Chưa kết nối được. Hạt giống vẫn còn trong kho, bạn thử lại nhé.', 'info');
    } finally { setBusy(null); }
  }
  async function care(plot: PlantedPlot, kind: CareKind) {
    if (offline) { toast('Cần kết nối mạng để chăm cây.', 'info'); return; }
    if (careOf(plot, kind).done) { toast(`${plot.name}: ${careText(plot, kind).toLowerCase()}.`, 'info'); return; }
    const key = `${kind}:${plot.plot}:${plot.planted_at}`;
    setBusy(plot.plot);
    try {
      const result = await inventoryApi.care(plot.plot, kind, requestId(key));
      requests.current.delete(key);
      show(result.garden);
      toast(result.cared ? `Đã ${CARE[kind].label.toLowerCase()} cho ${plot.name}!` : `${plot.name} đã được ${CARE[kind].label.toLowerCase()} hôm nay rồi.`,
        result.cared ? 'success' : 'info');
    } catch (e) {
      if (e instanceof ApiError) { requests.current.delete(key); toast(e.code === 'plot_empty' ? 'Ô đất này không còn cây.' : 'Chưa chăm được, bạn thử lại nhé.', 'info'); void load(); }
      else toast('Chưa kết nối được, bạn thử lại nhé.', 'info');
    } finally { setBusy(null); }
  }
  async function clear(plot: PlantedPlot) {
    if (offline) { toast('Cần kết nối mạng để dọn ô đất.', 'info'); return; }
    if (!(await confirm({ title: 'Dọn ô đất này?', message: `${plot.name} đã lớn. Dọn ô để trồng cây mới nhé.`, confirmLabel: 'Dọn ô', cancelLabel: 'Để lại', icon: 'leaf-outline' }))) return;
    setBusy(plot.plot);
    try { show((await inventoryApi.clear(plot.plot)).garden); } catch { toast('Chưa dọn được ô đất, bạn thử lại nhé.', 'info'); } finally { setBusy(null); }
  }
  function tapPlot(plot: GardenPlot) {
    if (busy !== null) return;
    if (plot.empty) {
      if (tool === 'plant' && chosen) void plant(plot.plot, chosen);
      else if (data?.seeds.length) setChoosing(plot.plot);
      else toast('Chưa có hạt giống. Pet sẽ mang hạt về sau những chuyến khám phá.', 'info');
    } else if (tool === 'water' || tool === 'tend') void care(plot, tool);
    else setDetail(plot.plot);
  }
  function onDetailAction(plot: PlantedPlot, id: string) {
    setDetail(null);
    if (id === 'clear') void clear(plot); else void care(plot, id as CareKind);
  }

  if (!data) return error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Đang ra vườn…" />;

  const plants = planted(data.plots);
  const thirsty = plants.filter((p) => !careOf(p, 'water').done).length;
  const seedCount = data.seeds.reduce((n, x) => n + x.available, 0);
  const tools: Tool[] = [
    { id: 'plant', label: 'Trồng', icon: 'leaf', color: '#2E8C3A', bg: '#E3F5E6' },
    { id: 'water', label: CARE.water.short, icon: CARE.water.icon, color: CARE.water.color, bg: CARE.water.bg, disabled: !plants.length },
    { id: 'tend', label: CARE.tend.short, icon: CARE.tend.icon, color: CARE.tend.color, bg: CARE.tend.bg, disabled: !plants.length },
  ];
  const hint = tool === 'plant' ? (chosen ? `Chạm ô trống để trồng ${chosen.name}.` : data.seeds.length ? 'Chọn hạt giống, rồi chạm ô trống.' : null)
    : tool ? `Chạm cây để ${CARE[tool].label.toLowerCase()}.` : 'Chạm cây để xem chi tiết và chăm sóc.';
  const ready = (plot: GardenPlot) => (plot.empty ? tool === 'plant' && !!chosen : (tool === 'water' || tool === 'tend') && !careOf(plot, tool).done);
  const labelFor = (plot: GardenPlot) => {
    if (plot.empty) return `Ô đất trống ${plot.plot + 1}${tool === 'plant' && chosen ? `, chạm để trồng ${chosen.name}` : ''}`;
    const care = plot.care ? `, ${careText(plot, 'water').toLowerCase()}, ${careText(plot, 'tend').toLowerCase()}` : '';
    const action = tool === 'water' || tool === 'tend' ? `chạm để ${CARE[tool].label.toLowerCase()}` : 'chạm để xem chi tiết';
    return `${plot.name}, ${plot.stage_label}${plot.next_stage_at ? `, lớn tiếp sau khoảng ${hoursLeft(plot.next_stage_at)} giờ` : ''}${care}, ${action}`;
  };
  const open = detail !== null ? data.plots[detail] : undefined;
  const openPlant = open && !open.empty ? open : null;

  return (
    <ScrollView style={s.fill} contentContainerStyle={s.body}>
      {offline ? <Pressable onPress={() => { void load(); }} style={s.offline} accessibilityRole="button" accessibilityLabel="Đang ngoại tuyến, chạm để thử lại">
        <Ionicons name="cloud-offline-outline" size={14} color="#6B4A12" />
        <Text style={s.offlineText}>Ngoại tuyến · vườn đã lưu. Cần kết nối để trồng và chăm cây.</Text>
      </Pressable> : null}
      <SummaryBar stats={[
        { icon: 'leaf-outline', text: `${plants.length}/${data.size} ô`, label: `${plants.length} trên ${data.size} ô đã có cây` },
        { icon: 'flower-outline', text: `${plants.filter((p) => p.grown).length} đã lớn` },
        ...(plants.length ? [{ icon: 'water-outline' as const, text: thirsty ? `${thirsty} cần tưới` : 'Đã tưới hết', tone: thirsty ? 'warn' as const : undefined }] : []),
        { icon: 'ellipse-outline', text: `${seedCount} hạt giống` },
      ]} />
      <ToolBar tools={tools} active={tool} onChange={(id) => setTool(id as ToolId | null)} />
      {tool === 'plant' ? (
        data.seeds.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.seeds} style={s.seedRow}>
            {data.seeds.map((x) => {
              const on = sameSeed(seed, x);
              return <Pressable key={`${x.id}.${x.variant}`} onPress={() => setSeed(on ? null : x)} style={[s.seed, { borderColor: on ? t.accent : rarityOf(x.rarity).border }, on && s.seedOn]}
                accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${x.name}, ${x.rarity_label}, còn ${x.available}`}>
                <View style={[s.seedArt, { backgroundColor: rarityOf(x.rarity).bg }]}><ItemIcon id={x.id} variant={x.variant} size={24} /></View>
                <View style={s.seedInfo}>
                  <Text style={s.seedName} numberOfLines={1}>{x.name}</Text>
                  <Text style={s.seedCount}>Còn {x.available}</Text>
                </View>
              </Pressable>;
            })}
          </ScrollView>
        ) : <Text style={s.hintText}>Chưa có hạt giống. Pet sẽ mang hạt về sau những chuyến khám phá.</Text>
      ) : null}
      {hint ? <Text style={s.hintText} accessibilityLiveRegion="polite">{hint}</Text> : null}
      <PlotGrid plots={data.plots} busy={busy} ready={ready} labelFor={labelFor} onPress={tapPlot} />

      <OptionSheet visible={choosing !== null} title="Trồng hạt giống nào?" onClose={() => setChoosing(null)}>
        {data.seeds.map((x) => <OptionRow key={`${x.id}.${x.variant}`} icon="leaf-outline" label={x.name} description={`${x.rarity_label} · còn ${x.available}`}
          onPress={() => { const plot = choosing!; setChoosing(null); setSeed(x); void plant(plot, x); }} />)}
      </OptionSheet>
      <OptionSheet visible={!!openPlant} title={openPlant?.name ?? ''} onClose={() => setDetail(null)}>
        {openPlant ? <PlotDetail plot={openPlant} onAction={(id) => onDetailAction(openPlant, id)}
          actions={[...careActions(openPlant), ...(openPlant.grown ? [{ id: 'clear', label: 'Dọn ô', icon: 'trash-outline' as const, color: t.danger }] : [])]} /> : null}
      </OptionSheet>
    </ScrollView>
  );
}

// ------------------------------------------------------------------------------------------------ Vườn bạn bè
function FriendGardens({ onVisit }: { onVisit: (f: Friend) => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { setFriends(await togetherApi.friends()); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView style={s.fill} contentContainerStyle={[s.body, s.friends]} keyboardShouldPersistTaps="handled">
      <Text style={s.friendsHint}>Ghé vườn bạn bè để tưới nước và chăm sóc cây giúp nhau.</Text>
      <FriendDirectory friends={friends} error={error} onRetry={() => { setError(null); void load(); }} onVisit={onVisit}
        actionLabel="Thăm vườn" emptyBody="Kết bạn bằng mã hoặc mã QR để thăm và chăm vườn của nhau nhé." />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { color: t.ink, fontSize: 17, fontWeight: '800' },
  inventory: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 18, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#BBD6E8' },
  inventoryText: { color: t.accent, fontSize: 11.5, fontWeight: '700' },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, padding: 3, borderRadius: 14, backgroundColor: '#FFFFFFAA' },
  tab: { flex: 1, minHeight: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#FFFFFF', shadowColor: t.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { color: t.muted, fontSize: 12.5, fontWeight: '700' },
  tabTextOn: { color: '#2E6B33', fontWeight: '800' },
  offline: { marginHorizontal: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: '#FFF3DF' },
  offlineText: { flexShrink: 1, color: '#6B4A12', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  hintText: { marginHorizontal: 16, marginBottom: 8, color: '#2E5A30', fontSize: 11.5, lineHeight: 15, fontWeight: '600' },
  seedRow: { flexGrow: 0, marginBottom: 6 },
  seeds: { gap: 6, paddingHorizontal: 16 },
  seed: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, paddingVertical: 4, paddingLeft: 4, paddingRight: 8, borderRadius: 14,
    backgroundColor: '#FFFFFF', borderWidth: 1.5 },
  seedOn: { backgroundColor: '#E7F2FA' },
  seedArt: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  seedInfo: { flexShrink: 1 },
  seedName: { color: t.ink, fontSize: 11, fontWeight: '700' },
  seedCount: { color: t.muted, fontSize: 10, fontWeight: '600' },
  friends: { paddingHorizontal: 16 },
  friendsHint: { color: t.muted, fontSize: 11.5, fontWeight: '600', marginBottom: 8 },
});
