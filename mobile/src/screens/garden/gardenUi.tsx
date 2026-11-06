import React, { useEffect } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import type { CareKind, GardenPlot, PlantedPlot, PlotCare } from '../../inventory/types';
import { appTheme as t } from '../../theme';
import { radius } from '../../ui/design';
import type { IconName } from '../../ui/kit';
import { plantArt } from './gardenArt';
import { TierPill, timeLeft } from './tiers';

/** The pieces both gardens share (yours and a friend's), besides the scene itself: the summary bar, the tools and a plant's detail. */

export const CARE: Record<CareKind, { label: string; short: string; done: string; icon: IconName; color: string; bg: string }> = {
  water: { label: 'Tưới nước', short: 'Tưới', done: 'Đã tưới', icon: 'water', color: '#1B6FA8', bg: '#DCEFFB' },
  tend: { label: 'Chăm sóc', short: 'Chăm sóc', done: 'Đã chăm', icon: 'sparkles', color: '#8A5A00', bg: '#FFF1CC' },
};
export const CARE_KINDS: CareKind[] = ['water', 'tend'];

/** Whether a plant can be harvested (`grown` in answers from before harvests). */
export const isReady = (plot: PlantedPlot) => plot.ready ?? plot.grown;
/** When it is ready, told in words: "Sẵn sàng thu hoạch", "Thu hoạch sau 12 phút". */
export function readyText(plot: PlantedPlot) {
  if (isReady(plot)) return 'Sẵn sàng thu hoạch';
  const at = plot.ready_at ?? plot.next_stage_at;
  return at ? `${plot.ready_at ? 'Thu hoạch sau' : 'Lớn tiếp sau'} ${timeLeft(at)}` : ' ';
}
export const careOf = (plot: PlantedPlot, kind: CareKind): PlotCare => plot.care?.[kind] ?? { done: false, by: null, at: null };
export const planted = (plots: GardenPlot[]) => plots.filter((p): p is PlantedPlot => !p.empty);
/** Who cared for it today, for the detail and for screen readers. */
export function careText(plot: PlantedPlot, kind: CareKind) {
  const c = careOf(plot, kind);
  if (!c.done) return kind === 'water' ? 'Chưa tưới hôm nay' : 'Chưa chăm sóc hôm nay';
  return `${CARE[kind].done} hôm nay${c.by ? ` · ${c.by.me ? 'bạn' : c.by.display_name}` : ''}`;
}

/** Asks the backend again when the next plant reaches its next stage (the backend decides, by its own clock: the wait is
 * told from its `server_now`), so a garden left open shows it growing and "Dọn ô" once it has. */
