import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** "Phòng cá nhân" in the menu: a house with a heart, drawn with the Ionicons outline weight (32 on 512) so it sits
 * with the other tab icons but never reads as "Trang chủ". Selected, the heart is filled. */
export function RoomTabIcon({ size, color, selected }: { size: number; color: string; selected: boolean }) {
  // Hidden from screen readers on the wrapper: react-native-svg hands unknown props to the DOM <svg> on web.
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Path d="M48 244L256 60l208 184" fill="none" stroke={color} strokeWidth={32} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M96 204v228a24 24 0 0 0 24 24h272a24 24 0 0 0 24-24V204" fill="none" stroke={color} strokeWidth={32}
        strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M256 398c-8 0-76-44-88-88-9-33 13-62 44-62 19 0 34 11 44 26 10-15 25-26 44-26 31 0 53 29 44 62-12 44-80 88-88 88Z"
        fill={selected ? color : 'none'} stroke={color} strokeWidth={28} strokeLinejoin="round" />
    </Svg>
    </View>
  );
}
