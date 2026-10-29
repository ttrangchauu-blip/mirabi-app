import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { Text } from '../../components/Typography';
import { GARDEN_PLANTS, SOIL_PLOT } from '../../gardenArt';
import type { CareKind, GardenPlot, PlantedPlot, PlotCare } from '../../inventory/types';
import { appTheme as t } from '../../theme';
import type { IconName } from '../../ui/kit';

/** The pieces both gardens share (yours and a friend's): the summary bar, the tools, the plots and a plant's detail. */

export const CARE: Record<CareKind, { label: string; short: string; done: string; icon: IconName; color: string; bg: string }> = {
  water: { label: 'Tưới nước', short: 'Tưới', done: 'Đã tưới', icon: 'water', color: '#1B6FA8', bg: '#DCEFFB' },
  tend: { label: 'Chăm sóc', short: 'Chăm sóc', done: 'Đã chăm', icon: 'sparkles', color: '#8A5A00', bg: '#FFF1CC' },
};
export const CARE_KINDS: CareKind[] = ['water', 'tend'];

export const hoursLeft = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 3_600_000));
export const careOf = (plot: PlantedPlot, kind: CareKind): PlotCare => plot.care?.[kind] ?? { done: false, by: null, at: null };
export const planted = (plots: GardenPlot[]) => plots.filter((p): p is PlantedPlot => !p.empty);
/** "Đang lớn · ~3 giờ nữa" or "Đã lớn". */
export const growthText = (plot: PlantedPlot) => (plot.grown ? plot.stage_label
  : plot.next_stage_at ? `${plot.stage_label} · ~${hoursLeft(plot.next_stage_at)} giờ` : plot.stage_label);
/** Who cared for it today, for the detail and for screen readers. */
export function careText(plot: PlantedPlot, kind: CareKind) {
  const c = careOf(plot, kind);
  if (!c.done) return kind === 'water' ? 'Chưa tưới hôm nay' : 'Chưa chăm sóc hôm nay';
  return `${CARE[kind].done} hôm nay${c.by ? ` · ${c.by.me ? 'bạn' : c.by.display_name}` : ''}`;
}

// ------------------------------------------------------------------------------------------------ summary bar
export type Stat = { icon: IconName; text: string; label?: string; tone?: 'warn' };

