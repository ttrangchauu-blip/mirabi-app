import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import { formatMinutes } from '../../studyTogether/timer';
import type { EligibleRoom, RoomInvitation, TogetherHome as HomeData } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card, ProgressBar, SectionHeader } from '../../ui/kit';
import { showError } from '../main/shared';
import { STATE_LABELS, subjectLabel } from './labels';
import { StudyModeSwitch } from './StudyModeSwitch';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { EmptyState, ErrorState, LoadingState, PersonRow, PresenceLabel, SmallButton } from './ui';

export function TogetherHome() {
  const nav = useTogetherNav();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await togetherApi.home()); setError(null); }
    catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);

  async function run(key: string, action: () => Promise<unknown>, title: string) {
    setBusy(key);
    try { await action(); } catch (e) { showError(title, e); } finally { setBusy(null); }
  }
  const acceptInvitation = (inv: RoomInvitation) => run(`inv${inv.id}`, async () => {
    const { room } = await togetherApi.acceptInvitation(inv.id);
    nav.push({ name: 'room', roomId: room.id, initial: room });
  }, 'Không thể tham gia phòng');
  const declineInvitation = (inv: RoomInvitation) => run(`inv${inv.id}`, async () => {
    await togetherApi.declineInvitation(inv.id); await load();
  }, 'Không thể từ chối lời mời');
  const joinRoom = (room: EligibleRoom) => run(`room${room.id}`, async () => {
    const result = await togetherApi.joinRoom(room.id);
    nav.push({ name: 'room', roomId: result.room.id, initial: result.room });
  }, 'Không thể tham gia phòng');

  const user = nav.user;
  const header = (
    <>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Text style={styles.hello} accessibilityRole="header">Chào {user.display_name}!</Text>
          <Text style={styles.sub}>Cùng bạn bè tập trung, không ai phải học một mình.</Text>
        </View>
        <Pressable onPress={() => nav.push({ name: 'notifications' })} style={styles.bell} accessibilityRole="button"
          accessibilityLabel={`Thông báo${data?.unread_notifications ? `, ${data.unread_notifications} chưa đọc` : ''}`}>
          <Ionicons name="notifications-outline" size={22} color={t.ink} />
          {data?.unread_notifications ? <View style={styles.badge}><Text style={styles.badgeText}>{Math.min(99, data.unread_notifications)}</Text></View> : null}
        </Pressable>
      </View>
      <StudyModeSwitch value="together" onChange={(m) => { if (m !== 'together') nav.exit(m); }} />
    </>
  );
  if (!data) return <>{header}{error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />}</>;

  const otherRooms = data.rooms.filter((r) => r.relation !== 'member' && r.relation !== 'invited');
  return (
    <>
      {header}
      <Card style={styles.hero}>
        <PetCompanion pet={user.pet} stage={user.level} size={86} />
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>{user.pet_name ?? 'Pet'} sẵn sàng học cùng nhóm</Text>
          <Text style={styles.heroCode} selectable>Mã kết bạn: {data.me.public_code}</Text>
        </View>
      </Card>
      {data.current_room ? (
        <Card style={styles.current}>
          <Text style={styles.cardLabel}>Phòng của bạn</Text>
          <Text style={styles.cardTitle}>{data.current_room.name}</Text>
          <Text style={styles.sub}>{STATE_LABELS[data.current_room.state]} · {data.current_room.member_count}/{data.current_room.max_members} thành viên</Text>
          <Button title="Vào phòng" icon="enter-outline"
            onPress={() => nav.push({ name: 'room', roomId: data.current_room!.id, initial: data.current_room })} />
        </Card>
      ) : (
        <View style={styles.actions}>
          <Button title="Tạo phòng học" icon="add-circle-outline" onPress={() => nav.push({ name: 'create' })} style={styles.flex} />
          <Button title="Nhập mã phòng" icon="keypad-outline" variant="secondary" onPress={() => nav.push({ name: 'join' })} style={styles.flex} />
        </View>
      )}

      {data.invitations.length > 0 && <>
        <SectionHeader title="Lời mời vào phòng" />
        {data.invitations.map((inv) => (
          <Card key={inv.id}>
            <PersonRow user={inv.inviter} subtitle={`mời bạn vào “${inv.room.name}”`} />
            <Text style={styles.sub}>{subjectLabel(inv.room.subject)} · {inv.room.focus_minutes} phút tập trung · {inv.room.member_count}/{inv.room.max_members} thành viên</Text>
            {!inv.room.can_join && inv.room.reason === 'room_full' ? <Text style={styles.warn}>Phòng đã đủ người.</Text> : null}
            <View style={styles.rowButtons}>
              <SmallButton title="Tham gia" variant="primary" icon="checkmark" loading={busy === `inv${inv.id}`} onPress={() => { void acceptInvitation(inv); }} />
              <SmallButton title="Từ chối" onPress={() => { void declineInvitation(inv); }} disabled={busy === `inv${inv.id}`} />
            </View>
          </Card>
        ))}
      </>}

      {data.incoming_requests.length > 0 && (
        <Pressable onPress={() => nav.openFriends?.('requests')} accessibilityRole="button">
          <Card style={styles.requests}>
            <Ionicons name="person-add-outline" size={20} color={t.accent} />
            <Text style={[styles.flex, styles.requestText]}>{data.incoming_requests.length} lời mời kết bạn đang chờ bạn</Text>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Card>
        </Pressable>
      )}

      {otherRooms.length > 0 && <>
        <SectionHeader title="Phòng của bạn bè" />
        {otherRooms.map((room) => (
          <Card key={room.id}>
            <Text style={styles.cardTitle}>{room.name}</Text>
            <Text style={styles.sub}>Chủ phòng {room.host?.display_name} · {room.state === 'in_session' ? 'Đang học' : 'Đang chờ'} · {room.member_count}/{room.max_members}</Text>
            <SmallButton title={room.can_join ? 'Tham gia' : 'Đã đủ người'} variant="primary" icon="enter-outline" disabled={!room.can_join}
              loading={busy === `room${room.id}`} onPress={() => { void joinRoom(room); }} />
          </Card>
        ))}
      </>}

      <SectionHeader title="Bạn bè" action={{ label: 'Xem tất cả', onPress: () => nav.openFriends?.('friends') }} />
      <Card>
        {data.friends.length === 0
          ? <EmptyState icon="people-outline" title="Chưa có bạn học" body="Tìm bạn bằng tên hoặc mã kết bạn để cùng học nhé."
            action={<SmallButton title="Tìm bạn" icon="search" onPress={() => nav.openFriends?.('search')} />} />
          : data.friends.slice(0, 5).map((f) => <PersonRow key={f.id} user={f} subtitle={<PresenceLabel presence={f.presence} />} />)}
      </Card>

      <SectionHeader title="Nhiệm vụ nhóm" action={{ label: 'Tất cả', onPress: () => nav.push({ name: 'quests' }) }} />
      <Card>
        {data.team_quests.length === 0
          ? <EmptyState icon="flag-outline" title="Chưa có nhiệm vụ nhóm" body="Chủ phòng có thể tạo nhiệm vụ chung trong phòng học." />
          : data.team_quests.slice(0, 3).map((q) => (
            <Pressable key={q.id} onPress={() => nav.push({ name: 'quest', questId: q.id })} accessibilityRole="button" style={styles.quest}>
              <Text style={styles.questTitle}>{q.title}</Text>
              <ProgressBar value={q.progress / q.target} />
              <Text style={styles.sub}>{q.progress}/{q.target} {q.unit === 'minutes' ? 'phút' : 'chu kỳ'} · {q.room_name}</Text>
            </Pressable>
          ))}
      </Card>

      <SectionHeader title="Phiên học gần đây" />
      <Card>
        {data.recent_sessions.length === 0
          ? <EmptyState icon="time-outline" title="Chưa có phiên học nhóm" body="Kết quả các phiên học cùng bạn bè sẽ hiện ở đây." />
          : data.recent_sessions.map((h) => (
            <Pressable key={h.id} onPress={() => nav.push({ name: 'summary', sessionId: h.id })} style={styles.history} accessibilityRole="button"
              accessibilityLabel={`${h.room_name}, ${formatMinutes(h.focus_seconds)}, ${h.exp_awarded} EXP`}>
              <View style={styles.flex}>
                <Text style={styles.questTitle} numberOfLines={1}>{h.room_name}</Text>
                <Text style={styles.sub}>{formatMinutes(h.focus_seconds)} · {h.cycles_completed} chu kỳ · {h.participant_count} người</Text>
              </View>
              <Text style={styles.exp}>+{h.exp_awarded} EXP</Text>
            </Pressable>
          ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  hello: { fontSize: 24, fontWeight: '900', color: t.ink },
  sub: { fontSize: 13, color: t.muted, lineHeight: 19 },
  bell: { width: 46, height: 46, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 5, right: 5, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.danger,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.hero },
  heroTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  heroCode: { fontSize: 13, fontWeight: '800', color: t.accent, marginTop: 4, letterSpacing: 0.5 },
  current: { borderWidth: 2, borderColor: '#A9D6EE' },
  cardLabel: { fontSize: 12, fontWeight: '800', color: t.accent, textTransform: 'uppercase' },
  cardTitle: { fontSize: 17, fontWeight: '900', color: t.ink, marginBottom: 2 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  rowButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  warn: { color: t.danger, fontSize: 13, fontWeight: '700', marginTop: 4 },
  requests: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  requestText: { fontSize: 15, fontWeight: '800', color: t.ink },
  quest: { paddingVertical: 8, gap: 6 },
  questTitle: { fontSize: 15, fontWeight: '800', color: t.ink },
  history: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minHeight: 52 },
  exp: { fontSize: 14, fontWeight: '900', color: t.success },
});
