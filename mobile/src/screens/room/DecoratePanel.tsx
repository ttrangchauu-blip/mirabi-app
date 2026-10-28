import React, { useMemo, useState } from 'react';
import { AccessibilityActionEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { useViewportSize } from '../../components/MobileViewport';
import { Text } from '../../components/Typography';
import { itemArt, itemThumb, surfaceThumb, variantOf } from '../../room/art';
import type { Catalog, CatalogItem, Layout } from '../../room/types';
import { appTheme as t } from '../../theme';

type Props = {
  catalog: Catalog; draft: Layout; saved: Layout; selected: string | null; bottomInset: number;
  onSurface: (kind: 'wall' | 'floor', id: string) => void;
  /** An item card: adds the item to the room (from the storage) or selects it when it is already there. */
  onItem: (id: string) => void;
  onVariant: (variant: string) => void;
  onFlip: () => void;
  onRotate: () => void;
  onStore: () => void;
  onNudge: (dx: number, dy: number) => void;
  onDeselect: () => void;
};

const NUDGE = 8;
const MOVES = [
  { name: 'moveLeft', label: 'Dời sang trái', dx: -NUDGE, dy: 0 }, { name: 'moveRight', label: 'Dời sang phải', dx: NUDGE, dy: 0 },
  { name: 'moveUp', label: 'Dời lên', dx: 0, dy: -NUDGE }, { name: 'moveDown', label: 'Dời xuống', dx: 0, dy: NUDGE },
];

/** "Trang trí": the selected item's tools, then one tab per group with its items. Every change is only a preview until
 * the screen saves. Items not in the room are in the storage ("Trong kho"). */
export function DecoratePanel(props: Props) {
  const { catalog, draft, saved, selected, bottomInset, onSurface, onItem } = props;
  const [group, setGroup] = useState(catalog.groups[0]?.id);
  // At most ~42% of the screen (a little more with an item's tools), so the room above stays large enough to judge.
  const { height } = useViewportSize();
  const placed = useMemo(() => new Map(draft.items.map((p) => [p.item, p])), [draft.items]);
  const items = catalog.items.filter((item) => item.group === group && item.kind === 'item' && itemArt(item.id));
  const selectedItem = selected ? catalog.items.find((item) => item.id === selected) : undefined;
  const maxHeight = selectedItem ? Math.min(400, Math.max(270, height * 0.45)) : Math.min(330, Math.max(240, height * 0.42));

  return (
    <View style={[s.panel, { maxHeight }]} testID="decorate-panel">
      {selectedItem ? <ItemTools {...props} item={selectedItem} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.groups} accessibilityRole="tablist">
        {catalog.groups.map((g) => {
          const on = g.id === group;
          return (
            <Pressable key={g.id} onPress={() => setGroup(g.id)} style={[s.group, on && s.groupOn]} accessibilityRole="tab"
              accessibilityState={{ selected: on }} accessibilityLabel={g.label}>
              <Text style={[s.groupText, on && s.groupTextOn]}>{g.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: Math.max(bottomInset, 12) }} showsVerticalScrollIndicator={false}>
        {group === 'surface' ? catalog.surfaces.map((surface) => (
          <View key={surface.id} style={s.section}>
            <Text style={s.sectionTitle}>{surface.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.items}>
              {catalog.items.filter((item) => item.kind === surface.id && surfaceThumb(item.id)).map((item) => {
                const on = draft[surface.id] === item.id;
                return (
                  <Card key={item.id} label={item.name} role="radio" selected={on} locked={!item.owned} badge={on ? 'Đang dùng' : undefined}
                    note={lockNote(item) ?? (saved[surface.id] === item.id ? 'Đã lưu' : undefined)} onPress={() => onSurface(surface.id, item.id)}>
                    <SvgXml xml={surfaceThumb(item.id)!} width="100%" height="100%" />
                  </Card>
                );
              })}
            </ScrollView>
          </View>
        )) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.items, s.itemsOnly]}>
            {items.map((item) => {
              const inRoom = placed.get(item.id);
              return (
                <Card key={item.id} label={item.name} role="button" selected={selected === item.id} locked={!item.owned}
                  badge={inRoom ? 'Đang dùng' : undefined} note={lockNote(item) ?? (inRoom ? undefined : 'Trong kho')}
                  onPress={() => onItem(item.id)}>
                  <SvgXml xml={itemThumb(item.id, inRoom?.variant)!} width="100%" height="100%" />
                </Card>
              );
            })}
          </ScrollView>
        )}
      </ScrollView>
    </View>
  );
}

const lockNote = (item: CatalogItem) => (item.owned ? undefined : item.source === 'walk' ? 'Pet mang về khi đi dạo' : 'Chưa sở hữu');

/** The selected item: its name and colour variants, and flip, tilt and "Cất vào kho" where its artwork allows. */
function ItemTools({ item, draft, onVariant, onFlip, onRotate, onStore, onNudge, onDeselect }: Props & { item: CatalogItem }) {
  const art = itemArt(item.id)!;
  const p = draft.items.find((entry) => entry.item === item.id);
  if (!p) return null;
  const variant = variantOf(art, p.variant);
  const onAction = (e: AccessibilityActionEvent) => {
    const move = MOVES.find((m) => m.name === e.nativeEvent.actionName);
    if (move) onNudge(move.dx, move.dy);
  };
  return (
    <View style={s.tools} testID="item-tools">
      <View style={s.toolsHead}>
        <View style={s.flex} accessible accessibilityLabel={`Đang chọn ${item.name}, ${variant.name}. Kéo trong phòng để đổi chỗ.`}
          accessibilityActions={MOVES.map(({ name, label }) => ({ name, label }))} onAccessibilityAction={onAction}>
          <Text style={s.toolsName} numberOfLines={1}>{item.name}</Text>
          <Text style={s.toolsHint} numberOfLines={1}>{art.variants.length > 1 ? variant.name : 'Kéo trong phòng để đổi chỗ'}</Text>
        </View>
        {art.variants.length > 1 ? (
          <View style={s.swatches} accessibilityRole="radiogroup">
            {art.variants.map((v) => {
              const on = v.id === variant.id;
              return (
                <Pressable key={v.id} onPress={() => onVariant(v.id)} hitSlop={4} style={[s.swatchRing, on && s.swatchRingOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Màu ${v.name}`}>
                  <View style={[s.swatch, { backgroundColor: v.swatch }]} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Pressable onPress={onDeselect} style={s.close} hitSlop={6} accessibilityRole="button" accessibilityLabel="Bỏ chọn">
          <Ionicons name="close" size={18} color={t.muted} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolsRow}>
        {art.flip ? <Tool icon="swap-horizontal" label="Lật" onPress={onFlip} on={p.flip} /> : null}
        {art.rotate ? <Tool icon="refresh" label={p.rotate ? `Xoay ${p.rotate > 0 ? '+' : ''}${p.rotate}°` : 'Xoay'} onPress={onRotate} on={!!p.rotate} /> : null}
        <Tool icon="archive-outline" label="Cất vào kho" onPress={onStore} />
      </ScrollView>
    </View>
  );
}

function Tool({ icon, label, onPress, on = false }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; on?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tool, on && s.toolOn, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={16} color={on ? '#FFFFFF' : t.accent} />
      <Text style={[s.toolText, on && s.toolTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Card({ label, note, badge, selected, locked = false, role, onPress, children }: {
  label: string; note?: string; badge?: string; selected: boolean; locked?: boolean; role: 'radio' | 'button'; onPress: () => void; children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={locked} style={({ pressed }) => [s.card, badge && s.cardUsed, selected && s.cardOn, locked && s.locked, pressed && s.pressed]}
      accessibilityRole={role} accessibilityState={{ selected, disabled: locked }}
      accessibilityLabel={`${label}${badge ? `, ${badge.toLowerCase()}` : ''}${note ? `, ${note}` : ''}`}>
      <View style={s.thumb}>{children}</View>
      <Text style={s.cardLabel} numberOfLines={2}>{label}</Text>
      {badge ? <View style={s.badge}><Ionicons name="checkmark" size={11} color="#FFFFFF" /><Text style={s.badgeText}>{badge}</Text></View>
        : note ? <View style={s.noteRow}>{locked ? <Ionicons name="lock-closed" size={10} color={t.muted} /> : null}<Text style={s.note} numberOfLines={2}>{note}</Text></View> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  panel: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 12,
    shadowColor: t.shadow, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  tools: { marginHorizontal: 12, marginBottom: 10, padding: 10, borderRadius: 18, backgroundColor: '#F3F8FB', gap: 8 },
  toolsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolsName: { color: t.ink, fontSize: 14, fontWeight: '900' },
  toolsHint: { color: t.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  swatches: { flexDirection: 'row', gap: 4 },
  swatchRing: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchRingOn: { borderColor: t.accent },
  swatch: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  toolsRow: { gap: 8 },
  tool: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: '#FFFFFF' },
  toolOn: { backgroundColor: t.accent },
  toolText: { color: t.accent, fontSize: 12, fontWeight: '800' },
  toolTextOn: { color: '#FFFFFF' },
  groups: { gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  group: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: t.tint },
  groupOn: { backgroundColor: t.accent },
  groupText: { color: t.accent, fontSize: 13, fontWeight: '800' },
  groupTextOn: { color: '#FFFFFF' },
  body: { flexGrow: 0 },
  section: { marginBottom: 6 },
  sectionTitle: { color: t.muted, fontSize: 12, fontWeight: '800', marginLeft: 16, marginBottom: 6 },
  items: { gap: 10, paddingHorizontal: 16, paddingBottom: 6 },
  itemsOnly: { paddingTop: 2 },
  card: { width: 104, borderRadius: 18, padding: 8, backgroundColor: '#F6F9FB', borderWidth: 2, borderColor: 'transparent' },
  cardUsed: { backgroundColor: '#EEF7FC' },
  cardOn: { borderColor: t.accent },
  locked: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.97 }] },
  thumb: { height: 62, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardLabel: { color: t.ink, fontSize: 12, lineHeight: 16, fontWeight: '800', marginTop: 6, minHeight: 32 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: t.accent, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  note: { flexShrink: 1, color: t.muted, fontSize: 10, lineHeight: 13, fontWeight: '700' },
});