/** One small line of numbers above the garden instead of separate cards. */
export function SummaryBar({ stats }: { stats: Stat[] }) {
  return (
    <View style={s.summary} accessibilityRole="summary">
      {stats.map((x) => (
        <View key={x.text} style={s.stat} accessible accessibilityLabel={x.label ?? x.text}>
          <Ionicons name={x.icon} size={13} color={x.tone === 'warn' ? '#A15C00' : '#2E6B33'} />
          <Text style={[s.statText, x.tone === 'warn' && s.statWarn]} numberOfLines={1}>{x.text}</Text>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ tools
export type Tool = { id: string; label: string; icon: IconName; color: string; bg: string; disabled?: boolean };

/** Icon + short label; a chosen tool is applied to the plots tapped next, tapped again it is put down. */
export function ToolBar({ tools, active, onChange }: { tools: Tool[]; active: string | null; onChange: (id: string | null) => void }) {
  return (
    <View style={s.tools} accessibilityRole="radiogroup">
      {tools.map((tool) => {
        const on = active === tool.id;
        return (
          <Pressable key={tool.id} onPress={() => onChange(on ? null : tool.id)} disabled={tool.disabled} accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!tool.disabled }} accessibilityLabel={tool.label}
            style={({ pressed }) => [s.tool, on && { backgroundColor: tool.color, borderColor: tool.color }, tool.disabled && s.dimmed, pressed && s.pressed]}>
            <View style={[s.toolIcon, { backgroundColor: on ? '#FFFFFF33' : tool.bg }]}>
              <Ionicons name={tool.icon} size={15} color={on ? '#FFFFFF' : tool.color} />
            </View>
            <Text style={[s.toolText, on && s.toolTextOn]} numberOfLines={1}>{tool.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ plots
/** Three plots a row, so the whole garden fits on screen; the soil and plant stay large enough to see and tap. */
export function PlotGrid({ plots, busy, ready, labelFor, onPress }: {
  plots: GardenPlot[]; busy: number | null; /** Plots the chosen tool would act on (outlined). */ ready: (plot: GardenPlot) => boolean;
  labelFor: (plot: GardenPlot) => string; onPress: (plot: GardenPlot) => void;
}) {
  return (
    <View style={s.plots}>
      {plots.map((plot) => {
        const art = plot.empty ? null : (GARDEN_PLANTS[plot.item_id] ?? GARDEN_PLANTS.seedling)?.[plot.stage];
        const on = ready(plot);
        return (
          <Pressable key={plot.plot} onPress={() => onPress(plot)} style={({ pressed }) => [s.plot, on && s.plotReady, pressed && s.pressed]}
            accessibilityRole="button" accessibilityLabel={labelFor(plot)} testID={`garden-plot-${plot.plot}`}>
            <View style={s.plotArt}>
              <View style={s.soil}><SvgXml xml={SOIL_PLOT} width="100%" height="100%" /></View>
              {art ? <View style={s.plant}><SvgXml xml={art} width="100%" height="100%" /></View>
                : <Ionicons name={on ? 'add-circle' : 'add-circle-outline'} size={24} color={on ? '#2E8C3A' : '#8A6A48'} style={s.plus} />}
              {plot.empty ? null : (
                <View style={s.badges}>
                  {CARE_KINDS.filter((k) => careOf(plot, k).done).map((k) => (
                    <View key={k} style={[s.badge, { backgroundColor: CARE[k].bg }]}><Ionicons name={CARE[k].icon} size={10} color={CARE[k].color} /></View>
                  ))}
                </View>
              )}
              {busy === plot.plot ? <ActivityIndicator style={StyleSheet.absoluteFill} color={t.accent} /> : null}
            </View>
            <Text style={s.plotName} numberOfLines={1}>{plot.empty ? 'Ô trống' : plot.name}</Text>
            <Text style={s.plotStage} numberOfLines={1}>{plot.empty ? ' ' : growthText(plot)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ a plant's detail
export type PlotAction = { id: string; label: string; icon: IconName; color?: string; disabled?: boolean; note?: string };

/** Inside an OptionSheet: how the plant grows, today's care, then what this person may do with it. */
export function PlotDetail({ plot, actions, note, onAction }: { plot: PlantedPlot; actions: PlotAction[]; note?: string; onAction: (id: string) => void }) {
  const art = (GARDEN_PLANTS[plot.item_id] ?? GARDEN_PLANTS.seedling)?.[plot.stage];
  return (
    <View>
      <View style={s.detail}>
        <View style={s.detailArt}>{art ? <SvgXml xml={art} width="100%" height="100%" /> : null}</View>
        <View style={s.flex}>
          <Text style={s.detailStage}>{plot.stage_label}</Text>
          <Text style={s.detailSub}>{plot.grown ? 'Cây đã lớn hẳn' : plot.next_stage_at ? `Lớn tiếp sau khoảng ${hoursLeft(plot.next_stage_at)} giờ` : ' '}</Text>
          {CARE_KINDS.map((k) => {
            const done = careOf(plot, k).done;
            return (
              <View key={k} style={s.careLine}>
                <Ionicons name={done ? CARE[k].icon : (`${CARE[k].icon}-outline` as IconName)} size={13} color={done ? CARE[k].color : t.muted} />
                <Text style={[s.careText, done && { color: CARE[k].color }]} numberOfLines={1}>{careText(plot, k)}</Text>
              </View>
            );
          })}
        </View>
      </View>
      {note ? <Text style={s.note} accessibilityLiveRegion="polite">{note}</Text> : null}
      {actions.map((a) => (
        <Pressable key={a.id} onPress={() => onAction(a.id)} disabled={a.disabled} accessibilityRole="button" accessibilityLabel={a.note ? `${a.label}, ${a.note}` : a.label}
          accessibilityState={{ disabled: !!a.disabled }} style={({ pressed }) => [s.action, a.disabled && s.dimmed, pressed && s.pressed]}>
          <Ionicons name={a.icon} size={18} color={a.color ?? t.accent} />
          <Text style={s.actionText}>{a.label}</Text>
          {a.note ? <Text style={s.actionNote} numberOfLines={1}>{a.note}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** The care actions of a plant: done ones (by anyone today) stay listed but cannot be tapped. */
export function careActions(plot: PlantedPlot, blocked?: string): PlotAction[] {
  return CARE_KINDS.map((k) => {
    const done = careOf(plot, k).done;
    return { id: k, label: CARE[k].label, icon: CARE[k].icon, color: CARE[k].color, disabled: done || !!blocked,
      note: done ? `${CARE[k].done} hôm nay` : blocked };
  });
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  dimmed: { opacity: 0.45 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#E6F4E4' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: '#1F5A26', fontSize: 11, fontWeight: '700' },
  statWarn: { color: '#A15C00' },
  tools: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 8 },
  tool: { flex: 1, minWidth: 0, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 6,
    borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#D3E6D0' },
  toolIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toolText: { flexShrink: 1, color: t.ink, fontSize: 11.5, fontWeight: '700' },
  toolTextOn: { color: '#FFFFFF' },
  plots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  plot: { width: '31.5%', flexGrow: 1, borderRadius: 16, padding: 6, backgroundColor: '#CFE9B8', borderWidth: 2, borderColor: '#A9D48A' },
  plotReady: { borderColor: '#2E8C3A', backgroundColor: '#BFE3A4' },
  plotArt: { height: 84, alignItems: 'center', justifyContent: 'flex-end' },
  soil: { position: 'absolute', left: 2, right: 2, bottom: 0, height: 38 },
  plant: { position: 'absolute', left: '10%', right: '10%', bottom: 13, top: 0 },
  plus: { position: 'absolute', bottom: 10 },
  badges: { position: 'absolute', top: 0, right: 0, gap: 3 },
  badge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  plotName: { color: '#21401A', fontSize: 11, fontWeight: '800', marginTop: 4 },
  plotStage: { color: '#3F5E33', fontSize: 10, fontWeight: '600' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  detailArt: { width: 64, height: 64, borderRadius: 16, backgroundColor: '#E6F4E4', padding: 4 },
  detailStage: { color: t.ink, fontSize: 14, fontWeight: '800' },
  detailSub: { color: t.muted, fontSize: 11.5, fontWeight: '600', marginBottom: 3 },
  careLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  careText: { flexShrink: 1, color: t.muted, fontSize: 11.5, fontWeight: '600' },
  note: { color: '#A15C00', fontSize: 11.5, fontWeight: '700', marginVertical: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: t.tint },
  actionText: { flex: 1, color: t.ink, fontSize: 14, fontWeight: '700' },
  actionNote: { color: t.muted, fontSize: 11, fontWeight: '600' },
});
