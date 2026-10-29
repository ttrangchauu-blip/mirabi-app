import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, newIdempotencyKey } from '../../api/client';
import type { User } from '../../auth/AuthContext';
import { errorMessage } from '../../auth/messages';
import { PET_STAGE_NAMES } from '../../components/PetEvolutionProgress';
import { Text } from '../../components/Typography';
import { roomApi } from '../../room/api';
import { poseFor } from '../../room/art';
import type { PetGiftReason, VisitAction, VisitedRoom } from '../../room/types';
import { CHEERS, STUDY_PRESETS, waitSeconds } from '../../room/visit';
import { appTheme as t } from '../../theme';
import { Button, Chip } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { SUBJECTS } from '../together/labels';
import { OptionRow, OptionSheet, PetAvatar } from '../together/ui';
import { PLAY_MS } from '../../room/prefs';
import { RoomScene, type PetMenuAction } from './RoomScene';

type Props = {
  userId: number;
  me: User;
  onBack: () => void;
  /** Opens a study room in Study Together (after "Rủ học" created or used one). */
  onOpenStudyRoom?: (roomId: number) => void;
};

// What their pet says to "Chào pet", in turn.
const REPLIES = ['Chào bạn! Cảm ơn đã ghé chơi nha!', 'Hi hi, nhột quá!', 'Ồ, có khách! Vui quá đi!', 'Chơi với mình thêm nha!',
  'Thích bạn ghê!', 'Hi hi, chào cậu nhé!', 'Yeah, vui quá đi!'];
const WAIT_NOTE = 'đã gửi, chờ một lát';
/** Said once a visit, the first time a tap gives no EXP. */
const NO_GIFT: Record<PetGiftReason, (pet: string) => string> = {
  already_given: (pet) => `Hôm nay bạn đã tặng EXP cho ${pet} rồi. Vẫn chơi cùng được nhé!`,
  pet_full: (pet) => `${pet} đã nhận đủ EXP từ bạn bè hôm nay. Vẫn chơi cùng được nhé!`,
  pet_away: (pet) => `${pet} đang đi dạo, hãy để lại lời chào nhé.`,
};

/**
 * A friend's saved room, read only: no decorating, no control over their pet. Your pet waits on the guest spot.
 * A tap on their pet opens its menu: "Chào pet" plays with it (a hop, a line and hearts), sends a greeting unless one
 * was sent a moment ago, and the first time in a visit asks the backend whether it gives the pet EXP today (saying what
 * happened once); "Động viên" sends a preset cheer. While the pet is out, its marker opens the same menu with "Để lại
 * lời chào". "Rủ học" (inviting the owner, not playing with the pet) sits in the header. Greetings, cheers and
 * invitations are limited by the backend (the menu and button show it too) and never give EXP; a failed send keeps its
 * request id, so tapping again cannot deliver it twice.
 */
