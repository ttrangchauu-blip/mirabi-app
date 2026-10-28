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
import { RoomScene } from './RoomScene';

type Props = {
  userId: number;
  me: User;
  onBack: () => void;
  /** Opens a study room in Study Together (after "Rủ học" created or used one). */
  onOpenStudyRoom?: (roomId: number) => void;
};

const HELLO_REPLIES = ['Chào bạn! Cảm ơn đã ghé chơi nha!', 'Ồ, có khách! Vui quá đi!', 'Hi hi, chào cậu nhé!'];
const PLAY_REPLIES = ['Hi hi, nhột quá!', 'Chơi với mình thêm nha!', 'Thích bạn ghê!', 'Yeah, vui quá đi!'];
/** Said once a visit, the first time a tap gives no EXP. */
const NO_GIFT: Record<PetGiftReason, (pet: string) => string> = {
  already_given: (pet) => `Hôm nay bạn đã tặng EXP cho ${pet} rồi. Vẫn chơi cùng được nhé!`,
  pet_full: (pet) => `${pet} đã nhận đủ EXP từ bạn bè hôm nay. Vẫn chơi cùng được nhé!`,
  pet_away: (pet) => `${pet} đang đi dạo, hãy để lại lời chào nhé.`,
};

/**
 * A friend's saved room, read only: no decorating, no control over their pet. Your pet waits on the guest spot.
 * "Chào pet", "Động viên" and "Rủ học" are sent to the backend, which limits how often (the buttons show it too) and
 * never gives EXP for them. A failed send keeps its request id, so tapping again cannot deliver it twice.
 * Tapping their pet plays with it (a hop, a line and hearts, every time); the first tap of a visit also asks the
 * backend whether it gives the pet EXP today, and says what happened once.
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
    if (!result) return;
    if (result.host_away) toast(`Đã để lại lời chào. ${host} sẽ thấy khi ${petName} về.`, 'success');
    else {
      setReaction((r) => ({ key: (r?.key ?? 0) + 1, text: HELLO_REPLIES[(r?.key ?? 0) % HELLO_REPLIES.length] }));
      toast(`Đã chào ${petName}!`, 'success');
    }
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

  async function playWithPet() {
    setReaction((r) => ({ key: (r?.key ?? 0) + 1, text: PLAY_REPLIES[(r?.key ?? 0) % PLAY_REPLIES.length] }));
    setHearts((h) => h + 1);
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

  const actions: { action: VisitAction; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; disabled?: boolean }[] = [
    { action: 'hello', label: away ? 'Để lại lời chào' : 'Chào pet', icon: 'hand-left-outline', onPress: () => { void hello(); } },
    { action: 'cheer', label: 'Động viên', icon: 'heart-outline', onPress: () => setSheet('cheer') },
    { action: 'study_invite', label: 'Rủ học', icon: 'book-outline', onPress: () => setSheet('study'), disabled: !room.can_invite_study },
  ];

  return (
    <View style={[s.fill, { paddingTop: insets.top + 10 }]} testID="visit-room">
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={10} style={s.back} accessibilityRole="button" accessibilityLabel="Quay lại">
          <Ionicons name="chevron-back" size={22} color={t.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={2}>{room.room.name}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{`Bạn đang ghé thăm ${host} · chỉ xem`}</Text>
        </View>
      </View>
      <View style={s.petRow}>
        <PetAvatar user={{ pet: room.pet.id, pet_level: room.pet.level }} size={34} />
        <Text style={s.petName} numberOfLines={2}>{petName}<Text style={s.petLevel}>{`  ·  Cấp ${stage} ${PET_STAGE_NAMES[stage]}`}</Text></Text>
      </View>
      <View style={s.sceneWrap}>
        <RoomScene layout={room.room.layout} pet={{ ...room.pet, name: petName }} pose={pose} away={away}
          guest={{ ...room.guest_pet, name: room.guest_pet.name ?? me.pet_name }} reaction={reaction} notice={notice}
          onPetPress={away ? undefined : () => { void playWithPet(); }} hearts={hearts}
          description={`${room.room.name}${away ? `, ${petName} đang đi dạo` : ''}, pet của bạn đang ghé chơi`} />
      </View>
      {away ? <Text style={s.hint}>{`${petName} đang đi dạo. Lời chào sẽ chờ ${host} và ${petName} về.`}</Text>
        : !room.can_invite_study ? <Text style={s.hint}>{`${host} đang tắt nhận lời mời học.`}</Text> : null}
      <View style={s.actions}>
        {actions.map((a) => {
          const sentRecently = waiting(a.action);
          const off = busy !== null || sentRecently || !!a.disabled;
          return (
            <Pressable key={a.action} onPress={a.onPress} disabled={off} accessibilityRole="button"
              accessibilityState={{ busy: busy === a.action, disabled: off }}
              accessibilityLabel={sentRecently ? `${a.label}, đã gửi, chờ một lát` : a.label}
              style={({ pressed }) => [s.action, pressed && s.pressed, off && busy !== a.action && s.dimmed]}>
              {busy === a.action ? <ActivityIndicator color={t.accent} />
                : <Ionicons name={sentRecently ? 'checkmark-circle-outline' : a.icon} size={22} color={t.accent} />}
              <Text style={s.actionText}>{a.label}</Text>
              {sentRecently ? <Text style={s.actionSent}>Đã gửi</Text> : null}
            </Pressable>
          );
        })}
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
  petRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 18, backgroundColor: '#FFFFFFCC' },
  petName: { flex: 1, color: t.ink, fontSize: 15, fontWeight: '900' },
  petLevel: { color: t.muted, fontSize: 12, fontWeight: '700' },
  sceneWrap: { flex: 1, minHeight: 0, paddingHorizontal: 16, paddingBottom: 8 },
  hint: { color: t.muted, fontSize: 12, textAlign: 'center', marginHorizontal: 20, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  action: { flex: 1, minHeight: 64, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4,
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  actionText: { color: t.ink, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  actionSent: { color: t.muted, fontSize: 10, fontWeight: '700' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  dimmed: { opacity: 0.5 },
  sheetLabel: { fontSize: 14, fontWeight: '800', color: t.ink, marginTop: 4, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  sheetHint: { fontSize: 12, color: t.muted, lineHeight: 17, marginVertical: 10 },
});
