import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Text } from '../../components/Typography';
import { Actions, NoteLine, SceneProps, Stepper, useSolvedReaction, useWrongShake } from './common';
import { angleAt, angleKind, armEnd, clampStep, rectAt } from './logic';

// Xưởng hình học (Toán): a blueprint on the workshop table.
// - An angle: the protractor lies on the blueprint, one arm along 0°. The learner turns the other arm by dragging its
//   handle (or − / +, on the protractor's steps). With `readout` the measure shows as it turns; without it the learner
//   reads it on the protractor's scale. Right: the angle's arc fills green and its kind and measure are written in.
// - A rectangle: drawn from the top-left corner of a centimetre grid; the learner drags its other corner (or − / +).
//   The side lengths show; the area and the perimeter are the learner's to work out. Right: the unit squares fill one
//   after the other (the area counted) and the area and perimeter are written in.
// The backend measures what was built (`angle:<degrees>`, `rect:<w>x<h>`); nothing here knows the answer.

const BLUEPRINT = '#1F4E8C';
const CHALK = '#FFFFFF';
const GOLD = '#F4C14F';
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function GeometryWorkshop(props: SceneProps & { demo?: { value: number | [number, number]; solved?: boolean } }) {
  return props.turn.prompt.shape === 'rect' ? <RectGrid {...props} /> : <Protractor {...props} />;
}

