import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { PET_STAGE_NAMES, PET_THRESHOLDS } from '../../components/PetEvolutionProgress';
import { Text } from '../../components/Typography';
import { roomApi, roomCache } from '../../room/api';
import { itemArt, nextRotation, placeNew, poseFor, settle } from '../../room/art';
import { clockLabel } from '../../room/format';
import type { Layout, OwnRoom, Placement, Pose } from '../../room/types';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, ProgressBar, SoftInput } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import type { FocusTimer } from '../main/MainApp';
import { showError } from '../main/shared';
import { OptionRow, OptionSheet, PetAvatar } from '../together/ui';
import { DecoratePanel } from './DecoratePanel';
import { PhotoSheet } from './PhotoSheet';
import { RoomScene } from './RoomScene';

type Props = {
  user: User;
  timer: FocusTimer;
  /** Hides the tab bar while decorating, so the panel has room and a tap on the menu cannot drop the changes. */
  onImmersiveChange: (immersive: boolean) => void;
  onOpenAlbum: () => void;
  /** Opens Community → Bạn bè, where friends' rooms are visited. */
  onOpenFriends?: () => void;
};

const LINES: Record<Pose, string[]> = {
  rug: ['Chào bạn! Hôm nay mình vui lắm.', 'Mình thích góc nhỏ này ghê!', 'Cùng học một chút nhé?', 'Bạn trang trí phòng xinh quá!'],
  study: ['Suỵt, mình đang tập trung đó!', 'Học cùng bạn vui hơn hẳn!', 'Thêm một chút nữa thôi, cố lên!'],
  rest: ['Nghỉ ngơi một chút rồi học tiếp nha.', 'Ấm áp quá… mình nằm thêm tí nhé.'],
};

/** Where the owner's pet is: the focus timer on this device first (it is the live state), then the backend
 * (a focus session from another device or a group room), else its rug. Never changes any of them. */
function ownerPose(timer: FocusTimer, room: OwnRoom): Pose {
  const sessionOn = timer.running || !!timer.activeCycle;
  const wanted: Pose = sessionOn ? (timer.phase === 'focus' ? 'study' : 'rest') : room.activity === 'studying' ? 'study' : 'rug';
  return poseFor(wanted, room.room.layout);
}

