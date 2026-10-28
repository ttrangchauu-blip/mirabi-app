import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import { Text, TextInput } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { togetherApi } from '../../studyTogether/api';
import type { RoomSnapshot } from '../../studyTogether/types';
import type { ChatItem, useRoomChat } from '../../studyTogether/useRoomChat';
import { appTheme as t } from '../../theme';
import { AppModal } from '../../ui/AppModal';
import { useToast } from '../../ui/Toast';
import { focusTheme as fs } from '../main/focusSpaceTheme';
import { showError } from '../main/shared';
import { REPORT_REASONS, STATE_LABELS } from './labels';
import { PetAvatar } from './ui';

type Chat = ReturnType<typeof useRoomChat>;
type Props = { visible: boolean; onClose: () => void; room: RoomSnapshot; meId: number; chat: Chat };

const MAX_LENGTH = 500;
const GROUP_GAP_MS = 3 * 60 * 1000;
const SEPARATOR_GAP_MS = 15 * 60 * 1000;
const QUICK_REPLIES = ['Chào cả nhà 👋', 'Cố lên nào 💪', 'Nghỉ chút nhé ☕'];

const time = (iso: string) => new Date(iso).getTime();
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "14:05", "Hôm qua 14:05" or "21/10 14:05", for the separators between bursts of messages. */
export function separatorLabel(iso: string, now: Date = new Date()) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  return diff === 0 ? clock(d) : diff === 1 ? `Hôm qua ${clock(d)}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${clock(d)}`;
}

/** A short message made only of emoji is shown large, without a bubble (letters, digits or spaces rule it out). */
function emojiOnly(body: string) {
  return body.length <= 8 && !/[\sA-Za-z0-9À-ɏḀ-ỿ]/.test(body);
}

