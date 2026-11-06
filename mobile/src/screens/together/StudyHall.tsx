import React, { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { Presence } from '../../studyTogether/types';
import { useWorldMotion } from '../../world/budget';
import { ContactShadow, Plate, useSize } from '../../world/diorama';
import { newActValues, actTransform, PET_ACTS, playAct } from '../../world/motion';
import { makeStyles } from '../../ui/theme';

/**
 * Cùng bạn tiến bộ's common room: a chalkboard with the group's goal, a long table, and each member's own pet around it.
 * Everything shown is what the server says: nobody's contribution, and nobody's "online" dot, is ever made up. A dot is
 * drawn only where presence is really known (a friend who shares it); others simply have none.
 */

export type HallMember = { id: number; name: string; pet: string; level: number; presence?: Presence | null; tag?: string | null; rewarded?: boolean };

const PRESENCE: Partial<Record<Presence, { color: string; word: string }>> = {
  studying: { color: '#F4B23E', word: 'đang học' },
  online: { color: '#4CD07F', word: 'trực tuyến' },
  offline: { color: '#A6ABB0', word: 'ngoại tuyến' },
};

/** A member's pet at the table. A new `cheer` number makes it hop: that member has just added to the goal. */
const MemberPet = memo(function MemberPet({ member, size, cheer, still }: { member: HallMember; size: number; cheer: number; still: boolean }) {
  const h = useStyles();
  const values = useRef(newActValues()).current;
  const { level } = useWorldMotion();
  useEffect(() => {
    if (!cheer || level === 'still') return;
    const anim = playAct(PET_ACTS.celebrate, values);
    anim.start();
    return () => anim.stop();
  }, [cheer, level, values]);
  const p = member.presence ? PRESENCE[member.presence] : undefined;
  return (
    <View style={[h.member, { width: size + 12 }]} accessible accessibilityLabel={`${member.name}${p ? `, ${p.word}` : ''}${member.tag ? `, ${member.tag}` : ''}`} testID={`hall-member-${member.id}`}>
      <ContactShadow width={size * 0.8} height={14} opacity={0.34} style={h.memberShadow} />
      <Animated.View style={{ transformOrigin: '50% 100%', transform: actTransform(values, size) }}>
        <PetArt pet={member.pet} stage={member.level} size={size} still={still} />
      </Animated.View>
      <View style={h.nameTag}>
        {p ? <View style={[h.dot, { backgroundColor: p.color }]} testID={`presence-${member.id}-${member.presence}`} /> : null}
        <Text style={h.name} numberOfLines={1}>{member.name}</Text>
      </View>
      {member.tag ? <Text style={h.contribution} numberOfLines={1}>{member.tag}</Text> : null}
    </View>
  );
});

const ROOM = require('../../../assets/world/hall/room.jpg');
const BOARD = require('../../../assets/world/hall/board.webp');
const TABLE = require('../../../assets/world/hall/table.webp');

/** The room: the wall with its flags, the chalkboard (its contents are `board`), the table and the pets around it. */
export function StudyHallScene({ members, cheers, board, children }: { members: HallMember[]; cheers?: Record<number, number>; board: React.ReactNode; children?: React.ReactNode }) {
  const h = useStyles();
  const [size, onLayout] = useSize({ width: 390, height: 420 });
  const [boardSize, onBoard] = useSize({ width: 350, height: 170 });
  const { level } = useWorldMotion();
  // A big group keeps most of its pets on their still art: moving sheets are large.
  const stillArt = level === 'lite' || members.length > 4;
  const petSize = Math.min(84, Math.floor((size.width - 24) / Math.max(3, Math.min(members.length, 4))) - 14);
  return (
    <View style={h.hall} onLayout={onLayout} testID="study-hall">
      <Plate source={ROOM} width={size.width} height={size.width * (2100 / 1170)} />
      <View style={h.boardFrame} onLayout={onBoard}>
        <Plate source={BOARD} width={boardSize.width} height={boardSize.height} />
        <View style={h.board}>{board}</View>
      </View>
      <Plate source={TABLE} width={size.width} height={size.width * (270 / 1170)} style={[h.table, { top: size.height - size.width * (240 / 1170) }]} />
      {members.length ? (
        <View style={h.row}>
          {members.slice(0, 8).map((m) => <MemberPet key={m.id} member={m} size={petSize} cheer={cheers?.[m.id] ?? 0} still={stillArt} />)}
        </View>
      ) : <View style={h.rowEmpty} />}
      {children}
    </View>
  );
}

/** A progress line written in chalk: what has been done of the goal, no more. */
export function ChalkBar({ value, done = false, height = 12 }: { value: number; done?: boolean; height?: number }) {
  const h = useStyles();
  return (
    <View style={[h.chalkTrack, { height }]}>
      <View style={[h.chalkFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: done ? '#9FE3B4' : '#FFE9A8' }]} />
    </View>
  );
}

// The room, the board and the chalk are the picture; the name tags floating over it are interface (glass, theme ink).
const useStyles = makeStyles(({ t }) => StyleSheet.create({
  hall: { overflow: 'hidden', paddingTop: 52, paddingBottom: 22, backgroundColor: '#F4FAFE' },
  boardFrame: { marginHorizontal: 16 },
  board: { minHeight: 132, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 28, gap: 6 },
  table: { left: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 8, marginTop: 14, rowGap: 6 },
  rowEmpty: { height: 66 },
  member: { alignItems: 'center' },
  memberShadow: { position: 'absolute', top: '42%', alignSelf: 'center' },
  nameTag: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', backgroundColor: t.glass, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1, marginTop: -2 },
  name: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '900', color: t.ink },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: t.card },
  contribution: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: '#FFE9A8', textShadowColor: 'rgba(30,15,5,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 },
  chalkTrack: { borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', overflow: 'hidden' },
  chalkFill: { height: '100%', borderRadius: 4 },
}));
