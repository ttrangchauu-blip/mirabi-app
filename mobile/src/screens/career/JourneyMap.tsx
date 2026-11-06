import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Image, type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { CareerSkill, SkillStatus } from '../../life/worlds';
import { useSwing, useWorldMotion } from '../../world/budget';
import { ContactShadow, Plate, Tag, Tiles } from '../../world/diorama';
import { EASE } from '../../world/motion';

/**
 * The career as a road through a land: each group of skills is its own region, each skill a milestone on the road, and
 * the road is gold as far as the owner has really come. Where each milestone stands is worked out from its order, so it
 * never moves; which ones are open, done or locked is only what the server says.
 */

/** Height of one milestone on the road, and of a region's sign. */
const STEP = 112;
const SIGN = 74;
const PET = 74;

export type MapNode = { skill: CareerSkill; x: number; y: number; side: 1 | -1; region: number };
export type MapRegion = { name: string; top: number; height: number; index: number };
export type MapLayout = { nodes: MapNode[]; regions: MapRegion[]; height: number; road: string; done: string };

export const finished = (status: SkillStatus) => status === 'practiced' || status === 'assessed';
const LANDS = [
  require('../../../assets/world/career/land-0.jpg'), require('../../../assets/world/career/land-1.jpg'), require('../../../assets/world/career/land-2.jpg'),
  require('../../../assets/world/career/land-3.jpg'), require('../../../assets/world/career/land-4.jpg'), require('../../../assets/world/career/land-5.jpg'),
];
const HEDGE = require('../../../assets/world/career/hedge.webp');

/** Where everything stands, for a map this wide. The road swings from side to side at its own pace, and it goes straight
 * through the region signs, so it reads as one road. */
export function layoutMap(groups: { name: string; skills: CareerSkill[] }[], width: number): MapLayout {
  const nodes: MapNode[] = [];
  const regions: MapRegion[] = [];
  let y = 0;
  groups.forEach((group, index) => {
    const top = y;
    y += SIGN;
    group.skills.forEach((skill) => {
      const turn = nodes.length;
      const x = width * (0.5 + 0.27 * Math.sin(turn * 1.15 + 0.5));
      nodes.push({ skill, x, y: y + STEP * 0.46, side: x > width / 2 ? -1 : 1, region: index });
      y += STEP;
    });
    regions.push({ name: group.name, top, height: y - top, index });
  });
  const pathTo = (count: number) => {
    let d = '';
    nodes.slice(0, count).forEach((n, i) => {
      if (!i) { d = `M${n.x.toFixed(1)} ${n.y.toFixed(1)}`; return; }
      const p = nodes[i - 1];
      const mid = (p.y + n.y) / 2;
      d += ` C${p.x.toFixed(1)} ${mid.toFixed(1)} ${n.x.toFixed(1)} ${mid.toFixed(1)} ${n.x.toFixed(1)} ${n.y.toFixed(1)}`;
    });
    return d;
  };
  const reached = nodes.reduce((last, n, i) => (finished(n.skill.status) ? i + 1 : last), 0);
  return { nodes, regions, height: y + 30, road: pathTo(nodes.length), done: pathTo(reached + (reached < nodes.length && nodes[reached].skill.unlocked ? 1 : 0)) };
}

/** A region's land: a rendered tile of its ground, as long as the region is. */
const RegionLand = memo(function RegionLand({ region, width }: { region: MapRegion; width: number }) {
  return <View style={{ position: 'absolute', left: 0, top: region.top, width, height: region.height, overflow: 'hidden' }}><Tiles source={LANDS[region.index % LANDS.length]} width={width} height={region.height} /></View>;
});

