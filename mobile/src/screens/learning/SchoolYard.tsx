import React, { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PetArt } from '../../components/PetArt';
import { radius } from '../../ui/design';
import { useAtmosphere } from '../../world/atmosphere';
import { ContactShadow, Plate } from '../../world/diorama';
import { Rain, Snow, WeatherChip } from '../../world/living';
import { LiveSky } from '../../world/liveSky';
import { useWeather } from '../../world/weather';
import { SCHOOL, SCHOOL_RATIO, SCHOOL_RIDGE } from './learnArt';

/** Sky above the school, in points. */
const SKY = 34;
const PET = 56;

/** The top of Học tập: the school in its real hour and weather, with the learner's pet in the yard. It only sets the scene: everything to do is below it. */
export const SchoolYard = memo(function SchoolYard({ petId, petLevel }: { petId?: string; petLevel?: number }) {
  const { reading } = useWeather();
  const { hours, mood, light: c, night } = useAtmosphere(reading);
  const [width, setWidth] = useState(0);
  const land = width / SCHOOL_RATIO;
  const height = Math.round(SKY + land) || 190;
  const ridge = SKY + land * SCHOOL_RIDGE;
  return (
    <View style={[s.card, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="school-yard">
      <LinearGradient colors={c.sky} end={{ x: 0, y: Math.min(1, (ridge + 24) / height) }} style={StyleSheet.absoluteFill} />
      {width ? <>
        <LiveSky id="school" width={width} ridge={ridge} hours={hours} c={c} cover={mood.cover} />
        <Plate source={SCHOOL[night ? 'night' : 'day']} width={width} height={land} style={{ top: SKY }} />
        {petId ? <View style={[s.pet, { left: width * 0.2, top: SKY + land * 0.93 - PET }]}>
          <ContactShadow width={40} height={9} opacity={0.4} style={s.petShadow} />
          <PetArt pet={petId} stage={petLevel ?? 1} size={PET} still />
        </View> : null}
        <Rain width={width} height={height} strength={mood.rain} wind={mood.wind} ground={0.92} />
        <Snow width={width} height={height} strength={mood.snow} />
      </> : null}
      <View style={s.chip}><WeatherChip night={night} tone={night ? 'light' : 'dark'} /></View>
    </View>
  );
});

const s = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', marginTop: 12, marginBottom: 4, backgroundColor: '#BFE3F5' },
  pet: { position: 'absolute', width: PET, alignItems: 'center' },
  petShadow: { position: 'absolute', bottom: 0 },
  chip: { position: 'absolute', top: 6, right: 8 },
});
