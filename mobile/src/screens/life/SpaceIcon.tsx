import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { useTheme } from '../../ui/theme';
import type { LifeSpace } from './spaces';

/** The four places, drawn in one small illustrated style: soft filled shapes with a dark ink edge. Dimmed when not the
 * current place, so the one you are in stands out without changing shape. */
/** A place that isn't the current one: its shapes go quiet in the interface's own greys, so they stay readable on a dark bar. */
const QUIET = {
  light: { edge: '#55718A', pale: '#E7EEF3', mid: '#B9C8D4', soil: '#D9E2E9' },
  dark: { edge: '#A8BCD2', pale: '#2C4264', mid: '#4A5D78', soil: '#34507A' },
};

export function SpaceIcon({ space, size = 24, active = true }: { space: LifeSpace; size?: number; active?: boolean }) {
  const q = QUIET[useTheme().scheme];
  const ink = active ? '#17476B' : q.edge;
  const edge = { stroke: ink, strokeWidth: 1.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const fill = (color: string, quiet: string) => (active ? color : quiet);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {space === 'home' ? <>
        <Path d="M4 11.2 12 4l8 7.2V20H4Z" fill={fill('#FFE3A1', q.pale)} {...edge} />
        <Path d="M2.8 11.8 12 3.4l9.2 8.4" fill="none" {...edge} />
        <Path d="M12 17.8c-2.6-1.7-3.6-3-3.6-4.2 0-1 .8-1.7 1.7-1.7.8 0 1.5.4 1.9 1.1.4-.7 1.1-1.1 1.9-1.1.9 0 1.7.7 1.7 1.7 0 1.2-1 2.5-3.6 4.2Z" fill={fill('#F2709B', q.mid)} stroke="none" />
      </> : null}
      {space === 'garden' ? <>
        <Ellipse cx="12" cy="19" rx="8.5" ry="2.8" fill={fill('#B98A5E', q.soil)} {...edge} />
        <Path d="M12 18V10" fill="none" {...edge} />
        <Path d="M12 12c-4.6.3-6.2-2.2-6.4-5.4 3.6-.1 6 1.4 6.4 5.4Z" fill={fill('#7BCF7A', q.pale)} {...edge} />
        <Path d="M12 9.8c.4-3.2 2.4-5.2 6.4-5.4.1 3.4-1.9 5.6-6.4 5.4Z" fill={fill('#9BE08F', q.pale)} {...edge} />
      </> : null}
      {space === 'explore' ? <>
        <Circle cx="12" cy="12" r="8.6" fill={fill('#BFE6FA', q.pale)} {...edge} />
        <Path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3Z" fill={fill('#F2845C', q.mid)} {...edge} />
        <Circle cx="12" cy="12" r="1" fill={ink} />
      </> : null}
      {space === 'friends' ? <>
        <Circle cx="8.6" cy="9" r="3.4" fill={fill('#F7B5CB', q.pale)} {...edge} />
        <Path d="M2.8 19.4c.3-3.6 2.6-5.6 5.8-5.6s5.5 2 5.8 5.6Z" fill={fill('#F7B5CB', q.pale)} {...edge} />
        <Circle cx="16.2" cy="8.2" r="2.9" fill={fill('#C3B9F5', q.pale)} {...edge} />
        <Path d="M16.4 13c2.8.1 4.6 2 4.9 5.2h-5" fill={fill('#C3B9F5', q.pale)} {...edge} />
      </> : null}
    </Svg>
    </View>
  );
}
