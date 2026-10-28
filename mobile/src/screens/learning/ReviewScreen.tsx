import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../../auth/messages';
import { Text } from '../../components/Typography';
import { learningApi } from '../../learning/api';
import { OUTCOME_LABEL } from '../../learning/labels';
import type { ReviewGroup } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button, Card, ScreenHeader } from '../../ui/kit';

/** "Danh sách cần ôn": weakest first, grouped by topic, each group playable as a review stage. */
export function ReviewScreen({ onBack, onPractice, busyTopicId }: { onBack: () => void; onPractice: (topicId: number) => void; busyTopicId: number | null }) {
  const [groups, setGroups] = useState<ReviewGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setGroups((await learningApi.review()).groups); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <ScreenHeader title="Cần ôn lại" subtitle="Nội dung còn yếu được ưu tiên luyện trước" right={
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Quay lại" hitSlop={8}>
          <Ionicons name="close" size={26} color={t.ink} />
        </Pressable>} />
      {error ? <Card><Text style={styles.error}>{error}</Text><Button title="Thử lại" icon="refresh" onPress={() => void load()} /></Card> : null}
      {!groups && !error ? <ActivityIndicator color={t.accent} /> : null}
      {groups && groups.length === 0 ? <Card><Text style={styles.empty}>Không còn gì cần ôn. Tuyệt vời! 🎉</Text></Card> : null}
      {groups?.map((g) => (
        <Card key={g.topic.id}>
          <Text style={styles.group}>{g.subject.name} · {g.topic.name}</Text>
          {g.items.map((item) => (
            <View key={item.id} style={styles.item}>
              <Text style={styles.label}>{item.label}</Text>
              <Text style={styles.reason}>{OUTCOME_LABEL[item.reason]}{item.times_flagged > 1 ? ` · ${item.times_flagged} lần` : ''}</Text>
            </View>
          ))}
          <Button title="Luyện lại" icon="refresh-circle-outline" loading={busyTopicId === g.topic.id} onPress={() => onPractice(g.topic.id)} />
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: t.danger, fontWeight: '700' },
  empty: { fontSize: 16, color: t.ink, fontWeight: '800', textAlign: 'center' },
  group: { fontSize: 17, fontWeight: '900', color: t.ink, marginBottom: 6 },
  item: { borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 8 },
  label: { fontSize: 15, color: t.ink, fontWeight: '700' },
  reason: { fontSize: 13, color: t.danger, marginTop: 2 },
});
