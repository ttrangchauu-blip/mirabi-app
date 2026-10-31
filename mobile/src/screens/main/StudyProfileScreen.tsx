import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { errorMessage } from '../../auth/messages';
import { StudyProfileFields } from '../../components/StudyProfileFields';
import { Text } from '../../components/Typography';
import { validateAge, validateGrade, type GradeId } from '../../studyProfile';
import { appTheme as t } from '../../theme';
import { Button, Card } from '../../ui/kit';
import { useToast } from '../../ui/Toast';
import { request } from './shared';

type FormProps = {
  user: User;
  title: string;
  description: string;
  /** The profile as the server saved it. */
  onSaved: (user: User) => void;
  /** "Để sau": close without saving (asked again next time). */
  onSkip?: () => void;
};

/** Age and grade, saved to the profile. The grade can be chosen only the first time (an account created before
 * registration asked for it); after that it is locked and only the age can be corrected. */
export function StudyProfileForm({ user, title, description, onSaved, onSkip }: FormProps) {
  const toast = useToast();
  const gradeLocked = !!user.school_grade;
  const [age, setAge] = useState<number | null>(user.age ?? null);
  const [grade, setGrade] = useState<GradeId | null>(user.school_grade ?? null);
  const [errors, setErrors] = useState<{ age?: string; grade?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const next = { age: validateAge(age),
      grade: gradeLocked && validateGrade(age, grade) ? 'Độ tuổi này không khớp với lớp đã đăng ký.' : validateGrade(age, grade) };
    setErrors(next);
    if (next.age || next.grade || saving) return;
    setSaving(true);
    try {
      const saved: User = await request('/api/profile/study', { method: 'PUT', body: { age, school_grade: grade } });
      toast('Đã lưu thông tin học tập');
      onSaved(saved);
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <StudyProfileFields age={age} grade={grade} errors={errors} disabled={saving} gradeLocked={gradeLocked}
        onChange={(a, g) => { setAge(a); setGrade(g); setErrors({}); }} />
      <Button title="Lưu" icon="checkmark" loading={saving} onPress={() => void save()} />
      {onSkip ? <Button title="Để sau" variant="ghost" disabled={saving} onPress={onSkip} /> : null}
    </Card>
  );
}

/** Cài đặt → "Độ tuổi & lớp học". */
export function StudyProfileScreen({ user, onBack, onUserUpdated }: { user: User; onBack: () => void; onUserUpdated: (user: User) => void }) {
  return (
    <>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quay lại"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Ionicons name="chevron-back" size={22} color={t.ink} />
        </Pressable>
        <Text style={styles.screenTitle} accessibilityRole="header">Độ tuổi & lớp học</Text>
      </View>
      <StudyProfileForm user={user} title="Thông tin học tập" onSaved={(saved) => { onUserUpdated(saved); onBack(); }}
        description={user.school_grade ? 'Học tập theo lớp bạn đã đăng ký và tự lên lớp vào đầu mỗi năm học. Bạn có thể cập nhật độ tuổi.'
          : 'Chọn độ tuổi và lớp bạn đang học trong năm học này. Lớp học sẽ được giữ cố định và tự lên lớp vào đầu mỗi năm học mới.'} />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4, padding: 18 },
  title: { fontSize: 18, fontWeight: '900', color: t.ink },
  description: { fontSize: 14, lineHeight: 20, color: t.muted, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
    shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  screenTitle: { fontSize: 22, fontWeight: '900', color: t.ink },
});