export function RoomTab({ user, timer, onImmersiveChange, onOpenAlbum, onOpenFriends }: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<OwnRoom | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [draft, setDraft] = useState<Layout | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ key: number; text: string } | null>(null);
  const lineIndex = useRef(0);
  const [photo, setPhoto] = useState(false);
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await roomApi.get();
      setData(fresh); setOffline(false); setLoadError(null);
      void roomCache.store(user.id, fresh);
    } catch (e) {
      const cached = await roomCache.load(user.id);
      if (cached) { setData((current) => current ?? cached); setOffline(true); } else setLoadError(e);
    }
  }, [user.id]);
  useEffect(() => { void load(); }, [load]);
  // When the walk is due to end, read the state again (reading never settles the walk).
  useEffect(() => {
    if (!data?.walk.away || !data.walk.return_at) return;
    const wait = Date.parse(data.walk.return_at) - Date.now() + 1500;
    const id = setTimeout(() => { void load(); }, Math.max(1000, Math.min(wait, 2 ** 31 - 1)));
    return () => clearTimeout(id);
  }, [data?.walk.away, data?.walk.return_at, load]);

  const decorating = draft !== null;
  useEffect(() => { onImmersiveChange(decorating); }, [decorating, onImmersiveChange]);
  useEffect(() => () => onImmersiveChange(false), [onImmersiveChange]);
  const cancel = useCallback(() => { setDraft(null); setSelected(null); }, []);
  const changed = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data.room.layout);
  const requestCancel = useCallback(async () => {
    if (changed && !(await confirm({ title: 'Bỏ các thay đổi?', message: 'Phòng sẽ trở lại như lần lưu gần nhất.', confirmLabel: 'Bỏ thay đổi',
      cancelLabel: 'Trang trí tiếp', icon: 'arrow-undo-outline' }))) return;
    cancel();
  }, [changed, confirm, cancel]);
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
  const shown = useMemo(() => (data ? { ...data, room: { ...data.room, layout: draft ?? data.room.layout } } : null), [data, draft]);
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
  const notice = away && data.walk.return_at ? { icon: 'walk-outline' as const, text: `${petName} đang đi dạo · về lúc ${clockLabel(data.walk.return_at)}` }
    : pose === 'study' ? { icon: 'book-outline' as const, text: `${petName} đang học cùng bạn` }
    : pose === 'rest' ? { icon: 'cafe-outline' as const, text: `${petName} đang nghỉ giải lao` } : null;

  function interact() {
    if (away) { toast(`${petName} đang đi dạo, về lúc ${clockLabel(data!.walk.return_at!)} nhé.`, 'info'); return; }
    const lines = LINES[pose];
    const text = lines[lineIndex.current++ % lines.length];
    setReaction((r) => ({ key: (r?.key ?? 0) + 1, text }));
  }

  async function save(name: string, layout: Layout) {
    setSaving(true);
    try {
      const { room } = await roomApi.save(name, layout, data!.room.version);
      const next = { ...data!, room };
      setData(next); setOffline(false); setDraft(null); setSelected(null); setRename(null);
      void roomCache.store(user.id, next);
      toast('Đã lưu phòng!', 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'room_version_conflict') {
        setDraft(null); setSelected(null); setRename(null);
        await load();
        await confirm({ title: 'Phòng vừa được cập nhật', message: 'Phòng đã được thay đổi ở nơi khác. Mirabi đã mở bản mới nhất, bạn trang trí lại nhé.',
          confirmLabel: 'Đã hiểu', cancelLabel: null, icon: 'sync-outline' });
      } else showError('Chưa lưu được phòng', e); // the draft stays, so "Lưu" tries again
    } finally { setSaving(false); }
  }
  // Decorating edits a copy of the saved room; every change keeps the item inside the room.
  const editItems = (change: (items: Placement[]) => Placement[]) => setDraft((d) => (d ? { ...d, items: change(d.items) } : d));
  const update = (item: string | null, change: (p: Placement) => Placement) => {
    if (item) editItems((items) => items.map((p) => (p.item === item ? settle(change(p)) : p)));
  };
  const nameOf = (item: string) => data.catalog.items.find((entry) => entry.id === item)?.name ?? 'Đồ vật';
  function pickItem(item: string) {
    if (!draft) return;
    if (draft.items.some((p) => p.item === item)) { setSelected(item); return; }
    if (draft.items.length >= data!.catalog.max_items) { toast('Phòng đã đủ đồ rồi. Cất bớt vào kho để thêm món mới nhé.', 'info'); return; }
    const added = placeNew(item);
    if (!added) return;
    editItems((items) => [...items, added]);
    setSelected(item);
  }
  function store() {
    if (!selected) return;
    editItems((items) => items.filter((p) => p.item !== selected));
    toast(`Đã cất ${nameOf(selected)} vào kho.`, 'info');
    setSelected(null);
  }
  const openFriends = () => { setMenu(false); onOpenFriends?.(); };
  const takePhoto = () => {
    if (away) { toast(`${petName} đang đi dạo. Chờ ${petName} về rồi chụp ảnh nhé!`, 'info'); return; }
    if (offline) { toast('Cần kết nối mạng để lưu ảnh vào Album.', 'info'); return; }
    setPhoto(true);
  };

  return (
    <View style={[s.fill, { paddingTop: insets.top + 10 }]}>
      <View style={s.header}>
        <View style={s.flex}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={decorating ? 1 : 2}>{decorating ? 'Trang trí' : data.room.name}</Text>
          {decorating ? <Text style={s.subtitle} numberOfLines={2}>{selected ? 'Kéo để đổi chỗ' : 'Chạm đồ vật để chọn, kéo để đổi chỗ'}</Text> : null}
        </View>
        {decorating ? <>
          <Button title="Hủy" variant="secondary" onPress={() => { void requestCancel(); }} disabled={saving} style={s.headerButton} />
          <Button title="Lưu" onPress={() => { void save(data.room.name, draft!); }} loading={saving} style={s.headerButton} />
        </> : <>
          <Pressable onPress={openFriends} style={s.menuButton} accessibilityRole="button" accessibilityLabel="Ghé phòng bạn bè">
            <Ionicons name="people-outline" size={20} color={t.ink} />
          </Pressable>
          <Pressable onPress={() => setMenu(true)} style={s.menuButton} accessibilityRole="button" accessibilityLabel="Tùy chọn phòng">
            <Ionicons name="ellipsis-horizontal" size={20} color={t.ink} />
          </Pressable>
        </>}
      </View>

      {decorating ? null : (
        <View style={s.petRow} accessible accessibilityLabel={`${petName}, cấp ${stage} ${PET_STAGE_NAMES[stage]}, ${xp} EXP`}>
          <PetAvatar user={{ pet: data.pet.id, pet_level: level }} size={34} />
          <View style={s.flex}>
            <Text style={s.petName} numberOfLines={1}>{petName}<Text style={s.petLevel}>{`  ·  Cấp ${stage} ${PET_STAGE_NAMES[stage]}`}</Text></Text>
            <View style={s.expRow}>
              <View style={s.flex}><ProgressBar value={next ? Math.min(1, xp / next) : 1} /></View>
              <Text style={s.expText}>{next ? `${xp}/${next} EXP` : `${xp} EXP`}</Text>
            </View>
          </View>
        </View>
      )}

      {offline ? (
        <Pressable onPress={() => { void load(); }} style={s.offline} accessibilityRole="button" accessibilityLabel="Đang ngoại tuyến, chạm để thử lại">
          <Ionicons name="cloud-offline-outline" size={16} color={t.muted} />
          <Text style={s.offlineText}>Đang ngoại tuyến · hiển thị phòng đã lưu. Chạm để thử lại.</Text>
        </Pressable>
      ) : null}

      <View style={s.sceneWrap}>
        <RoomScene layout={shown.room.layout} pet={{ id: data.pet.id, name: petName, level }} pose={pose} away={away}
          onPetPress={decorating ? undefined : interact} reaction={decorating ? null : reaction} notice={decorating ? null : notice}
          walkable={!decorating}
          description={`${data.room.name}${away ? `, ${petName} đang đi dạo` : `, ${petName} đang ở trong phòng`}`}
          editor={decorating ? { selected, onSelect: setSelected, onMove: (item, x, y) => update(item, (p) => ({ ...p, x, y })) } : null} />
      </View>

      {decorating ? (
        <DecoratePanel catalog={data.catalog} draft={draft!} saved={data.room.layout} selected={selected} bottomInset={insets.bottom}
          onSurface={(kind, id) => setDraft((d) => (d ? { ...d, [kind]: id } : d))} onItem={pickItem}
          onVariant={(variant) => update(selected, (p) => ({ ...p, variant }))}
          onFlip={() => update(selected, (p) => ({ ...p, flip: !p.flip }))}
          onRotate={() => update(selected, (p) => ({ ...p, rotate: nextRotation(itemArt(p.item)!, p.rotate) }))}
          onStore={store} onNudge={(dx, dy) => update(selected, (p) => ({ ...p, x: p.x + dx, y: p.y + dy }))} onDeselect={() => setSelected(null)} />
      ) : (
        <View style={s.actions}>
          <Action icon="hand-left-outline" label="Tương tác" onPress={interact} />
          <Action icon="color-palette-outline" label="Trang trí" onPress={() => setDraft({ ...data.room.layout, items: [...data.room.layout.items] })} />
          <Action icon="camera-outline" label="Chụp ảnh" onPress={takePhoto} />
        </View>
      )}

      <PhotoSheet visible={photo} pose={pose} onClose={() => setPhoto(false)} onSaved={() => {
        setPhoto(false);
        toast('Đã lưu ảnh vào Album kỷ niệm!', 'success', { label: 'Xem', onPress: onOpenAlbum });
      }} />
      <OptionSheet visible={menu} title={data.room.name} onClose={() => setMenu(false)}>
        <OptionRow icon="create-outline" label="Đổi tên phòng" onPress={() => { setMenu(false); setRename(data.room.name); }} />
        <OptionRow icon="people-outline" label="Ghé phòng bạn bè" description="Xem phòng bạn bè và để lại lời chào" onPress={openFriends} />
        <OptionRow icon="images-outline" label="Album kỷ niệm" onPress={() => { setMenu(false); onOpenAlbum(); }} />
      </OptionSheet>
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

function Action({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={t.accent} />
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  centerText: { color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
  title: { color: t.ink, fontSize: 22, lineHeight: 28, fontWeight: '900' },
  subtitle: { color: t.muted, fontSize: 12, marginTop: 2 },
  headerButton: { minWidth: 72 },
  menuButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  petRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 18, backgroundColor: '#FFFFFFCC' },
  petName: { color: t.ink, fontSize: 15, fontWeight: '900' },
  petLevel: { color: t.muted, fontSize: 12, fontWeight: '700' },
  expRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  expText: { color: t.muted, fontSize: 11, fontWeight: '800' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 14, backgroundColor: '#FFF6E8' },
  offlineText: { flex: 1, color: t.muted, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  sceneWrap: { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingBottom: 10 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  action: { flex: 1, minHeight: 60, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  actionText: { color: t.ink, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  dialogBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: 'rgba(10,36,56,0.45)' },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 26, padding: 22, gap: 14 },
  dialogTitle: { color: t.ink, fontSize: 19, fontWeight: '900' },
  dialogActions: { flexDirection: 'row', gap: 10 },
});
