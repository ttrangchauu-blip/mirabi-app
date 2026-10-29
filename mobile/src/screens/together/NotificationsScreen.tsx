import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { NotificationKind, SocialNotification } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Card, IconCircle, IconName } from '../../ui/kit';
import { Route, usePullToRefresh, useTogetherNav } from './navigation';
import { BackHeader, EmptyState, ErrorState, LoadingState, SmallButton } from './ui';

const ICONS: Record<NotificationKind, IconName> = {
  friend_request: 'person-add-outline', friend_accepted: 'people-outline', room_invitation: 'mail-outline',
  session_started: 'play-circle-outline', session_completed: 'trophy-outline', team_quest_completed: 'flag-outline',
  room_visit: 'home-outline', garden_care: 'leaf-outline',
};
const iconFor = (n: SocialNotification): IconName => (n.kind === 'room_visit' && n.data.action === 'cheer' ? 'heart-outline'
  : n.kind === 'room_visit' && n.data.action === 'hello' ? 'hand-left-outline' : ICONS[n.kind] ?? 'notifications-outline');

/** Where tapping a notification leads inside Study Together. Friend requests open Community → Bạn bè and a greeting or
 * cheer opens the sender's room instead (see `open`). */
export function routeFor(n: SocialNotification): Route {
  switch (n.kind) {
    case 'room_invitation': return n.data.invitation_id ? { name: 'invitation', invitationId: n.data.invitation_id } : { name: 'home' };
    case 'session_started': return n.data.room_id ? { name: 'room', roomId: n.data.room_id } : { name: 'home' };
    case 'session_completed': return n.data.session_id ? { name: 'summary', sessionId: n.data.session_id } : { name: 'home' };
    case 'team_quest_completed': return n.data.quest_id ? { name: 'quest', questId: n.data.quest_id } : { name: 'quests' };
    default: return { name: 'home' };
  }
}

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} giờ trước`;
  return `${Math.round(minutes / 1440)} ngày trước`;
}

export function NotificationsScreen() {
  const nav = useTogetherNav();
  const [items, setItems] = useState<SocialNotification[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try { setItems((await togetherApi.notifications()).items); setError(null); } catch (e) { setError(e); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  usePullToRefresh(load);
  // New ones arrive live; a merged greeting replaces the unread one it grew from.
  useEffect(() => nav.realtime.onMessage((m) => {
    if (m.type !== 'notification') return;
    setItems((list) => (list ? [m.notification, ...list.filter((x) => x.id !== m.notification.id && x.id !== m.replaces)] : list));
  }), [nav.realtime]);

  async function open(n: SocialNotification) {
    if (!n.read) void togetherApi.markRead(n.id).catch(() => {});
    setItems((list) => list?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null);
    // "Chào pet" or "Động viên": visit back the friend who sent it.
    if (n.kind === 'room_visit' && n.data.user_id && nav.visitRoom) { nav.visitRoom(n.data.user_id); return; }
    // A friend cared for the garden: see it (who watered and tended what today).
    if (n.kind === 'garden_care' && nav.openGarden) { nav.openGarden(); return; }
    if ((n.kind === 'friend_request' || n.kind === 'friend_accepted') && nav.openFriends) {
      nav.openFriends(n.kind === 'friend_request' ? 'requests' : 'friends'); return;
    }
    const target = routeFor(n);
    if (target.name === 'home') nav.home(); else nav.replace(target);
  }
  async function readAll() {
    await togetherApi.markAllRead().catch(() => {});
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
  }

  return (
    <>
      <BackHeader title="Thông báo" onBack={nav.back}
        right={items?.some((n) => !n.read) ? <SmallButton title="Đọc hết" icon="checkmark-done" onPress={() => { void readAll(); }} /> : undefined} />
      {!items ? (error ? <ErrorState error={error} onRetry={load} /> : <LoadingState />) : items.length === 0 ? (
        <Card><EmptyState icon="notifications-outline" title="Chưa có thông báo" body="Lời mời, lời chào, lời động viên và kết quả học nhóm sẽ xuất hiện ở đây." /></Card>
      ) : (
        <Card>
          {items.map((n) => (
            <Pressable key={n.id} onPress={() => { void open(n); }} style={styles.row} accessibilityRole="button"
              accessibilityLabel={`${n.read ? '' : 'Chưa đọc. '}${n.title}. ${n.body}`}>
              <IconCircle name={iconFor(n)} size={40} />
              <View style={styles.flex}>
                <Text style={[styles.title, !n.read && styles.unread]}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.time}>{ago(n.created_at)}</Text>
              </View>
              {!n.read ? <View style={styles.dot} /> : null}
            </Pressable>
          ))}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  title: { fontSize: 15, fontWeight: '700', color: t.ink },
  unread: { fontWeight: '900' },
  body: { fontSize: 13, color: t.muted, lineHeight: 19, marginTop: 2 },
  time: { fontSize: 11, color: t.muted, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent, marginTop: 6 },
});
