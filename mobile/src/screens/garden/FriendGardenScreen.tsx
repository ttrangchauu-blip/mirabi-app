import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, newIdempotencyKey } from '../../api/client';
import { Text } from '../../components/Typography';
import { inventoryApi } from '../../inventory/api';
import type { CareKind, GardenPlot, PlantedPlot, VisitedGarden } from '../../inventory/types';
import { appTheme as t } from '../../theme';
import { Button } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { EmptyState, ErrorState, LoadingState, OptionSheet, PetAvatar } from '../together/ui';
import { CARE, careActions, careOf, careText, hoursLeft, planted, PlotDetail, PlotGrid, SummaryBar, ToolBar, type Tool } from './gardenUi';

type Props = { userId: number; onBack: () => void };

/** Why the garden cannot be shown, in the visitor's words. */
const CLOSED: Record<string, string> = {
  garden_visits_disabled: 'Bạn ấy đang tắt ghé thăm, nên chưa thể vào vườn lúc này.',
  garden_not_found: 'Không tìm thấy vườn này. Có thể hai bạn không còn là bạn bè.',
};

/**
 * A friend's garden as it is now: the owner's own plants, how each grows and who cared for it today. A visitor may
 * only water and tend ("Tưới", "Chăm sóc"), within what the backend allows (each plant once a day, from anyone, and a
 * daily number of plants per visitor); planting, clearing or moving anything is not offered and the backend refuses it.
 * Each care keeps its request id until the backend answers, so a retry after a lost connection is counted once.
 */
