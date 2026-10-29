import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, ActivityIndicator, Animated, Easing, NativeScrollEvent, NativeSyntheticEvent, PanResponder, Pressable, ScrollView,
  StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SvgXml } from 'react-native-svg';
import { useViewportSize } from '../../components/MobileViewport';
import { Text } from '../../components/Typography';
import { RARITY } from '../../inventory/rarity';
import { ItemArt, itemArt, itemThumb, keyOf, surfaceThumb, variantOf } from '../../room/art';
import { freeCopies, placedHere } from '../../room/found';
import type { Catalog, CatalogItem, FoundStack, Layout } from '../../room/types';
import { appTheme as t } from '../../theme';

type Props = {
  catalog: Catalog; draft: Layout; saved: Layout; selected: string | null; bottomInset: number;
  onSurface: (kind: 'wall' | 'floor', id: string) => void;
  /** An item card: adds the item to the room (from the storage) or selects it when it is already there. */
  onItem: (id: string) => void;
  /** A found decoration's card ("Đồ khám phá"): adds one more of its free copies, or selects a placed one. */
  onCopy?: (stack: FoundStack) => void;
  onVariant: (variant: string) => void;
  onFlip: () => void;
  onRotate: () => void;
  onStore: () => void;
  onNudge: (dx: number, dy: number) => void;
  onDeselect: () => void;
  /** The tab it opens on ("surface" for the walls and floors); the first group otherwise. */
  initialGroup?: string;
};

const NUDGE = 8;
const MOVES = [
  { name: 'moveLeft', label: 'Dời sang trái', dx: -NUDGE, dy: 0 }, { name: 'moveRight', label: 'Dời sang phải', dx: NUDGE, dy: 0 },
  { name: 'moveUp', label: 'Dời lên', dx: 0, dy: -NUDGE }, { name: 'moveDown', label: 'Dời xuống', dx: 0, dy: NUDGE },
];

/** Where each kind of item goes, shown on its card and with its tools. */
export const MOUNT_LABEL: Record<ItemArt['mount'], string> = { wall: 'Treo tường', floor: 'Đặt trên sàn', rug: 'Trải sàn', top: 'Trên bàn, kệ' };
const MOUNT_ICON: Record<ItemArt['mount'], React.ComponentProps<typeof Ionicons>['name']> = {
  wall: 'image-outline', floor: 'cube-outline', rug: 'ellipse-outline', top: 'layers-outline' };

/** The decorating panel's height for a screen `height` points tall, folded: about a quarter of the screen, so the room
 * stays in view while decorating. It is fixed for the screen, whatever the tab or the selection, and the room's camera
 * is set for it (unfolding draws the panel over the room, it never moves the room). */
export const decoratePanelHeight = (height: number) => Math.round(Math.min(250, Math.max(200, height * 0.28)));
/** Unfolded with its grip: most of the screen, still leaving the decorating header and a band of the room in view. */
export const decoratePanelOpenHeight = (height: number) =>
  Math.max(decoratePanelHeight(height), Math.round(Math.min(height * 0.6, height - 260)));

/** How far a drag on the grip must go (points) to fold or unfold the panel, and how fast a flick must be. */
const SNAP_DRAG = 24;
const SNAP_SPEED = 0.3;

/** "Trang trí": a grip, the selected item's tools (`ItemTools`) docked at its top, then one tab per group with its items
 * in a grid that scrolls. Every change is only a preview until the screen saves. Items not in the room are in the
 * storage ("Trong kho"). The panel keeps one height whatever the tab or the selection, so neither the room above nor
 * the tools ever move, and each tab keeps where its list was scrolled. Dragging the grip up unfolds it over the room
 * and down folds it again; it is anchored at its bottom, so the screen lays it out as an overlay (its folded height is
 * `decoratePanelHeight`). */
