import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text, TextInput } from '../../components/Typography';
import { friendQrPayload, parseFriendCode, qrPath } from '../../room/visit';
import type { CodeLookup, Friend } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { EmptyState, ErrorState, LoadingState, OptionSheet, PetAvatar, PresenceLabel, SmallButton } from './ui';

/** Case- and accent-insensitive, so "linh" finds "Lĩnh" and "dao" finds "Đào". */
export function foldName(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

// ------------------------------------------------------------------------------------------------ my code and QR
export function FriendQr({ code, size = 176 }: { code: string; size?: number }) {
  const qr = useMemo(() => qrPath(friendQrPayload(code)), [code]);
  const quiet = 3;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Mã QR kết bạn ${code}`} testID="friend-qr">
      <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${qr.size + quiet * 2} ${qr.size + quiet * 2}`}>
        <Rect x={-quiet} y={-quiet} width={qr.size + quiet * 2} height={qr.size + quiet * 2} fill="#FFFFFF" />
        <Path d={qr.d} fill={t.ink} />
      </Svg>
    </View>
  );
}

/** The user's own friend code and QR code, to show a friend, copy or share ("Mã của tôi"). */
export function FriendCode({ code }: { code: string }) {
  const toast = useToast();
  const spaced = `${code.slice(0, 4)} ${code.slice(4)}`;
  async function copy() {
    try { await Clipboard.setStringAsync(code); toast('Đã sao chép mã kết bạn.', 'success'); }
    catch { toast('Không sao chép được, hãy giữ vào mã để chọn.'); }
  }
  return (
    <View style={s.codeCard}>
      <View style={s.qrFrame}><FriendQr code={code} /></View>
      <Text style={s.code} selectable accessibilityLabel={`Mã kết bạn ${code.split('').join(' ')}`}>{spaced}</Text>
      <Text style={s.codeHint}>Bạn bè quét mã QR này hoặc nhập mã để gửi lời mời kết bạn.</Text>
      <View style={s.codeActions}>
        <SmallButton title="Sao chép" icon="copy-outline" onPress={() => { void copy(); }} />
        <SmallButton title="Chia sẻ mã" icon="share-outline" variant="primary"
          onPress={() => { void Share.share({ message: `Kết bạn với mình trên Mirabi để cùng học nhé! Mã kết bạn: ${code}` }); }} />
      </View>
    </View>
  );
}

/** Reads a friend QR code with the camera; hands back the friend code. Web browsers without a camera get a note. */
export function QrScannerSheet({ visible, onClose, onCode }: { visible: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [wrong, setWrong] = useState(false);
  const handled = useRef(false);
  useEffect(() => { if (visible) { handled.current = false; setWrong(false); } }, [visible]);

  function scanned(data: string) {
    if (handled.current) return; // the camera reports the same code many times a second
    const code = parseFriendCode(data);
    if (!code) { setWrong(true); return; }
    handled.current = true;
    setWrong(false);
    onCode(code);
  }

  return (
    <OptionSheet visible={visible} title="Quét mã QR kết bạn" onClose={onClose}>
      {!permission ? <LoadingState label="Đang mở camera…" />
        : !permission.granted ? (
          <View style={s.scanState}>
            <Ionicons name="camera-outline" size={36} color={t.muted} />
            <Text style={s.scanText}>{permission.canAskAgain
              ? 'Mirabi cần quyền dùng camera để quét mã QR của bạn bè.'
              : 'Quyền camera đang tắt. Hãy bật lại trong Cài đặt của máy, hoặc nhập mã kết bạn.'}</Text>
            {permission.canAskAgain ? <Button title="Cho phép dùng camera" icon="camera-outline" onPress={() => { void requestPermission(); }} /> : null}
          </View>
        ) : (
          <>
            <View style={s.camera}>
              {visible ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => scanned(data)} /> : null}
              <View pointerEvents="none" style={s.viewfinder} />
            </View>
            <Text style={[s.scanText, wrong && s.scanWrong]} accessibilityLiveRegion="polite">
              {wrong ? 'Đây không phải mã QR kết bạn của Mirabi.'
                : Platform.OS === 'web' ? 'Đưa mã QR vào khung. Nếu trình duyệt không quét được, hãy nhập mã kết bạn.' : 'Đưa mã QR của bạn bè vào khung.'}
            </Text>
          </>
        )}
    </OptionSheet>
  );
}

