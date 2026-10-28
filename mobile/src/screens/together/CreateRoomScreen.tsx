import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, newIdempotencyKey } from '../../api/client';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { Friend, Visibility } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card, Chip, Segmented, SectionHeader } from '../../ui/kit';
import { SUBJECTS } from './labels';
import { useTogetherNav } from './navigation';
import { BackHeader, Field, OptionRow, SmallButton, Stepper } from './ui';

// Same limits as RoomCreate in backend/app/study_rooms.py; the backend validates again.
export const LIMITS = { name: 60, goal: 160, focus: [5, 90], break: [1, 30], cycles: [1, 8], members: [2, 8], invites: 7 } as const;

export function validateRoom(name: string, goal: string): { name?: string; goal?: string } {
  const errors: { name?: string; goal?: string } = {};
  const trimmed = name.trim();
  if (!trimmed) errors.name = 'Hãy đặt tên cho phòng học.';
  else if (trimmed.length > LIMITS.name) errors.name = `Tên phòng tối đa ${LIMITS.name} ký tự.`;
  if (goal.trim().length > LIMITS.goal) errors.goal = `Mục tiêu tối đa ${LIMITS.goal} ký tự.`;
  return errors;
}

export function CreateRoomScreen() {
  const nav = useTogetherNav();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [subject, setSubject] = useState('general');
  const [focus, setFocus] = useState(25);
  const [rest, setRest] = useState(5);
  const [cycles, setCycles] = useState(4);
  const [members, setMembers] = useState(4);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invited, setInvited] = useState<number[]>([]);
  const [errors, setErrors] = useState<{ name?: string; goal?: string }>({});
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Reused for retries of the same form so a timed-out request can't create a second room.
  const attempt = useRef(newIdempotencyKey());

  useEffect(() => { void togetherApi.friends().then(setFriends).catch(() => setFriends([])); }, []);
  useEffect(() => { attempt.current = newIdempotencyKey(); }, [name, goal, subject, focus, rest, cycles, members, visibility, invited]);

  const toggleInvite = (id: number) => setInvited((list) => list.includes(id) ? list.filter((x) => x !== id)
    : list.length >= Math.min(LIMITS.invites, members - 1) ? list : [...list, id]);

  async function submit() {
    const found = validateRoom(name, goal);
    setErrors(found);
    setFailure(null);
    if (found.name || found.goal) return;
    setSaving(true);
    try {
      const { room } = await togetherApi.createRoom({ name: name.trim(), goal: goal.trim() || null, subject, focus_minutes: focus,
        break_minutes: rest, cycles, max_members: members, visibility, invitee_ids: invited }, attempt.current);
      nav.replace({ name: 'room', roomId: room.id, initial: room });
    } catch (e) {
      setFailure({ message: errorMessage(e), code: e instanceof ApiError ? e.code : undefined });
    } finally { setSaving(false); }
  }

  return (
    <>
      <BackHeader title="Tạo phòng học" subtitle="Thiết lập một phiên học nhẹ nhàng cho cả nhóm" onBack={nav.back} />
      <Card>
        <Field label="Tên phòng" value={name} onChangeText={setName} placeholder="Ví dụ: Ôn thi Toán 12" maxLength={LIMITS.name + 10}
          error={errors.name} />
        <Field label="Mục tiêu học tập (không bắt buộc)" value={goal} onChangeText={setGoal} placeholder="Ví dụ: Hoàn thành chương 3"
          maxLength={LIMITS.goal + 10} error={errors.goal} hint={`${goal.trim().length}/${LIMITS.goal}`} />
        <Text style={styles.label}>Môn học / hoạt động</Text>
        <View style={styles.chips}>
          {SUBJECTS.map((x) => <Chip key={x.id} label={x.label} selected={subject === x.id} onPress={() => setSubject(x.id)} />)}
        </View>
      </Card>
      <SectionHeader title="Nhịp học" />
      <Card>
        <Stepper label="Tập trung" value={focus} min={LIMITS.focus[0]} max={LIMITS.focus[1]} step={5} unit="phút" onChange={setFocus} />
        <Stepper label="Nghỉ" value={rest} min={LIMITS.break[0]} max={LIMITS.break[1]} unit="phút" onChange={setRest} />
        <Stepper label="Số chu kỳ" value={cycles} min={LIMITS.cycles[0]} max={LIMITS.cycles[1]} onChange={setCycles} />
        <Stepper label="Tối đa thành viên" value={members} min={LIMITS.members[0]} max={LIMITS.members[1]} unit="người"
          onChange={(v) => { setMembers(v); setInvited((list) => list.slice(0, v - 1)); }} />
        <Text style={styles.total}>Tổng cộng khoảng {cycles * focus + (cycles - 1) * rest} phút</Text>
      </Card>
      <SectionHeader title="Ai có thể tham gia" />
      <Segmented<Visibility> value={visibility} onChange={setVisibility}
        options={[{ value: 'private', label: 'Riêng tư' }, { value: 'code', label: 'Tham gia bằng mã' }]} />
      <Text style={styles.hint}>{visibility === 'private' ? 'Chỉ những bạn được mời mới vào được phòng.'
        : 'Ai có mã phòng đều có thể tham gia; bạn bè của bạn cũng thấy phòng này.'}</Text>
      <SectionHeader title={`Mời bạn bè (${invited.length})`} />
      <Card>
        {friends.length === 0 ? <Text style={styles.hint}>Bạn có thể mời bạn bè sau khi tạo phòng.</Text>
          : friends.map((f) => <OptionRow key={f.id} label={f.display_name} description={`Mã ${f.public_code ?? ''}`}
            selected={invited.includes(f.id)} onPress={() => toggleInvite(f.id)} />)}
      </Card>
      {failure ? <View style={styles.failure} accessibilityLiveRegion="polite">
        <Text style={styles.failureText}>{failure.message}</Text>
        {failure.code === 'already_in_another_room' ? <SmallButton title="Đi tới phòng hiện tại" onPress={() => {
          void togetherApi.home().then((h) => h.current_room && nav.replace({ name: 'room', roomId: h.current_room.id, initial: h.current_room }));
        }} /> : null}
      </View> : null}
      <Button title="Tạo phòng" icon="sparkles-outline" onPress={() => { void submit(); }} loading={saving} />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '800', color: t.ink, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  total: { fontSize: 13, color: t.muted, marginTop: 6 },
  hint: { fontSize: 13, color: t.muted, marginTop: -6, marginBottom: 8, lineHeight: 19 },
  failure: { backgroundColor: t.dangerBg, borderRadius: 14, padding: 12, gap: 8, marginTop: 4 },
  failureText: { color: t.danger, fontWeight: '800', fontSize: 14 },
});