export function DecoratePanel(props: Props) {
  const { catalog, draft, saved, selected, bottomInset, onSurface, onItem, initialGroup } = props;
  const [group, setGroup] = useState(catalog.groups.some((g) => g.id === initialGroup) ? initialGroup : catalog.groups[0]?.id);
  const { height } = useViewportSize();
  const placed = useMemo(() => new Map(draft.items.filter((p) => !p.uid).map((p) => [p.item, p])), [draft.items]);
  const items = catalog.items.filter((item) => item.group === group && item.kind === 'item' && itemArt(item.id));
  const found = (catalog.found ?? []).filter((stack) => itemArt(stack.item));
  const folded = decoratePanelHeight(height);
  const unfolded = decoratePanelOpenHeight(height);
  const [open, setOpen] = useState(false);
  const panelHeight = useRef(new Animated.Value(folded)).current;
  const shown = useRef(folded);
  const sizes = useRef({ folded, unfolded });
  sizes.current = { folded, unfolded };
  const snap = (next: boolean) => {
    setOpen(next);
    shown.current = next ? sizes.current.unfolded : sizes.current.folded;
    Animated.timing(panelHeight, { toValue: shown.current, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // The screen turned or the window was resized: the same state at the new sizes.
  useEffect(() => {
    shown.current = open ? unfolded : folded;
    panelHeight.setValue(shown.current);
  }, [folded, unfolded]); // eslint-disable-line react-hooks/exhaustive-deps
  const grip = useMemo(() => {
    let from = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { from = shown.current; },
      onPanResponderMove: (_, g) => {
        const { folded: low, unfolded: high } = sizes.current;
        panelHeight.setValue(Math.min(high, Math.max(low, from - g.dy)));
      },
      onPanResponderRelease: (_, g) => {
        const wasOpen = from > sizes.current.folded;
        // A tap toggles; a drag or a flick goes its way; a short drag goes back.
        if (Math.abs(g.dy) < 4) snapRef.current(!wasOpen);
        else if (g.dy < -SNAP_DRAG || g.vy < -SNAP_SPEED) snapRef.current(true);
        else if (g.dy > SNAP_DRAG || g.vy > SNAP_SPEED) snapRef.current(false);
        else snapRef.current(wasOpen);
      },
      onPanResponderTerminate: () => snapRef.current(from > sizes.current.folded),
    });
  }, [panelHeight]);
  const scrolled = useRef(new Map<string, number>());
  const remember = (key: string) => (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current.set(key, e.nativeEvent.contentOffset.y);
  };

  return (
    <Animated.View style={[s.panel, { height: panelHeight }]} testID="decorate-panel">
      <View {...grip.panHandlers} style={s.grip} accessible accessibilityRole="button" testID="decorate-grip"
        accessibilityLabel={open ? 'Thu gọn bảng trang trí' : 'Mở rộng bảng trang trí'} accessibilityState={{ expanded: open }}
        accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => snap(!open)}>
        <View style={s.gripBar} />
      </View>
      <ItemTools {...props} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.groupsBar} contentContainerStyle={s.groups} accessibilityRole="tablist">
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
      <ScrollView key={group} style={s.body} contentContainerStyle={{ paddingBottom: Math.max(bottomInset, 8) }} showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: scrolled.current.get(group ?? '') ?? 0 }} onScroll={remember(group ?? '')} scrollEventThrottle={64}>
        {group === 'surface' ? <>
          {catalog.surfaces.map((surface) => (
          <View key={surface.id} style={s.section}>
            <Text style={s.sectionTitle}>{surface.label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
              {catalog.items.filter((item) => item.kind === surface.id && surfaceThumb(item.id)).map((item) => {
                const on = draft[surface.id] === item.id;
                return (
                  <Card key={item.id} label={item.name} role="radio" selected={on} locked={!item.owned} badge={on ? 'Đang dùng' : undefined}
                    note={lockNote(item) ?? (saved[surface.id] === item.id ? 'Đã lưu' : undefined)} compact onPress={() => onSurface(surface.id, item.id)}>
                    <SvgXml xml={surfaceThumb(item.id)!} width="100%" height="100%" />
                  </Card>
                );
              })}
            </ScrollView>
          </View>
          ))}
        </> : group === 'found' ? (
          <View style={[s.items, s.itemsOnly]}>
            {found.length ? found.map((stack) => {
              const free = freeCopies(stack, saved, draft);
              const here = placedHere(stack, draft);
              const rarity = RARITY[stack.rarity];
              const chosen = !!selected && draft.items.some((p) => p.uid === selected && p.item === stack.item && p.variant === stack.variant);
              return (
                <Card key={`${stack.item}.${stack.variant}`} label={stack.name} role="button" selected={chosen} locked={!free && !here}
                  badge={here ? `Đang đặt ${here}` : undefined} note={free ? `Còn ${free}` : 'Đã đặt hết'} tone={rarity?.color}
                  mount={itemArt(stack.item)!.mount} onPress={() => props.onCopy?.(stack)}>
                  <SvgXml xml={itemThumb(stack.item, stack.variant)!} width="100%" height="100%" />
                </Card>
              );
            }) : <Text style={s.foundEmpty}>Đồ trang trí pet mang về sau mỗi chuyến khám phá sẽ ở đây.</Text>}
          </View>
        ) : (
          <View style={[s.items, s.itemsOnly]}>
            {items.map((item) => {
              const inRoom = placed.get(item.id);
              return (
                <Card key={item.id} label={item.name} role="button" selected={selected === item.id} locked={!item.owned}
                  badge={inRoom ? 'Đang dùng' : undefined} note={lockNote(item) ?? (inRoom ? undefined : 'Trong kho')}
                  mount={itemArt(item.id)!.mount} onPress={() => onItem(item.id)}>
                  <SvgXml xml={itemThumb(item.id, inRoom?.variant)!} width="100%" height="100%" />
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

/** The decorating header of both rooms, one row of 40-point buttons: close ("Hủy") on the left, the title and a short
 * hint, then undo and "Lưu". It sits above the room, never over it. */
export function DecorateHeader({ title, canUndo, saving, canSave = true, onCancel, onUndo, onSave, onInventory, style }: {
  title: string; canUndo: boolean; saving: boolean; canSave?: boolean; onCancel: () => void; onUndo: () => void; onSave: () => void;
  /** "Kho đồ": the inventory over the room being decorated; what is placed from it goes into this room's draft. */
  onInventory?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.header, style]}>
      <Pressable onPress={onCancel} disabled={saving} hitSlop={4} style={({ pressed }) => [s.iconButton, pressed && s.pressed, saving && s.off]}
        accessibilityRole="button" accessibilityLabel="Hủy" accessibilityState={{ disabled: saving }}>
        <Ionicons name="close" size={22} color={t.ink} />
      </Pressable>
      <View style={s.flex}>
        <Text style={s.headerTitle} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        <Text style={s.headerHint} numberOfLines={1}>Chạm chọn · kéo đổi chỗ</Text>
      </View>
      {onInventory ? (
        <Pressable onPress={onInventory} disabled={saving} hitSlop={4} style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
          accessibilityRole="button" accessibilityLabel="Kho đồ">
          <Ionicons name="cube-outline" size={20} color={t.accent} />
        </Pressable>
      ) : null}
      <Pressable onPress={onUndo} disabled={!canUndo || saving} hitSlop={4} style={({ pressed }) => [s.iconButton, pressed && s.pressed, !canUndo && s.off]}
        accessibilityRole="button" accessibilityLabel="Hoàn tác" accessibilityState={{ disabled: !canUndo }}>
        <Ionicons name="arrow-undo" size={20} color={canUndo ? t.accent : t.muted} />
      </Pressable>
      <Pressable onPress={onSave} disabled={saving || !canSave} style={({ pressed }) => [s.save, pressed && s.pressed, !canSave && s.off]}
        accessibilityRole="button" accessibilityLabel="Lưu" accessibilityState={{ disabled: saving || !canSave, busy: saving }}>
        {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
        <Text style={s.saveText}>Lưu</Text>
      </Pressable>
    </View>
  );
}

const lockNote = (item: CatalogItem) => (item.owned ? undefined : item.source === 'walk' ? 'Pet mang về khi đi dạo' : 'Chưa sở hữu');

/** The selected item's tools, at the top of the decorating panel (always the same place, never over the room): its name
 * and colour variants, and flip, tilt and "Cất vào kho" where its artwork allows. Nothing when no item in the room is
 * selected. */
function ItemTools({ catalog, draft, selected, onVariant, onFlip, onRotate, onStore, onNudge, onDeselect }: Pick<Props,
  'catalog' | 'draft' | 'selected' | 'onVariant' | 'onFlip' | 'onRotate' | 'onStore' | 'onNudge' | 'onDeselect'>) {
  const p = selected ? draft.items.find((entry) => keyOf(entry) === selected) : undefined;
  const item = p ? catalog.items.find((entry) => entry.id === p.item) : undefined;
  const art = item && itemArt(item.id);
  if (!item || !art || !p) return null;
  const variant = variantOf(art, p.variant);
  // A found decoration's copy keeps the colour it was found in: another colour is another item of the inventory.
  const recolour = art.variants.length > 1 && !p.uid;
  const onAction = (e: AccessibilityActionEvent) => {
    const move = MOVES.find((m) => m.name === e.nativeEvent.actionName);
    if (move) onNudge(move.dx, move.dy);
  };
  return (
    <View style={s.tools} testID="item-tools">
      <View style={s.toolsHead}>
        <View style={s.flex} accessible accessibilityLabel={`Đang chọn ${item.name}, ${variant.name}. Kéo trong phòng để đổi chỗ.`}
          accessibilityActions={MOVES.map(({ name, label }) => ({ name, label }))} onAccessibilityAction={onAction}>
          <Text style={s.toolsName} numberOfLines={1} selectable={false}>{item.name}</Text>
          <Text style={s.toolsHint} numberOfLines={1} selectable={false}>{`${MOUNT_LABEL[art.mount]} · ${art.variants.length > 1 ? variant.name : 'Kéo trong phòng để đổi chỗ'}`}</Text>
        </View>
        {recolour ? (
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

/** The chosen card's mark, at its top right corner (with its accent border). */
function Tick() {
  return <View style={s.tick}><Ionicons name="checkmark" size={10} color="#FFFFFF" /></View>;
}

function Card({ label, note, badge, selected, locked = false, compact = false, role, mount, tone, onPress, children }: {
  label: string; note?: string; badge?: string; selected: boolean; locked?: boolean; role: 'radio' | 'button'; mount?: ItemArt['mount'];
  /** A wall or a floor: a smaller tile with its name only (a lock on its picture when it is not owned); the badge and the
   * note are still read out. */
  compact?: boolean;
  /** A rarity colour, as a strip along the card's top. */
  tone?: string;
  onPress: () => void; children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={locked} style={({ pressed }) => [s.card, compact && s.cardCompact, badge && s.cardUsed, selected && s.cardOn,
      locked && s.locked, tone ? { borderTopColor: tone, borderTopWidth: 3 } : null, pressed && s.pressed]}
      accessibilityRole={role} accessibilityState={{ selected, disabled: locked }}
      accessibilityLabel={`${label}${mount ? `, ${MOUNT_LABEL[mount].toLowerCase()}` : ''}${badge ? `, ${badge.toLowerCase()}` : ''}${note ? `, ${note}` : ''}`}>
      <View style={[s.thumb, compact && s.thumbCompact]}>{children}
        {mount ? <View style={s.mount}><Ionicons name={MOUNT_ICON[mount]} size={9} color="#FFFFFF" /></View> : null}
        {compact && locked ? <View style={s.mount}><Ionicons name="lock-closed" size={9} color="#FFFFFF" /></View> : null}
      </View>
      {selected ? <Tick /> : null}
      <Text style={s.cardLabel} numberOfLines={2}>{label}</Text>
      {compact ? null : badge ? <Text style={s.used} numberOfLines={1}>{badge}</Text>
        : note ? <View style={s.noteRow}>{locked ? <Ionicons name="lock-closed" size={9} color={t.muted} /> : null}<Text style={s.note} numberOfLines={1}>{note}</Text></View> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { color: t.ink, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  headerHint: { color: t.muted, fontSize: 12, marginTop: 1 },
  iconButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EEF4F8', alignItems: 'center', justifyContent: 'center' },
  save: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 16, borderRadius: 20, backgroundColor: t.accent },
  saveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  off: { opacity: 0.45 },
  panel: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    shadowColor: t.shadow, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  // 20 points tall to grab, the bar itself small.
  grip: { height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  gripBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#C3D4E0' },
  tools: { flexShrink: 0, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 14, backgroundColor: '#E4F0F8', gap: 6,
    borderWidth: 1, borderColor: '#C6DDEC' },
  toolsHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolsName: { color: t.ink, fontSize: 13, fontWeight: '900' },
  toolsHint: { color: t.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  swatches: { flexDirection: 'row', gap: 2 },
  swatchRing: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchRingOn: { borderColor: t.accent },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  toolsRow: { gap: 6 },
  tool: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: t.accent },
  toolOn: { backgroundColor: t.accent },
  toolText: { color: t.accent, fontSize: 12, fontWeight: '800' },
  toolTextOn: { color: '#FFFFFF' },
  // Never shrunk by the item list below it (a tall list would otherwise clip the tabs on the web).
  groupsBar: { flexGrow: 0, flexShrink: 0 },
  groups: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  group: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BBD6E8' },
  groupOn: { backgroundColor: t.accent, borderColor: t.accent },
  groupText: { color: t.muted, fontSize: 12, fontWeight: '700' },
  groupTextOn: { color: '#FFFFFF', fontWeight: '900' },
  body: { flex: 1 },
  section: { marginBottom: 6 },
  sectionTitle: { color: t.ink, fontSize: 12, lineHeight: 16, fontWeight: '800', marginLeft: 12, marginBottom: 6 },
  // A grid that wraps: the panel's list scrolls up and down, however many items there are.
  items: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12 },
  // A wall's or a floor's row: one line, scrolled sideways.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12 },
  itemsOnly: { paddingTop: 2 },
  card: { width: 76, borderRadius: 12, padding: 4, backgroundColor: '#EEF3F7', borderWidth: 2, borderColor: '#DCE6EE' },
  cardCompact: { width: 64 },
  cardUsed: { backgroundColor: '#DDEFFA', borderColor: '#B7D7EC' },
  cardOn: { borderColor: t.accent },
  locked: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.97 }] },
  thumb: { height: 48, borderRadius: 8, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbCompact: { height: 36 },
  mount: { position: 'absolute', left: 3, bottom: 3, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(23,59,82,0.72)' },
  tick: { position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent, borderWidth: 1.5, borderColor: '#FFFFFF' },
  cardLabel: { color: t.ink, fontSize: 11, lineHeight: 13, fontWeight: '800', marginTop: 3, minHeight: 26 },
  used: { color: t.accent, fontSize: 10, lineHeight: 13, fontWeight: '800', marginTop: 1 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  note: { flexShrink: 1, color: t.muted, fontSize: 10, lineHeight: 13, fontWeight: '700' },
  foundEmpty: { color: t.muted, fontSize: 12, lineHeight: 17, fontWeight: '700', paddingVertical: 12, maxWidth: 300 },
});
