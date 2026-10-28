import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { GAME_INFO, gameTitle } from '../../learning/labels';
import { TUTORIALS } from '../../learning/tutorials';
import type { GameId } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { Button } from '../../ui/kit';
import { TutorialArt } from './TutorialArt';

type Props = {
  game: GameId;
  petId: string;
  petLevel: number;
  reduceMotion: boolean;
  /** The last page's button: "Bắt đầu" (only it finishes the guide), or "Đã hiểu" when read again during a game. */
  finishLabel?: string;
  onFinish: () => void;
  /** Close without finishing: the guide shows again next time. */
  onClose: () => void;
  /** "Bắt đầu" is on its way (the game is being prepared). */
  busy?: boolean;
};

/** "Cách chơi": a game's own guide, 2–3 short pages (goal, controls, how it ends), each with an animated copy of the
 * game. Nothing runs behind it: no session, no clock, no question. */
export function GameTutorial({ game, petId, petLevel, reduceMotion, finishLabel = 'Bắt đầu', onFinish, onClose, busy = false }: Props) {
  const pages = TUTORIALS[game];
  const [index, setIndex] = useState(0);
  // One tap on "Bắt đầu" is enough: a second one never starts a second game.
  const [finished, setFinished] = useState(false);
  const page = pages[index];
  const last = index === pages.length - 1;
  const finish = () => {
    if (finished) return;
    setFinished(true);
    onFinish();
  };
  const text = (
    <>
      <Text style={styles.pageTitle} accessibilityLiveRegion="polite">{page.title}</Text>
      <Text style={styles.body}>{page.body}</Text>
    </>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.gameIcon}><Ionicons name={GAME_INFO[game].icon} size={22} color={t.accent} /></View>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.title}>Cách chơi</Text>
          <Text style={styles.subtitle}>{gameTitle(game)}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Đóng hướng dẫn" hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={24} color={t.ink} />
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{page.tag}</Text>
          <Text style={styles.count} accessibilityLabel={`Trang ${index + 1} trên ${pages.length}`}>{index + 1}/{pages.length}</Text>
        </View>
        {/* A page of rules reads as text: its title comes first. */}
        {page.scene.kind === 'rules' ? text : null}
        <TutorialArt key={`${game}.${index}`} scene={page.scene} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} />
        {page.scene.kind === 'rules' ? null : text}
      </View>

      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {pages.map((p, i) => <View key={p.tag + i} style={[styles.dot, i === index && styles.dotOn]} />)}
      </View>

      <View style={styles.actions}>
        {index > 0 ? (
          <Button title="Trước" icon="chevron-back" variant="secondary" style={styles.back} disabled={finished} onPress={() => setIndex((i) => i - 1)} />
        ) : null}
        {last ? (
          <Button title={finishLabel} icon="play" style={styles.flex} loading={busy} disabled={finished} onPress={finish} />
        ) : (
          <Button title="Tiếp" icon="chevron-forward" style={styles.flex} onPress={() => setIndex((i) => i + 1)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gameIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 23, fontWeight: '900', color: t.ink },
  subtitle: { fontSize: 14, color: t.muted, marginTop: 2 },
  close: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 14, gap: 10,
    shadowColor: '#0B4F75', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  tagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { fontSize: 12, fontWeight: '900', color: t.accent, backgroundColor: t.tint, textTransform: 'uppercase', letterSpacing: 0.4,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  count: { fontSize: 14, fontWeight: '900', color: t.muted },
  pageTitle: { fontSize: 21, fontWeight: '900', color: t.ink },
  body: { fontSize: 16, color: t.ink, lineHeight: 23 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C3DCEB' },
  dotOn: { width: 22, backgroundColor: t.accent },
  actions: { flexDirection: 'row', gap: 10 },
  back: { minWidth: 110 },
});
