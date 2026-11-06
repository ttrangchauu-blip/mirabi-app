import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Typography';
import { PetArt } from '../../../components/PetArt';
import { usePetCheer } from '../../../games/engine/rig';
import type { Turn } from '../../../learning/types';
import { makeStyles } from '../../../ui/theme';
import { NumberPad } from './NumberPad';
import { DoorFrame } from '../../../games/art/wordForest';
import { ChoiceOption, ChoiceResult, markOf } from './AnswerFeedback';

type PetProps = { petId: string; petLevel: number; reduceMotion: boolean };

/** "Chọn đáp án ngữ pháp": the pet stands before the gates; the right answer opens the way. Four or long answers
 * ("has been waiting") are laid out two by two so every answer stays readable on a phone. Once answered (`result`) the
 * gates lock and are marked (the one chosen green or red, the right one green) above the explanation. */
export function GateChoice({ turn, onChoose, disabled, result, petId, petLevel, reduceMotion }: {
  turn: Turn; onChoose: (id: string) => void; disabled: boolean; result?: ChoiceResult | null } & PetProps) {
  const idle = useIdle();
  const styles = useStyles();
  const options = turn.prompt.options ?? [];
  const cheer = usePetCheer(petId, petLevel, !!result?.right, reduceMotion);
  const grid = options.length > 3 || options.some((o) => o.text.length > 10);
  return (
    <View style={styles.scene}>
      <View style={[styles.gates, grid && styles.gatesGrid]}>
        {options.map((option) => (
          <ChoiceOption key={option.id} label={`Đáp án ${option.text}`} onPress={() => onChoose(option.id)} disabled={disabled || !!result}
            mark={markOf(result, option.id)} idle={idle.gate} reduceMotion={reduceMotion}
            style={[styles.gate, grid && styles.gateGrid, disabled && !result && styles.dimmed]}>
            {grid ? null : <View style={styles.gateArch} pointerEvents="none"><DoorFrame size={40} /></View>}
            <Text style={[styles.gateText, grid && styles.gateTextGrid]}>{option.text}</Text>
          </ChoiceOption>
        ))}
      </View>
      <View style={styles.petRow} pointerEvents="none"><PetArt pet={petId} size={56} stage={petLevel} still={reduceMotion} cheer={cheer} /></View>
    </View>
  );
}

/** "Sắp xếp câu": tap the pieces in order to lay planks; every piece must be used. Each piece has its own id, so the same
 * word twice can be placed and removed one by one. The final punctuation is shown after the last plank. */
