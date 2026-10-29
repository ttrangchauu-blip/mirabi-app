import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, LayoutChangeEvent, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { useViewportSize } from '../../components/MobileViewport';
import { PET_STAGE_NAMES, PET_THRESHOLDS } from '../../components/PetEvolutionProgress';
import { Text } from '../../components/Typography';
import { type PlaceRequest, usePlaceRequest } from '../../inventory/api';
import type { InventoryItem } from '../../inventory/types';
import { roomApi, roomCache } from '../../room/api';
import { keyOf, poseFor } from '../../room/art';
import { freeCopies } from '../../room/found';
import { clockLabel } from '../../room/format';
import { PET_ACTIONS, PLAY_MS, type PetAction, useRoomPrefs, useRoomSounds } from '../../room/prefs';
import { PROBLEM_TEXT, type Problem } from '../../room/rules';
import type { FoundStack, Layout, OwnRoom, Pose } from '../../room/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, ProgressBar, SoftInput } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import type { FocusTimer } from '../main/MainApp';
import { showError } from '../main/shared';
import { InventoryScreen } from '../inventory/InventoryScreen';
import { OptionRow, OptionSheet, PetAvatar, ToggleRow } from '../together/ui';
import { DecorateHeader, DecoratePanel, decoratePanelHeight } from './DecoratePanel';
import { PhotoSheet } from './PhotoSheet';
import { RoomScene } from './RoomScene';
import { TAB_BAR_RADIUS } from '../main/TabBar';
import { useRoomEditor } from './useRoomEditor';

type Props = {
  user: User;
  timer: FocusTimer;
  /** The menu bar stays while decorating: before it leaves this tab, the app calls the guard set here (unsaved
   * changes are confirmed first); false keeps the user here. Null when nothing needs asking. */
  leaveGuard?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onOpenAlbum: () => void;
  /** Opens Community → Bạn bè, where friends' rooms are visited. */
  onOpenFriends?: () => void;
  /** The egg is hatching on the Home screen (its animation or congratulations): no interactions with it here. */
  hatching?: boolean;
  /** "Kho đồ" and "Vườn nhà" in the room's settings. */
  onOpenInventory?: () => void;
  onOpenGarden?: () => void;
};

const LINES: Record<Pose, string[]> = {
  rug: ['Chào bạn! Hôm nay mình vui lắm.', 'Mình thích góc nhỏ này ghê!', 'Cùng học một chút nhé?', 'Bạn trang trí phòng xinh quá!'],
  study: ['Suỵt, mình đang tập trung đó!', 'Học cùng bạn vui hơn hẳn!', 'Thêm một chút nữa thôi, cố lên!'],
  rest: ['Nghỉ ngơi một chút rồi học tiếp nha.', 'Ấm áp quá… mình nằm thêm tí nhé.'],
};
// What the pet says to each interaction of its menu ("Trò chuyện" uses LINES, by where it is).
const ACTION_LINES: Record<Exclude<PetAction, 'talk'>, string[]> = {
  pet: ['Hi hi, nhột quá đi!', 'Thích quá, vuốt thêm chút nữa nha!', 'Ấm áp ghê, cảm ơn bạn!'],
  feed: ['Măm măm… ngon quá!', 'Cảm ơn bạn, mình no căng rồi!', 'Món này ngon tuyệt!'],
  play: ['Bắt được rồi nè!', 'Chơi nữa đi, vui quá!', 'Mình chạy nhanh không nào?'],
};

/** Where the owner's pet is: the focus timer on this device first (it is the live state), then the backend
 * (a focus session from another device or a group room), else its rug. Never changes any of them. */
function ownerPose(timer: FocusTimer, room: OwnRoom): Pose {
  const sessionOn = timer.running || !!timer.activeCycle;
  const wanted: Pose = sessionOn ? (timer.phase === 'focus' ? 'study' : 'rest') : room.activity === 'studying' ? 'study' : 'rug';
  return poseFor(wanted, room.room.layout);
}

/** Points kept at the top for the floating header panel (8 above it, its 96 and a gap of 6). Fixed, so nothing in the
 * panel (a longer name, the offline notice) ever moves or rescales the room. */
