import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { REWARD_ART } from '../rewardArt';
import { Text } from './Typography';

/** Picture of a pet walk reward. Items the app has no drawing for yet fall back to the backend's emoji. */
export function RewardItemArt({ id, emoji, size = 30 }: { id: string; emoji: string; size?: number }) {
  const xml = REWARD_ART[id];
  return <View testID={`reward-art-${id}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
    {xml ? <SvgXml xml={xml} width={size} height={size} /> : <Text style={{ fontSize: size * 0.75 }}>{emoji}</Text>}
  </View>;
}
