import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { togetherApi } from '../../studyTogether/api';
import type { RoomPreview } from '../../studyTogether/types';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { subjectLabel } from './labels';
import { useTogetherNav } from './navigation';
import { BackHeader, Field, PersonRow } from './ui';

const REFUSALS: Record<string, string> = {
  room_closed: 'Phòng học này đã đóng.',
  room_full: 'Phòng học đã đủ thành viên.',
  room_invite_only: 'Đây là phòng riêng tư, bạn cần được mời để tham gia.',
  room_unavailable: 'Bạn không thể tham gia phòng học này.',
};

/** Room codes are 8 characters; people type them with spaces, dashes or lower case. */
export const cleanCode = (value: string) => value.replace(/[\s-]/g, '').toUpperCase().slice(0, 8);

export function JoinRoomScreen({ initialCode = '' }: { initialCode?: string }) {
  const nav = useTogetherNav();
  const [code, setCode] = useState(cleanCode(initialCode));
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'lookup' | 'join' | null>(null);

  async function lookup() {
    if (code.length !== 8) { setError('Mã phòng gồm 8 ký tự.'); return; }
    setLoading('lookup'); setError(null); setPreview(null);
    try { setPreview(await togetherApi.lookup(code)); } catch (e) { setError(errorMessage(e)); } finally { setLoading(null); }
  }
  async function join() {
    setLoading('join'); setError(null);
    try {
      const { room } = await togetherApi.joinByCode(code);
      nav.replace({ name: 'room', roomId: room.id, initial: room });
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(null); }
  }

  return (
    <>
      <BackHeader title="Tham gia phòng" subtitle="Nhập mã phòng bạn bè gửi cho bạn" onBack={nav.back} />
      <Card>
        <Field label="Mã phòng" value={code} onChangeText={(v) => { setCode(cleanCode(v)); setPreview(null); setError(null); }}
          placeholder="VD: K7P2QX9M" autoCapitalize="characters" autoCorrect={false} returnKeyType="go" onSubmitEditing={() => { void lookup(); }}
          error={error} style={styles.code} />
        <Button title="Xem phòng" icon="search" variant="secondary" onPress={() => { void lookup(); }} loading={loading === 'lookup'} />
      </Card>
      {preview ? (
        <Card>
          <Text style={styles.name}>{preview.name}</Text>
          {preview.goal ? <Text style={styles.goal}>🎯 {preview.goal}</Text> : null}
          {preview.host ? <PersonRow user={preview.host} subtitle="Chủ phòng" /> : null}
          <View style={styles.facts}>
            <Text style={styles.fact}>{subjectLabel(preview.subject)}</Text>
            <Text style={styles.fact}>{preview.focus_minutes}′ tập trung · {preview.break_minutes}′ nghỉ · {preview.cycles} chu kỳ</Text>
            <Text style={styles.fact}>{preview.member_count}/{preview.max_members} thành viên · {preview.state === 'in_session' ? 'đang học' : preview.state === 'closed' ? 'đã đóng' : 'đang chờ'}</Text>
          </View>
          {preview.can_join
            ? <Button title={preview.reason === 'already_member' ? 'Vào phòng' : 'Tham gia'} icon="enter-outline" onPress={() => { void join(); }} loading={loading === 'join'} />
            : <Text style={styles.refusal} accessibilityLiveRegion="polite">{REFUSALS[preview.reason ?? ''] ?? errorMessage(null)}</Text>}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 22, fontWeight: '900', letterSpacing: 4, textAlign: 'center' },
  name: { fontSize: 19, fontWeight: '900', color: t.ink },
  goal: { fontSize: 14, color: t.ink, marginTop: 4 },
  facts: { gap: 4, marginTop: 6 },
  fact: { fontSize: 13, color: t.muted },
  refusal: { color: t.danger, fontWeight: '800', marginTop: 12, fontSize: 14 },
});
