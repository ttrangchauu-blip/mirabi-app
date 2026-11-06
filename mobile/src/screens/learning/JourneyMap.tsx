import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PetCompanion } from '../../components/PetCompanion';
import { Text } from '../../components/Typography';
import { JourneySection, LessonCard, nodeStatus, unlockHint } from '../../learning/lessonOrder';
import type { ContentStatus, UnlockRequirement } from '../../learning/types';
import { appTheme as t } from '../../theme';
import { IconName, ProgressBar } from '../../ui/kit';
import { useAtmosphere } from '../../world/atmosphere';
import { ContactShadow, Plate, Tiles } from '../../world/diorama';
import { LiveSky } from '../../world/liveSky';
import { useWeather } from '../../world/weather';
import { POINT, POINT_FACE, STEPS, TRAIL_RIDGE, TRAIL_TILE, TRAIL_TOP } from './learnArt';
import type { Look } from './LearningUI';

// The journey map of a subject (backend learning_unlocks.py): its chapters are areas and its lessons points on one winding
// path. Every state comes from the backend; a lesson that has just opened plays its unlock here, without ever holding
// up a tap: the lock shakes and opens, light spreads, the point goes from faded to clear, and the pet jumps for joy.

const WIDTH = 300;
const WAVE = 62;
const LINK = 58;
const SIZE = 66;
/** A point's rendered stone, a bit wider than where it can be tapped. */
const STONE = 92;
const STEP = 46;
/** The sky above the hillside, in points. */
export const TRAIL_SKY = 58;
const STATE_LABEL: Record<ContentStatus, string> = { LOCKED: 'Chưa mở', UNLOCKED: 'Đã mở', IN_PROGRESS: 'Đang học', COMPLETED: 'Đã hoàn thành' };
const CHAPTER_LABEL: Record<ContentStatus, string> = { LOCKED: 'Chưa mở', UNLOCKED: 'Khu vực mới', IN_PROGRESS: 'Đang khám phá', COMPLETED: 'Đã chinh phục' };

/** How far from the middle the point at this place of the whole path stands: the path winds on across the chapters. */
export const waveOffset = (place: number) => [0, WAVE, 0, -WAVE][place % 4];

type Props = { section: JourneySection; firstPlace: number; look: Look | null; current: string | null;
  /** Just opened: they play their unlock once. */ opening: Set<string>;
  hint: string | null; petId?: string; petLevel?: number; reduceMotion?: boolean; night?: boolean;
  onPress: (card: LessonCard) => void; onOpenRequirement: (key: string) => void;
  /** Where a point stands in this area, for bringing it into view. */ onNodeLayout?: (id: string, y: number) => void };

