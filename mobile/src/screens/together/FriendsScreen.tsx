import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text, TextInput } from '../../components/Typography';
import { parseFriendCode } from '../../room/visit';
import { togetherApi } from '../../studyTogether/api';
import type { CodeLookup, Friend, FriendRequest, SearchResult, SocialSettings } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Card, ScreenHeader, SectionHeader } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { showError } from '../main/shared';
import { FriendCode, FriendDirectory, ProfileCard, QrScannerSheet } from './friendsUi';
import { REPORT_REASONS } from './labels';
import { usePullToRefresh } from './navigation';
import {
  BackHeader, EmptyState, ErrorState, LoadingState, OptionRow, OptionSheet, PersonRow, PetAvatar, SmallButton, ToggleRow,
} from './ui';

/** Where a shortcut points inside the friends screen. Everything is on one screen; 'search' focuses the code box. */
export type FriendsTab = 'friends' | 'requests' | 'search';

type Props = {
  initialTab?: FriendsTab;
  /** Shows a header with a back button (when shown as a screen of its own). */
  onBack?: () => void;
  /** Opens a friend's pet room (read only). */
  onVisit: (userId: number) => void;
  /** Opens a friend's garden ("Thăm vườn" in their menu). */
  onVisitGarden?: (userId: number) => void;
  /** Opens a study room in Study Together (a friend's open room, after joining it). */
  onOpenStudyRoom?: (roomId: number) => void;
  /** A friend request was accepted, declined or withdrawn (the Home badge counts the pending ones). */
  onRequestsChanged?: () => void;
};

/** Incoming requests shown before "Xem tất cả". */
const REQUESTS_SHOWN = 3;

/**
 * The "Bạn bè" screen, one scroll without tabs: header with Cài đặt, add a friend by code (search, QR, "Mã của tôi"),
 * incoming requests (hidden when there are none), sent requests folded into one row, then the friend list.
 */
