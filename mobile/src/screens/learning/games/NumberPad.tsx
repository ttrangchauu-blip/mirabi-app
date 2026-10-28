import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../components/Typography';
import { appTheme as t } from '../../../theme';

const MAX_LENGTH = 7;

/** Builds the next value of a number being typed. "±" toggles the sign; only digits are ever added. */
export function pressKey(value: string, key: string): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'sign') return value.startsWith('-') ? value.slice(1) : `-${value}`;
  if (!/^\d$/.test(key) || value.replace('-', '').length >= MAX_LENGTH) return value;
  return value === '0' ? key : value === '-0' ? `-${key}` : value + key;
}

export const isNumberDraft = (value: string) => /^-?\d+$/.test(value);
export const showNumber = (value: string) => value.replace('-', '−');

/** On-screen number keys: never covers the question like a system keyboard can, and offers ± for negative numbers. */
export function NumberPad({ value, onChange, onSubmit, allowNegative, disabled, submitLabel }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; allowNegative: boolean; disabled?: boolean; submitLabel: string;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowNegative ? 'sign' : '', '0', 'back'];
  return (
    <View>
      <View style={styles.display} accessibilityLabel={`Đáp án: ${value ? showNumber(value) : 'chưa nhập'}`}>
        <Text style={styles.displayText}>{value ? showNumber(value) : ' '}</Text>
      </View>
      <View style={styles.grid}>
        {keys.map((key, i) => key ? (
          <Pressable key={key} onPress={() => onChange(pressKey(value, key))} disabled={disabled} accessibilityRole="button"
            accessibilityLabel={key === 'back' ? 'Xóa' : key === 'sign' ? 'Đổi dấu âm dương' : key}
            style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
            {key === 'back' ? <Ionicons name="backspace-outline" size={22} color={t.ink} />
              : <Text style={styles.keyText}>{key === 'sign' ? '±' : key}</Text>}
          </Pressable>
        ) : <View key={`empty${i}`} style={[styles.key, styles.empty]} />)}
      </View>
      <Pressable onPress={onSubmit} disabled={disabled || !isNumberDraft(value)} accessibilityRole="button" accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: disabled || !isNumberDraft(value) }}
        style={[styles.submit, (disabled || !isNumberDraft(value)) && styles.dimmed]}>
        <Text style={styles.submitText}>{submitLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  display: { minHeight: 48, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: t.border, justifyContent: 'center', paddingHorizontal: 14, marginBottom: 8 },
  displayText: { fontSize: 24, fontWeight: '900', color: t.ink, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  key: { width: '31.9%', minHeight: 44, borderRadius: 12, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  empty: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.7 },
  keyText: { fontSize: 20, fontWeight: '800', color: t.ink },
  submit: { marginTop: 8, minHeight: 48, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  dimmed: { opacity: 0.5 },
});