const STONE: Record<SkillStatus, { art: ImageSourcePropType; icon: React.ComponentProps<typeof Ionicons>['name']; ink: string }> = {
  locked: { art: require('../../../assets/world/career/stone-locked.webp'), icon: 'lock-closed', ink: '#4F585C' },
  available: { art: require('../../../assets/world/career/stone-available.webp'), icon: 'flag', ink: '#8A5A12' },
  in_progress: { art: require('../../../assets/world/career/stone-in_progress.webp'), icon: 'trending-up', ink: '#135E8A' },
  practiced: { art: require('../../../assets/world/career/stone-practiced.webp'), icon: 'checkmark', ink: '#17603A' },
  assessed: { art: require('../../../assets/world/career/stone-assessed.webp'), icon: 'star', ink: '#7A4D00' },
};

const WORDS: Record<SkillStatus, string> = { locked: 'Chưa mở', available: 'Sẵn sàng học', in_progress: 'Tự đánh giá', practiced: 'Đã thực hành', assessed: 'Đã qua bài kiểm tra' };

/** One milestone: a stone by the road, its name on a sign, a soft pulse when it is the next one to take. A new opening
 * rises out of the ground. */
export const Milestone = memo(function Milestone({ node, justOpened, onPress }: { node: MapNode; justOpened: boolean; onPress: () => void }) {
  const { skill, x, y, side } = node;
  const st = STONE[skill.status];
  const next = skill.status === 'available' || skill.status === 'in_progress';
  const pulse = useSwing({ ms: 1500, enabled: next });
  const { level } = useWorldMotion();
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!justOpened || level === 'still') return;
    pop.setValue(0.3);
    const anim = Animated.timing(pop, { toValue: 1, duration: 620, easing: EASE.land, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [justOpened, level, pop]);
  const left = x - 28;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={`skill-${skill.code}`}
      accessibilityLabel={`${skill.name}, ${WORDS[skill.status]}${skill.status === 'in_progress' ? ` ${skill.progress_percent}%` : ''}`}
      style={[s.mile, { left: 0, right: 0, top: y - 40 }]}>
      <View style={[s.stoneSpot, { left }]}>
        <ContactShadow width={70} height={18} opacity={0.34} style={s.stoneShadow} />
        {next ? <Animated.View style={[s.halo, { opacity: pulse.interpolate({ inputRange: [-1, 1], outputRange: [0.12, 0.55] }), transform: [{ scale: pulse.interpolate({ inputRange: [-1, 1], outputRange: [1, 1.22] }) }] }]} /> : null}
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Image source={st.art} style={s.stone} resizeMode="stretch" accessibilityIgnoresInvertColors />
          <View style={s.stoneIcon}><Ionicons name={st.icon} size={24} color={st.ink} /></View>
        </Animated.View>
      </View>
      <Tag style={[s.sign, { left: side > 0 ? x + 36 : Math.max(6, x - 36 - 158) }, skill.status === 'locked' && s.signLocked]}>
        <Text style={[s.signName, skill.status === 'locked' && s.signLockedText]} numberOfLines={2}>{skill.name}</Text>
        <Text style={[s.signMeta, { color: st.ink }]} numberOfLines={1}>{WORDS[skill.status]}{skill.status === 'in_progress' ? ` · ${skill.progress_percent}%` : ''} · Cấp {skill.level}</Text>
      </Tag>
    </Pressable>
  );
});

/** The pet on the road: at the next milestone, and walking there whenever one is reached. Its feet stay on the road, its
 * art comes from its own strips. */