export function FriendsScreen({ initialTab = 'friends', onBack, onVisit, onVisitGarden, onOpenStudyRoom, onRequestsChanged }: Props) {
  const confirm = useConfirm();
  const toast = useToast();
  const [settings, setSettings] = useState<SocialSettings | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [friendsError, setFriendsError] = useState<unknown>(null);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [requestsError, setRequestsError] = useState<unknown>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [sheet, setSheet] = useState<'settings' | 'code' | 'incoming' | 'outgoing' | null>(null);
  const [menuFor, setMenuFor] = useState<Friend | null>(null);
  const [reportFor, setReportFor] = useState<Friend | null>(null);

  const loadFriends = useCallback(async () => {
    try { setFriends(await togetherApi.friends()); setFriendsError(null); } catch (e) { setFriendsError(e); }
  }, []);
  const loadRequests = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([togetherApi.requests('incoming'), togetherApi.requests('outgoing')]);
      setIncoming(a); setOutgoing(b); setRequestsError(null);
    } catch (e) { setRequestsError(e); }
  }, []);
  const loadSettings = useCallback(async () => {
    try { setSettings(await togetherApi.socialSettings()); } catch { /* Cài đặt and "Mã của tôi" wait for the next refresh */ }
  }, []);
  const loadAll = useCallback(async () => { await Promise.all([loadFriends(), loadRequests(), loadSettings()]); }, [loadFriends, loadRequests, loadSettings]);
  useEffect(() => { void loadAll(); }, [loadAll]);
  usePullToRefresh(loadAll);

  async function answer(id: number, call: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try { await call(); if (done) toast(done, 'success'); onRequestsChanged?.(); await Promise.all([loadRequests(), loadFriends()]); }
    catch (e) { showError('Không thể cập nhật lời mời', e); } finally { setBusy(null); }
  }
  const accept = (r: FriendRequest) => { void answer(r.id, () => togetherApi.acceptRequest(r.id), 'Hai bạn đã là bạn bè!'); };
  const decline = (r: FriendRequest) => { void answer(r.id, () => togetherApi.declineRequest(r.id)); };
  const cancel = (r: FriendRequest) => { void answer(r.id, () => togetherApi.cancelRequest(r.id)); };

  async function remove(friend: Friend) {
    setMenuFor(null);
    if (!await confirm({ title: 'Hủy kết bạn?', message: `Bạn và ${friend.display_name} sẽ không còn là bạn bè, không ghé phòng nhau được nữa và lời mời học đang chờ sẽ bị hủy.`,
      confirmLabel: 'Hủy kết bạn', destructive: true })) return;
    try { await togetherApi.removeFriend(friend.id); await loadFriends(); } catch (e) { showError('Không thể hủy kết bạn', e); }
  }
  async function block(friend: Friend) {
    setMenuFor(null);
    if (!await confirm({ title: `Chặn ${friend.display_name}?`, message: 'Hai bạn sẽ không tìm thấy, kết bạn, ghé phòng hay mời nhau học được nữa.', confirmLabel: 'Chặn', destructive: true, icon: 'ban-outline' })) return;
    try { await togetherApi.block(friend.id); toast('Đã chặn người dùng.'); await loadFriends(); } catch (e) { showError('Không thể chặn', e); }
  }
  async function report(reason: string) {
    const target = reportFor;
    setReportFor(null);
    if (!target) return;
    try { await togetherApi.report(target.id, reason); toast('Cảm ơn bạn, Mirabi sẽ xem xét báo cáo này.', 'success'); }
    catch (e) { showError('Không gửi được báo cáo', e); }
  }
  async function updateSettings(patch: Parameters<typeof togetherApi.updateSocialSettings>[0]) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    try { setSettings(await togetherApi.updateSocialSettings(patch)); } catch (e) { setSettings(settings); showError('Không lưu được cài đặt', e); }
  }

  const settingsButton = (
    <Pressable onPress={() => setSheet('settings')} disabled={!settings} hitSlop={6} accessibilityRole="button" accessibilityLabel="Cài đặt"
      accessibilityState={{ disabled: !settings }} style={({ pressed }) => [styles.gear, pressed && styles.pressed]}>
      <Ionicons name="settings-outline" size={22} color={t.ink} />
    </Pressable>
  );
  const requestRow = (r: FriendRequest) => (
    <RequestRow key={r.id} request={r} busy={busy === r.id} onAccept={() => accept(r)} onDecline={() => decline(r)} />
  );

  return (
    <>
      {onBack ? <BackHeader title="Bạn bè" onBack={onBack} right={settingsButton} /> : <ScreenHeader title="Bạn bè" right={settingsButton} />}

      <AddFriend autoFocus={initialTab === 'search'} hasCode={!!settings?.public_code} onMyCode={() => setSheet('code')}
        onSent={() => { void loadRequests(); }} onFriend={() => { void loadFriends(); }} />

      {incoming.length > 0 && <>
        <SectionHeader title={`Lời mời kết bạn (${incoming.length})`}
          action={incoming.length > REQUESTS_SHOWN ? { label: 'Xem tất cả', onPress: () => setSheet('incoming') } : undefined} />
        <Card style={styles.listCard}>{incoming.slice(0, REQUESTS_SHOWN).map(requestRow)}</Card>
      </>}
      {requestsError && incoming.length === 0 && outgoing.length === 0
        ? <Card><ErrorState error={requestsError} onRetry={() => { void loadRequests(); }} /></Card> : null}

      {outgoing.length > 0 && (
        <Pressable onPress={() => setSheet('outgoing')} accessibilityRole="button" accessibilityLabel={`Đã gửi, ${outgoing.length} lời mời đang chờ`}
          style={({ pressed }) => [styles.sentRow, pressed && styles.pressed]}>
          <Ionicons name="paper-plane-outline" size={20} color={t.accent} />
          <Text style={styles.sentLabel}>Đã gửi</Text>
          <View style={styles.count}><Text style={styles.countText}>{outgoing.length}</Text></View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      )}

      <SectionHeader title={friends && friends.length > 0 ? `Bạn bè (${friends.length})` : 'Bạn bè'} />
      <FriendDirectory friends={friends} error={friendsError} onRetry={() => { setFriendsError(null); void loadFriends(); }}
        onVisit={(f) => onVisit(f.id)} onMenu={setMenuFor} />


      <OptionSheet visible={sheet === 'settings'} title="Cài đặt" onClose={() => setSheet(null)}>
        {settings ? <ScrollView>
          <ToggleRow label="Cho bạn bè ghé thăm phòng" description="Chỉ bạn bè đã kết bạn mới ghé phòng và vườn được. Tắt để không ai ghé phòng và vườn của bạn."
            value={settings.allow_room_visits} onChange={(v) => { void updateSettings({ allow_room_visits: v }); }} />
          <ToggleRow label="Nhận lời mời học" description="Bạn bè có thể rủ bạn vào phòng học nhóm."
            value={settings.allow_study_invites} onChange={(v) => { void updateSettings({ allow_study_invites: v }); }} />
          <ToggleRow label="Cho bạn bè thấy trạng thái" description="Trực tuyến hoặc đang học. Tắt để luôn hiện “Ẩn trạng thái”."
            value={settings.presence_visibility === 'friends'} onChange={(v) => { void updateSettings({ presence_visibility: v ? 'friends' : 'nobody' }); }} />
          <ToggleRow label="Chia sẻ số phút học trong phòng" description="Thành viên khác thấy số phút và đóng góp nhiệm vụ của bạn."
            value={settings.share_study_stats} onChange={(v) => { void updateSettings({ share_study_stats: v }); }} />
          <ToggleRow label="Cho phép tìm theo tên" description="Khi tắt, người khác chỉ tìm được bạn bằng mã kết bạn."
            value={settings.discoverable} onChange={(v) => { void updateSettings({ discoverable: v }); }} />
        </ScrollView> : <LoadingState />}
      </OptionSheet>
      <OptionSheet visible={sheet === 'code'} title="Mã của tôi" onClose={() => setSheet(null)}>
        {settings?.public_code ? <FriendCode code={settings.public_code} /> : <LoadingState />}
      </OptionSheet>
      <OptionSheet visible={sheet === 'incoming'} title={`Lời mời kết bạn (${incoming.length})`} onClose={() => setSheet(null)}>
        <ScrollView>{incoming.length === 0 ? <EmptyState icon="mail-open-outline" title="Không có lời mời mới" /> : incoming.map(requestRow)}</ScrollView>
      </OptionSheet>
      <OptionSheet visible={sheet === 'outgoing'} title={`Lời mời đã gửi (${outgoing.length})`} onClose={() => setSheet(null)}>
        <ScrollView>
          {outgoing.length === 0 ? <EmptyState icon="paper-plane-outline" title="Bạn chưa gửi lời mời nào" /> : outgoing.map((r) => (
            <PersonRow key={r.id} user={r.user} subtitle="Đang chờ phản hồi"
              right={<SmallButton title="Hủy lời mời" loading={busy === r.id} onPress={() => cancel(r)} />} />
          ))}
        </ScrollView>
      </OptionSheet>
      <OptionSheet visible={!!menuFor} title={menuFor?.display_name ?? ''} onClose={() => setMenuFor(null)}>
        {menuFor?.room && onOpenStudyRoom ? <OptionRow icon="enter-outline" label="Vào phòng học của bạn ấy" onPress={() => {
          const roomId = menuFor.room!.id; setMenuFor(null);
          void togetherApi.joinRoom(roomId).then(() => onOpenStudyRoom(roomId)).catch((e) => showError('Không thể tham gia phòng', e));
        }} /> : null}
        {menuFor && onVisitGarden ? <OptionRow icon="leaf-outline" label="Thăm vườn"
          description={menuFor.can_visit ? 'Xem vườn, tưới nước và chăm cây giúp bạn ấy' : 'Bạn ấy đang tắt ghé thăm'}
          onPress={() => { const friend = menuFor; setMenuFor(null); if (friend.can_visit) onVisitGarden(friend.id); else toast(`${friend.display_name} đang tắt ghé thăm.`); }} /> : null}
        <OptionRow icon="person-remove-outline" label="Hủy kết bạn" onPress={() => { if (menuFor) void remove(menuFor); }} />
        <OptionRow icon="ban-outline" label="Chặn" onPress={() => { if (menuFor) void block(menuFor); }} />
        <OptionRow icon="flag-outline" label="Báo cáo" onPress={() => { setReportFor(menuFor); setMenuFor(null); }} />
      </OptionSheet>
      <OptionSheet visible={!!reportFor} title="Lý do báo cáo" onClose={() => setReportFor(null)}>
        {REPORT_REASONS.map((r) => <OptionRow key={r.id} label={r.label} onPress={() => { void report(r.id); }} />)}
      </OptionSheet>
    </>
  );
}