const HEADER_RESERVE = 110;
/** The decorating header's height under the safe area: one row of 40-point buttons. */
const EDIT_HEADER = 56;

/**
 * Phòng cá nhân, a tab of the main menu: the room edge to edge over the whole space above the menu bar (and under its
 * rounded corners), with one compact panel floating over its wall: the room's name and the icons (Bạn bè, Cài đặt,
 * Chụp ảnh), the pet's level and EXP, and what it is doing. Its camera depends only on the screen and a fixed reserve
 * (`HEADER_RESERVE`), so nothing in the panel ever moves it. Decorating keeps the menu bar and puts the room between its own header and the decorating panel, never
 * under them (every item, up to the top of the wall, can be reached and dragged); both have fixed heights, so nothing
 * selected, moved or stored ever moves the room.
 */
export function RoomTab({ user, timer, leaveGuard, onOpenAlbum, onOpenFriends, hatching = false, onOpenInventory, onOpenGarden }: Props) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useViewportSize();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<OwnRoom | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const editor = useRoomEditor('personal', data?.catalog.max_items ?? 32);
  const { draft, selected } = editor;
  const [saving, setSaving] = useState(false);
  const [reaction, setReaction] = useState<{ key: number; text: string } | null>(null);
  const lineIndex = useRef<Record<PetAction, number>>({ pet: 0, feed: 0, play: 0, talk: 0 });
  const [photo, setPhoto] = useState(false);
  const [settings, setSettings] = useState(false);
  const [petMenu, setPetMenu] = useState(false);
  // The decorating tab "Cài đặt" opened it on: the items, or "Tường và sàn" for colours and themes.
  const [decorateGroup, setDecorateGroup] = useState<string | undefined>(undefined);
  const [rename, setRename] = useState<string | null>(null);
  // Kho đồ over the room being decorated, and a decoration chosen in Kho đồ waiting to be placed here.
  const [inventory, setInventory] = useState(false);
  const [queued, setQueued] = useState<PlaceRequest | null>(null);
  // Until when the pet's last interaction plays: taps meanwhile neither open its menu nor start it again.
  const playing = useRef(0);
  // Where the floating header ends: the room's content starts under it, and the pet's menu and lines stay below it.
  const [headerBottom, setHeaderBottom] = useState(insets.top + 104);
  const onHeaderLayout = (e: LayoutChangeEvent) => {
    const bottom = Math.round(e.nativeEvent.layout.y + e.nativeEvent.layout.height);
    setHeaderBottom((b) => (b === bottom ? b : bottom));
  };
  const prefs = useRoomPrefs(user.id);
  const playSound = useRoomSounds(prefs.sound);

  // The newest room version this screen has seen (loaded or saved).
  const newest = useRef(0);
  const load = useCallback(async () => {
    try {
      const fresh = await roomApi.get();
      // A read that started before a save must not bring the older room back (on screen or in the cache).
      if (fresh.room.version < newest.current) return;
      newest.current = fresh.room.version;
      setData(fresh); setOffline(false); setLoadError(null);
      void roomCache.store(user.id, fresh);
    } catch (e) {
      const cached = await roomCache.load(user.id);
      if (cached) { setData((current) => current ?? cached); setOffline(true); } else setLoadError(e);
    }
  }, [user.id]);
  useEffect(() => { void load(); }, [load]);
  usePlaceRequest('personal', !!data && !offline, setQueued);
  // When the walk is due to end, read the state again (reading never settles the walk).
  useEffect(() => {
    if (!data?.walk.away || !data.walk.return_at) return;
    const wait = Date.parse(data.walk.return_at) - Date.now() + 1500;
    const id = setTimeout(() => { void load(); }, Math.max(1000, Math.min(wait, 2 ** 31 - 1)));
    return () => clearTimeout(id);
  }, [data?.walk.away, data?.walk.return_at, load]);

  const decorating = draft !== null;
  const cancel = editor.stop;
  const changed = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.room.layout);
  /** Leaves decorating, after asking when there are unsaved changes; false when the user keeps decorating. */
  const requestCancel = useCallback(async () => {
    if (changed && !(await confirm({ title: 'Bỏ các thay đổi?', message: 'Phòng sẽ trở lại như lần lưu gần nhất.', confirmLabel: 'Bỏ thay đổi',
      cancelLabel: 'Trang trí tiếp', icon: 'arrow-undo-outline' }))) return false;
    cancel();
    return true;
  }, [changed, confirm, cancel]);
  useEffect(() => {
    if (!leaveGuard) return;
    leaveGuard.current = decorating ? requestCancel : null;
    return () => { leaveGuard.current = null; };
  }, [leaveGuard, decorating, requestCancel]);
  useEffect(() => {
    if (!decorating) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { void requestCancel(); return true; });
    return () => sub.remove();
  }, [decorating, requestCancel]);

  useEffect(() => {
    if (!reaction) return;
    const id = setTimeout(() => setReaction(null), 2600);
    return () => clearTimeout(id);
  }, [reaction]);
  // The pet's menu never stays open over decorating, a walk that just began or a hatch.
  useEffect(() => { if (decorating || data?.walk.away || hatching) setPetMenu(false); }, [decorating, data?.walk.away, hatching]);
  const shown = useMemo(() => (data ? { ...data, room: { ...data.room, layout: draft ?? data.room.layout } } : null), [data, draft]);
  // "Đặt vào phòng" from Kho đồ: decorating opens on "Đồ khám phá" with one more copy of it.
  useEffect(() => {
    if (!queued || !data) return;
    if (!draft) { openDecorating('found'); return; }
    setQueued(null);
    pickCopy({ item: queued.item, variant: queued.variant, name: queued.name });
  }, [queued, data, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !shown) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        {loadError ? <>
          <Ionicons name="cloud-offline-outline" size={40} color={t.muted} />
          <Text style={s.centerText}>Chưa mở được phòng. Kiểm tra kết nối rồi thử lại nhé.</Text>
          <Button title="Thử lại" icon="refresh" onPress={() => { setLoadError(null); void load(); }} />
        </> : <ActivityIndicator color={t.accent} size="large" accessibilityLabel="Đang mở phòng" />}
      </View>
    );
  }

  const petName = user.pet_name || data.pet.name || 'Pet';
  const level = user.level ?? data.pet.level;
  const xp = user.xp ?? data.pet.xp;
  const stage = Math.max(0, Math.min(6, level));
  const next = stage < 6 ? PET_THRESHOLDS[stage + 1] : null;
  const away = data.walk.away;
  const pose = ownerPose(timer, shown);
  // The panel's last line, always there (the panel keeps one height): short, without the pet's name it sits under.
  const notice = away && data.walk.return_at ? { icon: 'walk-outline' as const, text: `Đang khám phá · Về lúc ${clockLabel(data.walk.return_at)}` }
    : pose === 'study' ? { icon: 'book-outline' as const, text: 'Đang học cùng bạn' }
    : pose === 'rest' ? { icon: 'cafe-outline' as const, text: 'Đang nghỉ giải lao' }
    : stage === 0 ? { icon: 'egg-outline' as const, text: 'Trứng đang được ủ ấm' }
    : { icon: 'home-outline' as const, text: 'Đang thư giãn trong phòng' };

  const say = (text: string, action?: PetAction) => setReaction((r) => ({ key: (r?.key ?? 0) + 1, text, action }));
  /** A tap on the pet: its menu, or, while it can't play (out walking, an egg, hatching), what it is doing. */
  function tapPet() {
    if (away) { toast(`${petName} đang đi dạo, về lúc ${clockLabel(data!.walk.return_at!)} nhé.`, 'info'); return; }
    if (hatching) { say('Trứng sắp nở rồi! Về Trang chủ xem nhé.'); return; }
    if (stage === 0) {
      const need = Math.max(0, PET_THRESHOLDS[1] - xp);
      say(need > 0 ? `Trứng đang được ủ ấm · còn ${need} EXP nữa là nở` : 'Trứng sắp nở rồi! Về Trang chủ xem nhé.');
      return;
    }
    if (Date.now() < playing.current) return; // its last animation is still playing
    setPetMenu((open) => !open);
  }
  /** One of the menu's interactions: the menu closes, the pet answers with its animation and sound. Only play. */
  function act(action: PetAction) {
    setPetMenu(false);
    if (Date.now() < playing.current) return;
    playing.current = Date.now() + PLAY_MS;
    const lines = action === 'talk' ? LINES[pose] : ACTION_LINES[action];
    say(lines[lineIndex.current[action]++ % lines.length], action);
    playSound(action);
  }
  function openDecorating(group?: string) {
    setSettings(false); setPetMenu(false);
    setDecorateGroup(group);
    editor.start(data!.room.layout);
  }

  async function save(name: string, layout: Layout) {
    setSaving(true);
    try {
      const { room, catalog } = await roomApi.save(name, layout, data!.room.version);
      newest.current = Math.max(newest.current, room.version);
      const next = { ...data!, room, catalog: catalog ?? data!.catalog };
      setData(next); setOffline(false); editor.stop(); setRename(null);
      void roomCache.store(user.id, next);
      toast('Đã lưu phòng!', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'room_version_conflict') {
        editor.stop(); setRename(null);
        await load();
        await confirm({ title: 'Phòng vừa được cập nhật', message: 'Phòng đã được thay đổi ở nơi khác. Mirabi đã mở bản mới nhất, bạn trang trí lại nhé.',
          confirmLabel: 'Đã hiểu', cancelLabel: null, icon: 'sync-outline' });
      } else if (e instanceof ApiError && e.code === 'not_enough_items') {
        // Another room took a copy meanwhile: the latest counts, and the draft stays to fix.
        try { const fresh = await roomApi.get(); setData((d) => (d ? { ...d, catalog: fresh.catalog } : d)); } catch { /* keep the counts shown */ }
        toast('Kho đồ không còn đủ món này. Cất bớt một món rồi lưu lại nhé.', 'info');
      } else showError('Chưa lưu được phòng', e); // the draft stays, so "Lưu" tries again
    } finally { setSaving(false); }
  }
  // Decorating edits a copy of the saved room (useRoomEditor); a change that doesn't fit is not applied, and says why.
  const nameOf = (item: string) => data.catalog.items.find((entry) => entry.id === item)?.name ?? 'Đồ vật';
  const refused = (problem: Problem | null | undefined) => { if (problem) toast(PROBLEM_TEXT[problem], 'info'); };
  function pickItem(item: string) {
    const result = editor.add(item);
    if (result === 'full') toast('Phòng đã đủ đồ rồi. Cất bớt vào kho để thêm món mới nhé.', 'info');
    else if (result === 'unsupported') toast('Chưa có chỗ trống trên bàn hoặc kệ. Thêm bàn, kệ hoặc dọn bớt đồ trên đó nhé.', 'info');
    else if (result === 'blocks_pet' || result === 'trapped') toast('Phòng chưa còn chỗ trống cho món này. Cất bớt đồ rồi thử lại nhé.', 'info');
  }
  /** One more copy of a found decoration, if one is free (counting this draft); else the first copy already placed. */
  function pickCopy(want: Pick<FoundStack, 'item' | 'variant' | 'name'>) {
    const stack = data!.catalog.found?.find((f) => f.item === want.item && f.variant === want.variant);
    const layout = editor.draft ?? data!.room.layout;
    if (!stack || freeCopies(stack, data!.room.layout, layout) < 1) {
      const placed = layout.items.find((p) => p.uid && p.item === want.item && p.variant === want.variant);
      if (placed) editor.select(keyOf(placed));
      toast(`Đã đặt hết ${want.name}. Cất bớt một món để đặt thêm nhé.`, 'info');
      return;
    }
    const result = editor.addCopy(stack.item, stack.variant);
    if (result === 'added') toast(`Đã thêm ${stack.name}. Kéo để đổi chỗ rồi bấm Lưu nhé.`, 'info');
    else if (result === 'full') toast('Phòng đã đủ đồ rồi. Cất bớt vào kho để thêm món mới nhé.', 'info');
    else if (result === 'unsupported') toast('Chưa có chỗ trống trên bàn hoặc kệ. Thêm bàn, kệ hoặc dọn bớt đồ trên đó nhé.', 'info');
    else if (result === 'blocks_pet' || result === 'trapped') toast('Phòng chưa còn chỗ trống cho món này. Cất bớt đồ rồi thử lại nhé.', 'info');
  }
  const placeFromInventory = (item: InventoryItem) => {
    setInventory(false);
    if (item.art) pickCopy({ item: item.art, variant: item.variant, name: item.name });
  };
  function store() {
    const result = editor.store();
    if (!result) return;
    if ('problem' in result) { refused(result.problem); return; }
    toast(`Đã cất ${result.stored.map(nameOf).join(', ')} vào kho.`, 'info');
  }
  const openFriends = () => { setSettings(false); setPetMenu(false); onOpenFriends?.(); };
  const openSettings = () => { setPetMenu(false); setSettings(true); };
  // The photo is drawn by the backend from the room and the pet only, so no button or menu is ever in it.
  const takePhoto = () => {
    setPetMenu(false);
    if (away) { toast(`${petName} đang đi dạo. Chờ ${petName} về rồi chụp ảnh nhé!`, 'info'); return; }
    if (offline) { toast('Cần kết nối mạng để lưu ảnh vào Album.', 'info'); return; }
    setPhoto(true);
  };

  const scene = (
    <RoomScene layout={shown.room.layout} pet={{ id: data.pet.id, name: petName, level }} pose={pose} away={away} fullScreen
      safeTop={insets.top + HEADER_RESERVE} safeBottom={TAB_BAR_RADIUS}
      chrome={decorating ? { top: insets.top + EDIT_HEADER, bottom: decoratePanelHeight(screenHeight) + TAB_BAR_RADIUS } : undefined}
      menuTop={decorating ? undefined : headerBottom + 6}
      onPetPress={decorating ? undefined : tapPet} petLabel={`${petName}, chạm để mở menu tương tác`}
      reaction={decorating ? null : reaction} effects={prefs.effects}
      petMenu={petMenu && !decorating ? { actions: PET_ACTIONS, onAction: (id) => act(id as PetAction), onClose: () => setPetMenu(false) } : null}
      walkable={!decorating}
      description={`${data.room.name}${away ? `, ${petName} đang đi dạo` : `, ${petName} đang ở trong phòng`}`}
      editor={decorating ? { selected, onSelect: editor.select, place: editor.place, preview: editor.preview,
        onMove: (item, x, y) => { const problem = editor.move(item, x, y); if (problem) toast(`${PROBLEM_TEXT[problem]}. Đã đưa về chỗ cũ.`, 'info'); } } : null} />
  );
  const sides = { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 };
  // The selected item's tools (docked in the decorating panel) and the panel share these.
  const tools = decorating ? {
    catalog: data.catalog, draft: draft!, selected, onVariant: editor.variant,
    onFlip: () => refused(editor.flip()), onRotate: () => refused(editor.rotate()), onStore: store,
    onNudge: (dx: number, dy: number) => { const p = draft!.items.find((entry) => keyOf(entry) === selected); if (p) refused(editor.move(keyOf(p), p.x + dx, p.y + dy)); },
    onDeselect: () => editor.select(null),
  } : null;

  return (
    <View style={[s.fill, s.underBar]} testID="personal-room">
      <StatusBar barStyle={shown.room.layout.wall === 'wall_night' ? 'light-content' : 'dark-content'} />
      {/* The room stays at the same place in the tree, the same size and with the same camera whether decorating or not:
          the decorating header and panel are drawn over it, so an item is on the same spot of the screen in both. */}
      <View style={s.fill}>{scene}</View>
      {/* Decorating: close on the left, the title and its hint, then undo and save; a fixed height, over the room. */}
      {tools ? (
        <DecorateHeader title="Trang trí" canUndo={editor.canUndo} saving={saving} onCancel={() => { void requestCancel(); }}
          onUndo={editor.undo} onSave={() => { void save(data.room.name, draft!); }} onInventory={() => setInventory(true)}
          style={[s.editHeader, sides, { paddingTop: insets.top + 8, height: insets.top + EDIT_HEADER }]} />
      ) : null}
      {/* Over the room's wall, never on a band of its own: the room goes on behind it up to the top of the screen. */}
      {tools ? null : (
        <View style={[s.overlay, sides, { paddingTop: insets.top + 8 }]} pointerEvents="box-none" onLayout={onHeaderLayout}>
          {/* One translucent panel: name and icons, the pet's level and EXP, what it is doing. Every row has a fixed height. */}
          <View style={s.panel} testID="room-header">
            <View style={s.topRow}>
              <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{data.room.name}</Text>
              <Pressable onPress={openFriends} hitSlop={6} style={({ pressed }) => [s.icon, pressed && s.pressed]} accessibilityRole="button"
                accessibilityLabel="Ghé phòng bạn bè">
                <Ionicons name="people" size={20} color={t.ink} />
              </Pressable>
              <Pressable onPress={openSettings} hitSlop={6} style={({ pressed }) => [s.icon, pressed && s.pressed]} accessibilityRole="button"
                accessibilityLabel="Cài đặt">
                <Ionicons name="settings" size={20} color={t.ink} />
              </Pressable>
              <Pressable onPress={takePhoto} hitSlop={6} style={({ pressed }) => [s.icon, pressed && s.pressed]} accessibilityRole="button"
                accessibilityLabel="Chụp ảnh">
                <Ionicons name="camera" size={20} color={t.accent} />
              </Pressable>
            </View>
            {/* The stage's name (Sơ Sinh…) is left to the pet's details; screen readers still hear it. */}
            <View style={s.petRow} accessible accessibilityLabel={`${petName}, cấp ${stage} ${PET_STAGE_NAMES[stage]}, ${next ? `${xp} trên ${next}` : xp} EXP`}>
              <PetAvatar user={{ pet: data.pet.id, pet_level: level }} size={24} />
              <Text style={s.petName} numberOfLines={1}>{petName}<Text style={s.petLevel}>{` · Cấp ${stage}`}</Text></Text>
              <View style={s.expBar}><ProgressBar value={next ? Math.min(1, xp / next) : 1} /></View>
              <Text style={s.expText} numberOfLines={1}>{next ? `${xp}/${next}` : `${xp} EXP`}</Text>
            </View>
            <View style={s.status} accessibilityLiveRegion="polite">
              <Ionicons name={notice.icon} size={13} color={t.accent} />
              <Text style={s.statusText} numberOfLines={1}>{notice.text}</Text>
            </View>
          </View>
          {offline ? (
            <Pressable onPress={() => { void load(); }} style={s.offline} accessibilityRole="button" accessibilityLabel="Đang ngoại tuyến, chạm để thử lại">
              <Ionicons name="cloud-offline-outline" size={15} color={t.muted} />
              <Text style={s.offlineText} numberOfLines={1}>Ngoại tuyến · phòng đã lưu. Chạm để thử lại.</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {tools ? (
        <View style={s.panelDock}>
          <DecoratePanel {...tools} saved={data.room.layout} bottomInset={0} onSurface={editor.surface}
            onItem={pickItem} onCopy={pickCopy} initialGroup={decorateGroup} />
        </View>
      ) : null}

      <PhotoSheet visible={photo} pose={pose} onClose={() => setPhoto(false)} onSaved={() => {
        setPhoto(false);
        toast('Đã lưu ảnh vào Album kỷ niệm!', 'success', { label: 'Xem', onPress: onOpenAlbum });
      }} />
      <OptionSheet visible={settings} title="Cài đặt phòng" onClose={() => setSettings(false)}>
        <ScrollView style={s.settingsList} contentContainerStyle={s.settingsBody}>
          <OptionRow icon="color-palette-outline" label="Trang trí phòng" description="Thêm, kéo, xoay, lật và cất đồ vật"
            onPress={() => openDecorating()} />
          <OptionRow icon="brush-outline" label="Màu tường, sàn và chủ đề" description="Giấy dán tường và sàn nhà"
            onPress={() => openDecorating('surface')} />
          <ToggleRow label="Âm thanh trong phòng" description="Tiếng động nhỏ khi chơi cùng pet" value={prefs.sound} onChange={prefs.setSound} />
          <ToggleRow label="Hiệu ứng trong phòng" description="Pet nhún nhảy, tim bay, đồ ăn, bóng và vòng chỉ đường" value={prefs.effects}
            onChange={prefs.setEffects} />
          {onOpenInventory ? <OptionRow icon="cube-outline" label="Kho đồ" description="Đồ pet mang về từ những chuyến khám phá"
            onPress={() => { setSettings(false); onOpenInventory(); }} /> : null}
          {onOpenGarden ? <OptionRow icon="leaf-outline" label="Vườn nhà" description="Trồng hạt giống pet mang về"
            onPress={() => { setSettings(false); onOpenGarden(); }} /> : null}
          <OptionRow icon="create-outline" label="Đổi tên phòng" onPress={() => { setSettings(false); setRename(data.room.name); }} />
          <OptionRow icon="images-outline" label="Album kỷ niệm" onPress={() => { setSettings(false); onOpenAlbum(); }} />
        </ScrollView>
      </OptionSheet>
      <AppModal visible={inventory} animationType="slide" onRequestClose={() => setInventory(false)}>
        <View style={s.inventoryModal}>
          {inventory ? <InventoryScreen userId={user.id} onBack={() => setInventory(false)} placeInto={{ room: 'personal', onPlace: placeFromInventory }} /> : null}
        </View>
      </AppModal>
      <AppModal visible={rename !== null} transparent animationType="fade" onRequestClose={() => setRename(null)}>
        <View style={s.dialogBackdrop}>
          <View style={s.dialog} accessibilityViewIsModal>
            <Text style={s.dialogTitle} accessibilityRole="header">Đổi tên phòng</Text>
            <SoftInput value={rename ?? ''} onChangeText={setRename} maxLength={40} autoFocus accessibilityLabel="Tên phòng" />
            <View style={s.dialogActions}>
              <Button title="Hủy" variant="secondary" onPress={() => setRename(null)} style={s.flex} />
              <Button title="Lưu" loading={saving} disabled={!rename?.trim()} style={s.flex}
                onPress={() => { void save(rename!.trim(), data.room.layout); }} />
            </View>
          </View>
        </View>
      </AppModal>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  centerText: { color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  // The room goes on under the menu bar's rounded corners, so no other background shows beside them.
  underBar: { marginBottom: -TAB_BAR_RADIUS },
  // The header floating over the room's wall: one panel of three fixed rows (8 + 32 + 4 + 24 + 4 + 16 + 8 = 96 points),
  // white enough for its text on the night wall as on the cream one.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, gap: 6 },
  panel: { paddingHorizontal: 10, paddingVertical: 8, gap: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1, borderColor: 'rgba(18,59,92,0.08)', shadowColor: t.shadow, shadowOpacity: 0.12, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  topRow: { height: 32, flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, minWidth: 0, color: t.ink, fontSize: 16, lineHeight: 20, fontWeight: '900', marginRight: 4 },
  // 44 wide and, with its hit slop, 44 tall to touch; no circle of its own.
  icon: { width: 44, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  petRow: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 6 },
  editHeader: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1,
    borderBottomColor: '#E3EDF4' },
  // Over the bottom of the room, above the menu bar (its last points under the bar's rounded corners).
  panelDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: TAB_BAR_RADIUS, backgroundColor: '#FFFFFF' },
  status: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusText: { flexShrink: 1, color: t.ink, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  // The name gives way first on a narrow screen; the bar takes what is left, the numbers keep their place.
  petName: { flexShrink: 1, maxWidth: '46%', color: t.ink, fontSize: 13, lineHeight: 17, fontWeight: '900' },
  petLevel: { color: t.muted, fontSize: 12, fontWeight: '700' },
  expBar: { flex: 1, minWidth: 40, height: 5, borderRadius: 3, overflow: 'hidden', justifyContent: 'center' },
  expText: { flexShrink: 0, color: t.muted, fontSize: 11, fontWeight: '800' },
  offline: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8,
    paddingVertical: 4, borderRadius: 12, backgroundColor: '#FFF6E8E6' },
  offlineText: { flexShrink: 1, color: t.muted, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  settingsList: { flexGrow: 0 },
  settingsBody: { gap: 4, paddingBottom: 4 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  dialogBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: 'rgba(10,36,56,0.45)' },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 26, padding: 22, gap: 14 },
  dialogTitle: { color: t.ink, fontSize: 19, fontWeight: '900' },
  dialogActions: { flexDirection: 'row', gap: 10 },
  inventoryModal: { flex: 1, backgroundColor: '#EEF6FB' },
});