export function RoadPet({ pet, level, to }: { pet: string; level: number; to: { x: number; y: number } | null }) {
  const { level: motion } = useWorldMotion();
  const x = useRef(new Animated.Value(to?.x ?? 0)).current;
  const y = useRef(new Animated.Value(to?.y ?? 0)).current;
  const [walking, setWalking] = React.useState(false);
  const [facing, setFacing] = React.useState<1 | -1>(1);
  const at = useRef(to);
  useEffect(() => {
    if (!to) return;
    const from = at.current;
    at.current = to;
    if (!from || motion === 'still') { x.setValue(to.x); y.setValue(to.y); return; }
    if (from.x === to.x && from.y === to.y) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    setFacing(to.x >= from.x ? 1 : -1);
    setWalking(true);
    const duration = Math.min(1500, 500 + distance * 6);
    const anim = Animated.parallel([
      Animated.timing(x, { toValue: to.x, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(y, { toValue: to.y, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start(() => setWalking(false));
    return () => anim.stop();
  }, [to?.x, to?.y, motion]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!to) return null;
  return (
    <Animated.View pointerEvents="none" style={[s.pet, { transform: [{ translateX: Animated.subtract(x, PET / 2) }, { translateY: Animated.subtract(y, PET) }] }]} testID="road-pet">
      <ContactShadow width={PET * 0.7} height={12} opacity={0.32} style={s.petShadow} />
      <View style={{ transform: [{ scaleX: facing }] }}><PetArt pet={pet} stage={level} size={PET} walking={walking} /></View>
    </Animated.View>
  );
}

/** The road and everything along it (the milestones go on top). */
export const RoadMap = memo(function RoadMap({ map, width }: { map: MapLayout; width: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {map.regions.map((r) => <RegionLand key={r.name} region={r} width={width} />)}
      {/* A hedge where one land meets the next. */}
      {map.regions.slice(1).map((r) => <Plate key={r.name} source={HEDGE} width={width} height={width * (210 / 1170)} style={{ top: r.top - width * (105 / 1170) }} />)}
      <Svg width={width} height={map.height} style={StyleSheet.absoluteFill}>
        <Path d={map.road} stroke="#6B4A2B" strokeWidth={27} strokeOpacity={0.26} fill="none" strokeLinecap="round" transform="translate(1.5 3)" />
        <Path d={map.road} stroke="#D9BE8E" strokeWidth={23} fill="none" strokeLinecap="round" />
        <Path d={map.road} stroke="#F4E6C4" strokeWidth={17} fill="none" strokeLinecap="round" />
        <Path d={map.road} stroke="#CDB184" strokeWidth={2} strokeDasharray="4 15" fill="none" strokeLinecap="round" />
        {map.done ? <Path d={map.done} stroke="#E9A93A" strokeWidth={7} fill="none" strokeLinecap="round" /> : null}
        {map.done ? <Path d={map.done} stroke="#FFE08A" strokeWidth={2.4} fill="none" strokeLinecap="round" /> : null}
      </Svg>
    </View>
  );
});

/** The sign at a region's entry, on its own wooden post. */
export function RegionSign({ region, done, total }: { region: MapRegion; done: number; total: number }) {
  return (
    <View style={[s.regionSign, { top: region.top + 12 }]}>
      <View style={s.regionBoard}>
        <Text style={s.regionName} accessibilityRole="header" numberOfLines={1}>{region.name}</Text>
        <Text style={s.regionCount}>{done}/{total}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  mile: { position: 'absolute', height: 84 },
  stoneSpot: { position: 'absolute', top: 2, width: 56, height: 72, alignItems: 'center' },
  stoneShadow: { position: 'absolute', top: 54, alignSelf: 'center' },
  stone: { width: 88, height: 93.5 },
  stoneIcon: { position: 'absolute', left: 0, right: 0, top: 22, alignItems: 'center' },
  halo: { position: 'absolute', top: -3, width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFE9A8' },
  sign: { position: 'absolute', top: 12, width: 158, paddingVertical: 5 },
  signLocked: { backgroundColor: 'rgba(245,242,235,0.92)' },
  signLockedText: { color: '#5C5F60' },
  signName: { fontSize: 13, lineHeight: 17, fontWeight: '900', color: '#123B5C' },
  signMeta: { fontSize: 11, lineHeight: 14, fontWeight: '800' },
  pet: { position: 'absolute', left: 0, top: 0, width: PET, height: PET, zIndex: 3 },
  petShadow: { position: 'absolute', bottom: -3, alignSelf: 'center' },
  regionSign: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  regionBoard: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '86%', backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#D6ECF7', paddingHorizontal: 14, paddingVertical: 6,
    shadowColor: '#1F6E9E', shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  regionName: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '900', color: '#123B5C' },
  regionCount: { fontSize: 12, fontWeight: '800', color: '#136FA8' },
});
