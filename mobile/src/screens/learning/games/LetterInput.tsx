import React, { useRef } from 'react';
import { Pressable, StyleSheet, TextInput as RNTextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../../../components/Typography';

type Props = {
  /** Letters per word of the answer, e.g. [3] for "cat", [6, 3] for two words. */
  letters?: number[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  editable: boolean;
  width: number;
};

const FIRE = 66;

/** The meteor's answer: one box per letter (so the length is clear), filled as the user types, plus the fire button.
 * The real text field sits over the boxes, so tapping them opens the keyboard and typing fills them. */
export function LetterInput({ letters, value, onChange, onSubmit, disabled, editable, width }: Props) {
  const input = useRef<RNTextInput>(null);
  const canFire = !disabled && !!value.trim();
  const fire = (
    <Pressable onPress={onSubmit} disabled={!canFire} accessibilityRole="button" accessibilityLabel="Bắn"
      accessibilityState={{ disabled: !canFire }} style={[styles.fire, !canFire && styles.fireIdle]}>
      <Ionicons name="flame" size={17} color={canFire ? '#FFFFFF' : 'rgba(255,255,255,0.6)'} />
      <Text style={[styles.fireText, !canFire && styles.fireTextIdle]}>Bắn</Text>
    </Pressable>
  );
  const total = letters?.reduce((a, b) => a + b, 0) ?? 0;
  // One box per letter while they fit; a long phrase ("a blessing in disguise") gets a plain field that says its size.
  const boxes = !!letters?.length && total * 20 + (letters.length - 1) * 10 + FIRE + 22 <= width;
  const field = (style: object) => (
    <TextInput ref={input} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} spellCheck={false} autoFocus
      returnKeyType="send" onSubmitEditing={onSubmit} editable={editable} maxLength={40} accessibilityLabel="Đáp án tiếng Anh"
      placeholder={boxes ? undefined : letters?.length ? `${letters.length > 1 ? `${letters.length} từ, ` : ''}${total} chữ cái` : 'Gõ từ tiếng Anh…'}
      placeholderTextColor="#9FB0D6" caretHidden={boxes} style={style} />
  );
  if (!boxes || !letters) {
    return <View style={[styles.row, { width: Math.max(160, width - 8) }]}>{field(styles.plain)}{fire}</View>;
  }
  const slot = Math.max(16, Math.min(28, Math.floor((width - FIRE - 14 - (letters.length - 1) * 10) / total) - 4));
  const typed = value.replace(/\s+/g, '');
  let index = 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable onPress={() => input.current?.focus()} accessible={false} style={styles.slots}>
          {letters.map((count, word) => (
            <View key={word} style={styles.word}>
              {Array.from({ length: count }, () => {
                const ch = typed[index];
                const isLast = index === total - 1;
                index += 1;
                return (
                  <View key={index} style={[styles.slot, { width: slot, height: slot + 8 }, ch ? styles.slotFilled : null]}>
                    <Text style={[styles.letter, { fontSize: slot * 0.7 }]}>{isLast && typed.length > total ? '…' : ch ?? ''}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          {field(styles.overlay)}
        </Pressable>
        {fire}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  slots: { flexDirection: 'row', gap: 10, padding: 4 },
  word: { flexDirection: 'row', gap: 4 },
  slot: { borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.38)', backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center' },
  // A typed letter: a bright tile, so what has been typed reads at a glance on the night sky.
  slotFilled: { borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' },
  letter: { color: '#142349', fontWeight: '900' },
  overlay: { ...StyleSheet.absoluteFillObject, opacity: 0.02, color: 'transparent', fontSize: 16 },
  plain: { flex: 1, minWidth: 0, maxWidth: 260, minHeight: 40, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, fontSize: 17, color: '#FFFFFF' },
  fire: { width: FIRE, height: 40, borderRadius: 20, backgroundColor: '#FF7A3D', flexDirection: 'row', gap: 4, alignItems: 'center',
    justifyContent: 'center', shadowColor: '#FF7A3D', shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  fireIdle: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', shadowOpacity: 0, elevation: 0 },
  fireText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  fireTextIdle: { color: 'rgba(255,255,255,0.6)' },
});
