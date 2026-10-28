import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { ConnectionStatus } from '../../studyTogether/realtime';
import { formatClock, formatMinutes, phaseProgress, remainingMs, TimerAnchor } from '../../studyTogether/timer';
import type { Friend, PublicUser, QuestTemplate, RoomSnapshot } from '../../studyTogether/types';
import { useRoomChat } from '../../studyTogether/useRoomChat';
import { useStudyRoom } from '../../studyTogether/useStudyRoom';
import { appTheme as t } from '../../theme';
import { useConfirm } from '../../ui/ConfirmDialog';
import { Button, Card, IconName, ProgressBar, SectionHeader, SoftInput } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { focusTheme as fs } from '../main/focusSpaceTheme';
import { showError } from '../main/shared';
import { REACTIONS, STATE_LABELS, subjectLabel } from './labels';
import { RoomChat } from './RoomChat';
import { StudyRoomScene } from './StudyRoomScene';
import { usePullToRefresh, useTogetherNav } from './navigation';
import { BackHeader, EmptyState, ErrorState, LoadingState, OptionRow, OptionSheet, PersonRow, PresenceLabel, SmallButton } from './ui';

const CONNECTION: Record<ConnectionStatus, { label: string; color: string } | null> = {
  idle: null,
  connecting: { label: 'Đang kết nối…', color: '#E0A43A' },
  online: { label: 'Trực tuyến', color: '#1F9D6A' },
  reconnecting: { label: 'Đang kết nối lại…', color: '#E0A43A' },
  offline: { label: 'Mất kết nối · tự cập nhật mỗi 15 giây', color: '#A7B4C0' },
};

