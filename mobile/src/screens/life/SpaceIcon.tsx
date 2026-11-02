import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import type { LifeSpace } from './spaces';

/** The four places, drawn in one small illustrated style: soft filled shapes with a dark ink edge. Dimmed when not the
 * current place, so the one you are in stands out without changing shape. */
export function SpaceIcon({ space, size = 24, active = true }: { space: LifeSpace; size?: number; active?: boolean }) {
  const ink = active ? '#17476B' : '#55718A';
  const edge = { stroke: ink, strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const fill = (color: string, quiet: string) => (active ? color : quiet);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {space === 'home' ? <>
        <Path d="M4 11.2 12 4l8 7.2V20H4Z" fill={fill('#FFE3A1', '#E7EEF3')} {...edge} />
        <Path d="M2.8 11.8 12 3.4l9.2 8.4" fill="none" {...edge} />
        <Path d="M12 17.8c-2.6-1.7-3.6-3-3.6-4.2 0-1 .8-1.7 1.7-1.7.8 0 1.5.4 1.9 1.1.4-.7 1.1-1.1 1.9-1.1.9 0 1.7.7 1.7 1.7 0 1.2-1 2.5-3.6 4.2Z" fill={fill('#F2709B', '#B9C8D4')} stroke="none" />
      </> : null}
      {space === 'garden' ? <>
        <Ellipse cx="12" cy="19" rx="8.5" ry="2.8" fill={fill('#B98A5E', '#D9E2E9')} {...edge} />
        <Path d="M12 18V10" fill="none" {...edge} />
        <Path d="M12 12c-4.6.3-6.2-2.2-6.4-5.4 3.6-.1 6 1.4 6.4 5.4Z" fill={fill('#7BCF7A', '#E7EEF3')} {...edge} />
        <Path d="M12 9.8c.4-3.2 2.4-5.2 6.4-5.4.1 3.4-1.9 5.6-6.4 5.4Z" fill={fill('#9BE08F', '#E7EEF3')} {...edge} />
      </> : null}
      {space === 'explore' ? <>
        <Circle cx="12" cy="12" r="8.6" fill={fill('#BFE6FA', '#E7EEF3')} {...edge} />
        <Path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3Z" fill={fill('#F2845C', '#B9C8D4')} {...edge} />
        <Circle cx="12" cy="12" r="1" fill={ink} />
      </> : null}
      {space === 'friends' ? <>
        <Circle cx="8.6" cy="9" r="3.4" fill={fill('#F7B5CB', '#E7EEF3')} {...edge} />
        <Path d="M2.8 19.4c.3-3.6 2.6-5.6 5.8-5.6s5.5 2 5.8 5.6Z" fill={fill('#F7B5CB', '#E7EEF3')} {...edge} />
        <Circle cx="16.2" cy="8.2" r="2.9" fill={fill('#C3B9F5', '#E7EEF3')} {...edge} />
        <Path d="M16.4 13c2.8.1 4.6 2 4.9 5.2h-5" fill={fill('#C3B9F5', '#E7EEF3')} {...edge} />
      </> : null}
    </Svg>
    </View>
  );
}