/** Full-height room chat, shown over the room inside the app. */
export function RoomChat({ visible, onClose, room, meId, chat }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const toast = useToast();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<ChatItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const isHost = room.host_id === meId;
  const { markRead } = chat;

  useEffect(() => { if (visible) markRead(); }, [visible, markRead, chat.items.length]);
  useEffect(() => { if (!visible) { setSelected(null); setReporting(false); } }, [visible]);

  async function submit(body = text) {
    const value = body.trim();
    if (!value) return;
    if (body === text) setText('');
    nearBottom.current = true;
    try { await chat.send(value); } catch (e) {
      // The message stays in the list as "failed" with a retry; only explain limits that retrying won't fix soon.
      if (e instanceof ApiError && (e.code === 'rate_limited' || e.code === 'room_closed')) showError('Chưa gửi được tin nhắn', e);
    }
  }

  async function act(action: 'unsend' | 'remove') {
    const target = selected;
    setSelected(null);
    if (!target) return;
    try { await chat.remove(target.id); } catch (e) { showError(action === 'unsend' ? 'Không thu hồi được tin nhắn' : 'Không gỡ được tin nhắn', e); }
  }

  async function report(reason: string) {
    const target = selected;
    setSelected(null); setReporting(false);
    if (!target?.sender) return;
    try {
      await togetherApi.report(target.sender.id, reason, undefined, room.id, target.id);
      toast('Cảm ơn bạn, Mirabi sẽ xem xét tin nhắn này.', 'success');
    } catch (e) { showError('Không gửi được báo cáo', e); }
  }

  const typingNames = chat.typingIds.map((id) => room.members.find((m) => m.user_id === id)?.display_name).filter(Boolean) as string[];
  const typingLabel = typingNames.length === 0 ? null : typingNames.length === 1 ? `${typingNames[0]} đang soạn tin…`
    : typingNames.length === 2 ? `${typingNames[0]} và ${typingNames[1]} đang soạn tin…` : 'Nhiều bạn đang soạn tin…';

  const rows: React.ReactNode[] = [];
  chat.items.forEach((m, i) => {
    const prev = chat.items[i - 1];
    const next = chat.items[i + 1];
    const separated = !prev || time(m.created_at) - time(prev.created_at) > SEPARATOR_GAP_MS;
    const sameAsPrev = !separated && prev?.sender?.id === m.sender?.id && time(m.created_at) - time(prev.created_at) < GROUP_GAP_MS;
    const nextSeparated = !next || time(next.created_at) - time(m.created_at) > SEPARATOR_GAP_MS;
    const sameAsNext = !nextSeparated && next?.sender?.id === m.sender?.id && time(next.created_at) - time(m.created_at) < GROUP_GAP_MS;
    if (separated) rows.push(<Text key={`sep${m.id}`} style={s.separator}>{separatorLabel(m.created_at)}</Text>);
    rows.push(<MessageRow key={m.status ? m.client_id! : m.id} m={m} mine={m.sender?.id === meId} first={!sameAsPrev} last={!sameAsNext}
      onLongPress={() => { if (!m.status && !m.deleted) setSelected(m); }} onRetry={() => { void chat.retry(m).catch(() => {}); }}
      onDiscard={() => chat.discard(m)} />);
  });

  const screen = (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Đóng trò chuyện" style={s.back}>
          <Ionicons name="chevron-back" size={22} color={t.ink} />
        </Pressable>
        <View style={s.faces}>
          {room.members.slice(0, 3).map((m, i) => (
            <View key={m.user_id} style={[s.face, i > 0 && s.faceOverlap]}><PetAvatar user={m} size={30} /></View>
          ))}
        </View>
        <View style={s.flex}>
          <Text style={s.title} numberOfLines={1} accessibilityRole="header">{room.name}</Text>
          <Text style={s.subtitle} numberOfLines={1}>{room.members.length} thành viên · {STATE_LABELS[room.state]}</Text>
        </View>
      </View>
      {room.state === 'focus' ? (
        <View style={s.banner}>
          <Ionicons name="moon-outline" size={14} color="#5D7480" />
          <Text style={s.bannerText}>Đang trong giờ tập trung · nhắn ngắn gọn để cả phòng giữ nhịp nhé.</Text>
        </View>
      ) : null}

      <ScrollView ref={scroller} style={s.flex} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }} scrollEventThrottle={64}
        onContentSizeChange={() => { if (nearBottom.current) scroller.current?.scrollToEnd({ animated: !reduce }); }}>
        {chat.hasOlder ? (
          <Pressable onPress={() => { nearBottom.current = false; void chat.loadOlder(); }} style={s.older} accessibilityRole="button">
            {chat.loadingOlder ? <ActivityIndicator size="small" color={t.accent} /> : <Text style={s.olderText}>Xem tin nhắn cũ hơn</Text>}
          </Pressable>
        ) : null}
        {!chat.loaded ? <ActivityIndicator style={s.loading} color={t.accent} />
          : chat.items.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="chatbubbles-outline" size={26} color={t.accent} /></View>
              <Text style={s.emptyTitle}>Chưa có tin nhắn nào</Text>
              <Text style={s.emptyBody}>Gửi lời chào tới cả phòng nhé. Chỉ thành viên trong phòng mới đọc được.</Text>
              <View style={s.quick}>
                {QUICK_REPLIES.map((q) => (
                  <Pressable key={q} onPress={() => { void submit(q); }} style={({ pressed }) => [s.quickChip, pressed && s.pressed]} accessibilityRole="button">
                    <Text style={s.quickText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : rows}
        {typingLabel ? (
          <View style={s.typing} accessibilityLiveRegion="polite"><TypingDots /><Text style={s.typingText}>{typingLabel}</Text></View>
        ) : null}
      </ScrollView>

      <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={s.inputWrap}>
          <TextInput value={text} onChangeText={(v) => { setText(v); if (v.trim()) chat.notifyTyping(); }} placeholder="Nhắn cho cả phòng…"
            placeholderTextColor="#8295A5" multiline maxLength={MAX_LENGTH} style={s.input} accessibilityLabel="Tin nhắn"
            onKeyPress={(e: any) => {
              // Web: Enter sends, Shift+Enter adds a line (like Messenger).
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); void submit(); }
            }} />
          {text.length > MAX_LENGTH - 100 ? <Text style={s.counter}>{text.length}/{MAX_LENGTH}</Text> : null}
        </View>
        {text.trim() ? (
          <Pressable onPress={() => { void submit(); }} accessibilityRole="button" accessibilityLabel="Gửi" style={({ pressed }) => [s.sendWrap, pressed && s.pressed]}>
            <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.send}>
              <Ionicons name="paper-plane" size={18} color="#FFFFFF" style={s.sendIcon} />
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable onPress={() => { void submit('👍'); }} accessibilityRole="button" accessibilityLabel="Gửi like" style={({ pressed }) => [s.like, pressed && s.pressed]}>
            <Text style={s.likeText}>👍</Text>
          </Pressable>
        )}
      </View>

      {selected ? (
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setSelected(null); setReporting(false); }} accessibilityRole="button" accessibilityLabel="Đóng" />
          <View style={s.actions} accessibilityViewIsModal>
            <Text style={s.actionsQuote} numberOfLines={2}>“{selected.body}”</Text>
            {reporting ? (
              <>
                <Text style={s.actionsTitle}>Vì sao bạn báo cáo tin nhắn này?</Text>
                {REPORT_REASONS.map((r) => <ActionRow key={r.id} label={r.label} onPress={() => { void report(r.id); }} />)}
              </>
            ) : selected.sender?.id === meId ? (
              <ActionRow icon="arrow-undo-outline" label="Thu hồi tin nhắn" danger onPress={() => { void act('unsend'); }} />
            ) : (
              <>
                {isHost ? <ActionRow icon="trash-outline" label="Gỡ tin nhắn khỏi phòng" danger onPress={() => { void act('remove'); }} /> : null}
                <ActionRow icon="flag-outline" label="Báo cáo tin nhắn" onPress={() => setReporting(true)} />
              </>
            )}
            <ActionRow label="Hủy" onPress={() => { setSelected(null); setReporting(false); }} />
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );

  return (
    <AppModal visible={visible} transparent animationType={reduce ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      {screen}
    </AppModal>
  );
}

