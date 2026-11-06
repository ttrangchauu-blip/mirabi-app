import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient as Gradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Text } from '../../components/Typography';
import type { Priority, WorkTask } from '../../life/types';
import { makeStyles } from '../../ui/theme';
import { useAtmosphere } from '../../world/atmosphere';
import { useEased, useWorldMotion } from '../../world/budget';
import { BEAT, hashOf } from '../../world/diorama';
import { EASE } from '../../world/motion';
import { SkyBodies, Stars } from '../../world/sky';
import { CloudDeck, Rain, Snow } from '../../world/living';
import { useWeather } from '../../world/weather';
import { PRIORITIES, priorityOf } from './WorkTaskSheet';

/** Nhiệm vụ công việc's desk: what the app draws into the rendered picture of the desk, and the notes you can pick up and drop on
 * the tray or a priority folder. Art and gestures only: what a drop does is decided by the screen, with the same calls
 * as the buttons, which stay for anyone who doesn't drag. */

/** The rendered back of the desk (assets/world/work, from scripts/render-scenes): its shape, and where in the picture, as
 * shares of it, the app draws what the picture can't know: the sky behind the glass and the laptop's screen. */
export const PLATE = { ratio: 1170 / 708, glass: { left: 0.1253, top: 0.1646, right: 0.3794, bottom: 0.5662 }, screen: { left: 0.4937, top: 0.6001, right: 0.7061, bottom: 0.8162 } };
export const DESK_DAY = require('../../../assets/world/work/day.jpg');
export const DESK_NIGHT = require('../../../assets/world/work/night.jpg');
export const DESK_TOP = require('../../../assets/world/work/top.jpg');

const inPlate = (box: { left: number; top: number; right: number; bottom: number }, width: number, height: number) => ({
  position: 'absolute' as const, left: box.left * width, top: box.top * height, width: (box.right - box.left) * width, height: (box.bottom - box.top) * height,
});