/** One area of the map: its name and how far it is done, then its lessons as points on the path. */
export function JourneySectionView({ section, firstPlace, look, current, opening, hint, petId, petLevel, reduceMotion, night = false, onPress, onOpenRequirement, onNodeLayout }: Props) {
  const locked = section.status === 'LOCKED';
  const reveal = useRef(new Animated.Value(1)).current;
  const fresh = opening.has(section.key);
  useEffect(() => {
    if (!fresh || reduceMotion) return;
    reveal.setValue(0.5);
    const a = Animated.timing(reveal, { toValue: 1, duration: 700, delay: 500, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [fresh, reduceMotion, reveal]);
  const done = section.status === 'COMPLETED';
  // Nothing to play in this area yet: it is not "new", whatever the path says.
  const stateLabel = !locked && section.nodes.every((n) => n.planned) ? 'Sắp có' : CHAPTER_LABEL[section.status];
  return (
    <View style={styles.section}>
      <Animated.View accessible accessibilityRole="header" style={[styles.banner, locked && styles.bannerLocked, { opacity: reveal }]}
        accessibilityLabel={`${section.title}. ${stateLabel}${section.requiredTotal ? `, ${section.requiredCompleted} trên ${section.requiredTotal} bài bắt buộc` : ''}`}>
        <Ionicons name={locked ? 'lock-closed' : done ? 'trophy' : 'map-outline'} size={18} color={locked ? '#7A8D9E' : done ? '#B5850B' : look?.color ?? t.accent} />
        <View style={styles.flex}>
          <Text style={[styles.bannerTitle, locked && styles.mutedText]} numberOfLines={2}>{section.title}</Text>
          <Text style={styles.bannerState} numberOfLines={2}>{locked && section.note ? section.note : stateLabel}</Text>
        </View>
        {section.requiredTotal ? <Text style={styles.bannerCount}>{section.requiredCompleted}/{section.requiredTotal}</Text> : null}
      </Animated.View>
      {section.nodes.map((card, i) => {
        const place = firstPlace + i;
        const following = section.nodes[i + 1];
        return (
          <React.Fragment key={card.id}>
            <JourneyNode card={card} offset={waveOffset(place)} look={look} here={card.id === current} fresh={opening.has(card.id)}
              celebrating={opening.size > 0} hint={hint === card.id} petId={petId} petLevel={petLevel} reduceMotion={reduceMotion} night={night}
              onPress={() => onPress(card)} onOpenRequirement={onOpenRequirement} onLayoutY={(y) => onNodeLayout?.(card.id, y)} />
            {following ? <PathLink from={waveOffset(place)} to={waveOffset(place + 1)} open={following.unlocked} night={night} /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** The way between two points: stones in the grass, sharp up to what is open, faded beyond. */
function PathLink({ from, to, open, night }: { from: number; to: number; open: boolean; night: boolean }) {
  const a = WIDTH / 2 + from;
  const b = WIDTH / 2 + to;
  const art = night ? 'night' : 'day';
  return (
    <View style={styles.link} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none">
      {[0.14, 0.5, 0.86].map((u, i) => {
        // On the same curve as before: it leaves straight down and arrives straight down.
        const s3 = u * u * (3 - 2 * u);
        return <Image key={u} source={STEPS[(from + i) % 2 === 0 ? 0 : 1][art]} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors
          style={[styles.step, { opacity: open ? 1 : 0.75, left: a + (b - a) * s3 - STEP / 2, top: u * LINK - STEP * 0.62 }]} />;
      })}
    </View>
  );
}

/** The hillside behind a subject's map, with the real sky over its ridge. As long as the map is. */
export function TrailBackdrop({ width, top, height }: { width: number; top: number; height: number }) {
  const { reading } = useWeather();
  const { hours, mood, light: c, night } = useAtmosphere(reading);
  const art = night ? 'night' : 'day';
  const land = width / 2;
  const ridge = TRAIL_SKY + land * TRAIL_RIDGE;
  return (
    <View pointerEvents="none" style={[styles.backdrop, { top, height: Math.max(0, height) }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="trail-backdrop">
      <LinearGradient colors={c.sky} style={{ height: ridge + 24 }} />
      <View style={[styles.backdropSky, { height: ridge + 24 }]}><LiveSky id="trail" width={width} ridge={ridge} hours={hours} c={c} cover={mood.cover} /></View>
      <Plate source={TRAIL_TOP[art]} width={width} height={land + 1.5} style={{ top: TRAIL_SKY }} />
      <View style={[styles.backdropTiles, { top: TRAIL_SKY + land - 0.5 }]}><Tiles source={TRAIL_TILE[art]} width={width} height={Math.max(0, height - TRAIL_SKY - land)} /></View>
    </View>
  );
}

const NODE_ICON: Record<ContentStatus, IconName> = { LOCKED: 'lock-closed', UNLOCKED: 'book', IN_PROGRESS: 'play', COMPLETED: 'checkmark' };

type NodeProps = { card: LessonCard; offset: number; look: Look | null; here: boolean; fresh: boolean; celebrating: boolean; hint: boolean;
  petId?: string; petLevel?: number; reduceMotion?: boolean; night: boolean; onPress: () => void; onOpenRequirement: (key: string) => void;
  onLayoutY: (y: number) => void };

/** A lesson on the map. Chưa mở: a lock, slightly faded. Đã mở: clear colours and a soft light. Đang học: a progress bar.
 * Hoàn thành: a tick and a small medal. The pet stands by the lesson the learner is at. */
function JourneyNode({ card, offset, look, here, fresh, celebrating, hint, petId, petLevel, reduceMotion, night, onPress, onOpenRequirement, onLayoutY }: NodeProps) {
  const status = nodeStatus(card);
  const color = look?.color ?? t.accent;
  const shake = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(fresh && !reduceMotion ? 0 : 1)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const animated = fresh && !reduceMotion;
  useEffect(() => {
    if (!animated) { open.setValue(1); return; }
    open.setValue(0); // also for a point already on screen (back on the subject)
    burst.setValue(0);
    const kick = (to: number) => Animated.timing(shake, { toValue: to, duration: 55, useNativeDriver: true });
    const run = Animated.sequence([
      Animated.delay(250),
      kick(1), kick(-1), kick(1), kick(-1), kick(0),
      Animated.parallel([
        Animated.timing(open, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(burst, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    run.start();
    return () => run.stop();
  }, [animated, shake, open, burst]);
  // The soft light of the lesson the learner is at.
  const glowing = here && !reduceMotion && (status === 'UNLOCKED' || status === 'IN_PROGRESS');
  useEffect(() => {
    if (!glowing) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glowing, pulse]);
  const joyful = here && celebrating && !reduceMotion;
  useEffect(() => {
    if (!joyful) return;
    const jump = (height: number) => Animated.sequence([
      Animated.timing(hop, { toValue: height, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);
    const run = Animated.sequence([Animated.delay(600), jump(1), jump(0.6), jump(1)]);
    run.start();
    return () => run.stop();
  }, [joyful, hop]);

  const locked = status === 'LOCKED';
  const label = card.planned ? 'Sắp có' : STATE_LABEL[status];
  const pending = card.requirements.filter((r): r is Extract<UnlockRequirement, { type: 'lesson' }> => r.type === 'lesson' && !r.done);
  const fill = status === 'COMPLETED' ? '#2FA573' : color;
  const faded = open.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  return (
    <View style={styles.nodeRow} onLayout={(e) => onLayoutY(e.nativeEvent.layout.y)}>
      <View style={[styles.node, { transform: [{ translateX: offset }] }]}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: card.unlocked ? undefined : hint }}
          accessibilityLabel={`${card.title}. ${card.chapterTitle}. ${label}${status === 'IN_PROGRESS' ? `, ${card.percent}%` : ''}${card.required || card.planned ? '' : '. Tùy chọn'}`}
          accessibilityHint={card.unlocked ? (status === 'COMPLETED' ? 'Mở lại để ôn tập' : 'Mở bài học') : 'Xem điều kiện mở bài'}
          style={({ pressed }) => [styles.point, pressed && styles.pressed]}>
          {!locked ? <Animated.View pointerEvents="none" testID={glowing ? 'map-glow' : undefined} style={[styles.halo, { backgroundColor: `${fill}33`,
            opacity: glowing ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) : 0.45,
            transform: [{ scale: glowing ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) : 1 }] }]} /> : null}
          {animated ? <Animated.View pointerEvents="none" testID="map-unlocking" style={[styles.burst, { backgroundColor: '#FFE08A',
            opacity: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] }),
            transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.3] }) }] }]} /> : null}
          <ContactShadow width={STONE * 0.9} height={20} opacity={0.32} style={styles.stoneShadow} />
          <Animated.View style={[styles.stone, { opacity: locked ? 1 : faded }]}>
            <Image source={POINT[status][night ? 'night' : 'day']} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors style={styles.stoneArt} />
          </Animated.View>
          <Animated.View style={[styles.circle, { opacity: locked ? 1 : faded }]}>
            <Animated.View style={{ opacity: animated ? open.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }) : 1 }}>
              <Ionicons name={card.planned ? 'time-outline' : NODE_ICON[status]} size={28} color={locked ? '#5F7384' : '#FFFFFF'} />
            </Animated.View>
            {animated ? (
              <>
                <Animated.View pointerEvents="none" style={[styles.lockOver, { opacity: open.interpolate({ inputRange: [0, 0.2], outputRange: [1, 0], extrapolate: 'clamp' }),
                  transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) }] }]}>
                  <Ionicons name="lock-closed" size={28} color="#FFFFFF" />
                </Animated.View>
                <Animated.View pointerEvents="none" style={[styles.lockOver, { opacity: open.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [{ scale: open.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] }]}>
                  <Ionicons name="lock-open" size={28} color="#FFFFFF" />
                </Animated.View>
              </>
            ) : null}
          </Animated.View>
          {status === 'COMPLETED' ? <View style={styles.medal}><Ionicons name="ribbon" size={15} color="#B5850B" /></View> : null}
        </Pressable>
        <View style={styles.nodeLabel}>
          <Text style={[styles.nodeTitle, locked && styles.mutedText]} numberOfLines={2}>{card.title}</Text>
          {!card.required && !card.planned ? <Text style={styles.optional}>Tùy chọn</Text> : null}
          {status === 'IN_PROGRESS' ? <View style={styles.nodeBar}><ProgressBar value={card.percent / 100} color="#E39A2D" /></View> : null}
        </View>
        {here && petId ? (
          <Animated.View pointerEvents="none" testID="map-pet" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
            style={[styles.pet, offset > 0 ? styles.petLeft : styles.petRight,
              { transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) }] }]}>
            <PetCompanion pet={petId} size={52} stage={petLevel ?? 1} />
          </Animated.View>
        ) : null}
      </View>
      {hint && !card.unlocked ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <Text style={styles.hintText}>{unlockHint(card)}</Text>
          {pending.map((r) => (
            <Pressable key={r.lesson_id} onPress={() => onOpenRequirement(r.lesson_id)} accessibilityRole="button"
              accessibilityLabel={`Mở bài ${r.title}`} hitSlop={6} style={styles.hintLink}>
              <Text style={styles.hintLinkText}>Mở bài “{r.title}”</Text>
              <Ionicons name="arrow-forward" size={14} color={t.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { alignItems: 'center', marginBottom: 14 },
  banner: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14 },
  bannerLocked: { backgroundColor: '#F2F5F8' },
  bannerTitle: { fontSize: 15, fontWeight: '900', color: t.ink },
  bannerState: { fontSize: 12, color: t.muted, marginTop: 1 },
  bannerCount: { fontSize: 13, fontWeight: '900', color: t.muted },
  mutedText: { color: '#6F8394' },
  link: { width: WIDTH, height: LINK },
  step: { position: 'absolute', width: STEP, height: STEP },
  backdrop: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  backdropSky: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
  backdropTiles: { position: 'absolute', left: 0, right: 0 },
  stone: { position: 'absolute', width: STONE, height: STONE, left: (SIZE - STONE) / 2, top: SIZE / 2 - STONE * POINT_FACE },
  stoneArt: { width: STONE, height: STONE },
  stoneShadow: { position: 'absolute', top: SIZE - 14, alignSelf: 'center' },
  nodeLabel: { alignSelf: 'stretch', alignItems: 'stretch', marginTop: 14, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.92)' },
  nodeRow: { alignSelf: 'stretch', alignItems: 'center' },
  node: { width: 124, alignItems: 'center' },
  point: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  halo: { position: 'absolute', width: SIZE + 18, height: SIZE + 18, borderRadius: (SIZE + 18) / 2 },
  burst: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  circle: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  lockOver: { position: 'absolute' },
  medal: { position: 'absolute', top: -2, right: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFF4CD', alignItems: 'center', justifyContent: 'center' },
  nodeTitle: { fontSize: 13, fontWeight: '800', color: t.ink, textAlign: 'center', lineHeight: 17 },
  optional: { fontSize: 11, fontWeight: '700', color: t.muted, marginTop: 1, textAlign: 'center' },
  nodeBar: { alignSelf: 'stretch', marginTop: 4 },
  pet: { position: 'absolute', top: 4 },
  petLeft: { right: 112 },
  petRight: { left: 112 },
  hint: { alignSelf: 'stretch', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, marginTop: 8, gap: 6 },
  hintText: { fontSize: 13, color: t.muted, lineHeight: 18 },
  hintLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 28 },
  hintLinkText: { fontSize: 13, fontWeight: '800', color: t.accent },
});
