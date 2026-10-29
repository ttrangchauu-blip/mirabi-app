import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Typography';

/**
 * The answer boxes that ride in a falling word's frame, under its text: one box per letter (so the length is clear),
 * filled as the user types. They only show the answer: the text field itself is one field for the whole play field
 * (see Playfield), so moving targets, switching target or a word breaking never closes and reopens the keyboard.
 */
export function AnswerSlots({ letters, value, width, compact = false, onPress }: {
  /** Letters per word of the answer, e.g. [3] for "cat", [6, 3] for two words. */
  letters?: number[];
  value: string;
  width: number;
  /** A target that is not aimed at: small empty boxes. */
  compact?: boolean;
  /** Tapping the boxes answers this target (opens the keyboard). */
  onPress?: () => void;
}) {
  const total = letters?.reduce((a, b) => a + b, 0) ?? 0;
  const gap = compact ? 5 : 8;
  const min = compact ? 8 : 14;
  // One box per letter while they fit; a long phrase ("a blessing in disguise") gets a plain field that says its size.
  const boxes = !!letters?.length && total * (min + 4) + (letters.length - 1) * gap + 8 <= width;
  const typed = value.replace(/\s+/g, '');
  let body: React.ReactNode;
  if (!boxes || !letters) {
    const hint = letters?.length ? `${letters.length > 1 ? `${letters.length} từ, ` : ''}${total} chữ cái` : 'Gõ từ tiếng Anh…';
    body = (
      <View style={[styles.plain, compact && styles.plainCompact, { width: Math.max(compact ? 60 : 110, width - 8) }]}>
        <Text style={[styles.plainText, !value && styles.placeholder, compact && styles.plainTextCompact]} numberOfLines={1}>{value || hint}</Text>
      </View>
    );
  } else {
    const slot = Math.max(min, Math.min(compact ? 11 : SLOT_MAX, Math.floor((width - 8 - (letters.length - 1) * gap) / total) - 3));
    let index = 0;
    body = (
      <View style={[styles.slots, { gap }]}>
        {letters.map((count, word) => (
          <View key={word} style={[styles.word, compact && styles.wordCompact]}>
            {Array.from({ length: count }, () => {
              const ch = compact ? undefined : typed[index];
              const isLast = index === total - 1;
              index += 1;
              return (
                <View key={index} style={[styles.slot, compact && styles.slotCompact, { width: slot, height: slot + (compact ? 3 : 6) }, ch ? styles.slotFilled : null]}>
                  {compact ? null : <Text style={[styles.letter, { fontSize: slot * 0.66 }]}>{isLast && typed.length > total ? '…' : ch ?? ''}</Text>}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }
  if (!onPress) return <View pointerEvents="none">{body}</View>;
  return <Pressable onPress={onPress} accessible={false}>{body}</Pressable>;
}

/** The largest letter box, and the room one letter takes (box and gap): the aimed target is sized from it. */
const SLOT_MAX = 19;
export const SLOT_PITCH = SLOT_MAX + 3;

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', padding: 3 },
  word: { flexDirection: 'row', gap: 3 },
  wordCompact: { gap: 2 },
  slot: { borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.38)', backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center' },
  slotCompact: { borderRadius: 4, borderWidth: 1 },
  // A typed letter: a bright tile, so what has been typed reads at a glance on the night sky.
  slotFilled: { borderColor: '#FFFFFF', backgroundColor: '#FFFFFF' },
  letter: { color: '#142349', fontWeight: '800' },
  plain: { minHeight: 32, maxWidth: 240, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, justifyContent: 'center' },
  plainCompact: { minHeight: 22, borderRadius: 8, borderWidth: 1, paddingHorizontal: 6 },
  plainText: { fontSize: 14, color: '#FFFFFF' },
  plainTextCompact: { fontSize: 11 },
  placeholder: { color: '#9FB0D6' },
});
