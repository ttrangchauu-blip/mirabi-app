import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import { useViewportSize } from '../../components/MobileViewport';
import { Text } from '../../components/Typography';
import { type PlaceRequest, usePlaceRequest } from '../../inventory/api';
import type { InventoryItem } from '../../inventory/types';
import { focusRoomApi, focusRoomCache } from '../../room/api';
import { defaultLayout, geometry, keyOf, poseFor } from '../../room/art';
import { useDayPeriod } from '../../components/useDayPeriod';
import { freeCopies, stackOf, withStack } from '../../room/found';
import { PROBLEM_TEXT, type Problem } from '../../room/rules';
import type { FocusRoomData, FoundStack, Layout, RoomPet } from '../../room/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { Button } from '../../ui/kit';
import { useAtmosphere } from '../../world/atmosphere';
import { PhotoRoom } from '../../world/PhotoRoom';
import { useWeather } from '../../world/weather';
import { isLamp, RoomAmbience, skyOf, withLiveSky } from '../healing/RoomAmbience';
import { InventoryScreen } from '../inventory/InventoryScreen';
import { DecorateHeader, DecoratePanel, decoratePanelHeight } from '../room/DecoratePanel';
import { RoomScene } from '../room/RoomScene';
import { useRoomEditor } from '../room/useRoomEditor';
import { FOCUS_DRAWING, FOCUS_PHOTO_DRAWING, isPlatedWindow } from './FocusRoomArt';
import { FOCUS_FLOORS, FOCUS_WALLS } from './focusPlates';

type Props = { petId: string; petName: string | null; petLevel: number; resting: boolean; compact: boolean;
  /** No session running: the pet sits with you, it isn't studying. */ idle?: boolean;
  /** Goes up when a session is finished: the pet celebrates once. */ celebrate?: number;
  /** Whose saved focus room to show; without one, the default room. */ userId?: number };

const CANVAS = geometry('focus').canvas;
/** Until the saved room has loaded (the old starting layout, shown as a room nobody has decorated). */
const STARTING_LAYOUT = withStartingLook({ room: { name: '', layout: defaultLayout('focus'), version: 1, updated_at: '' }, catalog: { groups: [], surfaces: [], items: [], max_items: 0 } } as FocusRoomData).room.layout;
const LINES = ['Cùng tập trung nhé!', 'Mình ngồi học cạnh bạn nè.', 'Thêm một chút nữa thôi, cố lên!'];

/**
 * A room nobody has decorated yet (version 1, the old starting colours) opens in the colours the rendered room was made for. It is only
 * how it is shown until the owner saves; a room anyone has saved is never touched.
 */
export function withStartingLook(data: FocusRoomData): FocusRoomData {
  const { layout, version } = data.room;
  if (version > 1 || layout.wall !== 'wall_mint' || layout.floor !== 'floor_wood_light') return data;
  return { ...data, room: { ...data.room, layout: { ...layout, wall: 'wall_lilac', floor: 'floor_wood_honey',
    items: layout.items.map((p) => (p.item === 'rug_oval' && p.variant === 'sage' ? { ...p, variant: 'lilac' } : p)) } } };
}

/**
 * The Focus Space room: the owner's decorated Phòng tập trung (same catalog as the personal room, its own wider canvas
 * and saved layout), with the pet at its desk — studying, or resting on a break. Shows the default room until the saved
 * one loads, and the last saved one offline. "Trang trí" opens the decorating screen.
 */
