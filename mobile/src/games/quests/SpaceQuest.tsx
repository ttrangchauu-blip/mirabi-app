import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { Impact } from '../art/mathBattle';
import { Asteroid, AsteroidVariant, Laser, Planet, PLANET_NAME, Rocket, ROCKET_SEAT, RocketGlass, Rubble, SpaceLayer, Thruster } from '../art/space';
import { Layer, Parallax } from '../engine/Parallax';
import { useRig } from '../engine/rig';
import { useSfx } from '../engine/sfx';
import { NATIVE, planetCount, planetKind, planetsRescued, useQuestEvents } from './worlds';
import type { QuestProps } from './QuestProps';

// Space Adventure (Tiếng Anh lessons): the pet flies its rocket to grey, sleeping planets; asteroids block the way.
// A right answer fires the laser: the asteroid bursts into rubble, the rocket boosts on (the stars stream past) and
// the next asteroid drifts in; each planet's share of the stage brings it back to life (colour, a smile, sparkles),
// then the next one comes into view. A wrong answer: an asteroid bumps the rocket. Progress is the session's.

const H = 200;
const ROCKET = 112;
const ROCK = 56;
const PLANET = 92;
const RUBBLE = [0, 1, 2, 3, 4, 5].map((i) => ({ a: (i / 6) * Math.PI * 2 + 0.4, d: 46 + (i % 3) * 12, s: 14 + (i % 2) * 6 }));

const SPACE: Layer[] = [
  { key: 'sky', speed: 0, render: (w, h) => <SpaceLayer layer="sky" width={w} height={h} /> },
  { key: 'far', speed: 0.2, render: (w, h) => <SpaceLayer layer="far" width={w} height={h} /> },
  { key: 'near', speed: 0.7, render: (w, h) => <SpaceLayer layer="near" width={w} height={h} /> },
];

