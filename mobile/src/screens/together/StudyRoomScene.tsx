import React, { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import { useReduceMotion } from '../../components/useReduceMotion';
import type { LiveChatBubble } from '../../studyTogether/useRoomChat';
import type { LiveReaction } from '../../studyTogether/useStudyRoom';
import type { RoomMember, RoomState } from '../../studyTogether/types';
import { reactionEmoji } from './labels';

// The scene is drawn in a 400 x 260 viewBox (400 x 330 with a front row), in the same warm style as the personal Focus Space room.
const VW = 400;
const VH = 260;
/** With more than four members the room gains floor space in front of the desk for a second row. */
const VH_CROWDED = 330;
const DESK_TOP = 176;
/** Back-row pets stand with their feet here, so the desk (drawn over them) hides their legs: they sit at the desk. */
const BACK_FEET = 192;
const FRONT_FEET = 290;
const MAX_SEATS = 8;
const FALLBACK_WIDTH = 340;

/** Evenly spread seat centres for `count` pets across [from, to]. */
function spread(count: number, from: number, to: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + i * step);
}

function seatsFor(count: number) {
  const back = Math.min(4, count);
  const front = Math.min(MAX_SEATS, count) - back;
  const backXs = back <= 2 ? spread(back, 140, 260) : spread(back, 82, 318);
  return [
    ...backXs.map((x) => ({ x, y: BACK_FEET, row: 'back' as const })),
    ...spread(front, front <= 2 ? 120 : 70, front <= 2 ? 280 : 330).map((x) => ({ x, y: FRONT_FEET, row: 'front' as const })),
  ];
}

/** Y of the fairy-light string at x (a quadratic curve from (20, 18) through (200, 52) to (380, 16)). */
function lightY(x: number) {
  const t = (x - 20) / 360;
  return (1 - t) * (1 - t) * 18 + 2 * (1 - t) * t * 52 + t * t * 16;
}

type Props = { members: RoomMember[]; state: RoomState; reactions: LiveReaction[]; messages?: LiveChatBubble[]; meId: number };
const SPEECH_WIDTH = 140;
const NO_MESSAGES: LiveChatBubble[] = [];

/**
 * The shared study room: one desk with every member's pet seated at it. Daylight while focusing, a sunset during breaks
 * and a soft morning while waiting. Pets stay still when more than four are present or the OS asks for reduced motion,
 * which keeps cheaper phones smooth.
 */