/** The glass of the window: what is really outside, at this hour. */
export const DeskWindow = memo(function DeskWindow({ width, height }: { width: number; height: number }) {
  const { reading } = useWeather();
  const { hours, mood, light: c } = useAtmosphere(reading);
  const place = inPlate(PLATE.glass, width, height);
  const w0 = place.width, h0 = place.height;
  return (
    <View style={[place, w.glass]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Gradient colors={[c.sky[0], c.sky[1], c.sky[2]]} style={StyleSheet.absoluteFill} />
      <Stars width={w0} height={h0 * 0.6} opacity={c.stars} />
      <SkyBodies width={w0} hours={hours} c={c} horizon={h0 * 0.72} zenith={4} clip={h0 * 0.8} body={44} idPrefix="desk" />
      <CloudDeck width={w0} top={6} color={c.cloud} opacity={c.cloudOpacity} cover={mood.cover} scale={0.8} />
      <Svg width={w0} height={h0} style={StyleSheet.absoluteFill}>
        <Path d={`M0 ${h0 * 0.68} Q${w0 * 0.3} ${h0 * 0.46} ${w0 * 0.6} ${h0 * 0.64} T${w0} ${h0 * 0.58} V${h0} H0 Z`} fill={c.hills[0]} />
        <Path d={`M0 ${h0 * 0.8} Q${w0 * 0.4} ${h0 * 0.66} ${w0} ${h0 * 0.78} V${h0} H0 Z`} fill={c.meadow} />
      </Svg>
      <Rain width={w0} height={h0} strength={mood.rain} wind={mood.wind} ground={0.9} />
      <Snow width={w0} height={h0} strength={mood.snow} />
      <View style={[w.mullionV, { opacity: 1 - c.stars * 0.72 }]} /><View style={[w.mullionH, { opacity: 1 - c.stars * 0.72 }]} />
    </View>
  );
});

/** The laptop's screen while working: it comes on and goes off softly. */
export function DeskScreen({ lit, width, height }: { lit: boolean; width: number; height: number }) {
  const opacity = useEased(lit ? 1 : 0, 500);
  return (
    <Animated.View pointerEvents="none" style={[inPlate(PLATE.screen, width, height), w.screen, { opacity }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Gradient colors={['#D9F3FF', '#7CCBF2']} style={StyleSheet.absoluteFill} />
      {[0.62, 0.8, 0.5, 0.72].map((share, i) => <View key={i} style={[w.line, { width: `${share * 100}%` }]} />)}
    </Animated.View>
  );
}

/** A rectangle of the screen (from `measureInWindow`). */
export type Box = { x: number; y: number; width: number; height: number };
export type DropTarget = 'done' | Priority;
/** The drop target under a finger, if any. A little forgiving at the edges: fingers are wide. */
export function targetAt(zones: Partial<Record<DropTarget, Box>>, x: number, y: number, slop = 8): DropTarget | null {
  for (const [id, box] of Object.entries(zones) as [DropTarget, Box][]) {
    if (x >= box.x - slop && x <= box.x + box.width + slop && y >= box.y - slop && y <= box.y + box.height + slop) return id;
  }
  return null;
}

/** Holding a note this long picks it up, even without moving sideways. */
const HOLD_MS = 220;
/** Deep enough for white text at 4.5:1. */
const LABEL: Record<Priority, string> = { low: '#2F7A45', medium: '#1C6FA3', high: '#A8620F', urgent: '#B8303C' };
const NOTE: Record<Priority, { paper: string; deep: string }> = {
  low: { paper: '#E3F4D9', deep: '#C2E2AE' },
  medium: { paper: '#FFF4B8', deep: '#F2DF87' },
  high: { paper: '#FFD9A8', deep: '#F4BE78' },
  urgent: { paper: '#FFC6C4', deep: '#F19B98' },
};

type NoteProps = {
  task: WorkTask; done: boolean; state?: 'sending' | 'queued'; project?: string; due: string | null; stamping: boolean;
  onPress: () => void; onComplete: () => void;
  /** Picked up / put down: the page must not scroll in between. */ onLift: (lifted: boolean) => void;
  /** Where the finger is, while dragging. */ onHover: (x: number, y: number) => void;
  /** Let go at this point; true if it landed on something. */ onDrop: (x: number, y: number) => boolean;
};

/**
 * A note on the desk. A tap reads it; dragging it sideways, or holding it a moment first, picks it up: it lifts off the
 * desk and follows the finger, then lands on a target or slides back to its place. Its tilt comes from its id, so it
 * never reshuffles, and a stamp lands when it is done.
 */
export function DeskNote({ task, done, state, project, due, stamping, onPress, onComplete, onLift, onHover, onDrop }: NoteProps) {
  const { level } = useWorldMotion();
  const still = level === 'still';
  const p = priorityOf(task.priority);
  const color = NOTE[task.priority] ?? NOTE.medium;
  const late = !!task.overdue && !done;
  const steps = task.steps.length ? `${task.steps.filter((x) => x.done).length}/${task.steps.length}` : null;
  const tilt = useMemo(() => `${((hashOf(task.occurrence_id) % 50) - 25) / 10}deg`, [task.occurrence_id]);
  const drag = useRef(new Animated.ValueXY()).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [lifted, setLifted] = useState(false);
  const armed = useRef(false);
  const latest = useRef({ onLift, onHover, onDrop, done, still });
  latest.current = { onLift, onHover, onDrop, done, still };
  const raise = (to: number) => { if (!latest.current.still) Animated.timing(lift, { toValue: to, duration: BEAT.press, easing: EASE.ui, useNativeDriver: true }).start(); };
  const settle = () => {
    armed.current = false;
    setLifted(false);
    latest.current.onLift(false);
    raise(0);
    if (latest.current.still) { drag.setValue({ x: 0, y: 0 }); return; }
    Animated.spring(drag, { toValue: { x: 0, y: 0 }, friction: 7, tension: 90, useNativeDriver: true }).start();
  };
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !latest.current.done && (armed.current || (Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4)),
    onPanResponderGrant: () => { setLifted(true); latest.current.onLift(true); raise(1); },
    onPanResponderMove: (_, g) => { drag.setValue({ x: g.dx, y: g.dy }); latest.current.onHover(g.moveX, g.moveY); },
    onPanResponderRelease: (_, g) => {
      latest.current.onDrop(g.moveX, g.moveY);
      settle();
    },
    onPanResponderTerminate: () => settle(),
    onPanResponderTerminationRequest: () => false,
  })).current;
  const stamp = useRef(new Animated.Value(done ? 1 : 0)).current;
  useEffect(() => {
    if (!done) { stamp.setValue(0); return; }
    if (!stamping || still) { stamp.setValue(1); return; }
    stamp.setValue(0);
    const anim = Animated.spring(stamp, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [done, stamping, still, stamp]);
  return (
    <Animated.View {...responder.panHandlers} style={[n.wrap, lifted && n.wrapLifted, { transform: [...drag.getTranslateTransform(), { rotate: lifted ? '0deg' : tilt }, { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }]}>
      <Pressable onPress={onPress} onLongPress={() => { if (done) return; armed.current = true; latest.current.onLift(true); }} delayLongPress={HOLD_MS}
        onPressOut={() => { if (armed.current && !lifted) { armed.current = false; latest.current.onLift(false); } }}
        accessibilityRole="button" accessibilityLabel={`${task.title}, ưu tiên ${p.label}${due ? `, hạn ${due}` : ''}${late ? ', quá hạn' : ''}${done ? ', đã hoàn thành' : ''}`}
        accessibilityHint={done ? undefined : 'Giữ rồi kéo vào khay Xong hoặc một mức ưu tiên'} testID={`quest-${task.occurrence_id}`}
        style={[n.note, { backgroundColor: color.paper }, lifted && n.noteLifted, done && n.noteDone]}>
        <View style={[n.fold, { borderTopColor: color.deep }]} />
        <View style={n.tape} />
        <View style={[n.priority, { backgroundColor: LABEL[task.priority] ?? p.color }]}><Text style={n.priorityText}>{p.label}</Text></View>
        <Text style={[n.title, done && n.titleDone]} numberOfLines={3}>{task.title}</Text>
        {project ? <Text style={n.project} numberOfLines={1}>{project}</Text> : null}
        <View style={n.meta}>
          {late ? <View style={n.lateTag}><Ionicons name="alarm" size={12} color="#FFFFFF" /><Text style={n.lateText}>Quá hạn</Text></View>
            : due ? <View style={n.dueTag}><Ionicons name="alarm-outline" size={12} color="#4F6C86" /><Text style={n.dueText}>{due}</Text></View> : null}
          {steps ? <Text style={n.metaText}>☑ {steps}</Text> : null}
          {task.estimated_minutes ? <Text style={n.metaText}>{task.estimated_minutes} phút</Text> : null}
        </View>
        <View style={n.foot}>
          <Text style={n.exp}>+{task.exp} EXP</Text>
          {done && state === 'queued' ? <Ionicons name="cloud-upload-outline" size={18} color="#4F6C86" accessibilityLabel="Chờ đồng bộ" /> : null}
        </View>
        {done ? (
          <Animated.View pointerEvents="none" style={[n.stamp, { opacity: stamp, transform: [{ scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }, { rotate: '-14deg' }] }]}>
            <Text style={n.stampText}>{state === 'queued' ? 'CHỜ GỬI' : 'XONG'}</Text>
          </Animated.View>
        ) : null}
      </Pressable>
      {!done ? (
        <Pressable onPress={onComplete} hitSlop={8} style={n.doneBtn} accessibilityRole="button" accessibilityLabel={`Hoàn thành ${task.title}`}>
          <Ionicons name="checkmark" size={18} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** The tray and the four folders, only there while a note is being carried, so the desk stays clear otherwise. */
export const DropDock = React.forwardRef<View, { hover: DropTarget | null; onZones: (zones: Partial<Record<DropTarget, Box>>) => void; bottom: number }>(function DropDock({ hover, onZones, bottom }, ref) {
  const d = useStyles();
  const views = useRef<Partial<Record<DropTarget, View | null>>>({});
  const rise = useRef(new Animated.Value(0)).current;
  const { level } = useWorldMotion();
  useEffect(() => {
    if (level === 'still') rise.setValue(1);
    else Animated.timing(rise, { toValue: 1, duration: BEAT.open, easing: EASE.ui, useNativeDriver: true }).start();
    // Measured once it is drawn: this is where drops are checked, in the same coordinates as the finger.
    const id = setTimeout(() => {
      const zones: Partial<Record<DropTarget, Box>> = {};
      (Object.entries(views.current) as [DropTarget, View | null][]).forEach(([key, view]) => {
        view?.measureInWindow((x, y, width, height) => { zones[key] = { x, y, width, height }; onZones({ ...zones }); });
      });
    }, 30);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View ref={ref} pointerEvents="none" testID="drop-dock" style={[d.dock, { bottom, opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
      {PRIORITIES.map((x) => (
        <View key={x.id} ref={(v) => { views.current[x.id] = v; }} style={[d.folder, { backgroundColor: LABEL[x.id] }, hover === x.id && d.hover]} testID={`drop-${x.id}`}>
          <View style={[d.folderTab, { backgroundColor: LABEL[x.id] }]} />
          <Text style={d.folderText}>{x.label}</Text>
        </View>
      ))}
      <View ref={(v) => { views.current.done = v; }} style={[d.tray, hover === 'done' && d.hover]} testID="drop-done">
        <Svg width={46} height={26} viewBox="0 0 46 26"><Path d="M2 4 H44 L38 24 H8 Z" fill="#8A5C33" /><Path d="M2 4 H44 L42.5 9 H3.5 Z" fill="#C8924A" /></Svg>
        <Text style={d.trayText}>Xong</Text>
      </View>
    </Animated.View>
  );
});

const w = StyleSheet.create({
  glass: { overflow: 'hidden', backgroundColor: '#BFE3F5' },
  screen: { overflow: 'hidden', padding: 6, gap: 4, borderRadius: 2 },
  line: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.8)' },
  mullionV: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 3, marginLeft: -1.5, backgroundColor: '#FBF4E6' },
  mullionH: { position: 'absolute', top: '46%', left: 0, right: 0, height: 3, backgroundColor: '#FBF4E6' },
});

const n = StyleSheet.create({
  wrap: { width: '48%', zIndex: 1 },
  wrapLifted: { zIndex: 50, elevation: 30 },
  note: { minHeight: 148, padding: 10, paddingTop: 14, borderRadius: 3, shadowColor: '#1F6E9E', shadowOpacity: 0.34, shadowRadius: 5, shadowOffset: { width: 1, height: 4 }, elevation: 4 },
  noteLifted: { shadowOpacity: 0.42, shadowRadius: 16, shadowOffset: { width: 3, height: 14 }, elevation: 16 },
  noteDone: { opacity: 0.86 },
  fold: { position: 'absolute', right: 0, bottom: 0, width: 0, height: 0, borderTopWidth: 16, borderLeftWidth: 16, borderLeftColor: 'transparent' },
  tape: { position: 'absolute', top: -7, alignSelf: 'center', width: 48, height: 15, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: 0.5, borderColor: 'rgba(120,90,50,0.2)' },
  priority: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginBottom: 5 },
  priorityText: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: '#FFFFFF' },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#123B5C' },
  titleDone: { color: '#4F6C86', textDecorationLine: 'line-through' },
  project: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: '#4F6C86', marginTop: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  metaText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: '#4F6C86' },
  dueTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  dueText: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: '#4F6C86' },
  lateTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#C8323F', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  lateText: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: '#FFFFFF' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  exp: { fontSize: 12, fontWeight: '900', color: '#6A3FB5' },
  doneBtn: { position: 'absolute', right: 7, bottom: 7, width: 36, height: 36, borderRadius: 18, backgroundColor: '#22A06B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
  stamp: { position: 'absolute', top: '36%', alignSelf: 'center', borderWidth: 3, borderColor: '#C8323F', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.65)' },
  stampText: { color: '#C8323F', fontWeight: '900', fontSize: 18, letterSpacing: 2 },
});

// The dock floats over the page while a note is carried: it is chrome and follows the theme. The folders keep their
// priority colours (white text on them in both) and the tray its drawn wood.
const useStyles = makeStyles(({ t }) => StyleSheet.create({
  dock: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 8, borderRadius: 14, backgroundColor: t.glass, borderWidth: 1, borderColor: t.border, zIndex: 40, elevation: 20 },
  folder: { flex: 1, height: 58, borderRadius: 7, borderTopLeftRadius: 2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  folderTab: { position: 'absolute', left: -2, top: -8, width: 26, height: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  folderText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  tray: { flex: 1.3, height: 58, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: t.card, borderWidth: 2, borderColor: t.border },
  trayText: { fontSize: 13, lineHeight: 16, fontWeight: '900', color: t.success },
  hover: { transform: [{ scale: 1.08 }], borderColor: '#FFE28A', borderWidth: 3 },
}));