/** An incoming request: the buttons sit under the name so long names still fit on small screens. */
function RequestRow({ request, busy, onAccept, onDecline }: { request: FriendRequest; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <View style={styles.request}>
      <PetAvatar user={request.user} size={46} />
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>{request.user.display_name}</Text>
        <Text style={styles.sub} numberOfLines={1}>muốn kết bạn với bạn</Text>
        <View style={styles.actions}>
          <SmallButton title="Chấp nhận" variant="primary" loading={busy} onPress={onAccept} />
          <SmallButton title="Từ chối" disabled={busy} onPress={onDecline} />
        </View>
      </View>
    </View>
  );
}

/** Find someone by their exact code (typed or scanned) or by name, see their short profile, then ask with "Kết bạn". */
function AddFriend({ autoFocus, hasCode, onMyCode, onSent, onFriend }: {
  autoFocus: boolean; hasCode: boolean; onMyCode: () => void; onSent: () => void; onFriend: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [found, setFound] = useState<CodeLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const sequence = useRef(0);
  const toast = useToast();

  function clear() { ++sequence.current; setFound(null); setResults(null); setError(null); setSearching(false); }

  const lookup = useCallback(async (code: string) => {
    const id = ++sequence.current;
    setError(null); setResults(null); setSearching(true);
    try {
      const person = await togetherApi.lookupFriend(code);
      if (id === sequence.current) setFound(person);
    } catch (e) { if (id === sequence.current) { setFound(null); setError(errorMessage(e)); } }
    finally { if (id === sequence.current) setSearching(false); }
  }, []);

  const search = useCallback(async () => {
    const q = query.trim();
    const code = parseFriendCode(q);
    if (code) { await lookup(code); return; }
    if (q.length < 2) { setError('Hãy nhập mã kết bạn hoặc ít nhất 2 ký tự của tên.'); return; }
    const id = ++sequence.current;
    setError(null); setFound(null); setSearching(true);
    try {
      const list = await togetherApi.search(q);
      if (id === sequence.current) setResults(list);
    } catch (e) { if (id === sequence.current) setError(errorMessage(e)); }
    finally { if (id === sequence.current) setSearching(false); }
  }, [query, lookup]);

  async function add(target: { id: number; display_name: string }) {
    setBusy(target.id);
    try {
      const sent = await togetherApi.sendRequest({ user_id: target.id });
      toast(sent.auto_accepted ? `Bạn và ${target.display_name} đã là bạn bè!` : 'Đã gửi lời mời kết bạn.', 'success');
      const relationship = sent.auto_accepted ? 'friend' as const : 'outgoing' as const;
      setResults((list) => list?.map((x) => x.id === target.id ? { ...x, relationship, request_id: sent.id } : x) ?? null);
      setFound((p) => (p && p.id === target.id ? { ...p, relationship, request_id: sent.id } : p));
      if (sent.auto_accepted) onFriend(); else onSent();
    } catch (e) { showError('Không gửi được lời mời', e); } finally { setBusy(null); }
  }
  // Their request is already in "Lời mời kết bạn" just below; close the preview so it shows.
  const answer = () => { setQuery(''); clear(); };

  return (
    <>
      <View style={styles.addBar}>
        <View style={[styles.codeBox, !!error && styles.codeBoxError]}>
          <Ionicons name="person-add-outline" size={18} color={t.muted} />
          <TextInput value={query} onChangeText={(v) => { setQuery(v); if (!v.trim()) clear(); }} placeholder="Nhập mã để thêm bạn"
            placeholderTextColor="#7F95A8" style={styles.codeInput} accessibilityLabel="Nhập mã để thêm bạn" autoFocus={autoFocus}
            autoCapitalize="characters" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => { void search(); }} maxLength={40} />
        </View>
        <IconButton icon="search" label="Tìm" primary loading={searching} onPress={() => { void search(); }} />
        <IconButton icon="scan-outline" label="Quét mã QR" onPress={() => setScan(true)} />
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {hasCode ? (
        <Pressable onPress={onMyCode} hitSlop={6} accessibilityRole="button" accessibilityLabel="Mã của tôi"
          style={({ pressed }) => [styles.myCode, pressed && styles.pressed]}>
          <Ionicons name="qr-code-outline" size={16} color={t.accent} />
          <Text style={styles.myCodeText}>Mã của tôi</Text>
        </Pressable>
      ) : null}

      {found ? <ProfileCard person={found} busy={busy === found.id} onAdd={() => { void add(found); }} onAnswer={answer} /> : null}
      {results && <Card style={styles.listCard}>
        {results.length === 0 ? <EmptyState icon="search-outline" title="Không tìm thấy ai" body="Hãy thử mã kết bạn chính xác." /> : results.map((r) => (
          <PersonRow key={r.id} user={r} subtitle={r.pet_name ? `Pet ${r.pet_name} · Cấp ${r.pet_level}` : undefined}
            right={r.relationship === 'friend' ? <SmallButton title="Bạn bè" icon="checkmark" disabled onPress={() => {}} />
              : r.relationship === 'outgoing' ? <SmallButton title="Đã gửi" disabled onPress={() => {}} />
                : r.relationship === 'incoming' ? <SmallButton title="Trả lời" variant="primary" onPress={answer} />
                  : <SmallButton title="Kết bạn" variant="primary" icon="person-add-outline" loading={busy === r.id} onPress={() => { void add(r); }} />} />
        ))}
      </Card>}
      <QrScannerSheet visible={scan} onClose={() => setScan(false)} onCode={(code) => { setScan(false); setQuery(code); void lookup(code); }} />
    </>
  );
}