export function WordBridge({ turn, onSubmit, disabled, solved = false, petId, petLevel, reduceMotion }: { turn: Turn; onSubmit: (ids: string[]) => void; disabled: boolean;
  /** Answered right: the pet is glad. */ solved?: boolean } & PetProps) {
  const styles = useStyles();
  const cheer = usePetCheer(petId, petLevel, solved, reduceMotion);
  const tokens = turn.prompt.tokens ?? [];
  const [placed, setPlaced] = useState<string[]>([]);
  const text = (id: string) => tokens.find((tk) => tk.id === id)?.text ?? '';
  const complete = placed.length === tokens.length;
  const end = turn.prompt.end ?? '';
  return (
    <View style={styles.scene}>
      <View style={styles.bridgeRow}>
        <View pointerEvents="none"><PetArt pet={petId} size={52} stage={petLevel} still={reduceMotion} cheer={cheer} /></View>
        <View style={styles.bridge} accessibilityLabel={`Câu: ${placed.map(text).join(' ') || 'chưa có mảnh nào'}${placed.length ? end : ''}`}>
          {placed.length === 0 ? <Text style={styles.gapText}>Chạm vào các mảnh bên dưới để xếp câu</Text> : placed.map((id) => (
            <Pressable key={id} onPress={() => setPlaced((p) => p.filter((x) => x !== id))} disabled={disabled}
              accessibilityRole="button" accessibilityLabel={`Gỡ ${text(id)}`} style={styles.plank}>
              <Text style={styles.plankText}>{text(id)}</Text>
            </Pressable>
          ))}
          {placed.length && end ? <Text style={styles.endMark}>{end}</Text> : null}
        </View>
      </View>
      <View style={styles.tokens}>
        {tokens.filter((tk) => !placed.includes(tk.id)).map((tk) => (
          <Pressable key={tk.id} onPress={() => setPlaced((p) => [...p, tk.id])} disabled={disabled} accessibilityRole="button"
            accessibilityLabel={`Từ ${tk.text}`} style={({ pressed }) => [styles.token, pressed && styles.pressed]}>
            <Text style={styles.tokenText}>{tk.text}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => setPlaced([])} disabled={disabled || !placed.length} accessibilityRole="button" accessibilityLabel="Xếp lại"
          style={[styles.secondary, (!placed.length || disabled) && styles.dimmed]}><Text style={styles.secondaryText}>Xếp lại</Text></Pressable>
        <Pressable onPress={() => onSubmit(placed)} disabled={disabled || !complete} accessibilityRole="button" accessibilityLabel="Kiểm tra câu"
          accessibilityState={{ disabled: disabled || !complete }} style={[styles.primary, (!complete || disabled) && styles.dimmed]}>
          <Text style={styles.primaryText}>Kiểm tra</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "Xây cầu toán học": each correct answer finishes one span of the bridge. So sánh: the signs are options, marked once
 * answered (`result`). */
export function MathBridge({ turn, built, total, draft, setDraft, onSubmit, disabled, result, reduceMotion }: {
  turn: Turn; built: number; total: number; draft: string; setDraft: (v: string) => void; onSubmit: (answer: string) => void; disabled: boolean;
  result?: ChoiceResult | null; reduceMotion?: boolean;
}) {
  const idle = useIdle();
  const styles = useStyles();
  return (
    <View style={styles.scene}>
      <View style={styles.spans} accessibilityLabel={`Cầu đã xây ${built} trên ${total} đoạn`}>
        {Array.from({ length: total }, (_, i) => <View key={i} style={[styles.span, i < built && styles.spanBuilt]} />)}
      </View>
      {turn.kind === 'compare' ? (
        <View style={styles.compareRow}>
          {(turn.prompt.options ?? []).map((o) => (
            <ChoiceOption key={o.id} label={`Dấu ${o.text}`} onPress={() => onSubmit(o.id)} disabled={disabled || !!result}
              mark={markOf(result, o.id)} idle={idle.sign} reduceMotion={reduceMotion} style={[styles.sign, disabled && !result && styles.dimmed]}>
              <Text style={styles.signText}>{o.text}</Text>
            </ChoiceOption>
          ))}
        </View>
      ) : (
        <NumberPad value={draft} onChange={setDraft} onSubmit={() => onSubmit(draft)} allowNegative={!!turn.prompt.allow_negative}
          disabled={disabled} submitLabel="Đặt đoạn cầu" />
      )}
    </View>
  );
}

/** The options' colours before they are marked (ChoiceOption): golden gates, white sign cards. */
const useIdle = makeStyles(({ t, tones, dark }) => ({
  gate: { bg: dark ? tones.sun.from : '#FFF4E0', border: '#F2C46D' },
  sign: { bg: t.card, border: t.border },
}));

const useStyles = makeStyles(({ t, dark }) => StyleSheet.create({
  scene: { marginBottom: 10 },
  gates: { flexDirection: 'row', gap: 8 },
  gatesGrid: { flexWrap: 'wrap' },
  gateGrid: { flexBasis: '47%', flexGrow: 1, minHeight: 56, paddingVertical: 10 },
  gateTextGrid: { fontSize: 16 },
  endMark: { fontSize: 20, fontWeight: '900', color: t.ink, marginLeft: -2 },
  gate: { flex: 1, minHeight: 92, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: 8 },
  gateArch: { alignItems: 'center', marginBottom: 2 },
  gateText: { fontSize: 17, fontWeight: '900', color: t.ink, textAlign: 'center' },
  petRow: { alignItems: 'center', marginTop: 8 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  dimmed: { opacity: 0.5 },
  bridgeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bridge: { flex: 1, minHeight: 64, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: dark ? t.inputBorder : '#A9C9DD', padding: 6,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', backgroundColor: t.surfaceSecondary },
  gapText: { color: t.muted, fontSize: 13 },
  plank: { backgroundColor: '#C98B4E', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  plankText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  token: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 10 },
  tokenText: { fontSize: 16, fontWeight: '800', color: t.ink },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  secondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: t.tint, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.accent, fontWeight: '800', fontSize: 15 },
  primary: { flex: 2, minHeight: 46, borderRadius: 14, backgroundColor: t.accentFill, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: t.onPrimary, fontWeight: '900', fontSize: 15 },
  spans: { flexDirection: 'row', gap: 3, marginBottom: 12 },
  span: { flex: 1, height: 12, borderRadius: 4, backgroundColor: dark ? t.track : '#D4E3EC' },
  spanBuilt: { backgroundColor: '#C98B4E' },
  compareRow: { flexDirection: 'row', gap: 10 },
  sign: { flex: 1, minHeight: 64, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  signText: { fontSize: 30, fontWeight: '900', color: t.accent },
}));