export function SpaceQuest({ done, total, wrongKey, petId, petLevel, reduceMotion, running, hold = false }: QuestProps) {
  const play = useSfx();
  const [width, setWidth] = useState(0);
  const W = width || 340;
  const count = planetCount(total);
  const [rescued, setRescued] = useState(() => planetsRescued(done, total));
  const [planet, setPlanet] = useState(() => Math.min(count - 1, planetsRescued(done, total)));
  const [rock, setRock] = useState<AsteroidVariant>((done % 3) as AsteroidVariant);
  const [rockGone, setRockGone] = useState(done >= total && total > 0);
  const ship = useRig({ facing: 1, running, reduceMotion, idle: false });
  const travel = useRef(new Animated.Value(done)).current; // JS: drives the parallax
  const flame = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const laser = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const rockIn = useRef(new Animated.Value(0)).current;
  const rockAlpha = useRef(new Animated.Value(rockGone ? 0 : 1)).current;
  const life = useRef(new Animated.Value(planet < rescued ? 1 : 0)).current; // the planet being rescued: grey → bright
  const planetIn = useRef(new Animated.Value(0)).current;
  const ms = (n: number) => (reduceMotion ? 0 : n);
  const timing = (v: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
    Animated.timing(v, { toValue, duration: ms(duration), easing, useNativeDriver: NATIVE });

  // The thruster flickers and the rocket and asteroid float, while the game runs.
  useEffect(() => {
    if (!running || reduceMotion) { flame.setValue(0.5); bob.setValue(0.5); return; }
    const loops = [
      Animated.loop(Animated.sequence([timing(flame, 1, 140, Easing.linear), timing(flame, 0, 160, Easing.linear)])),
      Animated.loop(Animated.sequence([timing(bob, 1, 1300, Easing.inOut(Easing.sin)), timing(bob, 0, 1300, Easing.inOut(Easing.sin))])),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [running, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useQuestEvents(done, wrongKey, (now, _before, end, advance) => {
    const saved = planetsRescued(now, total);
    const finished = now >= total;
    play('shot');
    laser.setValue(0); burst.setValue(0);
    Animated.sequence([timing(laser, 1, 280, Easing.in(Easing.quad))]).start(() => {
      play('break');
      laser.setValue(0);
      Animated.parallel([
        timing(rockAlpha, 0, 90),
        timing(burst, 1, 620, Easing.out(Easing.cubic)),
        Animated.timing(travel, { toValue: now, duration: ms(760), easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]).start(() => {
        burst.setValue(0);
        const rescuing = saved > rescued;
        if (rescuing) {
          setRescued(saved);
          play(finished ? 'complete' : 'unlock');
          ship.play('celebrate');
          life.setValue(0);
        }
        // The planet comes back to life (what the answer did), then the next asteroid drifts in, with the next planet
        // once this one is rescued: once "Câu tiếp theo" is pressed, when the answered question waits for it.
        const rescue = (then: () => void) => (rescuing ? Animated.sequence([timing(life, 1, 700), Animated.delay(ms(700))]).start(then) : then());
        if (finished) { setRockGone(true); rescue(end); return; }
        rescue(() => advance((end) => {
          if (rescuing && saved < count) {
            setPlanet(saved);
            life.setValue(0);
            planetIn.setValue(1);
            timing(planetIn, 0, 800, Easing.out(Easing.quad)).start();
          }
          setRock((now % 3) as AsteroidVariant);
          rockIn.setValue(1);
          rockAlpha.setValue(1);
          timing(rockIn, 0, 650, Easing.out(Easing.back(1.2))).start(end);
        }));
      });
    });
  }, (end) => {
    play('wrong');
    ship.play('hit', end);
  }, hold);

  // The rocket, the asteroid and the planet, and where the laser flies.
  const rocketAt = { x: W * 0.03, y: H * 0.5 - ROCKET / 2 };
  const nose = { x: rocketAt.x + ROCKET * 0.98, y: rocketAt.y + ROCKET * 0.72 };
  const rockAt = { x: W * 0.5, y: H * 0.56 - ROCK / 2 };
  const target = { x: rockAt.x + ROCK / 2, y: rockAt.y + ROCK / 2 };
  const planetAt = { x: W - PLANET - 6, y: H * 0.12 };
  const kind = planetKind(planet);
  const thisRescued = planet < rescued;
  const finished = done >= total && total > 0;
  const float = bob.interpolate({ inputRange: [0, 1], outputRange: [-4, 4] });
  const label = finished ? `Đã giải cứu cả ${count} hành tinh!`
    : `Tàu của pet bay tới ${PLANET_NAME[kind]}; đã giải cứu ${rescued} trên ${count} hành tinh`;
  return (
    <View style={[styles.scene, { height: H }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityRole="image"
      accessibilityLabel={label}>
      {width ? <Parallax width={W} height={H} layers={SPACE} travel={travel} step={240} drift={1.2} running={running} reduceMotion={reduceMotion} /> : null}
      {/* The planet to rescue: grey and asleep, coming to life. */}
      <Animated.View pointerEvents="none" style={[styles.abs, { left: planetAt.x, top: planetAt.y,
        transform: [{ translateX: planetIn.interpolate({ inputRange: [0, 1], outputRange: [0, PLANET + 40] }) }] }]}>
        <Planet size={PLANET} kind={kind} rescued={false} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: thisRescued ? (reduceMotion ? 1 : life) : 0 }]}>
          <Planet size={PLANET} kind={kind} rescued />
        </Animated.View>
      </Animated.View>
      {/* The asteroid in the way. */}
      {!rockGone ? (
        <Animated.View pointerEvents="none" style={[styles.abs, { left: rockAt.x, top: rockAt.y, opacity: rockAlpha,
          transform: [{ translateX: rockIn.interpolate({ inputRange: [0, 1], outputRange: [0, W - rockAt.x] }) }, { translateY: float }] }]}>
          <Asteroid size={ROCK} variant={rock} />
        </Animated.View>
      ) : null}
      {/* Its burst: a flash and rubble flying apart. */}
      {!reduceMotion ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[styles.abs, { left: target.x - 40, top: target.y - 40, opacity: burst.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 0] }),
            transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.5] }) }] }]}>
            <Impact size={80} color="#FFB347" />
          </Animated.View>
          {RUBBLE.map((r, i) => (
            <Animated.View key={i} style={[styles.abs, { left: target.x - r.s / 2, top: target.y - r.s / 2,
              opacity: burst.interpolate({ inputRange: [0, 0.05, 0.8, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(r.a) * r.d] }) },
                { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(r.a) * r.d] }) },
                { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? 220 : -200}deg`] }) }] }]}>
              <Rubble size={r.s} variant={rock} />
            </Animated.View>
          ))}
          <Animated.View style={[styles.abs, { left: nose.x, top: nose.y - 7, opacity: laser.interpolate({ inputRange: [0, 0.05, 0.95, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateX: laser.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, target.x - nose.x - 46)] }) },
              { translateY: laser.interpolate({ inputRange: [0, 1], outputRange: [0, target.y - nose.y] }) }] }]}>
            <Laser size={46} />
          </Animated.View>
        </View>
      ) : null}
      {/* The rocket, the pet in its dome, the flame behind it. */}
      <Animated.View pointerEvents="none" style={[styles.abs, { left: rocketAt.x, top: rocketAt.y }, ship.style]}>
        <Animated.View style={{ transform: [{ translateY: float }] }}>
          <Animated.View style={[styles.abs, { left: -ROCKET * 0.34, top: ROCKET * 0.58, transform: [{ scaleX: flame.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }] }]}>
            <Thruster size={ROCKET * 0.5} />
          </Animated.View>
          <Rocket size={ROCKET} />
          <View style={[styles.abs, { left: ROCKET * ROCKET_SEAT.left, top: ROCKET * ROCKET_SEAT.top }]}>
            <PetArt pet={petId} size={ROCKET * ROCKET_SEAT.size} stage={petLevel} still={reduceMotion || !running} />
          </View>
          <View style={StyleSheet.absoluteFill}><RocketGlass size={ROCKET} /></View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.hurt, { opacity: ship.flash }]} />
        </Animated.View>
      </Animated.View>
      <View style={styles.chip} pointerEvents="none">
        {Array.from({ length: count }, (_, i) => (
          <View key={i} style={styles.mini}><Planet size={20} kind={planetKind(i)} rescued={i < rescued} /></View>
        ))}
        <Text style={styles.chipText}>{finished ? 'Hoàn thành!' : `Hành tinh ${Math.min(planet + 1, count)}/${count}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: { borderRadius: 22, overflow: 'hidden', backgroundColor: '#22204F', marginBottom: 10 },
  abs: { position: 'absolute' },
  hurt: { backgroundColor: 'rgba(240,71,58,0.35)', borderRadius: ROCKET / 2 },
  chip: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 999, paddingHorizontal: 8,
    paddingVertical: 3, backgroundColor: 'rgba(20,18,52,0.6)' },
  mini: { width: 20, height: 20 },
  chipText: { marginLeft: 4, fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
});
