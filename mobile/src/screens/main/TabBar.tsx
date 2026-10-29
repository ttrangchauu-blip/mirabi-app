import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RoomTabIcon } from '../../components/RoomTabIcon';
import { Text } from '../../components/Typography';
import { TabKey, TABS } from '../../tabs';
import { appTheme as t } from '../../theme';

/** The bar's rounded top corners: a screen drawn edge to edge (the personal room) goes on this far under the bar. */
export const TAB_BAR_RADIUS = 26;

/** `badges`: a count shown on a tab's icon, hidden at 0 (friend requests waiting on "Bạn bè"). */
export function TabBar({ active, onChange, bottomInset, badges }: {
  active: TabKey; onChange: (key: TabKey) => void; bottomInset: number; badges?: Partial<Record<TabKey, number>>;
}) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, 10) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const count = badges?.[tab.key as TabKey] ?? 0;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key as TabKey)} style={styles.item}
            accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
            accessibilityValue={count > 0 ? { text: `${count} lời mời kết bạn đang chờ` } : undefined}>
            <View style={[styles.iconWrap, selected && styles.iconWrapActive]}>
              {tab.key === 'Room'
                ? <RoomTabIcon size={22} color={selected ? t.accent : t.muted} selected={selected} />
                : <Ionicons name={selected ? tab.iconActive : tab.icon} size={22} color={selected ? t.accent : t.muted} />}
              {count > 0 ? <View style={styles.badge} testID={`tab-badge-${tab.key}`}><Text style={styles.badgeText}>{Math.min(99, count)}</Text></View> : null}
            </View>
            {/* Two lines rather than an ellipsis: "Phòng cá nhân" is wider than a tab on most phones. */}
            <Text style={[styles.label, selected && styles.labelActive]} numberOfLines={2}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#FFFFFF', paddingTop: 8, paddingHorizontal: 8, borderTopLeftRadius: TAB_BAR_RADIUS,
    borderTopRightRadius: TAB_BAR_RADIUS,
    shadowColor: t.shadow, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  item: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-start', minHeight: 54 },
  iconWrap: { width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconWrapActive: { backgroundColor: t.tint },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '700', color: t.muted, marginTop: 3, textAlign: 'center', paddingHorizontal: 1 },
  labelActive: { color: t.accent, fontWeight: '800' },
  badge: { position: 'absolute', top: -3, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: t.danger,
    borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10, lineHeight: 12, fontWeight: '900' },
});