/** A 48pt square button with only an icon; the label is for screen readers. */
function IconButton({ icon, label, primary, loading, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; primary?: boolean; loading?: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={loading} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy: !!loading }}
      style={({ pressed }) => [styles.iconButton, primary && styles.iconButtonPrimary, (pressed || loading) && styles.pressed]}>
      <Ionicons name={icon} size={20} color={primary ? '#FFFFFF' : t.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  gear: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  addBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeBox: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingHorizontal: 14, minHeight: 48, borderWidth: 1, borderColor: 'transparent' },
  codeBoxError: { borderColor: t.danger },
  codeInput: { flex: 1, minWidth: 0, fontSize: 15, color: t.ink, paddingVertical: 10 },
  iconButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  iconButtonPrimary: { backgroundColor: t.accent },
  error: { fontSize: 13, color: t.danger, marginTop: 6, marginLeft: 4 },
  myCode: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 4, marginTop: 4, marginBottom: 6 },
  myCodeText: { fontSize: 14, fontWeight: '800', color: t.accent },
  listCard: { paddingHorizontal: 14, paddingVertical: 8 },
  request: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  name: { fontSize: 15, fontWeight: '800', color: t.ink },
  sub: { fontSize: 12, color: t.muted, marginTop: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.card, borderRadius: 18, paddingHorizontal: 16, minHeight: 52, marginBottom: 6 },
  sentLabel: { flex: 1, fontSize: 15, fontWeight: '800', color: t.ink },
  count: { minWidth: 26, height: 22, borderRadius: 11, paddingHorizontal: 7, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '900', color: t.accent },
});
