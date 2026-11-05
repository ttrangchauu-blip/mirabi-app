import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient as Gradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useAtmosphere } from './atmosphere';
import { CloudDeck, Rain, Snow } from './living';
import { SkyBodies, Stars } from './sky';
import { useWeather } from './weather';
import { useSize } from './diorama';

/**
 * What is really outside at this hour, seen through a window of a rendered room: the sky, the sun or the moon and stars, clouds,
 * hills, rain or snow. It fills its parent, arched at the top like the rooms' windows, and goes under the picture of the frame.
 */
export const GlassSky = memo(function GlassSky({ idPrefix }: { idPrefix: string }) {
  const { reading } = useWeather();
  const { hours, mood, light: c } = useAtmosphere(reading);
  const [{ width: w, height: h }, onLayout] = useSize({ width: 80, height: 110 });
  return (
    <View style={[s.glass, { borderTopLeftRadius: w / 2, borderTopRightRadius: w / 2 }]} onLayout={onLayout} pointerEvents="none"
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="room-glass-sky">
      <Gradient colors={[c.sky[0], c.sky[1], c.sky[2]]} style={StyleSheet.absoluteFill} />
      <Stars width={w} height={h * 0.6} opacity={c.stars} />
      <SkyBodies width={w} hours={hours} c={c} horizon={h * 0.72} zenith={4} clip={h * 0.8} body={36} idPrefix={idPrefix} />
      <CloudDeck width={w} top={6} color={c.cloud} opacity={c.cloudOpacity} cover={mood.cover} scale={0.7} />
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Path d={`M0 ${h * 0.68} Q${w * 0.3} ${h * 0.46} ${w * 0.6} ${h * 0.64} T${w} ${h * 0.58} V${h} H0 Z`} fill={c.hills[0]} />
        <Path d={`M0 ${h * 0.8} Q${w * 0.4} ${h * 0.66} ${w} ${h * 0.78} V${h} H0 Z`} fill={c.meadow} />
      </Svg>
      <Rain width={w} height={h} strength={mood.rain} wind={mood.wind} ground={0.9} />
      <Snow width={w} height={h} strength={mood.snow} />
    </View>
  );
});

const s = StyleSheet.create({
  glass: { ...StyleSheet.absoluteFillObject, overflow: 'hidden', backgroundColor: '#CFE7F7' },
});
