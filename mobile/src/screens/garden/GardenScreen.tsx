import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { ApiError, newIdempotencyKey } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { Text } from '../../components/Typography';
import { gardenCache, inventoryApi } from '../../inventory/api';
import type { CareKind, GardenData, GardenPlot, Harvest, InventoryItem, PlantedPlot, Seed as OwnedSeed } from '../../inventory/types';
import { appTheme as t } from '../../theme';
import { formatNumber } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { ErrorState, LoadingState, OptionRow, OptionSheet } from '../together/ui';
import { GardenWorld, type GardenFx } from './GardenWorld';
import { readyArt } from './gardenArt';
import { GardenShop } from './GardenShop';
import { CARE, careActions, careOf, careText, isReady, planted, PlotDetail, readyText, TOOL_HEIGHT, ToolBar, type Tool, useNextStage } from './gardenUi';
import { duration, TierPill } from './tiers';

type Seed = Pick<InventoryItem, 'id' | 'variant'>;
type Props = { user: User; onOpenInventory: () => void;
  /** "Khám phá": where the pet brings seeds back from. */ onOpenExplore?: () => void;
  /** A seed chosen with "Trồng" in the inventory: the next empty plot tapped plants it. */ initialSeed?: Seed | null;
  /** Points under what the space's switcher takes, and over the menu bar. */ top?: number; bottom?: number;
  /** Hatching or out on its walk: the garden without the pet. */ petAway?: boolean;
  /** Out on its walk: says so, or an empty yard looks like something is wrong. */ petWalking?: boolean;
  /** Changes when a walk's gifts were received: the seeds on show may be old. */ version?: number;
  /** Coins or EXP changed here (a purchase, a harvest): the app reads the user's numbers again. */ onRewarded?: () => void };
type ToolId = 'plant' | CareKind;

/** The row with the coins, the seeds and the shop under the switcher, the one hint and the tools: what the scene keeps free for them, always the same, so a plot never moves. */
const SEED_CARD = 34;
const DOCK = 8 + TOOL_HEIGHT + 8 + 26 + 8;

/** Whether a tool can do anything right now. */
function toolOff(id: ToolId, data: GardenData, offline: boolean) {
  if (offline) return true;
  if (id === 'plant') return !data.seeds.length || !data.plots.some((p) => p.empty);
  return !planted(data.plots).some((p) => !careOf(p, id).done);
}

const Sprout = () => <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Svg width={20} height={20} viewBox="0 0 24 24">
  <Path d="M12 21V11" stroke="#6B4A2B" strokeWidth={2.2} strokeLinecap="round" />
  <Path d="M12 13C7 13.4 4.6 10.6 4.2 6.6c4.2-.2 7.3 1.8 7.8 6.4Z" fill="#7FC24F" stroke="#3F8A35" strokeWidth={1.2} strokeLinejoin="round" />
  <Path d="M12 10.4c.5-4 3-6.4 7.8-6.6.1 4.2-2.4 6.9-7.8 6.6Z" fill="#A3D95F" stroke="#3F8A35" strokeWidth={1.2} strokeLinejoin="round" />
</Svg></View>;

const sameSeed = (a: Seed | null, b: Seed) => !!a && a.id === b.id && a.variant === b.variant;
/** A seed in a list: its tier, how long it grows and how many are left, from the backend's catalog. */
const seedLine = (x: OwnedSeed) => [x.plant?.tier_label ?? x.rarity_label, x.plant ? duration(x.plant.grow_seconds) : null,
  x.plant ? `+${x.plant.harvest_exp} EXP · +${x.plant.harvest_coins} xu` : null, `còn ${x.available}`].filter(Boolean).join(' · ');
/** Newer or as new: an answer that left the server before the one on screen must not bring the older garden back. */
const notOlder = (shown: GardenData | null, next: GardenData) => !shown?.server_now || !next.server_now || Date.parse(next.server_now) >= Date.parse(shown.server_now);

