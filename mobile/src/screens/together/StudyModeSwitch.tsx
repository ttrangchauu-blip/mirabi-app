import React from 'react';
import { Segmented } from '../../ui/kit';

export type StudyMode = 'personal' | 'together';

/** The two study modes side by side: the personal study space (focus timer and the English/Math games) and Study Together. */
export function StudyModeSwitch({ value, onChange }: { value: StudyMode; onChange: (mode: StudyMode) => void }) {
  return (
    <Segmented<StudyMode> value={value} onChange={onChange}
      options={[{ value: 'personal', label: 'Học cá nhân' }, { value: 'together', label: 'Học cùng bạn bè' }]} />
  );
}