export const FocusRoom = memo(function FocusRoom({ petId, petName, petLevel, resting, idle = false, celebrate = 0, userId }: Props) {
  const [data, setData] = useState<FocusRoomData | null>(null);
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState(false);
  // A decoration chosen with "Đặt vào phòng" in Kho đồ: decorating opens with one more copy of it.
  const [queued, setQueued] = useState<PlaceRequest | null>(null);
  const [reaction, setReaction] = useState<{ key: number; text: string } | null>(null);
  const [photo, setPhoto] = useState(false);
  const lineIndex = useRef(0);

  // The newest room version this screen has seen (loaded or saved).
  const newest = useRef(0);
  const load = useCallback(async (): Promise<FocusRoomData | null> => {
    if (userId == null) return null;
    try {
      const read = await focusRoomApi.get();
      if (!Array.isArray(read?.room?.layout?.items) || !Array.isArray(read?.catalog?.items)) throw new Error('Unexpected focus room');
      const fresh = withStartingLook(read);
      // A read that started before a save must not bring the older room back (on screen or in the cache).
      if (fresh.room.version < newest.current) return fresh;
      newest.current = fresh.room.version;
      setData(fresh); setOffline(false);
      void focusRoomCache.store(userId, fresh);
      return fresh;
    } catch {
      const cached = await focusRoomCache.load(userId);
      if (cached) setData((current) => current ?? withStartingLook(cached));
      setOffline(true);
      return null;
    }
  }, [userId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const onPlaceRequest = useCallback((request: PlaceRequest) => { setQueued(request); setEditing(true); }, []);
  usePlaceRequest('focus', !!data && !offline && userId != null, onPlaceRequest);
  useEffect(() => {
    if (!reaction) return;
    const id = setTimeout(() => setReaction(null), 2400);
    return () => clearTimeout(id);
  }, [reaction]);

  const layout = data?.room.layout ?? STARTING_LAYOUT;
  // The sky of the hour on windows drawn from the catalog (a picture's window has the live sky already), and the light of the hour over the room.
  const sky = skyOf(useDayPeriod());
  const { reading } = useWeather();
  const { hours, mood } = useAtmosphere(reading);
  const lightHours = Math.round(hours * 4) / 4;
  const shown = useMemo(() => withLiveSky(layout, sky), [layout, sky]);
  // The desk lamp is on while the pet studies; otherwise it comes on by itself at dusk.
  const lamps = useMemo(() => (resting || idle ? undefined : Object.fromEntries(layout.items.filter((p) => isLamp(p.item)).map((p) => [keyOf(p), true]))), [layout, resting, idle]);
  const underlay = useCallback((k: number) => <RoomAmbience layout={shown} ambience={null} sky={sky} k={k} hours={lightHours} mood={mood} lamps={lamps} ownCurtains={isPlatedWindow} />,
    [shown, sky, lightHours, mood, lamps]);
  const pet: RoomPet = { id: petId, name: petName, level: petLevel };
  const name = petName || 'Pet';
  const doing = resting ? 'đang nghỉ ngơi' : idle ? 'đang ngồi cùng bạn' : 'đang học cùng bạn';
  // The status and the "Trang trí" icon sit under the room, so nothing is ever drawn over the room or its furniture.
  return <View testID="focus-room" style={s.wrap}>
    <View style={s.room}>
      <RoomScene kind="focus" layout={shown} drawing={FOCUS_DRAWING} underlay={underlay} pet={pet} pose={poseFor('study', layout)} resting={resting} seatIdle={idle} celebrate={celebrate} away={false}
        description={`Phòng tập trung, ${name} ${doing}`}
        onPetPress={() => setReaction((r) => ({ key: (r?.key ?? 0) + 1, text: LINES[lineIndex.current++ % LINES.length] }))} reaction={reaction} />
    </View>
    <View style={s.footer}>
      <View style={s.caption}><View style={[s.dot, resting && s.dotRest, idle && s.dotIdle]} />
        <Text style={s.captionText} numberOfLines={1}>{`${name} ${resting ? 'đang nghỉ ngơi bên bạn' : doing}`}</Text></View>
      <Pressable onPress={() => setPhoto(true)} hitSlop={6} style={({ pressed }) => [s.photo, pressed && s.pressed]} accessibilityRole="button"
        accessibilityLabel="Toàn màn hình để ngắm phòng và chụp ảnh" testID="focus-photo-open">
        <Ionicons name="scan-outline" size={19} color={t.accent} />
      </Pressable>
      <Pressable onPress={() => setEditing(true)} disabled={!data || offline} hitSlop={6}
        style={({ pressed }) => [s.decorate, (!data || offline) && s.decorateOff, pressed && s.pressed]}
        accessibilityRole="button" accessibilityLabel="Trang trí" accessibilityHint={offline ? 'Cần kết nối mạng để trang trí' : 'Mở kho đồ trang trí phòng tập trung'}
        accessibilityState={{ disabled: !data || offline }}>
        <Ionicons name="color-palette" size={20} color="#FFFFFF" />
      </Pressable>
    </View>
    {photo ? <PhotoRoom onClose={() => setPhoto(false)} top={(FOCUS_WALLS[layout.wall] ?? FOCUS_WALLS.wall_lilac).top} near={(FOCUS_FLOORS[layout.floor] ?? FOCUS_FLOORS.floor_wood_honey).near}
      fileName="mirabi-phong-tap-trung" testPrefix="focus-photo">
      {() => <RoomScene kind="focus" layout={shown} drawing={FOCUS_PHOTO_DRAWING} underlay={underlay} pet={pet} pose={poseFor('study', layout)} resting={resting} seatIdle={idle} away={false}
        description={`Phòng tập trung, ${name} ${doing}`} />}
    </PhotoRoom> : null}
    {data && editing ? <FocusRoomEditor data={data} pet={pet} resting={resting} userId={userId} initialCopy={queued}
      onClose={() => { setEditing(false); setQueued(null); }} reload={load}
      onSaved={(next) => { newest.current = Math.max(newest.current, next.room.version); setData(next); if (userId != null) void focusRoomCache.store(userId, next); setEditing(false); setQueued(null); }} /> : null}
  </View>;
});

/**
 * Decorating the focus room, over the whole screen. Its own messages and "Bỏ thay đổi?" question are drawn inside it
 * (the app's toasts and dialogs would be under a native modal).
 */
function FocusRoomEditor({ data, pet, resting, userId, initialCopy, onClose, onSaved, reload }: {
  data: FocusRoomData; pet: RoomPet; resting: boolean; userId?: number; initialCopy: PlaceRequest | null; onClose: () => void;
  onSaved: (data: FocusRoomData) => void; reload: () => Promise<FocusRoomData | null>;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useViewportSize();
  const editor = useRoomEditor('focus', data.catalog.max_items);
  const [current, setCurrent] = useState(data);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [inventory, setInventory] = useState(false);
  const { start } = editor;
  useEffect(() => { start(data.room.layout); }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  // What the pet or a friend brought since the room was read: the panel lists it. The draft stays on the opened version.
  useEffect(() => {
    void focusRoomApi.get().then((fresh) => setCurrent((c) => ({ ...c, catalog: fresh.catalog }))).catch(() => { /* keep the counts shown */ });
  }, []);
  const copied = useRef(false);
  useEffect(() => {
    if (!editor.draft || !initialCopy || copied.current) return;
    copied.current = true;
    pickCopy(initialCopy);
  }, [editor.draft, initialCopy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 3200);
    return () => clearTimeout(id);
  }, [message]);
  const draft = editor.draft;
  const changed = !!draft && JSON.stringify(draft) !== JSON.stringify(current.room.layout);
  const refused = (problem: Problem | null | undefined) => { if (problem) setMessage(PROBLEM_TEXT[problem]); };
  const nameOf = (item: string) => current.catalog.items.find((entry) => entry.id === item)?.name ?? 'Đồ vật';
  const requestClose = () => { if (changed) setAsking(true); else onClose(); };

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { room, catalog } = await focusRoomApi.save(draft, current.room.version);
      onSaved({ ...current, room, catalog: catalog ?? current.catalog });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'room_version_conflict') {
        const fresh = await reload();
        if (fresh) { setCurrent(fresh); start(fresh.room.layout); }
        setMessage('Phòng vừa được thay đổi ở nơi khác. Mirabi đã mở bản mới nhất, bạn trang trí lại nhé.');
      } else if (e instanceof ApiError && e.code === 'not_enough_items') {
        try { const fresh = await focusRoomApi.get(); setCurrent((c) => ({ ...c, catalog: fresh.catalog })); } catch { /* keep the counts shown */ }
        setMessage('Kho đồ không còn đủ món này. Cất bớt một món rồi lưu lại nhé.');
      } else setMessage('Chưa lưu được phòng. Kiểm tra kết nối rồi thử lại nhé.'); // the draft stays, so "Lưu" tries again
    } finally { setSaving(false); }
  }
  function pick(item: string) {
    const result = editor.add(item);
    if (result === 'full') setMessage('Phòng đã đủ đồ rồi. Cất bớt vào kho để thêm món mới nhé.');
    else if (result === 'unsupported') setMessage('Chưa có chỗ trống trên bàn hoặc kệ. Thêm bàn, kệ hoặc dọn bớt đồ trên đó nhé.');
    else if (result === 'blocks_pet' || result === 'trapped') setMessage('Phòng chưa còn chỗ trống cho món này. Cất bớt đồ rồi thử lại nhé.');
  }
  /** One more copy of a found decoration, if one is free (counting this draft); else the first copy already placed. */
  function pickCopy(want: Pick<FoundStack, 'item' | 'variant' | 'name'>, latest?: FoundStack) {
    const stack = latest ?? current.catalog.found?.find((f) => f.item === want.item && f.variant === want.variant);
    const layout = editor.draft ?? current.room.layout;
    if (!stack || freeCopies(stack, current.room.layout, layout) < 1) {
      const placed = layout.items.find((p) => p.uid && p.item === want.item && p.variant === want.variant);
      if (placed) editor.select(keyOf(placed));
      setMessage(`Đã đặt hết ${want.name}. Cất bớt một món để đặt thêm nhé.`);
      return;
    }
    const result = editor.addCopy(stack.item, stack.variant);
    if (result === 'added') setMessage(`Đã thêm ${stack.name}. Kéo để đổi chỗ rồi bấm Lưu nhé.`);
    else if (result === 'full') setMessage('Phòng đã đủ đồ rồi. Cất bớt vào kho để thêm món mới nhé.');
    else if (result === 'unsupported') setMessage('Chưa có chỗ trống trên bàn hoặc kệ. Thêm bàn, kệ hoặc dọn bớt đồ trên đó nhé.');
    else if (result === 'blocks_pet' || result === 'trapped') setMessage('Phòng chưa còn chỗ trống cho món này. Cất bớt đồ rồi thử lại nhé.');
  }
  const placeFromInventory = (item: InventoryItem) => {
    setInventory(false);
    if (!item.art) return;
    // Kho đồ has just read this; the room's catalog may be from before it arrived.
    const stack = stackOf({ ...item, art: item.art });
    setCurrent((c) => ({ ...c, catalog: withStack(c.catalog, stack) }));
    pickCopy(stack, stack);
  };
  function store() {
    const result = editor.store();
    if (!result) return;
    if ('problem' in result) refused(result.problem);
    else setMessage(`Đã cất ${result.stored.map(nameOf).join(', ')} vào kho.`);
  }
  const tools = draft ? {
    catalog: current.catalog, draft, selected: editor.selected, onVariant: (variant: string) => refused(editor.variant(variant)),
    onFlip: () => refused(editor.flip()), onRotate: () => refused(editor.rotate()), onStore: store,
    onNudge: (dx: number, dy: number) => { const p = draft.items.find((entry) => keyOf(entry) === editor.selected); if (p) refused(editor.move(keyOf(p), p.x + dx, p.y + dy)); },
    onDeselect: () => editor.select(null),
  } : null;

  return (
    <AppModal visible animationType="slide" onRequestClose={requestClose}>
      <View style={[s.editor, { paddingTop: insets.top + 10 }]} testID="focus-room-editor">
        <DecorateHeader title="Trang trí phòng tập trung" canUndo={editor.canUndo} saving={saving} canSave={!!draft} onCancel={requestClose}
          onUndo={editor.undo} onSave={() => { void save(); }} onInventory={userId != null ? () => setInventory(true) : undefined} style={s.header} />
        {/* The panel keeps one height with the selected item's tools docked in it: selecting, dragging or storing never
            moves the room or the tools. The room keeps the space of the folded panel; unfolded, the panel goes over it. */}
        <View style={[s.sceneWrap, { marginBottom: decoratePanelHeight(screenHeight) }]}>
          {draft ? <RoomScene kind="focus" layout={draft} drawing={FOCUS_DRAWING} pet={pet} pose={poseFor('study', draft)} resting={resting} away={false}
            description="Phòng tập trung đang trang trí"
            editor={{ selected: editor.selected, onSelect: editor.select, place: editor.place, preview: editor.preview,
              onMove: (item, x, y) => { const problem = editor.move(item, x, y); if (problem) setMessage(`${PROBLEM_TEXT[problem]}. Đã đưa về chỗ cũ.`); } }} />
            : <ActivityIndicator color={t.accent} />}
        </View>
        {tools ? <View style={s.panelDock}>
          <DecoratePanel {...tools} saved={current.room.layout} bottomInset={insets.bottom} onSurface={editor.surface} onItem={pick} onCopy={pickCopy} />
        </View> : null}
        {message ? <View style={[s.message, { top: insets.top + 64 }]} accessibilityLiveRegion="polite" pointerEvents="none">
          <Ionicons name="information-circle" size={16} color="#FFFFFF" /><Text style={s.messageText}>{message}</Text>
        </View> : null}
        {inventory && userId != null ? <View style={s.inventory}>
          <InventoryScreen userId={userId} onBack={() => setInventory(false)} placeInto={{ room: 'focus', onPlace: placeFromInventory }} />
        </View> : null}
        {asking ? <View style={s.askBackdrop} accessibilityViewIsModal>
          <View style={s.ask}>
            <Text style={s.askTitle} accessibilityRole="header">Bỏ các thay đổi?</Text>
            <Text style={s.askText}>Phòng sẽ trở lại như lần lưu gần nhất.</Text>
            <View style={s.askActions}>
              <Button title="Trang trí tiếp" variant="secondary" onPress={() => setAsking(false)} style={s.flex} />
              <Button title="Bỏ thay đổi" onPress={() => { setAsking(false); onClose(); }} style={s.flex} />
            </View>
          </View>
        </View> : null}
      </View>
    </AppModal>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', minWidth: 0, gap: 8 },
  room: { width: '100%', aspectRatio: CANVAS.width / CANVAS.height, position: 'relative', minWidth: 0, borderRadius: 24, overflow: 'hidden', backgroundColor: '#D9D2EE' },
  photo: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF4FB', borderWidth: 1, borderColor: '#D6E8F4' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  decorate: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent,
    shadowColor: '#0A2438', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  decorateOff: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.97 }] },
  caption: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 6, width: 6, borderRadius: 3, backgroundColor: '#2E8C6A' }, dotRest: { backgroundColor: '#7C83B5' }, dotIdle: { backgroundColor: '#E0B36A' },
  captionText: { color: '#2E4A55', fontSize: 11, fontWeight: '800' },
  editor: { flex: 1, backgroundColor: '#EAF3F8' },
  flex: { flex: 1, minWidth: 0 },
  header: { paddingHorizontal: 16, marginBottom: 10 },
  sceneWrap: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingBottom: 10, alignItems: 'center', justifyContent: 'center' },
  panelDock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  message: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#173B52',
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  messageText: { flex: 1, color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  askBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: 'rgba(10,36,56,0.45)' },
  ask: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 26, padding: 22, gap: 10 },
  askTitle: { color: t.ink, fontSize: 19, fontWeight: '900' },
  askText: { color: t.muted, fontSize: 14, lineHeight: 20 },
  askActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  // Kho đồ drawn inside the editor's modal (the app's other screens would be under it).
  inventory: { ...StyleSheet.absoluteFillObject, backgroundColor: '#EEF6FB' },
});
