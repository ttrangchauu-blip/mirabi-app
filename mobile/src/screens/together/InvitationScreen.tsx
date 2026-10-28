import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError } from '../../api/client';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { InvitationState, RoomInvitation } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { showError } from '../main/shared';
import { subjectLabel } from './labels';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { BackHeader, ErrorState, LoadingState, PersonRow } from './ui';

const STATE: Record<Exclude<InvitationState, 'pending'>, { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }> = {
  expired: { icon: 'time-outline', text: 'Lời mời đã hết hạn.' },
  room_closed: { icon: 'lock-closed-outline', text: 'Phòng học này đã đóng.' },
  accepted: { icon: 'checkmark-circle-outline', text: 'Bạn đã tham gia lời mời này.' },
  declined: { icon: 'close-circle-outline', text: 'Bạn đã từ chối lời mời này.' },
  cancelled: { icon: 'remove-circle-outline', text: 'Lời mời không còn hiệu lực.' },
};

function untilLabel(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (minutes <= 0) return 'sắp hết hạn';
  if (minutes < 60) return `còn ${minutes} phút`;
  return `còn ${Math.round(minutes / 60)} giờ`;
}

/** One study invitation, opened from a notification: who, which room, which rhythm, and whether it can still be joined. */
export function InvitationScreen({ invitationId }: { invitationId: number }) {
  const nav = useTogetherNav();
  const [invitation, setInvitation] = useState<RoomInvitation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'join' | 'decline' | null>(null);

  const load = useCallback(async () => {
    try { setInvitation(await togetherApi.invitation(invitationId)); setError(null); } catch (e) { setError(e); }
  }, [invitationId]);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);

  async function join() {
    setBusy('join');
    try {
      // The backend checks again: still friends, still open, not expired, a free seat.
      const { room } = await togetherApi.acceptInvitation(invitationId);
      nav.replace({ name: 'room', roomId: room.id, initial: room });
    } catch (e) {
      showError('Không thể tham gia phòng', e);
      await load(); // show why (closed, expired, withdrawn)
    } finally { setBusy(null); }
  }
  async function decline() {
    setBusy('decline');
    try { await togetherApi.declineInvitation(invitationId); await load(); } catch (e) { showError('Không thể từ chối lời mời', e); }
    finally { setBusy(null); }
  }

  const header = <BackHeader title="Lời mời học" onBack={nav.back} />;
  if (!invitation) {
    if (error instanceof ApiError && error.status === 404) {
      return <>{header}<Card><Text style={styles.gone}>{errorMessage(error)}</Text></Card></>;
    }
    return <>{header}{error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />}</>;
  }
  const { room, state } = invitation;
  const full = state === 'pending' && !room.can_join && room.reason === 'room_full';
  const closed = state !== 'pending' ? STATE[state] : full ? { icon: 'people-outline' as const, text: 'Phòng đã đủ người.' } : null;

  return (
    <>
      {header}
      <Card>
        <PersonRow user={invitation.inviter} subtitle="rủ bạn cùng học" />
        <Text style={styles.room}>{room.name}</Text>
        <View style={styles.facts}>
          <Fact icon="book-outline" text={subjectLabel(room.subject)} />
          <Fact icon="timer-outline" text={`${room.focus_minutes} phút tập trung · nghỉ ${room.break_minutes} phút`} />
          <Fact icon="repeat-outline" text={`${room.cycles} lượt`} />
          <Fact icon="people-outline" text={`${room.member_count}/${room.max_members} thành viên`} />
          {state === 'pending' ? <Fact icon="hourglass-outline" text={`Lời mời ${untilLabel(invitation.expires_at)}`} /> : null}
        </View>
        {closed ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Ionicons name={closed.icon} size={18} color={t.muted} />
            <Text style={styles.bannerText}>{closed.text}</Text>
          </View>
        ) : (
          <View style={styles.buttons}>
            <Button title="Tham gia" icon="enter-outline" loading={busy === 'join'} disabled={busy !== null} onPress={() => { void join(); }} style={styles.flex} />
            <Button title="Từ chối" variant="secondary" loading={busy === 'decline'} disabled={busy !== null} onPress={() => { void decline(); }} style={styles.flex} />
          </View>
        )}
      </Card>
    </>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={t.accent} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gone: { fontSize: 14, color: t.muted, textAlign: 'center', paddingVertical: 12 },
  room: { fontSize: 18, fontWeight: '900', color: t.ink, marginTop: 8 },
  facts: { gap: 6, marginTop: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factText: { fontSize: 14, color: t.ink, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: t.bg },
  bannerText: { flex: 1, fontSize: 14, fontWeight: '700', color: t.muted },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
});