// ------------------------------------------------------------------------------------------------ a person found by code
/** The short profile behind a friend code, with the next step (send, answer, already friends). Nothing is sent until "Kết bạn". */
export function ProfileCard({ person, busy, onAdd, onAnswer }: {
  person: CodeLookup; busy: boolean; onAdd: () => void; onAnswer: () => void;
}) {
  const r = person.relationship;
  return (
    <Card style={s.profile}>
      <PetAvatar user={person} size={84} />
      <Text style={s.profileName} numberOfLines={1}>{person.display_name}</Text>
      <Text style={s.profileSub} numberOfLines={1}>
        {person.pet_name ? `Pet đồng hành: ${person.pet_name} · Cấp ${person.pet_level}` : 'Chưa có pet đồng hành'}
      </Text>
      <View style={s.profileAction}>
        {r === 'self' ? <Text style={s.profileNote}>Đây là mã kết bạn của chính bạn.</Text>
          : r === 'friend' ? <SmallButton title="Đã là bạn bè" icon="checkmark" disabled onPress={() => {}} />
          : r === 'outgoing' ? <SmallButton title="Đã gửi lời mời" icon="time-outline" disabled onPress={() => {}} />
          : r === 'incoming' ? <SmallButton title="Trả lời lời mời" variant="primary" icon="mail-open-outline" onPress={onAnswer} />
          : <SmallButton title="Kết bạn" variant="primary" icon="person-add-outline" loading={busy} onPress={onAdd} />}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ friend list
function FriendRow({ friend, onVisit, onMenu, actionLabel = 'Ghé thăm' }: {
  friend: Friend; onVisit: (f: Friend) => void; onMenu?: (f: Friend) => void; actionLabel?: string;
}) {
  const pet = friend.pet_name ? `Pet ${friend.pet_name}` : 'Chưa có pet'; // the level shows in the avatar's art
  return (
    <View style={s.row} testID={`friend-${friend.id}`}>
      <PetAvatar user={friend} size={46} />
      <View style={s.flex}>
        <Text style={s.name} numberOfLines={1}>{friend.display_name}</Text>
        <Text style={s.sub} numberOfLines={1}>{friend.can_visit ? pet : `${pet} · Đang tắt ghé thăm`}</Text>
        <PresenceLabel presence={friend.presence} />
      </View>
      <SmallButton title={actionLabel} variant="primary" disabled={!friend.can_visit} onPress={() => onVisit(friend)} />
      {onMenu ? (
        <Pressable onPress={() => onMenu(friend)} hitSlop={8} style={s.more} accessibilityRole="button" accessibilityLabel={`Tùy chọn cho ${friend.display_name}`}>
          <Ionicons name="ellipsis-vertical" size={18} color={t.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Friend lists longer than this get a search by name. */
const SEARCH_FROM = 6;

/** Accepted friends with their pet and a "Ghé thăm" button (or `actionLabel`, e.g. "Thăm vườn"), searchable by name once the
 * list is long, with loading, error and empty states. */
export function FriendDirectory({ friends, error, onRetry, onVisit, onMenu, emptyAction, actionLabel, emptyBody }: {
  friends: Friend[] | null; error: unknown; onRetry: () => void; onVisit: (f: Friend) => void; onMenu?: (f: Friend) => void;
  emptyAction?: React.ReactNode; actionLabel?: string; emptyBody?: string;
}) {
  const [query, setQuery] = useState('');
  if (!friends) return error ? <ErrorState error={error} onRetry={onRetry} /> : <LoadingState label="Đang tải danh sách bạn bè…" />;
  if (friends.length === 0) {
    return <Card><EmptyState icon="people-outline" title="Chưa có bạn bè" body={emptyBody ?? 'Kết bạn bằng mã hoặc mã QR để ghé phòng và cùng học nhé.'} action={emptyAction} /></Card>;
  }
  const folded = foldName(query);
  const shown = folded ? friends.filter((f) => foldName(f.display_name).includes(folded)) : friends;
  return (
    <>
      {friends.length >= SEARCH_FROM || query ? <View style={s.search}>
        <Ionicons name="search" size={18} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Tìm bạn theo tên" placeholderTextColor="#7F95A8" style={s.searchInput}
          accessibilityLabel="Tìm bạn theo tên" autoCorrect={false} returnKeyType="search" maxLength={40} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm">
          <Ionicons name="close-circle" size={18} color={t.muted} />
        </Pressable> : null}
      </View> : null}
      <Card style={s.list}>
        {shown.length === 0
          ? <EmptyState icon="search-outline" title="Không tìm thấy bạn nào" body={`Không có bạn bè tên “${query.trim()}”.`} />
          : shown.map((f) => <FriendRow key={f.id} friend={f} onVisit={onVisit} onMenu={onMenu} actionLabel={actionLabel} />)}
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  codeCard: { alignItems: 'center', paddingBottom: 4 },
  qrFrame: { padding: 6, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.tint },
  code: { marginTop: 10, fontSize: 24, fontWeight: '900', color: t.accent, letterSpacing: 2 },
  codeHint: { marginTop: 4, fontSize: 12, color: t.muted, textAlign: 'center', lineHeight: 17 },
  codeActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  scanState: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  scanText: { fontSize: 13, color: t.muted, textAlign: 'center', lineHeight: 19, marginTop: 10 },
  scanWrong: { color: t.danger, fontWeight: '700' },
  camera: { height: 280, borderRadius: 22, overflow: 'hidden', backgroundColor: '#0A2438', alignItems: 'center', justifyContent: 'center' },
  viewfinder: { width: 190, height: 190, borderRadius: 22, borderWidth: 3, borderColor: '#FFFFFFCC' },
  profile: { alignItems: 'center', gap: 4 },
  profileName: { fontSize: 18, fontWeight: '900', color: t.ink, marginTop: 6 },
  profileSub: { fontSize: 13, color: t.muted },
  profileAction: { marginTop: 10 },
  profileNote: { fontSize: 13, color: t.muted, fontWeight: '700' },
  list: { paddingHorizontal: 14, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  name: { fontSize: 15, fontWeight: '800', color: t.ink },
  sub: { fontSize: 12, color: t.muted, marginTop: 1 },
  more: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, minHeight: 48, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 15, color: t.ink, paddingVertical: 10 },
});