function Protractor({ turn, disabled, feedback, solved, onSubmit, reduceMotion, demo }: SceneProps & { demo?: { value: number | [number, number]; solved?: boolean } }) {
  const p = turn.prompt;
  const step = p.angle_step ?? 5;
  const [own, setOwn] = useState<number>(typeof p.initial === 'number' ? p.initial : 30);
  const deg = typeof demo?.value === 'number' ? demo.value : own;
  const done = !!solved || !!demo?.solved;
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'geometry:angle', 1100, reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);
  const shake = useWrongShake(feedback, 'geometry:wrong', reduceMotion);
  const [width, setWidth] = useState(320);
  const h = Math.round(width * 0.58);
  const cx = width / 2;
  const cy = h - 16;
  const r = Math.min(width / 2 - 22, h - 34);
  const live = useRef({ off, cx, cy, step });
  live.current = { off, cx, cy, step };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.off,
    onMoveShouldSetPanResponder: () => !live.current.off,
    onPanResponderGrant: (e) => setOwn(angleAt(e.nativeEvent.locationX - live.current.cx, e.nativeEvent.locationY - live.current.cy, live.current.step)),
    onPanResponderMove: (e) => setOwn(angleAt(e.nativeEvent.locationX - live.current.cx, e.nativeEvent.locationY - live.current.cy, live.current.step)),
  }), []);
  const end = armEnd(cx, cy, r + 8, deg);
  const ticks = [];
  for (let a = 0; a <= 180; a += 5) {
    const long = a % 10 === 0;
    const outer = armEnd(cx, cy, r, a);
    const inner = armEnd(cx, cy, r - (a % 30 === 0 ? 14 : long ? 9 : 5), a);
    ticks.push(<Line key={a} x1={outer.x} y1={outer.y} x2={inner.x} y2={inner.y} stroke={CHALK} strokeWidth={a % 30 === 0 ? 2 : 1} opacity={0.85} />);
    if (a % 30 === 0) {
      const at = armEnd(cx, cy, r - 26, a);
      ticks.push(<SvgText key={`n${a}`} x={at.x} y={at.y + 4} fill={CHALK} fontSize={11} fontWeight="700" textAnchor="middle">{a}</SvgText>);
    }
  }
  const arcR = Math.min(46, r * 0.35);
  const a1 = armEnd(cx, cy, arcR, deg);
  const wedge = deg > 0 ? `M${cx} ${cy} L${cx + arcR} ${cy} A${arcR} ${arcR} 0 0 0 ${a1.x} ${a1.y} Z` : '';

  return (
    <View style={st.world}>
      <Text style={st.task}>{p.prompt}</Text>
      {p.context ? <Text style={st.context}>{p.context}</Text> : null}
      <Animated.View style={{ transform: [{ translateX: shake }] }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={p.readout === false ? 'Thước đo góc. Đọc số đo trên vạch chia.' : `Thước đo góc. Góc đang tạo: ${deg} độ.`}>
        <Svg width={width} height={h}>
          <Path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z`} fill={CHALK} opacity={0.08} stroke={CHALK} strokeWidth={2} />
          <G>{ticks}</G>
          {wedge ? <Path d={wedge} fill={GOLD} opacity={0.35} /> : null}
          {wedge ? <AnimatedPath d={wedge} fill="#4CC36B" opacity={progress} /> : null}
          <Line x1={cx} y1={cy} x2={cx + r + 8} y2={cy} stroke={GOLD} strokeWidth={4} strokeLinecap="round" />
          <Line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke={GOLD} strokeWidth={4} strokeLinecap="round" />
          <Circle cx={cx} cy={cy} r={5} fill={GOLD} />
          <Circle cx={end.x} cy={end.y} r={13} fill={GOLD} stroke={CHALK} strokeWidth={3} />
        </Svg>
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
      </Animated.View>
      <View style={st.row}>
        <Stepper value={deg} onChange={setOwn} min={0} max={180} step={step} disabled={off} label="góc" unit="°" light />
        <Text style={st.readout}>{p.readout === false && !done ? 'Đọc số đo trên thước' : `Góc: ${deg}°`}</Text>
      </View>
      <Animated.View style={{ opacity: progress }}>
        <Text style={st.result}>{done ? `${angleKind(deg)[0].toUpperCase()}${angleKind(deg).slice(1)} · ${deg}°` : ' '}</Text>
      </Animated.View>
      <NoteLine note={demo?.solved || done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Đặt lại" onReset={() => setOwn(typeof p.initial === 'number' ? p.initial : 30)} resetDisabled={off}
          onCheck={() => onSubmit([`angle:${clampStep(deg, step, 0, 180)}`])} checkDisabled={off} />
      )}
    </View>
  );
}

function RectGrid({ turn, disabled, feedback, solved, onSubmit, reduceMotion, demo }: SceneProps & { demo?: { value: number | [number, number]; solved?: boolean } }) {
  const p = turn.prompt;
  const cols = p.cols ?? 10;
  const rows = p.rows ?? 8;
  const unit = p.measure_unit ?? 'cm';
  const start = Array.isArray(p.initial) ? p.initial : [1, 1];
  const [own, setOwn] = useState<[number, number]>([start[0], start[1]]);
  const [w, h] = Array.isArray(demo?.value) ? demo!.value as [number, number] : own;
  const done = !!solved || !!demo?.solved;
  const off = disabled || done || !!demo;
  const progress = useSolvedReaction(!demo && solved, 'geometry:rect', Math.min(2200, 500 + 70 * w * h), reduceMotion);
  useEffect(() => { if (demo?.solved) progress.setValue(1); }, [demo?.solved, progress]);
  const shake = useWrongShake(feedback, 'geometry:wrong', reduceMotion);
  const [width, setWidth] = useState(320);
  const pad = 26;
  const cell = Math.max(14, Math.floor((width - pad - 10) / cols));
  const gridH = cell * rows + pad + 8;
  const live = useRef({ off, cell, cols, rows });
  live.current = { off, cell, cols, rows };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.off,
    onMoveShouldSetPanResponder: () => !live.current.off,
    onPanResponderGrant: (e) => setOwn(rectAt(e.nativeEvent.locationX - pad, e.nativeEvent.locationY - pad, live.current.cell, live.current.cols, live.current.rows)),
    onPanResponderMove: (e) => setOwn(rectAt(e.nativeEvent.locationX - pad, e.nativeEvent.locationY - pad, live.current.cell, live.current.cols, live.current.rows)),
  }), []);
  const area = w * h;
  const lines = [];
  for (let c = 0; c <= cols; c++) lines.push(<Line key={`c${c}`} x1={pad + c * cell} y1={pad} x2={pad + c * cell} y2={pad + rows * cell} stroke={CHALK} strokeWidth={1} opacity={0.25} />);
  for (let r = 0; r <= rows; r++) lines.push(<Line key={`r${r}`} x1={pad} y1={pad + r * cell} x2={pad + cols * cell} y2={pad + r * cell} stroke={CHALK} strokeWidth={1} opacity={0.25} />);

  return (
    <View style={st.world}>
      <Text style={st.task}>{p.prompt}</Text>
      <Animated.View style={{ transform: [{ translateX: shake }] }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Lưới ô vuông, mỗi ô 1 ${unit}. Hình đang vẽ: ngang ${w} ${unit}, dọc ${h} ${unit}.`}>
        <Svg width={width} height={gridH}>
          <G>{lines}</G>
          <Rect x={pad} y={pad} width={w * cell} height={h * cell} fill={GOLD} opacity={0.25} stroke={GOLD} strokeWidth={3} />
          <SvgText x={pad + (w * cell) / 2} y={pad - 8} fill={CHALK} fontSize={12} fontWeight="700" textAnchor="middle">{`${w} ${unit}`}</SvgText>
          <SvgText x={pad - 6} y={pad + (h * cell) / 2 + 4} fill={CHALK} fontSize={12} fontWeight="700" textAnchor="end">{`${h}`}</SvgText>
          <Circle cx={pad + w * cell} cy={pad + h * cell} r={11} fill={GOLD} stroke={CHALK} strokeWidth={3} />
        </Svg>
        {/* Right: the unit squares fill one after the other. */}
        {done ? Array.from({ length: area }, (_, i) => (
          <Animated.View key={i} pointerEvents="none" style={[st.unit, {
            left: pad + (i % w) * cell + 2, top: pad + Math.floor(i / w) * cell + 2, width: cell - 4, height: cell - 4,
            opacity: progress.interpolate({ inputRange: [i / area, (i + 1) / area], outputRange: [0, 1], extrapolate: 'clamp' }) }]} />
        )) : null}
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
      </Animated.View>
      <View style={st.row}>
        <Stepper value={w} onChange={(v) => setOwn([v, h])} min={1} max={cols} disabled={off} label="cạnh ngang" unit={` ${unit}`} light />
        <Stepper value={h} onChange={(v) => setOwn([w, v])} min={1} max={rows} disabled={off} label="cạnh dọc" unit={` ${unit}`} light />
      </View>
      <Animated.View style={{ opacity: progress }}>
        <Text style={st.result}>{done ? `Diện tích ${area} ${unit}² · Chu vi ${2 * (w + h)} ${unit}` : ' '}</Text>
      </Animated.View>
      <NoteLine note={demo?.solved || done ? null : feedback} />
      {done ? null : (
        <Actions resetLabel="Đặt lại" onReset={() => setOwn([start[0], start[1]])} resetDisabled={off}
          onCheck={() => onSubmit([`rect:${w}x${h}`])} checkDisabled={off} />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  world: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: BLUEPRINT, borderWidth: 2, borderColor: '#16406F' },
  task: { fontSize: 16, fontWeight: '900', color: CHALK, textAlign: 'center' },
  context: { fontSize: 13, fontWeight: '700', color: '#CFE3FF', textAlign: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-around', gap: 10 },
  readout: { fontSize: 15, fontWeight: '900', color: GOLD },
  result: { fontSize: 16, fontWeight: '900', color: '#A6F0B8', textAlign: 'center' },
  unit: { position: 'absolute', borderRadius: 3, backgroundColor: '#4CC36B' },
});
