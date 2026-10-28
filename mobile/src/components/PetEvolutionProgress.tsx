import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from './PetArt';
import { PetHatch } from './PetHatch';
import { Text } from './Typography';
import { appTheme as t } from '../theme';
import { ProgressBar, formatNumber } from '../ui/kit';

/** Cumulative EXP that reaches each stage (backend progression.py); shown wherever the pet's EXP progress appears. */
export const PET_THRESHOLDS = [0, 300, 800, 1500, 2400, 3500, 5000];
const THRESHOLDS = PET_THRESHOLDS;
export const PET_STAGE_NAMES = ['Tr\u1ee9ng Pet', 'S\u01a1 Sinh', 'Ph\u00e1t Tri\u1ec3n', 'N\u00e2ng Cao', 'Tr\u01b0\u1edfng Th\u00e0nh', '\u0110\u1ea1i Th\u1ea7n', 'T\u1ed1i Th\u01b0\u1ee3ng'];

type Props = { pet: string; currentPetLevel: number; totalExp: number;
  /** The egg has just reached Lv.1: hatch it here, then call `onHatched`. */ hatching?: boolean; onHatched?: () => void };

export function PetEvolutionProgress({ pet, currentPetLevel, totalExp, hatching = false, onHatched }: Props) {
  const currentLevel = Math.max(0, Math.min(6, currentPetLevel));
  const exp = Math.max(0, totalExp);
  const [viewingPetLevel, setViewingPetLevel] = useState(currentLevel);
  const [direction, setDirection] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const currentNextThreshold = currentLevel < 6 ? THRESHOLDS[currentLevel + 1] : THRESHOLDS[6];
  const fraction = currentLevel === 6 ? 1 : Math.max(0, Math.min(1, exp / currentNextThreshold));
  const isViewingCurrent = viewingPetLevel === currentLevel;
  const isLockedPreview = viewingPetLevel > currentLevel;
  // The hatching plays where the pet is shown: 'egg' while the shell cracks, 'out' while the pet pops out.
  const [hatchPhase, setHatchPhase] = useState<'egg' | 'out' | null>(null);
  const [justHatched, setJustHatched] = useState(false);
  const shownLevel = hatchPhase === 'egg' ? 0 : viewingPetLevel;

  useEffect(() => setViewingPetLevel(currentLevel), [currentLevel]);
  useEffect(() => {
    if (!hatching || hatchPhase) return;
    setViewingPetLevel(currentLevel);
    setHatchPhase('egg');
  }, [hatching, hatchPhase, currentLevel]);
  useEffect(() => {
    if (!direction) return;
    slide.setValue(direction * 24);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 3 }).start();
  }, [viewingPetLevel, direction, slide]);

  function navigateTo(level: number) {
    const boundedLevel = Math.max(0, Math.min(6, level));
    if (boundedLevel === viewingPetLevel || hatchPhase) return;
    setJustHatched(false);
    setDirection(boundedLevel > viewingPetLevel ? -1 : 1);
    setViewingPetLevel(boundedLevel);
  }

  const stateLabel = hatchPhase === 'egg' ? 'Tr\u1ee9ng \u0111ang n\u1edf\u2026'
    : isViewingCurrent ? (justHatched ? 'V\u1eeba n\u1edf!' : 'C\u1ea5p hi\u1ec7n t\u1ea1i')
    : isLockedPreview ? 'Ch\u01b0a m\u1edf kh\u00f3a' : 'C\u1ea5p tr\u01b0\u1edbc';
  const expLabel = currentLevel === 6
    ? `${formatNumber(exp)} EXP \u00b7 \u0110\u00e3 \u0111\u1ea1t c\u1ea5p t\u1ed1i \u0111a`
    : `${formatNumber(exp)} / ${formatNumber(currentNextThreshold)} EXP \u00b7 c\u00f2n ${formatNumber(Math.max(0, currentNextThreshold - exp))} EXP`;

  return <View style={styles.progress}>
    <View style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text style={styles.title}>{'Ti\u1ebfn tr\u00ecnh ti\u1ebfn h\u00f3a'}</Text>
        <Text style={styles.subtitle}>{`Pet Lv.${currentLevel} \u00b7 ${formatNumber(exp)} EXP`}</Text>
      </View>
      {!isViewingCurrent && <Pressable onPress={() => navigateTo(currentLevel)} accessibilityRole="button" style={styles.returnButton}>
        <Text style={styles.returnText}>{'Quay v\u1ec1 pet hi\u1ec7n t\u1ea1i'}</Text>
      </Pressable>}
    </View>

    <View style={styles.viewer}>
      <Pressable onPress={() => navigateTo(viewingPetLevel - 1)} disabled={viewingPetLevel === 0 || !!hatchPhase}
        accessibilityRole="button" accessibilityLabel={'Xem c\u1ea5p tr\u01b0\u1edbc'} style={styles.arrow}>
        <Ionicons name="chevron-back" size={18} color={viewingPetLevel === 0 || hatchPhase ? '#B7CBD8' : t.accent} />
      </Pressable>
      <Animated.View style={[styles.petFocus, { transform: [{ translateX: slide }] }]}>
        <View style={[styles.petImage, isLockedPreview && styles.lockedPreview]}>
          {/* Only the pet as it is now comes alive; earlier stages are a still picture, and stages still to come
              only a faint shape, so the next form stays a surprise. */}
          {hatchPhase ? <PetHatch pet={pet} stage={currentLevel} size={142}
            onCracked={() => { setHatchPhase('out'); setJustHatched(true); }}
            onDone={() => { setHatchPhase(null); onHatched?.(); }} />
            : <PetArt pet={pet} size={142} stage={viewingPetLevel} still={!isViewingCurrent} silhouette={isLockedPreview} />}
        </View>
        <Text style={styles.viewingLevel}>{`Lv.${shownLevel} ${PET_STAGE_NAMES[shownLevel]}`}</Text>
        <Text style={[styles.viewingStatus, isLockedPreview && styles.lockedLabel]}>{stateLabel}</Text>
      </Animated.View>
      <Pressable onPress={() => navigateTo(viewingPetLevel + 1)} disabled={viewingPetLevel === 6 || !!hatchPhase}
        accessibilityRole="button" accessibilityLabel={'Xem c\u1ea5p ti\u1ebfp theo'} style={styles.arrow}>
        <Ionicons name="chevron-forward" size={18} color={viewingPetLevel === 6 || hatchPhase ? '#B7CBD8' : t.accent} />
      </Pressable>
    </View>

    <View style={styles.expRow}>
      <Text style={styles.expLabel}>{expLabel}</Text>
      {!isViewingCurrent && <Text style={styles.viewingHint}>{stateLabel}</Text>}
    </View>
    <ProgressBar value={fraction} animated />
  </View>;
}

const styles = StyleSheet.create({
  progress: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: 'rgba(19,111,168,0.10)' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  headingCopy: { flex: 1 },
  title: { fontSize: 15, fontWeight: '900', color: t.ink }, subtitle: { fontSize: 11, color: t.muted, marginTop: 2 },
  returnButton: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: t.tint },
  returnText: { fontSize: 10, fontWeight: '800', color: t.accent },
  viewer: { minHeight: 170, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 30, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.66)' },
  petFocus: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  petImage: { width: 146, height: 142, alignItems: 'center', justifyContent: 'center' },
  lockedPreview: { opacity: 0.6 },
  viewingLevel: { fontSize: 13, fontWeight: '900', color: t.ink, textAlign: 'center' },
  viewingStatus: { fontSize: 10, fontWeight: '800', color: t.accent, marginTop: 1 },
  lockedLabel: { color: t.muted },
  expRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7, gap: 8 },
  expLabel: { flex: 1, fontSize: 11, fontWeight: '800', color: t.accent },
  viewingHint: { fontSize: 10, color: t.muted },
});
