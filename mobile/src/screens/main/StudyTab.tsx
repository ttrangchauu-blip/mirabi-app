import React from 'react';
import { StyleSheet, View } from 'react-native';
import { BackHeader } from '../learning/GamePicker';
import type { FocusTimer } from './MainApp';
import { PomodoroPanel } from './PomodoroPanel';

type Props = { timer: FocusTimer; petId: string; petName: string | null; petLevel: number; userId: number;
  /** Back to the subject screen of "Học tập". The timer keeps running. */ onBack: () => void };

/** "Học tự chọn": the personal focus space (timer, duration, sounds, study tools), reached from the subject screen. */
export function StudyTab({ timer, petId, petName, petLevel, userId, onBack }: Props) {
  return (
    <>
      <View style={styles.studyHeader}>
        <BackHeader title="Học tự chọn" subtitle="Không gian tập trung cho nội dung học cá nhân" onBack={onBack} />
      </View>
      <PomodoroPanel timer={timer} petId={petId} petName={petName} petLevel={petLevel} userId={userId} />
    </>
  );
}

const styles = StyleSheet.create({
  studyHeader: { width: '100%', maxWidth: 1440, alignSelf: 'center' },
});
