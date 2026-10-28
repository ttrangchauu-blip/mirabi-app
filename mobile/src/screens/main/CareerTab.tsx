import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Button, Card, Chip, IconCircle, IconName, ProgressBar, ScreenHeader, SectionHeader } from '../../ui/kit';
import { Career, categoryIcon, request, showError } from './shared';

// The career categories the backend scores against (backend/app/main.py CAREERS).
const INTERESTS: { label: string; icon: IconName }[] = [
  { label: 'Sáng tạo', icon: 'color-palette-outline' },
  { label: 'Công nghệ', icon: 'code-slash-outline' },
  { label: 'Con người', icon: 'heart-outline' },
];

export function CareerTab({ careers, onResults }: { careers: Career[]; onResults: (c: Career[]) => void }) {
  const [selected, setSelected] = useState<string[]>(['Sáng tạo', 'Công nghệ']);
  const [loading, setLoading] = useState(false);
  const toggle = (label: string) => setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));

  async function find() {
    setLoading(true);
    try { onResults(await request('/api/career/quiz', { method: 'POST', body: { interests: selected } })); }
    catch (e) { showError('Lỗi', e); }
    finally { setLoading(false); }
  }

  return (
    <>
      <ScreenHeader title="Nghề nghiệp" subtitle="Khám phá thế giới nghề nghiệp phù hợp với bạn" />
      <Card>
        <Text style={styles.cardTitle}>Bạn quan tâm điều gì?</Text>
        <Text style={styles.muted}>Chọn một hoặc nhiều lĩnh vực để Mirabi gợi ý nghề phù hợp.</Text>
        <View style={styles.chips}>
          {INTERESTS.map((i) => <Chip key={i.label} label={i.label} icon={i.icon} selected={selected.includes(i.label)} onPress={() => toggle(i.label)} />)}
        </View>
        <Button title="Tìm nghề phù hợp" icon="search" onPress={find} loading={loading} disabled={selected.length === 0} />
      </Card>

      <SectionHeader title="Gợi ý cho bạn" />
      {careers.map((c) => (
        <Card key={c.title}>
          <View style={styles.head}>
            <IconCircle name={categoryIcon(c.category)} />
            <View style={styles.flex}>
              <Text style={styles.title}>{c.title}</Text>
              <Text style={styles.category}>{c.category}</Text>
            </View>
            <View style={styles.match} accessibilityLabel={`Phù hợp ${c.match}%`}>
              <Text style={styles.matchValue}>{c.match}%</Text>
              <Text style={styles.matchLabel}>phù hợp</Text>
            </View>
          </View>
          <Text style={styles.desc}>{c.description}</Text>
          <ProgressBar value={c.match / 100} />
          <View style={styles.skills}>{c.skills.map((s) => <Chip key={s} label={s} />)}</View>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '900', color: t.ink },
  muted: { fontSize: 14, lineHeight: 21, color: t.muted, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 17, fontWeight: '800', color: t.ink },
  category: { fontSize: 13, color: t.muted, marginTop: 1 },
  match: { alignItems: 'flex-end' },
  matchValue: { fontSize: 22, fontWeight: '900', color: t.accent },
  matchLabel: { fontSize: 11, color: t.muted, fontWeight: '700' },
  desc: { fontSize: 14, lineHeight: 21, color: t.muted, marginTop: 10, marginBottom: 10 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
});