function MessageRow({ m, mine, first, last, onLongPress, onRetry, onDiscard }: {
  m: ChatItem; mine: boolean; first: boolean; last: boolean; onLongPress: () => void; onRetry: () => void; onDiscard: () => void;
}) {
  const big = !m.deleted && !!m.body && emojiOnly(m.body);
  const corners = mine
    ? { borderTopRightRadius: first ? 20 : 6, borderBottomRightRadius: last ? 20 : 6 }
    : { borderTopLeftRadius: first ? 20 : 6, borderBottomLeftRadius: last ? 20 : 6 };
  const label = m.deleted ? (m.removed_by === 'host' ? 'Tin nhắn đã bị chủ phòng gỡ' : mine ? 'Bạn đã thu hồi một tin nhắn' : 'Tin nhắn đã được thu hồi') : m.body;
  const who = mine ? 'Bạn' : m.sender?.display_name ?? 'Thành viên';
  const content = m.deleted ? (
    <View style={[s.bubble, s.removed, corners]}><Text style={s.removedText}>{label}</Text></View>
  ) : big ? (
    <Text style={s.bigEmoji}>{m.body}</Text>
  ) : mine ? (
    <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.bubble, corners]}>
      <Text style={s.mineText} selectable>{m.body}</Text>
    </LinearGradient>
  ) : (
    <View style={[s.bubble, s.theirs, corners]}><Text style={s.theirsText} selectable>{m.body}</Text></View>
  );
  return (
    <View style={[s.row, mine && s.rowMine, last && s.rowLast]}>
      {!mine ? <View style={s.avatarSlot}>{last && m.sender ? <PetAvatar user={m.sender} size={28} /> : null}</View> : null}
      <View style={[s.column, mine && s.columnMine]}>
        {!mine && first ? <Text style={s.name}>{who}</Text> : null}
        <Pressable onLongPress={onLongPress} delayLongPress={300} accessibilityLabel={`${who}: ${label}`}
          accessibilityHint={!m.status && !m.deleted ? 'Nhấn giữ để xem thêm tùy chọn' : undefined}
          style={m.status === 'sending' && s.sending}>
          {content}
        </Pressable>
        {m.status === 'failed' ? (
          <View style={s.failedRow}>
            <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={6}><Text style={s.failed}>Chưa gửi được · Thử lại</Text></Pressable>
            <Pressable onPress={onDiscard} accessibilityRole="button" accessibilityLabel="Bỏ tin nhắn này" hitSlop={6}><Text style={s.discard}>Bỏ</Text></Pressable>
          </View>
        ) : m.status === 'sending' && last ? <Text style={s.meta}>Đang gửi…</Text> : null}
      </View>
    </View>
  );
}

