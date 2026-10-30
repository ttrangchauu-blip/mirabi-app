import React, { useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AGES, gradeChoices, gradeLabel, suggestGrade, type GradeId } from '../studyProfile';
import { authTheme } from '../theme';
import { AppModal } from '../ui/AppModal';
import { Text } from './Typography';

type Props = {
  age: number | null;
  grade: GradeId | null;
  /** Picking an age also picks the grade it suggests; the user can then change the grade. */
  onChange: (age: number, grade: GradeId) => void;
  errors?: { age?: string; grade?: string };
  disabled?: boolean;
};

const COLUMNS = 6;
const ROW = 52; // cell height + gap

/** "Độ tuổi" (a number picker, nothing typed and nothing chosen in advance) and, once an age is chosen, "Lớp học gợi ý":
 * the grade the age suggests, with the other grades plausible at that age, since age alone does not tell the grade. */
export function StudyProfileFields({ age, grade, onChange, errors, disabled }: Props) {
  const [picking, setPicking] = useState(false);
  const suggested = age === null ? null : suggestGrade(age);
  return (
    <View>
      <View style={styles.field}>
        <Text style={styles.label}>Độ tuổi</Text>
        <Pressable onPress={() => { Keyboard.dismiss(); setPicking(true); }} disabled={disabled} accessibilityRole="button"
          accessibilityLabel="Độ tuổi" accessibilityValue={{ text: age === null ? 'Chưa chọn' : `${age} tuổi` }}
          accessibilityHint={errors?.age} testID="age-picker"
          style={({ pressed }) => [styles.inputRow, !!errors?.age && styles.inputError, pressed && styles.pressed]}>
          <Ionicons name="calendar-outline" size={20} color={errors?.age ? authTheme.error : '#6F8BA3'} style={styles.icon} />
          <Text style={[styles.value, age === null && styles.placeholder]}>{age === null ? 'Chọn độ tuổi' : `${age} tuổi`}</Text>
          <Ionicons name="chevron-down" size={20} color={authTheme.link} style={styles.chevron} />
        </Pressable>
        {errors?.age ? <Text style={styles.error} accessibilityLiveRegion="polite">{errors.age}</Text>
          : age === null ? <Text style={styles.hint}>Dùng để gợi ý lớp học, môn và trò chơi phù hợp.</Text> : null}
      </View>

      {age !== null && suggested ? (
        <View style={styles.field}>
          <Text style={styles.label}>Lớp học gợi ý</Text>
          <Text style={styles.hint}>Theo tuổi, gợi ý là {gradeLabel(suggested)}. Chọn lại nếu chưa đúng lớp bạn đang học.</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {gradeChoices(age).map((g) => {
              const selected = g.id === grade;
              return (
                <Pressable key={g.id} onPress={() => onChange(age, g.id)} disabled={disabled} accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled }} accessibilityLabel={g.id === suggested ? `${g.label}, gợi ý theo tuổi` : g.label}
                  style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}>
                  {g.id === suggested ? <Ionicons name="sparkles" size={13} color={selected ? '#FFFFFF' : authTheme.link} /> : null}
                  <Text style={[styles.chipText, selected && styles.chipTextOn]}>{g.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {errors?.grade ? <Text style={styles.error} accessibilityLiveRegion="polite">{errors.grade}</Text> : null}
        </View>
      ) : null}

      <AgePicker visible={picking} value={age} onClose={() => setPicking(false)}
        onPick={(picked) => { setPicking(false); if (picked !== age) onChange(picked, suggestGrade(picked)); }} />
    </View>
  );
}

function AgePicker({ visible, value, onPick, onClose }: { visible: boolean; value: number | null; onPick: (age: number) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  // Opens on the chosen age (or the start of the list): no scrolling to find it again.
  const row = value === null ? 0 : Math.floor(AGES.indexOf(value) / COLUMNS);
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Đóng" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} accessibilityRole="header">Chọn độ tuổi</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Đóng chọn độ tuổi" style={styles.close}>
            <Ionicons name="close" size={20} color={authTheme.muted} />
          </Pressable>
        </View>
        <ScrollView ref={scroll} contentContainerStyle={styles.grid} onLayout={() => scroll.current?.scrollTo({ y: Math.max(0, row - 1) * ROW, animated: false })}>
          {AGES.map((n) => {
            const selected = n === value;
            return (
              <View key={n} style={styles.cellWrap}>
                <Pressable onPress={() => onPick(n)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${n} tuổi`}
                  style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.pressed]}>
                  <Text style={[styles.cellText, selected && styles.chipTextOn]}>{n}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  // Same field look as AuthTextField.
  label: { fontSize: 13, fontWeight: '800', color: authTheme.ink, marginBottom: 6, marginLeft: 2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4FAFE', borderRadius: 16, borderWidth: 1.5, borderColor: '#D7EAF5', minHeight: 54 },
  inputError: { borderColor: authTheme.error },
  icon: { marginLeft: 14 },
  value: { flex: 1, paddingHorizontal: 10, fontSize: 16, color: authTheme.ink },
  placeholder: { color: '#7F95A8' },
  chevron: { marginRight: 14 },
  pressed: { opacity: 0.85 },
  error: { color: authTheme.error, fontSize: 13, marginTop: 5, marginLeft: 2 },
  hint: { color: authTheme.muted, fontSize: 12, lineHeight: 17, marginTop: 5, marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: '#F4FAFE', borderWidth: 1.5, borderColor: '#D7EAF5' },
  chipOn: { backgroundColor: authTheme.link, borderColor: authTheme.link },
  chipText: { fontSize: 14, fontWeight: '800', color: authTheme.ink },
  chipTextOn: { color: '#FFFFFF' },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,36,56,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%', backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  sheetTitle: { flex: 1, fontSize: 19, fontWeight: '900', color: authTheme.ink },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4FAFE', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 8, width: '100%', maxWidth: 480, alignSelf: 'center' },
  cellWrap: { width: `${100 / COLUMNS}%`, height: ROW, padding: 4 },
  cell: { flex: 1, borderRadius: 14, backgroundColor: '#F4FAFE', alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: authTheme.link },
  cellText: { fontSize: 16, fontWeight: '800', color: authTheme.ink },
});