export const StudyRoomScene = memo(function StudyRoomScene({ members, state, reactions, messages = NO_MESSAGES, meId }: Props) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const W = width || FALLBACK_WIDTH;
  const vh = members.length > 4 ? VH_CROWDED : VH;
  const H = (W * vh) / VW;
  const px = (x: number) => (x / VW) * W;
  const py = (y: number) => (y / vh) * H;

  const resting = state === 'break' || state === 'paused';
  const waiting = state === 'waiting';
  const seated = members.slice(0, MAX_SEATS);
  const seats = seatsFor(seated.length);
  const crowded = seated.length > 4;
  const size = W * (seated.length <= 2 ? 0.2 : seated.length === 3 ? 0.18 : 0.16);
  // Four seats in a row leave ~78 viewBox units between pets; keep name tags from touching.
  const tagWidth = Math.min(88, seated.length >= 4 ? px(76) : 88);
  const description = `Phòng học chung với ${members.length} bạn, ${waiting ? 'đang chờ bắt đầu' : resting ? 'đang nghỉ' : 'đang tập trung'}`;
  const sky = resting ? ['#F3C3A6', '#FBE3CC'] : waiting ? ['#C3E2F3', '#F1F5F4'] : ['#9ED0EE', '#DDF0FA'];

  const tag = (m: RoomMember) => {
    const me = m.user_id === meId;
    const away = m.presence === 'away';
    return (
      <View style={[styles.tag, { maxWidth: tagWidth }, me && styles.tagMe]}>
        <Text style={[styles.tagText, me && styles.tagTextMe]} numberOfLines={1}>
          {away ? '💤 ' : resting ? '☕ ' : ''}{me ? 'Bạn' : m.display_name}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.scene, { aspectRatio: VW / vh }]} testID="study-room-scene" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible accessibilityRole="image" accessibilityLabel={description}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VW} ${vh}`} preserveAspectRatio="xMidYMid slice">
          <Defs>
            <LinearGradient id="tg-wall" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F8F0E5" /><Stop offset="1" stopColor="#E9E6F1" /></LinearGradient>
            <LinearGradient id="tg-sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={sky[0]} /><Stop offset="1" stopColor={sky[1]} /></LinearGradient>
            <LinearGradient id="tg-floor" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#E7D9CB" /><Stop offset="1" stopColor="#F1E8DF" /></LinearGradient>
            <RadialGradient id="tg-glow"><Stop offset="0" stopColor="#FFEAC0" stopOpacity={resting ? 0.85 : 0.55} /><Stop offset="1" stopColor="#FFEAC0" stopOpacity="0" /></RadialGradient>
            <ClipPath id="tg-window"><Path d="M158 150V82a42 42 0 0 1 84 0v68Z" /></ClipPath>
          </Defs>
          <Rect width={VW} height={vh} fill="url(#tg-wall)" />

          {/* Fairy lights. */}
          <Path d="M20 18Q200 86 380 16" fill="none" stroke="#BAAE9C" strokeWidth="1.2" />
          {[52, 100, 148, 200, 252, 300, 348].map((x) => (
            <G key={x}><Circle cx={x} cy={lightY(x) + 3} r="7" fill="#FFF4D1" opacity="0.55" /><Circle cx={x} cy={lightY(x) + 3} r="2.2" fill="#FFF6DC" /></G>
          ))}

          {/* Arched window: the sky follows the room's state. */}
          <Path d="M140 44q-12 58 4 112l14 3q-12-74 0-115Z" fill="#DFD3CF" opacity="0.75" />
          <Path d="M260 44q12 58-4 112l-14 3q12-74 0-115Z" fill="#DFD3CF" opacity="0.65" />
          <Path d="M154 152V82a46 46 0 0 1 92 0v70Z" fill="#D1BDAE" />
          <G clipPath="url(#tg-window)">
            <Rect x="150" y="36" width="100" height="120" fill="url(#tg-sky)" />
            {resting ? <Circle cx="216" cy="118" r="13" fill="#FFE2B3" />
              : waiting ? <Circle cx="220" cy="70" r="9" fill="#FFF4D7" opacity="0.9" />
              : <G fill="#FFFFFF" opacity="0.9"><Ellipse cx="180" cy="72" rx="12" ry="4.5" /><Ellipse cx="222" cy="90" rx="9" ry="3.5" /></G>}
            <Path d="M156 140q22-20 44-8t46-6v26h-90Z" fill={resting ? '#D9A98F' : '#9FB9C3'} opacity="0.8" />
          </G>
          <Path d="M200 40V150M158 104H242" stroke="#FFF5E7" strokeWidth="4" />
          <Rect x="148" y="148" width="104" height="7" rx="3" fill="#C5AA94" />

          {/* Shelf with books and a trailing plant. */}
          <Rect x="24" y="74" width="80" height="5" rx="2" fill="#B9947B" />
          <Rect x="30" y="50" width="9" height="24" rx="1.5" fill="#B6BBCB" /><Rect x="41" y="54" width="8" height="20" rx="1.5" fill="#D6A89B" />
          <Rect x="51" y="47" width="10" height="27" rx="1.5" fill="#9EB9AF" />
          <Path d="M80 74l-3-13h18l-3 13Z" fill="#D9B89F" />
          <Path d="M86 62q-12-14-18-4 8 8 18 4Zm0 0q0-18 12-16 2 12-12 16Zm2 1q16 6 7 17-8 10-2 18" stroke="#8DA58A" strokeWidth="2" fill="none" />

          {/* Floor and rug. */}
          <Rect y="196" width={VW} height={vh - 196} fill="url(#tg-floor)" />
          <Path d={`M0 196H${VW}`} stroke="#D7C8BA" strokeWidth="1.5" />
          <G stroke="#DCCEC1" strokeWidth="1" opacity="0.55"><Path d={`M0 226H400M70 196L${70 - (vh - 196) * 0.6} ${vh}M200 196V${vh}M330 196L${330 + (vh - 196) * 0.6} ${vh}`} /></G>
          <Ellipse cx="200" cy="232" rx="176" ry="22" fill="#D4DDDC" opacity="0.85" />
          <Ellipse cx="200" cy="232" rx="156" ry="15" fill="none" stroke="#EAF0E9" strokeWidth="1.5" />

          {/* Floor plant. */}
          <Path d="M362 236l-9-34h34l-8 34q-9 4-17 0Z" fill="#CBA58E" />
          <G fill="#97AF8E">
            <Ellipse cx="360" cy="180" rx="7" ry="19" transform="rotate(-28 360 180)" /><Ellipse cx="382" cy="180" rx="7" ry="19" transform="rotate(28 382 180)" />
            <Ellipse cx="371" cy="170" rx="6.5" ry="19" />
          </G>

          {/* Warm lamp light over the desk, and the desk legs. */}
          <Ellipse cx="330" cy="160" rx="70" ry="40" fill="url(#tg-glow)" />
          <Path d="M58 200l-8 42M342 200l8 42" stroke="#B38E75" strokeWidth="6" strokeLinecap="round" />
        </Svg>
      </View>

      {/* Back row pets sit behind the desk. */}
      {seated.map((m, i) => {
        const seat = seats[i];
        if (seat.row !== 'back') return null;
        return (
          <View key={m.user_id} pointerEvents="none" style={[styles.pet, { left: px(seat.x) - size / 2, top: py(seat.y) - size, width: size, height: size },
            m.presence === 'away' && styles.away]}>
            <PetArt pet={m.pet} size={size} stage={m.pet_level} still={reduce || crowded || m.presence === 'away'} />
          </View>
        );
      })}

      {/* The desk top is drawn over the back row, with a book (or a mug during breaks) in front of each pet. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox={`0 0 ${VW} ${vh}`} preserveAspectRatio="xMidYMid slice">
          <Ellipse cx="200" cy="206" rx="168" ry="6" fill="#9C8676" opacity="0.18" />
          <Polygon points={`46,${DESK_TOP} 354,${DESK_TOP} 368,190 32,190`} fill="#D8B999" />
          <Rect x="32" y="189" width="336" height="13" rx="4" fill="#B48C6D" />
          <Rect x="32" y="189" width="336" height="3" fill="#C79E7F" />
          {seats.filter((s) => s.row === 'back').map((s) => (
            <G key={s.x} transform={`translate(${s.x} 184)`}>
              {resting
                ? <G><Path d="M-5 -9h10v8q-5 3-10 0Z" fill="#F5E7DA" /><Path d="M5 -7q5 0 3 4-1 2-3 1" stroke="#E5CEB8" strokeWidth="1.5" fill="none" /></G>
                : <G><Path d="M-16 -4q8-4 16 1 8-5 16-1l-2 6q-7-3-14 0-7-3-14 0Z" fill="#FFF8E6" stroke="#CBB699" strokeWidth="0.8" />
                  <Path d="M0 -3V3" stroke="#D9CBB6" strokeWidth="0.8" /></G>}
            </G>
          ))}
          {/* Reading lamp at the end of the desk. */}
          <Path d="M366 176V136l-14-12" fill="none" stroke="#889D9B" strokeWidth="3" strokeLinecap="round" />
          <Ellipse cx="366" cy="177" rx="9" ry="2" fill="#889D9B" />
          <Path d="M340 130q0-14 14-12l10 14Z" fill="#91A9A2" />
          <Rect x="40" y="168" width="20" height="8" rx="1.5" fill="#C5B8D3" /><Rect x="42" y="162" width="16" height="6" rx="1.5" fill="#9EB9AF" />
        </Svg>
      </View>

      {/* Front row (more than four members) stands in the foreground. */}
      {seated.map((m, i) => {
        const seat = seats[i];
        if (seat.row !== 'front') return null;
        return (
          <View key={m.user_id} pointerEvents="none" style={[styles.pet, { left: px(seat.x) - size / 2, top: py(seat.y) - size, width: size, height: size },
            m.presence === 'away' && styles.away]}>
            <PetArt pet={m.pet} size={size} stage={m.pet_level} still />
          </View>
        );
      })}

      {/* Name tags and live reactions sit above everything. */}
      {seated.map((m, i) => {
        const seat = seats[i];
        const reaction = [...reactions].reverse().find((r) => r.userId === m.user_id);
        const away = m.presence === 'away';
        const tagTop = seat.row === 'back' ? py(204) : py(seat.y) - 8;
        return (
          <View key={m.user_id} style={[styles.label, { left: px(seat.x) - 45, top: tagTop }]}
            accessible accessibilityLabel={`${m.display_name}${m.user_id === meId ? ' (bạn)' : ''}: ${away ? 'tạm vắng' : waiting ? 'đã vào phòng' : resting ? 'đang nghỉ' : 'đang học'}`}>
            {tag(m)}
            {reaction ? (
              <View style={[styles.bubble, { top: py(seat.y) - size - tagTop - 22 }]}>
                <Text style={styles.bubbleText}>{reactionEmoji(reaction.reaction)}</Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* A new chat message pops up over its sender's pet for a few seconds, like a speech bubble. */}
      {seated.map((m, i) => {
        const said = [...messages].reverse().find((b) => b.userId === m.user_id);
        if (!said) return null;
        const seat = seats[i];
        const left = Math.min(Math.max(4, px(seat.x) - SPEECH_WIDTH / 2), W - SPEECH_WIDTH - 4);
        return (
          <View key={`say${said.key}`} pointerEvents="none" style={[styles.speechSlot, { left, bottom: H - (py(seat.y) - size) - 6 }]}>
            <View style={styles.speech} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${m.display_name} nhắn: ${said.text}`}>
              <Text style={styles.speechText} numberOfLines={2}>{said.text}</Text>
            </View>
            <View style={[styles.speechTail, { marginLeft: px(seat.x) - left - SPEECH_WIDTH / 2 }]} />
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  scene: { width: '100%', borderRadius: 22, overflow: 'hidden', backgroundColor: '#F8F0E5' },
  pet: { position: 'absolute', alignItems: 'center', justifyContent: 'flex-end' },
  away: { opacity: 0.45 },
  label: { position: 'absolute', width: 90, alignItems: 'center' },
  tag: { maxWidth: 88, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#657C8A', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
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
});
