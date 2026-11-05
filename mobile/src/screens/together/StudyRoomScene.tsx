import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import { formatClock, remainingMs, type TimerAnchor } from '../../studyTogether/timer';
import type { LiveChatBubble } from '../../studyTogether/useRoomChat';
import type { LiveReaction } from '../../studyTogether/useStudyRoom';
import type { RoomMember, RoomState } from '../../studyTogether/types';
import { roomLight, useAtmosphere } from '../../world/atmosphere';
import { useSwing, useWorldMotion } from '../../world/budget';
import { GlassSky } from '../../world/GlassSky';
import { actTransform } from '../../world/motion';
import { PhotoRoom } from '../../world/PhotoRoom';
import { useCelebration } from '../../world/useCelebration';
import { useWeather } from '../../world/weather';
import { type Box, GROUP_BOARD, GROUP_FORE, GROUP_FRAME, GROUP_GLASS, GROUP_NEAR, GROUP_ROOM, GROUP_SEATS, GROUP_SWAY, GROUP_TABLE, GROUP_TOP, type SwayPart } from './groupPlates';
import { reactionEmoji } from './labels';

/** The picture's canvas (scene-grouproom.js): five chairs behind the table and three poufs in front. */
const CW = 640, CH = 440;
const MAX_SEATS = 8;
const FALLBACK_WIDTH = 340;
const SPEECH_WIDTH = 140;
const NO_MESSAGES: LiveChatBubble[] = [];
/** Which seats a room of this many has, evenly over the table: 0-4 behind it from the left, then 5-7 in front. */
const SEATS_FOR: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 6], 7: [0, 1, 2, 3, 4, 5, 7], 8: [0, 1, 2, 3, 4, 5, 6, 7] };
const SEAT_ORDER = [2, 1, 3, 0, 4, 6, 5, 7];
const LAMPS: [number, number][] = [[228, 34], [448, 34]];

type Mode = 'idle' | 'study' | 'rest' | 'paused' | 'away';
const WORD: Record<Mode, string> = { idle: 'đã vào phòng', study: 'đang học', rest: 'đang nghỉ', paused: 'tạm dừng', away: 'ngoại tuyến' };
const MARK: Record<Mode, string> = { idle: '', study: '📖 ', rest: '☕ ', paused: '⏸ ', away: '💤 ' };
const DOT: Record<Mode, string> = { idle: '#82AEBE', study: '#4F9E7B', rest: '#E0A84E', paused: '#A58FC0', away: '#A9A39A' };
const modeOf = (m: RoomMember, state: RoomState): Mode => (m.presence === 'away' ? 'away' : state === 'waiting' ? 'idle' : state === 'paused' ? 'paused' : state === 'break' ? 'rest'
  : m.in_session === false ? 'idle' : 'study');

type Props = { members: RoomMember[]; state: RoomState; reactions: LiveReaction[]; messages?: LiveChatBubble[]; meId: number;
  /** How many seats the room has: an empty chair waits for each one still free. */ seats?: number;
  /** The session's clock, for the board. */ anchor?: TimerAnchor | null;
  /** The room's goal, for the board. */ goal?: string | null;
  /** Cycles finished: each new one, those in the session celebrate. */ completed?: number;
  /** No photo mode (a preview). */ noPhoto?: boolean };

const place = ([x, y, w, h]: Box, W: number) => { const k = W / CW; return { position: 'absolute' as const, left: x * k, top: y * k, width: w * k, height: h * k }; };
const Plate = ({ source, box, W }: { source: ImageSourcePropType; box: Box; W: number }) => (
  <Image source={source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors style={place(box, W)} />
);
function Swaying({ part, W }: { part: SwayPart; W: number }) {
  const { level } = useWorldMotion();
  const swing = useSwing({ ms: part.ms, rest: [400, 3200], enabled: level === 'full' });
  const [x, y, w, h] = part.box;
  return <Animated.Image source={part.source} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors testID="room-sway"
    style={[place(part.box, W), { transformOrigin: `${((part.origin[0] - x) / w) * 100}% ${((part.origin[1] - y) / h) * 100}%`,
      transform: [{ rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: [`${-part.deg}deg`, `${part.deg}deg`] }) }] }]} />;
}