/**
 * Vườn nhà, one of the four places of Cuộc sống Mirabi: the garden scene (GardenWorld), with the coins, the number of
 * seeds and the seed shop over its sky and the tools (Trồng, Tưới, Chăm sóc) on the grass. A friend's garden opens from
 * Bạn bè. A chosen tool acts on the plots tapped next; with none, a tap opens the seeds or the plant's detail, where a
 * ready plant is harvested. A seed leaves the inventory only once the backend has planted it, one action runs at a time
 * however fast the taps come, and each keeps its request id until the backend answers, so a retry never plants, waters or
 * pays twice. Plants grow by themselves in real time; what a harvest gives is the backend's answer, shown after it, never
 * before. Offline it shows the last garden the server confirmed, and changes wait.
 */
export function GardenScreen(props: Props) {
  return <MyGarden {...props} />;
}

// ------------------------------------------------------------------------------------------------ Vườn của tôi
function MyGarden({ user, onOpenInventory, onOpenExplore, initialSeed = null, top = 0, bottom = 0, petAway = false, petWalking = false, version = 0, onRewarded }: Props) {
  const toast = useToast();
  const [data, setData] = useState<GardenData | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tool, setTool] = useState<ToolId | null>(initialSeed ? 'plant' : null);
  const [seed, setSeed] = useState<Seed | null>(initialSeed);
  const [busy, setBusy] = useState<number | null>(null);
  // An empty plot waiting for a seed to be chosen, or the plant whose detail is open.
  const [choosing, setChoosing] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  // "Trồng" with several kinds of seed: which one it plants. And the (+) on the card.
  const [pickingSeed, setPickingSeed] = useState(false);
  const [gettingSeeds, setGettingSeeds] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  // What the last harvest gave, as the backend paid it.
  const [reward, setReward] = useState<Harvest | null>(null);
  useEffect(() => {
    if (!reward) return;
    const id = setTimeout(() => setReward(null), 3600);
    return () => clearTimeout(id);
  }, [reward]);
  // One request id per plot and action, kept until the backend answers, so a retry never plants or waters twice.
  const requests = useRef(new Map<string, string>());
  // Set at once, not at the next render: two taps in one frame both see `busy` still empty.
  const acting = useRef(false);

  const shown = useRef<GardenData | null>(null);
  const show = useCallback((next: GardenData) => {
    if (!notOlder(shown.current, next)) return;
    shown.current = next;
    // Something grows in a plot: the planting whose answer was lost is over. Its id must not plant that plot again later
    // (the backend would answer "replayed" and plant nothing).
    for (const p of next.plots) {
      if (p.empty) continue;
      for (const key of [...requests.current.keys()]) if (key.startsWith(`plant:${p.plot}:`)) requests.current.delete(key);
    }
    setData(next); setOffline(false); setError(null); void gardenCache.store(user.id, next);
  }, [user.id]);
  // A care the server confirmed, played once on its plot (never before the answer: no pretend watering).
  const [fx, setFx] = useState<GardenFx | null>(null);
  const fxKey = useRef(0);
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
  // Opening it, a walk's gifts received, and back in the app: the seeds may have changed elsewhere.
  useEffect(() => { void load(); }, [load, version]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => sub.remove();
  }, [load]);
  useNextStage(data, load);
  // A tool that can no longer do anything is put down (the last seed planted, everything watered, the connection lost).
  useEffect(() => {
    if (data && tool && toolOff(tool, data, offline)) { setTool(null); setSeed(null); }
  }, [data, tool, offline]);

  const chosen = seed ? data?.seeds.find((x) => sameSeed(seed, x)) : undefined;
  const requestId = (key: string) => { const id = requests.current.get(key) ?? newIdempotencyKey(); requests.current.set(key, id); return id; };

  async function plant(plot: number, s: Seed) {
    if (offline) { toast('Cần kết nối mạng để trồng cây.', 'info'); return; }
    if (acting.current) return;
    acting.current = true;
    const key = `plant:${plot}:${s.id}.${s.variant}`;
    setBusy(plot);
    try {
      const result = await inventoryApi.plant(plot, s.id, s.variant, requestId(key));
      requests.current.delete(key);
      show(result.garden);
      if (result.planted) setFx({ plot, kind: 'plant', key: ++fxKey.current });
      const now = result.garden.plots[plot];
      toast(`Đã trồng ${now && !now.empty ? now.name : 'hạt giống'}!`, 'success');
      if (!result.garden.seeds.some((x) => sameSeed(s, x))) setSeed(null);
    } catch (e) {
      if (e instanceof ApiError) {
        requests.current.delete(key); // a final answer: a new tap is a new request
        toast(e.code === 'plot_taken' ? 'Ô đất này đã có cây rồi.' : e.code === 'not_enough_items' ? 'Bạn đã dùng hết hạt giống này.' : 'Chưa trồng được, bạn thử lại nhé.', 'info');
        void load();
      } else toast('Chưa kết nối được, bạn thử lại nhé.', 'info'); // it may have reached the server: a retry is the same request, so it never plants twice
    } finally { acting.current = false; setBusy(null); }
  }
  async function care(plot: PlantedPlot, kind: CareKind) {
    if (offline) { toast('Cần kết nối mạng để chăm cây.', 'info'); return; }
    if (careOf(plot, kind).done) { toast(`${plot.name}: ${careText(plot, kind).toLowerCase()}.`, 'info'); return; }
    if (acting.current) return;
    acting.current = true;
    const key = `${kind}:${plot.plot}:${plot.planted_at}`;
    setBusy(plot.plot);
    try {
      const result = await inventoryApi.care(plot.plot, kind, requestId(key));
      requests.current.delete(key);
      show(result.garden);
      if (result.cared) setFx({ plot: plot.plot, kind, key: ++fxKey.current });
      toast(result.cared ? `Đã ${CARE[kind].label.toLowerCase()} cho ${plot.name}!` : `${plot.name} đã được ${CARE[kind].label.toLowerCase()} hôm nay rồi.`,
        result.cared ? 'success' : 'info');
    } catch (e) {
      if (e instanceof ApiError) { requests.current.delete(key); toast(e.code === 'plot_empty' ? 'Ô đất này không còn cây.' : 'Chưa chăm được, bạn thử lại nhé.', 'info'); void load(); }
      else toast('Chưa kết nối được, bạn thử lại nhé.', 'info');
    } finally { acting.current = false; setBusy(null); }
  }
  /** The detail's "Thu hoạch" is the confirmation; the backend decides what it gives, and a replayed answer (the first one
   * was lost) shows the same reward. */
  async function harvest(plot: PlantedPlot) {
    if (offline) { toast('Cần kết nối mạng để thu hoạch.', 'info'); return; }
    if (acting.current) return;
    acting.current = true;
    const key = `harvest:${plot.plot}:${plot.planted_at}`;
    setBusy(plot.plot);
    try {
      const result = await inventoryApi.harvest(plot.plot, requestId(key));
      requests.current.delete(key);
      show(result.garden);
      const h = result.harvest;
      setFx({ plot: plot.plot, kind: 'harvest', key: ++fxKey.current, harvest: { item_id: h.item_id, art: h.art, exp: h.exp, coins: h.coins } });
      setReward(h);
      onRewarded?.();
    } catch (e) {
      if (e instanceof ApiError) {
        requests.current.delete(key);
        toast(e.code === 'not_ready' ? `${plot.name} chưa sẵn sàng thu hoạch.` : e.code === 'plot_empty' ? 'Cây này đã được thu hoạch rồi.' : 'Chưa thu hoạch được, bạn thử lại nhé.', 'info');
        void load();
      } else toast('Chưa kết nối được. Thử lại nhé: mỗi cây chỉ được nhận thưởng một lần.', 'info'); // the same request id: never paid twice
    } finally { acting.current = false; setBusy(null); }
  }
  function tapPlot(plot: GardenPlot) {
    if (acting.current) return;
    if (plot.empty) {
      if (tool === 'plant' && chosen) void plant(plot.plot, chosen);
      else if (data?.seeds.length) setChoosing(plot.plot);
      else setGettingSeeds(true);
    } else if (tool === 'water' || tool === 'tend') void care(plot, tool);
    else setDetail(plot.plot);
  }
  function onDetailAction(plot: PlantedPlot, id: string) {
    setDetail(null);
    if (id === 'harvest') void harvest(plot); else void care(plot, id as CareKind);
  }

  if (!data) return error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Đang ra vườn…" />;

  const plants = planted(data.plots);
  const seedCount = data.seeds.reduce((n, x) => n + x.available, 0);
  const coins = data.coins ?? user.coins;
  const tools: Tool[] = [
    { id: 'plant', label: 'Trồng', icon: 'leaf', color: '#2E8C3A', bg: '#E3F5E6', disabled: toolOff('plant', data, offline) },
    { id: 'water', label: CARE.water.short, icon: CARE.water.icon, color: CARE.water.color, bg: CARE.water.bg, disabled: toolOff('water', data, offline) },
    { id: 'tend', label: CARE.tend.short, icon: CARE.tend.icon, color: CARE.tend.color, bg: CARE.tend.bg, disabled: toolOff('tend', data, offline) },
  ];
  /** A tool in hand. "Trồng" asks which seed first, unless there is only one kind. */
  const pickTool = (id: string | null) => {
    if (id !== 'plant') { setTool(id as ToolId | null); setSeed(null); return; }
    if (data.seeds.length === 1) { setSeed(data.seeds[0]); setTool('plant'); } else setPickingSeed(true);
  };
  const hint = tool === 'plant' ? (chosen ? `Chạm ô trống để trồng ${chosen.name}.` : 'Chọn hạt giống, rồi chạm ô trống.')
    : tool ? `Chạm cây để ${CARE[tool].label.toLowerCase()}.` : petWalking ? 'Pet đang đi dạo, về nhà sẽ ra vườn chơi.' : plants.some(isReady) ? 'Có cây sẵn sàng thu hoạch: chạm vào cây để thu hoạch.'
    : plants.length ? 'Chạm cây để xem chi tiết và chăm sóc.' : null;
  const ready = (plot: GardenPlot) => (plot.empty ? tool === 'plant' && !!chosen : (tool === 'water' || tool === 'tend') && !careOf(plot, tool).done);
  const labelFor = (plot: GardenPlot) => {
    if (plot.empty) return `Ô đất trống ${plot.plot + 1}${tool === 'plant' && chosen ? `, chạm để trồng ${chosen.name}` : ''}`;
    const care = plot.care ? `, ${careText(plot, 'water').toLowerCase()}, ${careText(plot, 'tend').toLowerCase()}` : '';
    const action = tool === 'water' || tool === 'tend' ? `chạm để ${CARE[tool].label.toLowerCase()}` : isReady(plot) ? 'chạm để thu hoạch' : 'chạm để xem chi tiết';
    return `${plot.name}${plot.tier_label ? `, ${plot.tier_label}` : ''}, ${plot.stage_label}${isReady(plot) ? '' : `, ${readyText(plot).toLowerCase()}`}${care}, ${action}`;
  };
  const open = detail !== null ? data.plots[detail] : undefined;
  const openPlant = open && !open.empty ? open : null;

  return (
    <View style={s.fill} testID="garden-screen">
      <GardenWorld plots={data.plots} busy={busy} ready={ready} labelFor={labelFor} onPress={tapPlot} top={top + 8 + SEED_CARD} bottom={bottom + DOCK}
        pet={petAway ? null : { id: user.pet, level: user.level }} fx={fx}>
        <View style={[s.top, { top: top + 8 }]} pointerEvents="box-none">
          <View style={s.topRow} pointerEvents="box-none">
            <View style={s.seedCard} accessible accessibilityRole="text" accessibilityLabel={`${coins} xu`} testID="garden-coins">
              <Ionicons name="cash" size={15} color="#C08A1E" />
              <Text style={s.coinsText} numberOfLines={1}>{formatNumber(coins)}</Text>
            </View>
            <View style={s.seedCard} accessible accessibilityRole="text" accessibilityLabel={`Hạt giống: ${seedCount}`} testID="garden-seed-count">
              <Sprout />
              <Text style={s.seedCardText} numberOfLines={1}>{seedCount}</Text>
              <Pressable onPress={() => setGettingSeeds(true)} hitSlop={10} style={({ pressed }) => [s.seedMore, pressed && s.seedMorePressed]} accessibilityRole="button" accessibilityLabel="Nhận thêm hạt giống">
                <Ionicons name="add" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
            <Pressable onPress={() => setShopOpen(true)} style={({ pressed }) => [s.seedCard, s.shopButton, pressed && s.seedMorePressed]} accessibilityRole="button" accessibilityLabel="Mở Cửa hàng" testID="garden-open-shop">
              <Ionicons name="storefront" size={15} color="#FFFFFF" />
              <Text style={s.shopText} numberOfLines={1}>Cửa hàng</Text>
            </Pressable>
          </View>
          {offline ? <Pressable onPress={() => { void load(); }} style={s.offline} accessibilityRole="button" accessibilityLabel="Đang ngoại tuyến, chạm để thử lại">
            <Ionicons name="cloud-offline-outline" size={14} color="#6B4A12" />
            <Text style={s.offlineText}>Ngoại tuyến · vườn đã lưu. Cần kết nối để trồng và chăm cây.</Text>
          </Pressable> : null}
        </View>
        {reward ? <Pressable onPress={() => setReward(null)} style={[s.reward, { top: top + 8 + SEED_CARD + 10 }]} accessibilityRole="button" accessibilityLiveRegion="polite"
          accessibilityLabel={`Thu hoạch ${reward.name}: cộng ${reward.exp} EXP, cộng ${reward.coins} xu${reward.exp_capped ? '. Đã đủ EXP thu hoạch hôm nay' : ''}`} testID="garden-harvest-reward">
          <Image source={readyArt(reward.art)} resizeMode="contain" fadeDuration={0} style={s.rewardArt} />
          <View style={s.rewardBody}>
            <Text style={s.rewardTitle} numberOfLines={1}>Thu hoạch {reward.name}</Text>
            <TierPill tier={reward.tier} label={reward.tier_label} small />
            <View style={s.rewardGains}>
              <Text style={s.rewardExp}>+{reward.exp} EXP</Text>
              <Text style={s.rewardCoins}>+{reward.coins} xu</Text>
            </View>
            {reward.exp_capped ? <Text style={s.rewardNote}>Đã đủ EXP thu hoạch hôm nay, xu vẫn được cộng.</Text> : null}
          </View>
        </Pressable> : null}
        <View style={[s.dock, { bottom: bottom + 8 }]} pointerEvents="box-none">
          {hint ? <Text style={s.hintText} accessibilityLiveRegion="polite" numberOfLines={1}>{hint}</Text> : null}
          <ToolBar tools={tools} active={tool} onChange={pickTool} />
        </View>
      </GardenWorld>

      <OptionSheet visible={choosing !== null} title="Trồng hạt giống nào?" onClose={() => setChoosing(null)}>
        {data.seeds.map((x) => <OptionRow key={`${x.id}.${x.variant}`} icon="leaf-outline" label={x.name} description={seedLine(x)}
          onPress={() => { const plot = choosing!; setChoosing(null); setSeed(x); void plant(plot, x); }} />)}
      </OptionSheet>
      <OptionSheet visible={pickingSeed} title="Chọn hạt giống để trồng" onClose={() => setPickingSeed(false)}>
        {data.seeds.map((x) => <OptionRow key={`${x.id}.${x.variant}`} icon="leaf-outline" label={x.name} description={seedLine(x)}
          onPress={() => { setPickingSeed(false); setSeed(x); setTool('plant'); }} />)}
      </OptionSheet>
      {/* Where seeds come from: the shop, the pet's walks, and what is already in the inventory. */}
      <OptionSheet visible={gettingSeeds} title="Nhận thêm hạt giống" onClose={() => setGettingSeeds(false)}>
        <OptionRow icon="storefront-outline" label="Cửa hàng hạt giống" description="Mua hạt bằng xu: cây càng hiếm, thu hoạch càng nhiều."
          onPress={() => { setGettingSeeds(false); setShopOpen(true); }} />
        {onOpenExplore ? <OptionRow icon="compass-outline" label="Đến Khám phá" description="Pet có thể mang hạt giống về sau những chuyến khám phá."
          onPress={() => { setGettingSeeds(false); onOpenExplore(); }} /> : null}
        <OptionRow icon="cube-outline" label="Mở Kho đồ" description="Xem hạt giống và các vật phẩm bạn đang có."
          onPress={() => { setGettingSeeds(false); onOpenInventory(); }} />
      </OptionSheet>
      <OptionSheet visible={!!openPlant} title={openPlant?.name ?? ''} onClose={() => setDetail(null)}>
        {openPlant ? <PlotDetail plot={openPlant} onAction={(id) => onDetailAction(openPlant, id)}
          actions={[...(isReady(openPlant) ? [{ id: 'harvest', label: 'Thu hoạch', icon: 'basket' as const, color: '#B07800',
            note: openPlant.harvest ? `+${openPlant.harvest.exp} EXP · +${openPlant.harvest.coins} xu` : undefined }] : []), ...careActions(openPlant)]} /> : null}
      </OptionSheet>
      <GardenShop visible={shopOpen} onClose={() => setShopOpen(false)} onBought={() => { void load(); onRewarded?.(); }} />
    </View>
  );
}
const s = StyleSheet.create({
  fill: { flex: 1 },
  top: { position: 'absolute', left: 12, right: 12, gap: 6, alignItems: 'flex-end' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coinsText: { color: '#7A4D00', fontSize: 13, lineHeight: 18, fontWeight: '900', paddingRight: 6 },
  shopButton: { backgroundColor: '#2E8C3A', paddingRight: 11 },
  shopText: { color: '#FFFFFF', fontSize: 12.5, lineHeight: 18, fontWeight: '800' },
  reward: { position: 'absolute', alignSelf: 'center', left: 24, right: 24, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: 1.5, borderColor: '#F1D27A',
    shadowColor: '#23452A', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  rewardArt: { width: 52, height: 72 },
  rewardBody: { flex: 1, minWidth: 0, gap: 3 },
  rewardTitle: { color: t.ink, fontSize: 15, fontWeight: '900' },
  rewardGains: { flexDirection: 'row', gap: 10 },
  rewardExp: { color: '#1F6A2E', fontSize: 15, fontWeight: '900' },
  rewardCoins: { color: '#8A5A00', fontSize: 15, fontWeight: '900' },
  rewardNote: { color: t.muted, fontSize: 11, fontWeight: '600' },
  seedCard: { flexDirection: 'row', alignItems: 'center', gap: 6, height: SEED_CARD, paddingLeft: 9, paddingRight: 4, borderRadius: SEED_CARD / 2, backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#23452A', shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  seedCardText: { color: '#1F5A26', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  seedMore: { width: 26, height: 26, borderRadius: 13, marginLeft: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2E8C3A' },
  seedMorePressed: { opacity: 0.8, transform: [{ scale: 0.94 }] },
  dock: { position: 'absolute', left: 12, right: 12, gap: 8 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: '#FFF3DFF2' },
  offlineText: { flexShrink: 1, color: '#6B4A12', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  hintText: { alignSelf: 'center', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 13, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.92)', color: '#2E5A30', fontSize: 12, lineHeight: 18, fontWeight: '700' },
});
