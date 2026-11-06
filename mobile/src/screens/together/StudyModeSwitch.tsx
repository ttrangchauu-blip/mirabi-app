import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { makeStyles, useTheme } from '../../ui/theme';
import { Segmented } from '../../ui/kit';

export type StudyMode = 'personal' | 'together';

/** The two study modes side by side: the personal study space (focus timer and the English/Math games) and Study Together. */
export function StudyModeSwitch({ value, onChange }: { value: StudyMode; onChange: (mode: StudyMode) => void }) {
  return (
    <Segmented<StudyMode> value={value} onChange={onChange}
      options={[{ value: 'personal', label: 'Học cá nhân' }, { value: 'together', label: 'Học cùng bạn bè' }]} />
  );
}

const ROOMS = [
  { value: 'personal' as const, label: 'Phòng tập trung', icon: 'locate-outline' as const },
  { value: 'together' as const, label: 'Phòng học cùng bạn bè', icon: 'people-outline' as const },
];

/** In "Học tự chọn": the focus room and the room with friends. Switching only changes what is on screen: a session running in either goes on. */
export function StudyRoomTabs({ value, onChange }: { value: StudyMode; onChange: (mode: StudyMode) => void }) {
  const { t } = useTheme();
  const s = useStyles();
  return (
    <View style={s.tabs} accessibilityRole="tablist">
      {ROOMS.map((room) => {
        const active = room.value === value;
        return (
          <Pressable key={room.value} onPress={() => { if (!active) onChange(room.value); }} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={room.label}
            style={[s.tab, room.value === 'together' && s.tabWide, active && s.tabActive]}>
            <Ionicons name={room.icon} size={17} color={active ? t.accent : t.muted} />
            <Text numberOfLines={1} style={[s.label, active && s.labelActive]}>{room.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ t, dark }) => {
  // The tab bar is a thin pane over the backdrop: lighter than t.glass so the screen behind shows through.
  const tabsBg = dark ? 'rgba(24,37,62,0.6)' : 'rgba(255,255,255,0.55)';
  return StyleSheet.create({
    tabs: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 24, marginBottom: 12, backgroundColor: tabsBg, borderWidth: 1, borderColor: t.glassBorder },
    tab: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4, borderRadius: 20 },
    tabWide: { flex: 1.26 },
    tabActive: { backgroundColor: t.card, shadowColor: t.shadow, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    label: { flexShrink: 1, fontSize: 11.5, fontWeight: '700', color: t.muted },
    labelActive: { color: t.accent, fontWeight: '800' },
  });
});