export function FriendGardenScreen({ userId, onBack }: Props) {
  const toast = useToast();
  const [data, setData] = useState<VisitedGarden | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tool, setTool] = useState<CareKind | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const requests = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try { setData(await inventoryApi.visit(userId)); setError(null); } catch (e) { setError(e); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const host = data?.owner.display_name ?? 'bạn bè';
  const left = data?.care.left ?? 0;

  async function care(plot: PlantedPlot, kind: CareKind) {
    if (careOf(plot, kind).done) { toast(`${plot.name}: ${careText(plot, kind).toLowerCase()}.`, 'info'); return; }
    if (left <= 0) { toast('Hôm nay bạn đã hết lượt chăm vườn bạn bè. Quay lại vào ngày mai nhé!', 'info'); return; }
    const key = `${kind}:${plot.plot}:${plot.planted_at}`;
    const id = requests.current.get(key) ?? newIdempotencyKey();
    requests.current.set(key, id);
    setBusy(plot.plot);
    try {
      const result = await inventoryApi.careFriend(userId, plot.plot, kind, id);
      requests.current.delete(key);
      setData({ owner: result.owner, garden: result.garden, care: result.care });
      toast(result.cared ? `Đã ${CARE[kind].label.toLowerCase()} cho ${plot.name} của ${host}!`
        : `${plot.name} vừa được ${CARE[kind].label.toLowerCase()} hôm nay rồi.`, result.cared ? 'success' : 'info');
    } catch (e) {
      if (!(e instanceof ApiError)) { toast('Chưa kết nối được, bạn thử lại nhé.', 'info'); return; } // keeps the id: a retry counts once
      requests.current.delete(key);
      if (e.code && CLOSED[e.code]) { setData(null); setError(e); return; }
      toast(e.code === 'garden_care_daily_limit' ? 'Hôm nay bạn đã hết lượt chăm vườn bạn bè. Quay lại vào ngày mai nhé!'
        : e.code === 'plot_empty' ? 'Cây này vừa được dọn khỏi vườn.' : 'Chưa chăm được, bạn thử lại nhé.', 'info');
      void load();
    } finally { setBusy(null); }
  }
  function tapPlot(plot: GardenPlot) {
    if (busy !== null) return;
    if (plot.empty) { toast('Ô đất này chưa có cây.', 'info'); return; }
    if (tool) void care(plot, tool); else setDetail(plot.plot);
  }

  const header = (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quay lại" style={s.round}>
        <Ionicons name="chevron-back" size={20} color={t.ink} />
      </Pressable>
      {data ? <PetAvatar user={{ pet: data.owner.pet, pet_level: data.owner.pet_level }} size={34} /> : null}
      <View style={s.flex}>
        <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{data ? `Vườn của ${host}` : 'Vườn bạn bè'}</Text>
        <Text style={s.subtitle} numberOfLines={1}>Bạn đang thăm vườn · chỉ tưới và chăm sóc</Text>
      </View>
    </View>
  );
  if (!data) {
    const closed = error instanceof ApiError && error.code ? CLOSED[error.code] : undefined;
    return (
      <View style={s.fill} testID="friend-garden">
        {header}
        {closed ? <EmptyState icon="lock-closed-outline" title="Chưa vào được vườn" body={closed} action={<Button title="Quay lại" variant="secondary" onPress={onBack} />} />
          : error ? <ErrorState error={error} onRetry={() => { setError(null); void load(); }} /> : <LoadingState label="Đang sang vườn bạn…" />}
      </View>
    );
  }

  const plants = planted(data.garden.plots);
  const thirsty = plants.filter((p) => !careOf(p, 'water').done).length;
  const blocked = left <= 0 ? 'Hết lượt hôm nay' : undefined;
  const tools: Tool[] = (['water', 'tend'] as const).map((k) => ({ id: k, label: CARE[k].short, icon: CARE[k].icon, color: CARE[k].color, bg: CARE[k].bg,
    disabled: !plants.length || left <= 0 }));
  const labelFor = (plot: GardenPlot) => {
    if (plot.empty) return `Ô đất trống ${plot.plot + 1}`;
    const action = tool ? `chạm để ${CARE[tool].label.toLowerCase()}` : 'chạm để xem chi tiết';
    return `${plot.name}, ${plot.stage_label}${plot.next_stage_at ? `, lớn tiếp sau khoảng ${hoursLeft(plot.next_stage_at)} giờ` : ''}, `
      + `${careText(plot, 'water').toLowerCase()}, ${careText(plot, 'tend').toLowerCase()}, ${action}`;
  };
  const open = detail !== null ? data.garden.plots[detail] : undefined;
  const openPlant = open && !open.empty ? open : null;

  return (
    <View style={s.fill} testID="friend-garden">
      {header}
      <ScrollView style={s.fill} contentContainerStyle={s.body}>
        <SummaryBar stats={[
          { icon: 'leaf-outline', text: `${plants.length}/${data.garden.size} ô`, label: `${plants.length} trên ${data.garden.size} ô đã có cây` },
          ...(plants.length ? [{ icon: 'water-outline' as const, text: thirsty ? `${thirsty} cần tưới` : 'Đã tưới hết' }] : []),
          { icon: 'heart-outline', text: `Còn ${left}/${data.care.daily_limit} lượt chăm`, tone: left <= 0 ? 'warn' : undefined,
            label: left > 0 ? `Hôm nay bạn còn ${left} lượt chăm vườn bạn bè` : 'Hôm nay bạn đã hết lượt chăm vườn bạn bè' },
        ]} />
        {plants.length ? <>
          <ToolBar tools={tools} active={tool} onChange={(id) => setTool(id as CareKind | null)} />
          <Text style={s.hint} accessibilityLiveRegion="polite">{left <= 0 ? 'Hôm nay bạn đã hết lượt chăm, vẫn xem vườn được nhé.'
            : tool ? `Chạm cây để ${CARE[tool].label.toLowerCase()}.` : `Chạm cây để xem chi tiết và chăm giúp ${host}.`}</Text>
          <PlotGrid plots={data.garden.plots} busy={busy} labelFor={labelFor} onPress={tapPlot}
            ready={(plot) => !plot.empty && !!tool && left > 0 && !careOf(plot, tool).done} />
        </> : <EmptyState icon="leaf-outline" title={`Vườn của ${host} chưa có cây`} body={`Khi ${host} trồng cây, bạn có thể ghé tưới nước và chăm sóc giúp nhé.`} />}
      </ScrollView>
      <OptionSheet visible={!!openPlant} title={openPlant?.name ?? ''} onClose={() => setDetail(null)}>
        {openPlant ? <PlotDetail plot={openPlant} actions={careActions(openPlant, blocked)}
          note={blocked ? 'Hôm nay bạn đã hết lượt chăm vườn bạn bè.' : undefined}
          onAction={(id) => { setDetail(null); void care(openPlant, id as CareKind); }} /> : null}
      </OptionSheet>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { color: t.ink, fontSize: 16, fontWeight: '800' },
  subtitle: { color: t.muted, fontSize: 11, fontWeight: '600' },
  hint: { marginHorizontal: 16, marginBottom: 8, color: '#2E5A30', fontSize: 11.5, lineHeight: 15, fontWeight: '600' },
});