export function VisitRoom({ userId, me, onBack, onOpenStudyRoom }: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [data, setData] = useState<VisitedRoom | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<VisitAction | null>(null);
  const [reaction, setReaction] = useState<{ key: number; text: string } | null>(null);
  const [sheet, setSheet] = useState<'cheer' | 'study' | null>(null);
  const [subject, setSubject] = useState('general');
  const [preset, setPreset] = useState(STUDY_PRESETS[0].id);
  const [now, setNow] = useState(() => Date.now());
  // The request id of a send that failed, reused when exactly the same thing is sent again.
  const failed = useRef<{ key: string; id: string } | null>(null);
  const [hearts, setHearts] = useState(0);
  const [petMenu, setPetMenu] = useState(false);
  // Until when the last "Chào pet" plays: taps meanwhile neither open the menu nor start it again.
  const playing = useRef(0);
  // Playing with the pet: asked the backend at most once a visit (the same id again after a lost connection).
  const play = useRef<{ settled: boolean; busy: boolean; id: string | null }>({ settled: false, busy: false, id: null });

  const load = useCallback(async () => {
    try { setData(await roomApi.visit(userId)); setError(null); } catch (e) { setError(e); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  useEffect(() => {
    if (!reaction) return;
    const id = setTimeout(() => setReaction(null), 2600);
    return () => clearTimeout(id);
  }, [reaction]);
  // Re-enable a button when its cooldown ends (only cooldowns still ahead keep a timer).
  const nextAvailable = data ? Math.min(...Object.values(data.available_at).map((at) => (at ? Date.parse(at) : Infinity)).filter((at) => at > now)) : Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextAvailable)) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(Math.max(0, nextAvailable - Date.now()) + 200, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [nextAvailable]);

  if (!data) {
    const code = error instanceof ApiError ? error.code : null;
    const blocked = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        {error ? <>
          <Ionicons name={blocked ? 'lock-closed-outline' : 'cloud-offline-outline'} size={40} color={t.muted} />
          <Text style={s.centerText}>{code === 'room_visits_disabled' ? 'Bạn ấy đang tắt chế độ cho ghé thăm phòng.'
            : blocked ? 'Bạn chỉ có thể ghé phòng của bạn bè.' : 'Chưa mở được phòng của bạn ấy. Thử lại nhé.'}</Text>
          {blocked ? null : <Button title="Thử lại" icon="refresh" onPress={() => { setError(null); void load(); }} />}
          <Button title="Quay lại" variant="secondary" onPress={onBack} />
        </> : <ActivityIndicator color={t.accent} size="large" accessibilityLabel="Đang mở phòng của bạn bè" />}
      </View>
    );
  }

  const room = data;
  const host = room.owner.display_name;
  const petName = room.pet.name || 'Pet';
  const away = room.walk.away;
  const pose = poseFor(room.activity === 'studying' ? 'study' : 'rug', room.room.layout);
  const notice = away ? { icon: 'walk-outline' as const, text: `${petName} đang đi dạo, chưa có ở nhà` }
    : pose === 'study' ? { icon: 'book-outline' as const, text: `${petName} đang học` } : null;
  const stage = Math.max(0, Math.min(6, room.pet.level));
  const waiting = (action: VisitAction) => waitSeconds(room.available_at, action, now) > 0;

  async function send<T extends { available_at: string }>(action: VisitAction, key: string, call: (requestId: string) => Promise<T>) {
    const requestId = failed.current?.key === key ? failed.current.id : newIdempotencyKey();
    setBusy(action);
    try {
      const result = await call(requestId);
      failed.current = null;
      setData((d) => (d ? { ...d, available_at: { ...d.available_at, [action]: result.available_at } } : d));
      setNow(Date.now());
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) failed.current = null; // refused for good: a new tap is a new request
      else failed.current = { key, id: requestId };
      if (e instanceof ApiError && ['room_not_found', 'room_visits_disabled'].includes(e.code ?? '')) { setData(null); setError(e); }
      else if (e instanceof ApiError && (e.code === 'greeting_cooldown' || e.code === 'visit_daily_limit')) toast(errorMessage(e), 'info');
      else showError('Chưa gửi được', e);
      return null;
    } finally { setBusy(null); }
  }

  async function hello() {
    const result = await send('hello', 'hello', (id) => roomApi.greet(userId, 'hello', null, id));
    // At home, the pet's answer says it was greeted (and leaves the toast to the EXP it may get).
    if (result?.host_away) toast(`Đã để lại lời chào. ${host} sẽ thấy khi ${petName} về.`, 'success');
  }
  /** "Chào pet": it plays every time (once its last play is over), greets when it may, and EXP is asked for once. */
  function greetPet() {
    if (Date.now() < playing.current) return;
    playing.current = Date.now() + PLAY_MS;
    setReaction((r) => ({ key: (r?.key ?? 0) + 1, text: REPLIES[(r?.key ?? 0) % REPLIES.length] }));
    setHearts((h) => h + 1);
    void giftExp();
    if (!waiting('hello') && busy === null) void hello();
  }
  function onMenu(id: string) {
    setPetMenu(false);
    if (id === 'cheer') setSheet('cheer');
    else if (away) void hello();
    else greetPet();
  }
  async function cheer(key: string, text: string) {
    setSheet(null);
    const result = await send('cheer', `cheer:${key}`, (id) => roomApi.greet(userId, 'cheer', key, id));
    if (!result) return;
    if (!away) setReaction((r) => ({ key: (r?.key ?? 0) + 1, text: `“${text}” Cảm ơn bạn nhiều!` }));
    toast(`Đã gửi “${text}” tới ${host}.`, 'success');
  }
  async function inviteToStudy() {
    const chosen = STUDY_PRESETS.find((p) => p.id === preset) ?? STUDY_PRESETS[0];
    setSheet(null);
    const result = await send('study_invite', `study:${subject}:${chosen.id}`,
      (id) => roomApi.inviteToStudy(userId, { subject, ...chosen.input }, id));
    if (!result) return;
    const roomId = result.room?.id;
    toast(result.created_room ? `Đã tạo phòng học và rủ ${host} cùng học!` : `Đã rủ ${host} vào phòng học của bạn!`, 'success',
      roomId && onOpenStudyRoom ? { label: 'Vào phòng', onPress: () => onOpenStudyRoom(roomId) } : undefined);
  }

  async function giftExp() {
    const p = play.current;
    if (p.settled || p.busy || !room.pet_gift) return; // (a backend without friend EXP sends no pet_gift: just play)
    if (!room.pet_gift.available) { // nothing to give today: say so once, then just play
      p.settled = true;
      toast(NO_GIFT[room.pet_gift.reason ?? 'already_given'](petName), 'info');
      return;
    }
    p.busy = true;
    p.id ??= newIdempotencyKey();
    try {
      const result = await roomApi.playWithPet(userId, p.id);
      p.settled = true;
      if (result.granted > 0) toast(`+${result.granted} EXP cho ${result.pet_name || petName}`, 'success');
      else if (result.reason !== 'granted') toast(NO_GIFT[result.reason](petName), 'info');
      setData((d) => (d ? { ...d, pet: { ...d.pet, level: result.pet_level },
        pet_gift: { ...d.pet_gift, available: false, reason: result.granted > 0 ? 'already_given' : (result.reason as PetGiftReason) } } : d));
    } catch (e) {
      if (e instanceof ApiError && ['room_not_found', 'room_visits_disabled'].includes(e.code ?? '')) { setData(null); setError(e); }
      else if (e instanceof ApiError && e.status < 500) p.settled = true; // refused: keep playing, ask no more
      // A lost connection keeps the id: the next tap asks again and can never be counted twice.
    } finally { p.busy = false; }
  }

  // The pet's menu, in this order; one sent a moment ago (or while another sends) waits, and says so.
  const menuItem = (action: VisitAction, id: string, label: string, icon: PetMenuAction['icon'], always = false): PetMenuAction => {
    const sent = waiting(action);
    return { id, label, icon, disabled: !always && (sent || busy !== null), note: !always && sent ? WAIT_NOTE : undefined };
  };
  const menuActions = [
    away ? menuItem('hello', 'hello', 'Để lại lời chào', 'hand-left') : menuItem('hello', 'hello', 'Chào pet', 'hand-left', true),
    menuItem('cheer', 'cheer', 'Động viên', 'heart'),
  ];
  const openMenu = () => { if (Date.now() >= playing.current) setPetMenu((open) => !open); };
  // "Rủ học" stays reachable when the pet is out; when the owner takes no invitations it says so instead.
  const inviteSent = waiting('study_invite');
  const inviteOff = !room.can_invite_study;

  return (
    <View style={[s.fill, { paddingTop: insets.top + 10 }]} testID="visit-room">
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={10} style={s.back} accessibilityRole="button" accessibilityLabel="Quay lại">
          <Ionicons name="chevron-back" size={22} color={t.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={1}>{room.room.name}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{`Bạn đang ghé thăm ${host} · chỉ xem`}</Text>
        </View>
        <Pressable onPress={inviteOff ? () => toast(`${host} đang tắt nhận lời mời học.`, 'info') : () => { setPetMenu(false); setSheet('study'); }}
          disabled={busy !== null || inviteSent} hitSlop={4}
          style={({ pressed }) => [s.invite, pressed && s.pressed, (inviteOff || inviteSent) && s.dimmed]} accessibilityRole="button"
          accessibilityLabel={inviteSent ? `Rủ học, ${WAIT_NOTE}` : 'Rủ học'} accessibilityHint={inviteOff ? `${host} đang tắt nhận lời mời học` : `Mời ${host} cùng học`}
          accessibilityState={{ disabled: inviteSent || busy !== null, busy: busy === 'study_invite' }}>
          <View style={s.inviteIcon}>
            {busy === 'study_invite' ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Ionicons name={inviteSent ? 'checkmark' : 'book'} size={16} color="#FFFFFF" />}
          </View>
          <Text style={s.inviteText}>Rủ học</Text>
        </Pressable>
      </View>
      <View style={s.petRow}>
        <PetAvatar user={{ pet: room.pet.id, pet_level: room.pet.level }} size={34} />
        <View style={s.flex}>
          <Text style={s.petName} numberOfLines={1}>{petName}<Text style={s.petLevel}>{`  ·  Cấp ${stage} ${PET_STAGE_NAMES[stage]}`}</Text></Text>
          {notice ? (
            <View style={s.status} accessibilityLiveRegion="polite">
              <Ionicons name={notice.icon} size={13} color={t.accent} />
              <Text style={s.statusText} numberOfLines={1}>{notice.text}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={s.sceneWrap}>
        <RoomScene layout={room.room.layout} pet={{ ...room.pet, name: petName }} pose={pose} away={away}
          guest={{ ...room.guest_pet, name: room.guest_pet.name ?? me.pet_name }} reaction={reaction}
          onPetPress={away ? undefined : openMenu} petLabel={`${petName}, chạm để chào hoặc động viên`} hearts={hearts}
          petMenu={petMenu ? { actions: menuActions, onAction: onMenu, onClose: () => setPetMenu(false) } : null}
          awayMarker={away ? { text: `${petName} đang đi dạo · chạm để để lại lời chào`, onPress: openMenu } : null}
          description={`${room.room.name}${away ? `, ${petName} đang đi dạo` : ''}, pet của bạn đang ghé chơi`} />
      </View>

      <OptionSheet visible={sheet === 'cheer'} title={`Động viên ${host}`} onClose={() => setSheet(null)}>
        {CHEERS.map((c) => <OptionRow key={c.key} icon="heart-outline" label={c.text} onPress={() => { void cheer(c.key, c.text); }} />)}
      </OptionSheet>
      <OptionSheet visible={sheet === 'study'} title={`Rủ ${host} cùng học`} onClose={() => setSheet(null)}>
        <Text style={s.sheetLabel}>Môn học</Text>
        <View style={s.chips}>
          {SUBJECTS.slice(0, 8).map((x) => <Chip key={x.id} label={x.label} selected={subject === x.id} onPress={() => setSubject(x.id)} />)}
        </View>
        <Text style={s.sheetLabel}>Chế độ và thời lượng</Text>
        {STUDY_PRESETS.map((p) => <OptionRow key={p.id} label={p.label} description={p.detail} selected={preset === p.id} onPress={() => setPreset(p.id)} />)}
        <Text style={s.sheetHint}>Nếu bạn đang ở trong một phòng học, lời mời dùng phòng đó với nhịp học của phòng.</Text>
        <Button title="Gửi lời mời học" icon="paper-plane-outline" onPress={() => { void inviteToStudy(); }} />
      </OptionSheet>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  centerText: { color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 10 },
  back: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { color: t.ink, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  subtitle: { color: t.muted, fontSize: 12, marginTop: 1 },
  // The same look as "Cài đặt" in your own room.
  invite: { height: 44, flexShrink: 0, borderRadius: 16, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: 7, paddingRight: 12, borderWidth: 1.5, borderColor: '#B9D6EA' },
  inviteIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  inviteText: { color: t.ink, fontSize: 13, fontWeight: '900' },
  petRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 18, backgroundColor: '#FFFFFFCC' },
  petName: { color: t.ink, fontSize: 15, fontWeight: '900' },
  petLevel: { color: t.muted, fontSize: 12, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  statusText: { flexShrink: 1, color: t.ink, fontSize: 12, fontWeight: '800' },
  sceneWrap: { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingBottom: 12 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  dimmed: { opacity: 0.5 },
  sheetLabel: { fontSize: 14, fontWeight: '800', color: t.ink, marginTop: 4, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  sheetHint: { fontSize: 12, color: t.muted, lineHeight: 17, marginVertical: 10 },
});