function ActionRow({ label, icon, danger, onPress }: { label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && s.actionPressed]} accessibilityRole="button" accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={18} color={danger ? t.danger : t.ink} /> : null}
      <Text style={[s.actionText, danger && { color: t.danger }]}>{label}</Text>
    </Pressable>
  );
}

function TypingDots() {
  return <View style={s.dots}>{[0, 1, 2].map((i) => <View key={i} style={[s.dot, { opacity: 0.4 + i * 0.25 }]} />)}</View>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#F6F9FB' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#E7EEF3' },
  back: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 13, borderWidth: 2, borderColor: '#FFFFFF', overflow: 'hidden' },
  faceOverlap: { marginLeft: -12 },
  title: { fontSize: 16, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 12, color: t.muted, marginTop: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#EEF3F1' },
  bannerText: { flex: 1, fontSize: 12, color: '#5D7480', fontWeight: '600' },

  list: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, flexGrow: 1 },
  older: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, marginBottom: 6, minHeight: 36, justifyContent: 'center' },
  olderText: { fontSize: 12, fontWeight: '800', color: t.accent },
  loading: { marginTop: 40 },
  separator: { alignSelf: 'center', fontSize: 11, fontWeight: '700', color: '#8A9BA8', marginVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowLast: { marginBottom: 8 },
  avatarSlot: { width: 28 },
  column: { maxWidth: '76%', alignItems: 'flex-start' },
  columnMine: { alignItems: 'flex-end' },
  name: { fontSize: 11, fontWeight: '700', color: '#6E8191', marginLeft: 10, marginBottom: 3 },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  theirs: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7EEF3' },
  theirsText: { fontSize: 15, lineHeight: 21, color: t.ink },
  mineText: { fontSize: 15, lineHeight: 21, color: '#FFFFFF' },
  removed: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#D5DFE6' },
  removedText: { fontSize: 13, fontStyle: 'italic', color: '#7D8E9B' },
  bigEmoji: { fontSize: 38, lineHeight: 46 },
  sending: { opacity: 0.6 },
  meta: { fontSize: 10, color: '#8A9BA8', marginTop: 3, marginRight: 4 },
  failedRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  failed: { fontSize: 11, fontWeight: '800', color: t.danger },
  discard: { fontSize: 11, fontWeight: '700', color: t.muted },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 40, paddingVertical: 6 },
  typingText: { fontSize: 12, color: '#6E8191', fontStyle: 'italic' },
  dots: { flexDirection: 'row', gap: 3, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 7, borderWidth: 1, borderColor: '#E7EEF3' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7D8E9B' },

  empty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48, gap: 8 },
  emptyIcon: { width: 56, height: 56, borderRadius: 22, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: t.ink },
  emptyBody: { fontSize: 13, color: t.muted, textAlign: 'center', lineHeight: 19 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 },
  quickChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE8F0' },
  quickText: { fontSize: 13, fontWeight: '700', color: t.accent },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#E7EEF3' },
  inputWrap: { flex: 1, backgroundColor: t.bg, borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 4, minHeight: 44, justifyContent: 'center' },
  input: { fontSize: 15, color: t.ink, maxHeight: 110, paddingVertical: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  counter: { alignSelf: 'flex-end', fontSize: 10, color: t.muted, marginBottom: 2 },
  sendWrap: { width: 44, height: 44, borderRadius: 22, shadowColor: t.shadow, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  send: { flex: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { marginLeft: -2, marginTop: 1 },
  like: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  likeText: { fontSize: 26 },
  pressed: { transform: [{ scale: 0.94 }], opacity: 0.9 },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', backgroundColor: 'rgba(18,59,92,0.3)' },
  actions: { backgroundColor: fs.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 30, gap: 2 },
  actionsQuote: { fontSize: 13, color: t.muted, fontStyle: 'italic', paddingHorizontal: 8, marginBottom: 8 },
  actionsTitle: { fontSize: 14, fontWeight: '800', color: t.ink, paddingHorizontal: 8, marginBottom: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8, borderRadius: 14 },
  actionPressed: { backgroundColor: '#EEF3F6' },
  actionText: { fontSize: 15, fontWeight: '700', color: t.ink },
});