export function useNextStage(garden: { plots: GardenPlot[]; server_now?: string } | null | undefined, reload: () => unknown) {
  const stages = garden ? planted(garden.plots).flatMap((p) => (p.next_stage_at ? [Date.parse(p.next_stage_at)] : [])) : [];
  const soonest = stages.length ? Math.min(...stages) : null;
  const serverNow = garden?.server_now;
  useEffect(() => {
    if (soonest === null) return;
    const now = serverNow ? Date.parse(serverNow) : NaN;
    const wait = soonest - (Number.isNaN(now) ? Date.now() : now) + 1500;
    const id = setTimeout(() => { void reload(); }, Math.min(Math.max(wait, 1000), 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [soonest, serverNow, reload]);
}

// ------------------------------------------------------------------------------------------------ summary bar
export type Stat = { icon: IconName; text: string; label?: string; tone?: 'warn' };

/** One small line of numbers over the garden instead of separate cards. */
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

/** How tall a tool is on screen; its finger area is taller (`TOOL_SLOP`). What floats at the bottom of a garden is told from this. */
export const TOOL_HEIGHT = 36;
const TOOL_SLOP = { top: 6, bottom: 6, left: 4, right: 4 };

/** Icon + short label, small, so they leave the plots in view; a chosen tool is applied to the plots tapped next, tapped again it is put down. */
export function ToolBar({ tools, active, onChange }: { tools: Tool[]; active: string | null; onChange: (id: string | null) => void }) {
  return (
    <View style={s.tools} accessibilityRole="radiogroup">
      {tools.map((tool) => {
        const on = active === tool.id;
        return (
          <Pressable key={tool.id} onPress={() => onChange(on ? null : tool.id)} disabled={tool.disabled} hitSlop={TOOL_SLOP} accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!tool.disabled }} accessibilityLabel={tool.label}
            style={({ pressed }) => [s.tool, on && { backgroundColor: tool.color }, tool.disabled && s.toolOff, pressed && s.pressed]}>
            <View style={[s.toolIcon, { backgroundColor: on ? '#FFFFFF33' : tool.bg }]}>
              <Ionicons name={tool.icon} size={13} color={on ? '#FFFFFF' : tool.color} />
            </View>
            <Text style={[s.toolText, on && s.toolTextOn]} numberOfLines={1}>{tool.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------ a plant's detail
export type PlotAction = { id: string; label: string; icon: IconName; color?: string; disabled?: boolean; note?: string };

/** Inside an OptionSheet: the plant's tier, how it grows and what harvesting gives (the backend's numbers), today's care,
 * then what this person may do with it. */
export function PlotDetail({ plot, actions, note, onAction }: { plot: PlantedPlot; actions: PlotAction[]; note?: string; onAction: (id: string) => void }) {
  const ready = isReady(plot);
  const progress = ready ? 1 : Math.max(0, Math.min(1, plot.progress ?? plot.stage / Math.max(1, (plot.stage_count ?? 3) - 1)));
  return (
    <View>
      <View style={s.detail}>
        <View style={s.detailArt}><Image source={plantArt(plot)} resizeMode="contain" fadeDuration={0} accessibilityIgnoresInvertColors style={s.detailImage} /></View>
        <View style={s.flex}>
          <View style={s.detailHead}>
            <Text style={s.detailStage} numberOfLines={1}>{plot.stage_label}</Text>
            {plot.tier_label ? <TierPill tier={plot.tier} label={plot.tier_label} small /> : null}
          </View>
          <View style={s.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
            <View style={[s.barFill, { width: `${progress * 100}%` }, ready && s.barReady]} />
          </View>
          <Text style={[s.detailSub, ready && s.detailReady]}>{readyText(plot)}</Text>
          {plot.harvest ? <Text style={s.reward} testID="garden-plot-reward">Thu hoạch: +{plot.harvest.exp} EXP · +{plot.harvest.coins} xu</Text> : null}
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
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, paddingHorizontal: 2, paddingVertical: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: '#1F5A26', fontSize: 11, fontWeight: '700' },
  statWarn: { color: '#A15C00' },
  tools: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  tool: { flex: 1, minWidth: 0, maxWidth: 104, height: TOOL_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4,
    borderRadius: TOOL_HEIGHT / 2, backgroundColor: '#FFFFFF', shadowColor: '#23452A', shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toolOff: { backgroundColor: '#F2F6DF', opacity: 0.86, shadowOpacity: 0.06, elevation: 0 },
  toolIcon: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  toolText: { flexShrink: 1, color: t.ink, fontSize: 12, fontWeight: '700' },
  toolTextOn: { color: '#FFFFFF' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  detailArt: { width: 72, height: 84, borderRadius: 16, backgroundColor: '#E6F4E4', padding: 4 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#E3EEE0', overflow: 'hidden', marginVertical: 4 },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: '#5DAE55' },
  barReady: { backgroundColor: '#E2A72E' },
  detailReady: { color: '#8A5A00', fontWeight: '800' },
  reward: { color: '#5A4A12', fontSize: 11.5, fontWeight: '700', marginBottom: 2 },
  detailImage: { width: '100%', height: '100%' },
  detailStage: { flexShrink: 1, color: t.ink, fontSize: 14, fontWeight: '800' },
  detailSub: { color: t.muted, fontSize: 11.5, fontWeight: '600', marginBottom: 3 },
  careLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  careText: { flexShrink: 1, color: t.muted, fontSize: 11.5, fontWeight: '600' },
  note: { color: '#A15C00', fontSize: 11.5, fontWeight: '700', marginVertical: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: t.tint },
  actionText: { flex: 1, color: t.ink, fontSize: 14, fontWeight: '700' },
  actionNote: { color: t.muted, fontSize: 11, fontWeight: '600' },
});
