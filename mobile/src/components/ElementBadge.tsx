import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Element } from '../elements';
import { Text } from './Typography';

/** Compact pill showing the pet's element. */
export function ElementBadge({ element, compact }: { element: Element; compact?: boolean }) {
  const fullLabel = `H\u1ec7 ${element.label}`;
  return (
    <View style={[styles.badge, compact && styles.compact, { backgroundColor: element.bg }]} accessibilityLabel={fullLabel}>
      <Text style={[styles.text, compact && styles.textCompact, { color: element.color }]}>
        {element.icon} {compact ? element.label : fullLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  compact: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 13, fontWeight: '800' },
  textCompact: { fontSize: 11 },
});
