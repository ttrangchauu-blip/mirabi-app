import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ITEM_ICONS } from '../itemArt';
import { itemThumb } from '../room/art';
import { Text } from './Typography';

/**
 * The picture of a walk find. A decoration is drawn from its room artwork (`art`) in its variant, so the inventory shows
 * exactly what goes into the room; every other item from its icon (itemArt.ts, per variant where it has some). An item
 * this app version has no drawing for shows the backend's emoji.
 */
export function ItemIcon({ id, variant = 'default', art, emoji, size = 40 }: { id: string; variant?: string; art?: string | null; emoji?: string; size?: number }) {
  const xml = (art ? itemThumb(art, variant) : null) ?? ITEM_ICONS[`${id}.${variant}`] ?? ITEM_ICONS[id];
  return (
    <View testID={`reward-art-${id}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {xml ? <SvgXml xml={xml} width={size} height={size} /> : <Text style={{ fontSize: size * 0.7 }}>{emoji ?? '🎁'}</Text>}
    </View>
  );
}