export function RoomScreen({ roomId, initial }: { roomId: number; initial: RoomSnapshot | null }) {
  const nav = useTogetherNav();
  const live = useStudyRoom(roomId, nav.realtime, initial);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [questOpen, setQuestOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const meUser = useMemo<PublicUser>(() => ({ id: nav.user.id, display_name: nav.user.display_name, avatar_theme: nav.user.avatar_theme,
    pet: nav.user.pet, pet_name: nav.user.pet_name, pet_level: nav.user.level, public_code: null }), [nav.user]);
  const chat = useRoomChat(roomId, nav.realtime, meUser, live.connection);
  usePullToRefresh(live.refresh);
  useEffect(() => { if (live.gone) setChatOpen(false); }, [live.gone]);

  const { endedSessionId, clearEnded } = live;
  useEffect(() => {
    if (endedSessionId == null) return;
    clearEnded();
    nav.onRewards();
    nav.push({ name: 'summary', sessionId: endedSessionId });
  }, [clearEnded, endedSessionId, nav]);

  const room = live.room;
  const me = nav.user.id;
  const isHost = room?.host_id === me;
  const connection = CONNECTION[live.connection];
  // Online needs no words: a green dot is enough and leaves room for the chat button.
  const compact = live.connection === 'online';
  const pill = connection ? (
    <View style={[styles.pill, compact && styles.pillCompact]} accessible accessibilityLabel={`Kết nối: ${connection.label}`} accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: connection.color }]} />
      {compact ? null : <Text style={styles.pillText} numberOfLines={1}>{connection.label.split(' · ')[0]}</Text>}
    </View>
  ) : null;

  async function run(key: string, action: () => Promise<unknown>, title: string) {
    setBusy(key);
    try { await action(); } catch (e) { showError(title, e); } finally { setBusy(null); }
  }
  const control = (key: 'start' | 'pause' | 'resume') => run(key, () => live.act(() => togetherApi[key](roomId)), 'Không thể cập nhật phiên học');
  async function endSession() {
    if (!await confirm({ title: 'Kết thúc phiên sớm?', message: 'Thời gian tập trung hợp lệ đến lúc này vẫn được tính cho mọi người.', confirmLabel: 'Kết thúc', destructive: true, icon: 'stop-circle-outline' })) return;
    await run('end', () => live.act(() => togetherApi.end(roomId)), 'Không thể kết thúc phiên học');
  }
  async function leave() {
    const message = isHost ? 'Quyền chủ phòng sẽ được chuyển cho thành viên khác. Nếu không còn ai, phòng sẽ đóng.'
      : 'Thời gian bạn đã tập trung trong phiên vẫn được tính.';
    if (!await confirm({ title: 'Rời phòng học?', message, confirmLabel: 'Rời phòng', destructive: true, icon: 'exit-outline' })) return;
    await run('leave', async () => { await togetherApi.leave(roomId); nav.onRewards(); nav.home(); }, 'Không thể rời phòng');
  }
  async function closeRoom() {
    if (!await confirm({ title: 'Đóng phòng học?', message: 'Mọi thành viên sẽ rời phòng. Kết quả phiên đang diễn ra vẫn được lưu.', confirmLabel: 'Đóng phòng', destructive: true })) return;
    await run('close', async () => {
      const result = await togetherApi.close(roomId);
      nav.onRewards();
      if (result.last_session_id && room?.session) nav.replace({ name: 'summary', sessionId: result.last_session_id });
      else nav.home();
    }, 'Không thể đóng phòng');
  }

  if (live.gone) {
    return (
      <>
        <BackHeader title={room?.name ?? 'Phòng học'} onBack={nav.home} />
        <Card>
          <EmptyState icon="exit-outline" title="Phòng đã đóng hoặc bạn không còn trong phòng"
            action={<View style={styles.rowButtons}>
              {room?.last_session_id ? <SmallButton title="Xem tổng kết" onPress={() => nav.replace({ name: 'summary', sessionId: room.last_session_id! })} /> : null}
              <SmallButton title="Về trang chủ" variant="primary" onPress={nav.home} />
            </View>} />
        </Card>
      </>
    );
  }
  if (!room) {
    return <><BackHeader title="Phòng học" onBack={nav.back} right={pill} />{live.error ? <ErrorState error={live.error} onRetry={live.refresh} /> : <LoadingState />}</>;
  }

  const active = room.state === 'focus' || room.state === 'break' || room.state === 'paused';
  const away = room.members.filter((m) => m.presence === 'away').length;
  const here = room.members.length - away;
  const sceneCaption = !active ? `${room.member_count} bạn đã vào phòng`
    : room.state !== 'focus' ? 'Cả phòng đang nghỉ một chút'
    : away ? `${here} bạn đang tập trung · ${away} bạn tạm vắng`
    : here > 1 ? `Cả ${here} bạn đang tập trung cùng nhau` : 'Bạn đang tập trung';
  return (
    <>
      <BackHeader title={room.name} subtitle={`${STATE_LABELS[room.state]} · ${room.member_count}/${room.max_members} thành viên`} onBack={nav.back}
        right={<View style={styles.headerRight}>{pill}<ChatButton chat={chat} onOpen={() => setChatOpen(true)} /></View>} />
      {live.connection === 'offline' ? <Text style={styles.offline}>Đồng hồ vẫn chạy theo máy chủ; Mirabi sẽ tự kết nối lại.</Text> : null}

      {/* One surface for the room, the shared timer and its controls, like the personal Focus Space. */}
      <View style={styles.stage}>
        <View style={styles.sceneFrame}>
          <StudyRoomScene members={room.members} state={room.state} reactions={live.reactions} messages={chat.bubbles} meId={me} />
          <View style={styles.caption} pointerEvents="none">
            <View style={[styles.captionDot, active && room.state === 'focus' && styles.captionDotLive]} />
            <Text style={styles.captionText}>{sceneCaption}</Text>
          </View>
        </View>
        {active ? (
          <>
            <TimerStrip room={room} anchor={live.anchor} isHost={isHost} busy={busy}
              onToggle={() => { void control(room.state === 'paused' ? 'resume' : 'pause'); }} onEnd={() => { void endSession(); }} />
            <View style={styles.reactions} accessibilityRole="toolbar" accessibilityLabel="Gửi lời động viên">
              <Text style={styles.eyebrow}>Cổ vũ</Text>
              <View style={styles.reactionRow}>
                {REACTIONS.map((r) => (
                  <Pressable key={r.key} onPress={() => { void togetherApi.react(roomId, r.key).catch((e) => showError('Không gửi được', e)); }}
                    style={({ pressed }) => [styles.reaction, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={r.label} hitSlop={4}>
                    <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        ) : (
          <WaitingStrip room={room} isHost={isHost} busy={busy} onStart={() => { void control('start'); }} />
        )}
      </View>

      {/* Shared and personal goals together, before and during the session. */}
      <Card>
        <View style={styles.goalRow}>
          <View style={styles.goalIcon}><Ionicons name="flag-outline" size={16} color={t.accent} /></View>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>Mục tiêu chung</Text>
            <Text style={styles.goal}>{room.goal || 'Cùng nhau tập trung trọn vẹn từng chu kỳ.'}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <PersonalGoal roomId={room.id} userId={me} />
      </Card>

      <SectionHeader title={`Thành viên (${room.members.length})`} action={room.status === 'open' ? { label: 'Mời bạn', onPress: () => setInviteOpen(true) } : undefined} />
      <Card style={styles.listCard}>
        {room.members.map((m, i) => (
          <View key={m.user_id} style={i > 0 && styles.rowDivider}>
            <PersonRow user={m.user_id === me ? { ...m, display_name: `${m.display_name} (bạn)` } : m}
              subtitle={<PresenceLabel presence={m.presence === 'away' ? 'away' : active && m.in_session ? 'studying' : 'online'} />}
              right={<View style={styles.memberRight}>
                {m.role === 'host' ? <View style={styles.hostBadge}><Ionicons name="star" size={10} color="#9A6400" /><Text style={styles.hostText}>Chủ phòng</Text></View> : null}
                {active ? <Text style={styles.memberStat}>{m.focus_seconds == null ? 'Ẩn' : formatMinutes(m.focus_seconds)}</Text> : null}
              </View>} />
          </View>
        ))}
      </Card>

      {isHost || room.team_quests.length > 0 ? (
        <>
          <SectionHeader title="Nhiệm vụ nhóm" action={isHost ? { label: 'Tạo nhiệm vụ', onPress: () => setQuestOpen(true) } : undefined} />
          <Card style={styles.listCard}>
            {room.team_quests.length === 0 ? (
              <Pressable onPress={() => setQuestOpen(true)} style={styles.questEmpty} accessibilityRole="button" accessibilityLabel="Tạo nhiệm vụ nhóm">
                <View style={styles.goalIcon}><Ionicons name="trophy-outline" size={16} color={t.accent} /></View>
                <Text style={[styles.hint, styles.flex]}>Tạo một mục tiêu chung để cả nhóm cùng hướng tới.</Text>
                <Ionicons name="chevron-forward" size={18} color={t.muted} />
              </Pressable>
            ) : room.team_quests.map((q, i) => (
              <Pressable key={q.id} onPress={() => nav.push({ name: 'quest', questId: q.id })} style={[styles.quest, i > 0 && styles.rowDivider]} accessibilityRole="button">
                <View style={styles.questHead}>
                  <Text style={[styles.questTitle, styles.flex]} numberOfLines={1}>{q.title}</Text>
                  <Text style={styles.memberStat}>{q.progress}/{q.target} {q.unit === 'minutes' ? 'phút' : 'chu kỳ'}</Text>
                </View>
                <ProgressBar value={q.progress / q.target} />
                <Text style={styles.hint}>{q.member_ids.includes(me) ? 'Bạn đang tham gia' : 'Chạm để tham gia'}</Text>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      <View style={styles.footer}>
        <SmallButton title="Rời phòng" icon="exit-outline" variant="danger" onPress={() => { void leave(); }} loading={busy === 'leave'} />
        {isHost ? <SmallButton title="Đóng phòng" icon="close-circle-outline" onPress={() => { void closeRoom(); }} loading={busy === 'close'} /> : null}
      </View>

      <InviteSheet visible={inviteOpen} room={room} onClose={() => setInviteOpen(false)} onInvited={(n) => toast(n ? `Đã mời ${n} bạn.` : 'Không có ai mới để mời.', n ? 'success' : 'info')} />
      <QuestSheet visible={questOpen} roomId={room.id} onClose={() => setQuestOpen(false)} onCreated={() => { void live.refresh(); }} />
      <RoomChat visible={chatOpen} onClose={() => setChatOpen(false)} room={room} meId={me} chat={chat} />
    </>
  );
}

/** The way into the room chat, as a header icon: a badge counts unread messages, a dot shows someone is typing. */
function ChatButton({ chat, onOpen }: { chat: ReturnType<typeof useRoomChat>; onOpen: () => void }) {
  const unread = chat.unread;
  const typing = chat.typingIds.length > 0;
  return (
    <Pressable onPress={onOpen} hitSlop={6} style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]} accessibilityRole="button"
      accessibilityLabel={`Trò chuyện trong phòng${unread ? `, ${unread} tin nhắn chưa đọc` : ''}${typing ? ', có bạn đang soạn tin' : ''}`}>
      <Ionicons name={unread ? 'chatbubbles' : 'chatbubbles-outline'} size={22} color={t.accent} />
      {unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
        : typing ? <View style={styles.typingDot} /> : null}
    </Pressable>
  );
}

function WaitingStrip({ room, isHost, busy, onStart }: { room: RoomSnapshot; isHost: boolean; busy: string | null; onStart: () => void }) {
  const facts: { icon: IconName; label: string }[] = [
    { icon: 'book-outline', label: subjectLabel(room.subject) },
    { icon: 'timer-outline', label: `${room.focus_minutes}/${room.break_minutes} phút` },
    { icon: 'repeat-outline', label: `${room.cycles} chu kỳ` },
    { icon: room.visibility === 'private' ? 'lock-closed-outline' : 'key-outline', label: room.visibility === 'private' ? 'Riêng tư' : 'Vào bằng mã' },
  ];
  return (
    <View style={styles.strip}>
      <View style={styles.facts}>
        {facts.map((f) => (
          <View key={f.label} style={styles.fact} accessible accessibilityLabel={f.label}>
            <Ionicons name={f.icon} size={13} color={fs.muted} /><Text style={styles.factText}>{f.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.codeBox}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Mã phòng</Text>
          <Text style={styles.code} selectable accessibilityLabel={`Mã phòng ${room.code.split('').join(' ')}`}>{room.code}</Text>
        </View>
        <SmallButton title="Chia sẻ" icon="share-outline" onPress={() => {
          void Share.share({ message: `Vào phòng học “${room.name}” cùng mình trên Mirabi nhé! Mã phòng: ${room.code}` });
        }} />
      </View>
      {isHost
        ? <Button title="Bắt đầu phiên học" icon="play" onPress={onStart} loading={busy === 'start'} style={styles.startButton} />
        : (
          <View style={styles.waitingNote}>
            <ActivityIndicator size="small" color={fs.muted} />
            <Text style={styles.waitingText}>Đang chờ chủ phòng bắt đầu phiên học…</Text>
          </View>
        )}
    </View>
  );
}

function TimerStrip({ room, anchor, isHost, busy, onToggle, onEnd }: {
  room: RoomSnapshot; anchor: TimerAnchor | null; isHost: boolean; busy: string | null; onToggle: () => void; onEnd: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anchor?.running) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [anchor]);
  const session = room.session;
  if (!session) return null;
  const left = remainingMs(anchor);
  const paused = room.state === 'paused';
  const phase = paused ? 'Tạm dừng' : session.phase === 'focus' ? 'Tập trung' : 'Nghỉ ngơi';
  const tone = paused ? '#B7A6C9' : session.phase === 'focus' ? '#82AEBE' : '#E0B36A';
  const toggleTitle = paused ? 'Tiếp tục' : 'Tạm dừng';
  return (
    <View style={styles.strip}>
      <View style={styles.timerRow}>
        <View style={styles.flex}>
          <View style={styles.phaseRow}><View style={[styles.phaseDot, { backgroundColor: tone }]} /><Text style={styles.phase}>{phase}</Text></View>
          <Text style={styles.clock} accessibilityRole="timer" accessibilityLabel={`${phase}, còn ${formatClock(left)}`}>{formatClock(left)}</Text>
          <View style={styles.track}><View style={[styles.fill, { width: `${phaseProgress(anchor) * 100}%`, backgroundColor: tone }]} /></View>
        </View>
        {isHost ? (
          <View style={styles.controls}>
            <View style={styles.roundRow}>
              <Pressable onPress={onEnd} disabled={!!busy} accessibilityRole="button" accessibilityLabel="Kết thúc phiên"
                style={({ pressed }) => [styles.round, styles.roundStop, pressed && styles.pressed]}>
                {busy === 'end' ? <ActivityIndicator size="small" color={t.danger} /> : <Ionicons name="stop" size={17} color={t.danger} />}
              </Pressable>
              <Pressable onPress={onToggle} disabled={!!busy} accessibilityRole="button" accessibilityLabel={toggleTitle}
                style={({ pressed }) => [styles.roundPlay, pressed && styles.pressed]}>
                <LinearGradient colors={t.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.roundFill}>
                  {busy === 'pause' || busy === 'resume' ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <Ionicons name={paused ? 'play' : 'pause'} size={22} color="#FFFFFF" style={paused && styles.playNudge} />}
                </LinearGradient>
              </Pressable>
            </View>
            <Text style={styles.controlHint}>{toggleTitle}</Text>
          </View>
        ) : (
          <View style={styles.controls}>
            <View style={[styles.round, styles.roundIdle]}><Ionicons name="people-outline" size={18} color={fs.muted} /></View>
            <Text style={styles.controlHint}>Chủ phòng{'\n'}giữ đồng hồ</Text>
          </View>
        )}
      </View>
      <View style={styles.cycles} accessible accessibilityLabel={`Chu kỳ ${session.cycle} trên ${session.total_cycles}, đã xong ${session.completed_cycles}`}>
        {Array.from({ length: Math.min(12, session.total_cycles) }, (_, i) => (
          <View key={i} style={[styles.cycleDot, i < session.completed_cycles && styles.cycleDone, i === session.cycle - 1 && i >= session.completed_cycles && styles.cycleNow]} />
        ))}
        <Text style={styles.cycleLabel}>Chu kỳ {session.cycle}/{session.total_cycles}</Text>
      </View>
    </View>
  );
}

/** A private note for this session, kept on this device only (never sent to the room). */
function PersonalGoal({ roomId, userId }: { roomId: number; userId: number }) {
  const key = `mirabi.together.goal.v1:${userId}:${roomId}`;
  const [text, setText] = useState('');
  useEffect(() => { void AsyncStorage.getItem(key).then((v) => setText(v ?? '')).catch(() => {}); }, [key]);
  return (
    <View style={styles.personal}>
      <View style={styles.personalHead}>
        <Text style={[styles.eyebrow, styles.flex]}>Mục tiêu của bạn</Text>
        <Ionicons name="lock-closed-outline" size={11} color={fs.muted} /><Text style={styles.privateText}>Chỉ mình bạn thấy</Text>
      </View>
      <SoftInput value={text} onChangeText={(v) => { setText(v); void AsyncStorage.setItem(key, v).catch(() => {}); }} maxLength={160}
        placeholder="Ví dụ: làm xong 10 câu trắc nghiệm" accessibilityLabel="Mục tiêu của bạn" style={styles.personalInput} />
    </View>
  );
}

function InviteSheet({ visible, room, onClose, onInvited }: { visible: boolean; room: RoomSnapshot; onClose: () => void; onInvited: (n: number) => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setSelected([]);
    void togetherApi.friends().then(setFriends).catch(() => setFriends([]));
  }, [visible]);
  const memberIds = new Set(room.members.map((m) => m.user_id));
  const candidates = (friends ?? []).filter((f) => !memberIds.has(f.id));
  const seats = room.max_members - room.member_count;
  async function send() {
    setSending(true);
    try { const result = await togetherApi.invite(room.id, selected); onInvited(result.invited.length); onClose(); }
    catch (e) { showError('Không gửi được lời mời', e); } finally { setSending(false); }
  }
  return (
    <OptionSheet visible={visible} title="Mời bạn bè vào phòng" onClose={onClose}>
      {friends === null ? <LoadingState /> : candidates.length === 0
        ? <EmptyState icon="people-outline" title="Không còn bạn nào để mời" body="Hãy kết bạn thêm, hoặc chia sẻ mã phòng." />
        : candidates.map((f) => (
          <OptionRow key={f.id} label={f.display_name} description={f.presence === 'studying' ? 'Đang học' : f.presence === 'online' ? 'Trực tuyến' : undefined}
            selected={selected.includes(f.id)}
            onPress={() => setSelected((list) => list.includes(f.id) ? list.filter((x) => x !== f.id) : list.length >= Math.min(7, seats) ? list : [...list, f.id])} />
        ))}
      {seats <= 0 ? <Text style={styles.hint}>Phòng đã đủ người.</Text> : null}
      <Button title={`Gửi lời mời (${selected.length})`} icon="paper-plane-outline" onPress={() => { void send(); }} disabled={!selected.length} loading={sending} />
    </OptionSheet>
  );
}

function QuestSheet({ visible, roomId, onClose, onCreated }: { visible: boolean; roomId: number; onClose: () => void; onCreated: () => void }) {
  const [templates, setTemplates] = useState<QuestTemplate[] | null>(null);
  useEffect(() => { if (visible && !templates) void togetherApi.questTemplates().then(setTemplates).catch(() => setTemplates([])); }, [templates, visible]);
  async function create(key: string) {
    try { await togetherApi.createQuest(roomId, key); onClose(); onCreated(); } catch (e) { showError('Không tạo được nhiệm vụ', e); }
  }
  return (
    <OptionSheet visible={visible} title="Chọn nhiệm vụ nhóm" onClose={onClose}>
      {templates === null ? <LoadingState /> : templates.map((tpl) => (
        <OptionRow key={tpl.key} icon="flag-outline" label={tpl.title}
          description={`${tpl.description} · ${tpl.days} ngày · +${tpl.reward_exp} EXP mỗi người góp sức`} onPress={() => { void create(tpl.key); }} />
      ))}
    </OptionSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, maxWidth: 130 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillCompact: { width: 24, height: 24, paddingHorizontal: 0, paddingVertical: 0, justifyContent: 'center' },
  pillText: { fontSize: 11, fontWeight: '800', color: t.ink },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  typingDot: { position: 'absolute', top: 8, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: '#1F9D6A', borderWidth: 2, borderColor: '#FFFFFF' },
  offline: { fontSize: 12, color: t.muted, marginTop: -8, marginBottom: 10 },

  stage: { backgroundColor: fs.paper, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: '#FFFFFF', marginBottom: 16,
    shadowColor: fs.shadow, shadowOpacity: 0.1, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  sceneFrame: { padding: 8, paddingBottom: 0 },
  caption: { position: 'absolute', bottom: 9, left: 8, right: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  captionDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#B9B2A8' },
  captionDotLive: { backgroundColor: '#5FA585' },
  captionText: { color: '#5C6B68', fontSize: 11, fontWeight: '700' },
  strip: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#67818D', textTransform: 'uppercase', letterSpacing: 1.6 },

  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  phaseDot: { width: 6, height: 6, borderRadius: 3 },
  phase: { fontSize: 10, fontWeight: '800', color: '#667F89', textTransform: 'uppercase', letterSpacing: 2.2 },
  clock: { fontSize: 50, lineHeight: 60, fontWeight: '800', color: fs.ink, letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, backgroundColor: '#E6E8E4', overflow: 'hidden', maxWidth: 190 },
  fill: { height: 4, borderRadius: 2 },
  controls: { alignItems: 'center', gap: 6, minWidth: 104 },
  roundRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  roundStop: { backgroundColor: '#FBEFEE', borderColor: '#F1D9D6' },
  roundIdle: { backgroundColor: '#EFF4F3', borderColor: '#DCE7EA' },
  roundPlay: { width: 52, height: 52, borderRadius: 26, shadowColor: t.shadow, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  roundFill: { flex: 1, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  playNudge: { marginLeft: 3 },
  controlHint: { fontSize: 11, color: fs.muted, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  cycles: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cycleDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E1E5E2' },
  cycleDone: { backgroundColor: '#8DAA9E' },
  cycleNow: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#82AEBE' },
  cycleLabel: { marginLeft: 6, fontSize: 11, color: '#71817F', fontWeight: '600' },

  reactions: { borderTopWidth: 1, borderTopColor: fs.line, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, gap: 8 },
  reactionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  reaction: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F4EFE7', alignItems: 'center', justifyContent: 'center' },
  reactionEmoji: { fontSize: 20 },
  pressed: { transform: [{ scale: 0.92 }], opacity: 0.9 },

  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factText: { fontSize: 12, color: fs.muted, fontWeight: '700' },
  codeBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: fs.cream, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  code: { fontSize: 24, fontWeight: '900', letterSpacing: 4, color: fs.ink, marginTop: 2 },
  startButton: { marginTop: 0 },
  waitingNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  waitingText: { fontSize: 13, color: fs.muted, fontWeight: '700' },

  goalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  goalIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  goal: { fontSize: 15, fontWeight: '700', color: t.ink, lineHeight: 22, marginTop: 2 },
  divider: { height: 1, backgroundColor: t.border, marginVertical: 14 },
  personal: { gap: 8 },
  personalHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  privateText: { fontSize: 11, color: fs.muted, fontWeight: '600' },
  personalInput: { minHeight: 48 },

  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#E5484D',
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  badgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  listCard: { paddingVertical: 6 },
  rowDivider: { borderTopWidth: 1, borderTopColor: '#EEF4F8' },
  hint: { fontSize: 13, color: t.muted, lineHeight: 19 },
  memberRight: { alignItems: 'flex-end', gap: 4 },
  hostBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFF4CC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  hostText: { fontSize: 11, fontWeight: '900', color: '#7A4D00' },
  memberStat: { fontSize: 12, fontWeight: '800', color: t.muted },
  quest: { paddingVertical: 12, gap: 8 },
  questHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  questTitle: { fontSize: 15, fontWeight: '800', color: t.ink },
  questEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 4, marginBottom: 8 },
  rowButtons: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