/** The light of a lamp over the table, breathing very slowly. */
function LampGlow({ x, y, W }: { x: number; y: number; W: number }) {
  const breath = useSwing({ ms: 3600, jitter: 0.1 });
  const r = 78 * (W / CW), id = `study-lamp-${x}`;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: (x / CW) * W - r, top: (y / CW) * W - r, width: r * 2, height: r * 2,
      opacity: breath.interpolate({ inputRange: [-1, 1], outputRange: [0.55, 0.85] }) }}>
      <Svg width={r * 2} height={r * 2}>
        <Defs><RadialGradient id={id} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#FFE3A8" stopOpacity="0.55" /><Stop offset="0.45" stopColor="#FFE3A8" stopOpacity="0.16" /><Stop offset="1" stopColor="#FFE3A8" stopOpacity="0" /></RadialGradient></Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/** The clock on the board, from the server's own (the same anchor as the timer under the room). It counts by itself: the rest of the scene never redraws for it. */
function BoardClock({ anchor, state, goal, W }: { anchor: TimerAnchor | null; state: RoomState; goal?: string | null; W: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!anchor?.running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [anchor]);
  const k = W / CW;
  const session = state === 'focus' || state === 'break' || state === 'paused';
  const label = state === 'focus' ? 'Đang tập trung' : state === 'break' ? 'Giờ nghỉ' : state === 'paused' ? 'Tạm dừng' : 'Chờ bắt đầu';
  return (
    <View style={[place(GROUP_BOARD, W), styles.board]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="study-room-board">
      <Text style={[styles.boardLabel, { fontSize: 11 * k * 1.25, lineHeight: 15 * k * 1.25 }]} numberOfLines={1}>{label}</Text>
      {session && anchor ? <Text style={[styles.boardClock, { fontSize: 34 * k, lineHeight: 40 * k }]} testID="study-room-board-clock">{formatClock(remainingMs(anchor))}</Text> : null}
      {goal ? <Text style={[styles.boardGoal, { fontSize: 10 * k * 1.25, lineHeight: 14 * k * 1.25 }]} numberOfLines={session ? 1 : 3}>{goal}</Text> : null}
    </View>
  );
}

/** A member's pet in its seat, or their first letter when they have none yet (a paw in a photo, which has nobody's name in it). Its place on the screen is its parent's, so nothing here starts over when someone else comes or goes. */
const SeatPet = memo(function SeatPet({ pet, level, size, mode, still, celebrate, name }: { pet?: string | null; level: number; size: number; mode: Mode; still: boolean; celebrate: number; name: string | null }) {
  const party = useCelebration(celebrate, pet, level);
  if (!pet) return <View style={[styles.initial, { width: size * 0.62, height: size * 0.62, borderRadius: size * 0.31 }]} testID="study-room-no-pet">{name === null ? <Ionicons name="paw" size={size * 0.3} color="#2C6E96" /> : <Text style={[styles.initialText, { fontSize: size * 0.3 }]}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>}</View>;
  return (
    <Animated.View style={{ transformOrigin: '50% 100%', transform: actTransform(party.values, size) }}>
      <PetArt pet={pet} size={size} stage={level} studying={mode === 'study' && !still && !party.on} still={still || mode === 'rest' || mode === 'paused' || mode === 'away'} cheer={celebrate ? party.cheer : undefined} />
    </Animated.View>
  );
});

/** The picture of the room with its people in it. `bare` is for photo mode: only the room and the pets, no names, no words of anyone's. */
function Stage({ members, state, reactions, messages, meId, seats, anchor, goal, completed, W, bare }: Omit<Props, 'noPhoto'> & { W: number; bare?: boolean }) {
  const reduce = useReduceMotion();
  const { level } = useWorldMotion();
  const { reading } = useWeather();
  const { hours, mood } = useAtmosphere(reading);
  const wash = roomLight(Math.round(hours * 4) / 4, mood);
  const H = (W * CH) / CW, k = W / CW;
  const seated = members.slice(0, MAX_SEATS);
  const count = Math.max(1, Math.min(MAX_SEATS, Math.max(seats ?? 0, seated.length)));
  const slots = SEATS_FOR[count];
  // Who sits where: from the middle of the table outwards, so a small group sits together and nobody moves when someone joins.
  const order = [...slots].sort((a, b) => SEAT_ORDER.indexOf(a) - SEAT_ORDER.indexOf(b));
  const taken = seated.map((_, i) => order[i]);
  // A big group keeps others on their still art: moving sheets are large. The own pet still moves.
  const crowded = seated.length > 4 || level === 'lite';
  // With more than the five chairs in use, names get one seat's width each.
  const tight = count > 5;
  const tagWidth = tight ? 74 * k : 90;
  const size = (seat: number) => (GROUP_SEATS[seat].row === 'back' ? 84 : 88) * k;
  const feet = (m: RoomMember, seat: number) => {
    const s = GROUP_SEATS[seat], mode = modeOf(m, state);
    return (s.foot[1] + (s.row === 'back' ? (mode === 'study' ? 5 : 16) : 0)) * k;
  };
  const pet = (m: RoomMember, i: number) => {
    const seat = taken[i], px = size(seat), mode = modeOf(m, state);
    return (
      <View key={m.user_id} pointerEvents="none" testID={`study-pet-${m.user_id}-${mode}`}
        style={[styles.pet, { left: GROUP_SEATS[seat].foot[0] * k - px / 2, top: feet(m, seat) - px, width: px, height: px }, mode === 'away' && styles.away]}>
        <SeatPet pet={m.pet} level={m.pet_level} size={px} mode={mode} name={bare ? null : m.display_name} celebrate={m.in_session && mode !== 'away' ? completed ?? 0 : 0}
          still={reduce || (crowded && m.user_id !== meId)} />
      </View>
    );
  };
  return (
    <View style={{ width: W, height: H }}>
      <Image source={GROUP_ROOM} fadeDuration={0} resizeMode="stretch" accessibilityIgnoresInvertColors style={{ position: 'absolute', width: W, height: H }} />
      <View style={place(GROUP_GLASS, W)}><GlassSky idPrefix={bare ? 'groupshot' : 'group'} /></View>
      <Plate source={GROUP_FRAME.source} box={GROUP_FRAME.box} W={W} />
      {GROUP_SWAY.map((part) => <Swaying key={part.box.join()} part={part} W={W} />)}
      {wash.opacity > 0 ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash.color, opacity: wash.opacity }]} /> : null}
      {LAMPS.map(([x, y]) => <LampGlow key={x} x={x} y={y} W={W} />)}
      <BoardClock anchor={anchor ?? null} state={state} goal={bare ? null : goal} W={W} />
      {slots.map((seat) => <Plate key={seat} source={GROUP_SEATS[seat].source} box={GROUP_SEATS[seat].box} W={W} />)}
      {seated.map((m, i) => (GROUP_SEATS[taken[i]].row === 'back' ? pet(m, i) : null))}
      <Plate source={GROUP_TABLE.source} box={GROUP_TABLE.box} W={W} />
      {seated.map((m, i) => (GROUP_SEATS[taken[i]].row === 'front' ? pet(m, i) : null))}
      {bare ? null : GROUP_FORE.map((part) => <Swaying key={part.box.join()} part={part} W={W} />)}
      {bare ? null : seated.map((m, i) => {
        const seat = taken[i], s = GROUP_SEATS[seat], me = m.user_id === meId, mode = modeOf(m, state);
        const reaction = [...reactions].reverse().find((r) => r.userId === m.user_id);
        const px = size(seat), tagTop = s.row === 'back' ? (s.foot[1] + 24) * k : (s.foot[1] + 2) * k;
        return (
          <View key={m.user_id} style={[styles.label, { left: s.foot[0] * k - tagWidth / 2, top: tagTop, width: tagWidth }]} accessible
            accessibilityLabel={`${m.display_name}${me ? ' (bạn)' : ''}: ${WORD[mode]}`}>
            {tight ? (
              <View style={[styles.tag, styles.tagTight, me && styles.tagMe]}>
                <View style={[styles.tagDot, { backgroundColor: DOT[mode] }]} />
                <Text style={[styles.tagText, styles.tagTextTight, me && styles.tagTextMe]} numberOfLines={1}>{me ? 'Bạn' : m.display_name}</Text>
              </View>
            ) : (
              <View style={[styles.tag, me && styles.tagMe]}>
                <Text style={[styles.tagText, me && styles.tagTextMe]} numberOfLines={1}>{MARK[mode]}{me ? 'Bạn' : m.display_name}</Text>
              </View>
            )}
            {reaction ? <View style={[styles.bubble, { top: feet(m, seat) - px - tagTop - 22 }]}><Text style={styles.bubbleText}>{reactionEmoji(reaction.reaction)}</Text></View> : null}
          </View>
        );
      })}
      {/* A new chat message pops up over its sender's pet for a few seconds, like a speech bubble. Never in a photo. */}
      {bare ? null : seated.map((m, i) => {
        const said = [...(messages ?? NO_MESSAGES)].reverse().find((b) => b.userId === m.user_id);
        if (!said) return null;
        const seat = taken[i], s = GROUP_SEATS[seat], left = Math.min(Math.max(4, s.foot[0] * k - SPEECH_WIDTH / 2), W - SPEECH_WIDTH - 4);
        return (
          <View key={`say${said.key}`} pointerEvents="none" style={[styles.speechSlot, { left, bottom: H - (feet(m, seat) - size(seat)) - 6 }]}>
            <View style={styles.speech} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${m.display_name} nhắn: ${said.text}`}>
              <Text style={styles.speechText} numberOfLines={2}>{said.text}</Text>
            </View>
            <View style={[styles.speechTail, { marginLeft: s.foot[0] * k - left - SPEECH_WIDTH / 2 }]} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * The shared study room, a rendered 3D room in layers (scene-grouproom.js): a seat for each place the room has, every member's own pet in
 * theirs, doing what the server says they are doing, and a clock on the board that is the session's own. Nothing about anyone is made up:
 * no one is drawn who is not in the room. Photo mode leaves the room and the pets alone on the screen, with no names and no messages.
 */
export const StudyRoomScene = memo(function StudyRoomScene({ members, state, reactions, messages = NO_MESSAGES, meId, seats, anchor, goal, completed, noPhoto = false }: Props) {
  const [width, setWidth] = useState(0);
  const [photo, setPhoto] = useState(false);
  const W = width || FALLBACK_WIDTH;
  const waiting = state === 'waiting';
  const description = `Phòng học chung với ${members.length} bạn, ${waiting ? 'đang chờ bắt đầu' : state === 'paused' ? 'đang tạm dừng' : state === 'break' ? 'đang nghỉ' : 'đang tập trung'}`;
  const shared = { members, state, reactions, messages, meId, seats, anchor, goal, completed };
  return (
    <View style={styles.scene} testID="study-room-scene" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={description} />
      <Stage {...shared} W={W} />
      {noPhoto ? null : (
        <Pressable onPress={() => setPhoto(true)} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]} accessibilityRole="button" hitSlop={6}
          accessibilityLabel="Toàn màn hình để ngắm phòng và chụp ảnh" testID="group-photo-open">
          <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
        </Pressable>
      )}
      {photo ? <PhotoRoom onClose={() => setPhoto(false)} top={GROUP_TOP} near={GROUP_NEAR} fileName="mirabi-phong-hoc-nhom" testPrefix="group-photo">
        {(w) => <Stage {...shared} W={w} bare />}
      </PhotoRoom> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  scene: { width: '100%', aspectRatio: CW / CH, borderRadius: 22, overflow: 'hidden', backgroundColor: '#CFE0F2' },
  pet: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  away: { opacity: 0.45 },
  initial: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#9CC3DE' },
  initialText: { fontWeight: '900', color: '#2C6E96' },
  label: { position: 'absolute', alignItems: 'center' },
  tag: { maxWidth: 88, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#657C8A', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tagTight: { flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%', paddingHorizontal: 4 },
  tagDot: { width: 4, height: 4, borderRadius: 2 },
  tagTextTight: { fontSize: 9, flexShrink: 1 },
  tagMe: { backgroundColor: '#136FA8' },
  tagText: { fontSize: 10, fontWeight: '800', color: '#304653' },
  tagTextMe: { color: '#FFFFFF' },
  bubble: { position: 'absolute', zIndex: 2, backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 6, paddingVertical: 2,
    shadowColor: '#1F6E9E', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  bubbleText: { fontSize: 16 },
  speechSlot: { position: 'absolute', width: SPEECH_WIDTH, alignItems: 'center', zIndex: 3 },
  speech: { maxWidth: SPEECH_WIDTH, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5,
    shadowColor: '#1F6E9E', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  speechText: { fontSize: 11, lineHeight: 15, fontWeight: '700', color: '#304653' },
  speechTail: { width: 10, height: 10, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }], marginTop: -6 },
  board: { alignItems: 'center', justifyContent: 'center' },
  boardLabel: { color: '#D8F0EE', fontWeight: '800' },
  boardClock: { color: '#FFFFFF', fontWeight: '800', fontVariant: ['tabular-nums'] },
  boardGoal: { color: '#FFE9A8', fontWeight: '700', textAlign: 'center' },
  photoButton: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(24,40,64,0.42)' },
  pressed: { transform: [{ scale: 0.92 }], opacity: 0.9 },
});
