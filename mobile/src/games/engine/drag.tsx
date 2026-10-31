import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleProp, View, ViewStyle } from 'react-native';

// The interaction manager of the scene games (Magic Lab, Word Forest): drop zones measured on screen, and objects that
// can be dragged onto them or tapped. A drop lands on the zone under the finger; anywhere else the object springs back
// to where it was. Everything moves by transform (no re-render while dragging).

export type Rect = { x: number; y: number; width: number; height: number };
type Zones = { set: (id: string, view: View | null) => void; measure: () => void; at: (point: { x: number; y: number }) => string | null;
  hover: (id: string | null) => void; over: string | null };

/** The zone under a point (both in window coordinates), if any; the smallest one when zones overlap. */
export function zoneAt(point: { x: number; y: number }, rects: Record<string, Rect>): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const [id, r] of Object.entries(rects)) {
    if (point.x < r.x || point.x > r.x + r.width || point.y < r.y || point.y > r.y + r.height) continue;
    if (r.width * r.height < area) { best = id; area = r.width * r.height; }
  }
  return best;
}

const Ctx = createContext<Zones | null>(null);

/** Holds the drop zones of one scene. */
export function DropArea({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const views = useRef(new Map<string, View>());
  const rects = useRef<Record<string, Rect>>({});
  const [over, setOver] = useState<string | null>(null);
  const zones = useMemo<Omit<Zones, 'over'>>(() => ({
    set: (id, view) => { if (view) views.current.set(id, view); else { views.current.delete(id); delete rects.current[id]; } },
    measure: () => {
      for (const [id, view] of views.current) {
        view.measureInWindow?.((x, y, width, height) => { rects.current[id] = { x, y, width, height }; });
      }
    },
    at: (point) => zoneAt(point, rects.current),
    hover: (id) => setOver((now) => (now === id ? now : id)),
  }), []);
  const value = useMemo(() => ({ ...zones, over }), [zones, over]);
  return <Ctx.Provider value={value}><View style={style}>{children}</View></Ctx.Provider>;
}

/** A place something can be dropped on. `over`: an object is being dragged over it. */
export function DropZone({ id, style, children, accessibilityLabel }: {
  id: string; style?: StyleProp<ViewStyle> | ((over: boolean) => StyleProp<ViewStyle>); children?: React.ReactNode; accessibilityLabel?: string;
}) {
  const zones = useContext(Ctx);
  const ref = useCallback((view: View | null) => zones?.set(id, view), [zones, id]);
  const over = zones?.over === id;
  return (
    <View ref={ref} collapsable={false} accessibilityLabel={accessibilityLabel} style={typeof style === 'function' ? style(over) : style}>
      {children}
    </View>
  );
}

/** Something to drag onto a DropZone (or tap). `onDrop` says if the drop is taken; if not, it springs back. */
export function Draggable({ children, disabled, onDrop, style, lift = 1.12 }: {
  children: React.ReactNode; disabled?: boolean; onDrop: (zone: string) => boolean | void; style?: StyleProp<ViewStyle>; lift?: number;
}) {
  const zones = useContext(Ctx);
  const drag = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const live = useRef({ disabled, onDrop, zones });
  live.current = { disabled, onDrop, zones };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => !live.current.disabled && Math.abs(g.dx) + Math.abs(g.dy) > 6,
    onPanResponderGrant: () => {
      live.current.zones?.measure();
      Animated.spring(scale, { toValue: lift, friction: 6, useNativeDriver: false }).start();
    },
    onPanResponderMove: (_, g) => {
      drag.setValue({ x: g.dx, y: g.dy });
      live.current.zones?.hover(live.current.zones.at({ x: g.moveX, y: g.moveY }));
    },
    onPanResponderRelease: (_, g) => {
      const z = live.current.zones;
      const zone = z?.at({ x: g.moveX, y: g.moveY }) ?? null;
      z?.hover(null);
      Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: false }).start();
      if (zone && live.current.onDrop(zone) !== false) { drag.setValue({ x: 0, y: 0 }); return; }
      Animated.spring(drag, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => { live.current.zones?.hover(null); drag.setValue({ x: 0, y: 0 }); scale.setValue(1); },
  }), [drag, scale, lift]);
  return (
    <Animated.View {...responder.panHandlers} style={[style, { zIndex: 1, transform: [...drag.getTranslateTransform(), { scale }] }]}>
      {children}
    </Animated.View>
  );
}
