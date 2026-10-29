import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DayPeriod, periodAtHour } from './useDayPeriod';

/** One day–night clock for a whole scene: the sun, moon, sky colours, stars and light are all read from the same
 * local hour (a fraction, 0 ≤ h < 24), so they can never drift apart. */

/** Illustrative sun times, in local hours. Any values with sunrise < noon < sunset work. */
export type SunTimes = { sunrise: number; noon: number; sunset: number };
export const SUN_TIMES: SunTimes = { sunrise: 5, noon: 12, sunset: 18 };

/** The local time of day in hours, to the millisecond, by the device's calendar (so time zone and DST changes count). */
export function hoursOf(date: Date) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600 + date.getMilliseconds() / 3_600_000;
}

const wrap = (h: number) => ((h % 24) + 24) % 24;
/** The shortest signed way round the clock from `a` to `b` (forward on a tie): 23:59 → 00:01 is +2 minutes, not −23:58. */
export function hoursBetween(a: number, b: number) {
  const ahead = wrap(b - a);
  return ahead > 12 ? ahead - 24 : ahead;
}

/** Past the horizon the arc carries on this far (radians), enough to sink the body out of sight, then stops. */
const BELOW = 0.5;

/** Where a body is on its arc: `x` runs 0 (left horizon) → 0.5 (top) → 1 (right horizon), and a little past both ends;
 * `altitude` is 1 at the top, 0 on the horizon and negative below it. */
export type ArcPoint = { x: number; altitude: number };

function arc(angle: number, peak = 1): ArcPoint {
  const a = Math.max(-BELOW, Math.min(Math.PI + BELOW, angle));
  return { x: a / Math.PI, altitude: Math.sin(a) * peak };
}

/** The sun rises on the left at sunrise, is highest at noon and sets on the right at sunset. The angle moves at an even
 * rate through each half of the day, so its position changes continuously with the clock. */
export function sunAt(hours: number, times: SunTimes = SUN_TIMES): ArcPoint {
  const { sunrise, noon, sunset } = times;
  // Before dawn it is just under the left horizon (it rises from there); after dusk, under the right one.
  const h = hours > sunset + (24 - sunset + sunrise) / 2 ? hours - 24 : hours;
  const angle = h < noon
    ? ((h - sunrise) / (noon - sunrise)) * (Math.PI / 2)
    : Math.PI / 2 + ((h - noon) / (sunset - noon)) * (Math.PI / 2);
  return arc(angle);
}

/** The moon crosses the night sky on a lower arc: up on the left at sunset, down on the right by sunrise. */
export function moonAt(hours: number, times: SunTimes = SUN_TIMES): ArcPoint {
  const night = 24 - times.sunset + times.sunrise;
  let since = wrap(hours - times.sunset);
  if (since > night + (24 - night) / 2) since -= 24; // in the day: closer to the coming moonrise than the last moonset
  return arc((since / night) * Math.PI, 0.75);
}

/** The scene's colours at one moment. Opacities are 0–1; `shadow` is how dark cast shadows are. */
export type Light = {
  sky: [string, string, string]; horizon: string; sun: string; sunGlow: string; moon: string;
  cloud: string; cloudOpacity: number; stars: number; moonOpacity: number; fireflies: number; petLight: number; shadow: number;
  hills: [string, string]; meadow: string; trees: [string, string, string, string]; path: [string, string]; front: string;
  pebble: string; flowers: [string, string, string];
};

const NIGHT: Light = { sky: ['#17264D', '#283C6E', '#405784'], horizon: '#5B6FA3', sun: '#FFB46B', sunGlow: '#FFB46B', moon: '#FFF3C9',
  cloud: '#8E9CC4', cloudOpacity: 0.35, stars: 1, moonOpacity: 1, fireflies: 1, petLight: 0.45, shadow: 0.08,
  hills: ['#2F4A70', '#36567C'], meadow: '#3A6274', trees: ['#4E4352', '#2F5C63', '#386A6E', '#29525A'], path: ['#9C97AE', '#B7B2C6'],
  front: '#33586A', pebble: '#7E7A92', flowers: ['#C9A2C8', '#E8D9A0', '#D8DDF0'] };
// Trước bình minh: blue-violet, the stars going.
const PREDAWN: Light = { sky: ['#2A2F66', '#4E4785', '#8D72A6'], horizon: '#C489A8', sun: '#FFB27A', sunGlow: '#FF9E80', moon: '#FFF3C9',
  cloud: '#A79AC4', cloudOpacity: 0.45, stars: 0.55, moonOpacity: 0.7, fireflies: 0.4, petLight: 0.3, shadow: 0.08,
  hills: ['#4A4F7E', '#535C88'], meadow: '#516D80', trees: ['#5A4A5C', '#456A70', '#4E7578', '#3E6066'], path: ['#B3A7BC', '#C7BCCD'],
  front: '#4C6878', pebble: '#958AA2', flowers: ['#D3A6C6', '#EBD3A4', '#E0DDF0'] };
// Sáng sớm: pink and orange as the sun clears the hills.
const DAWN: Light = { sky: ['#8FA9DA', '#F2B5B8', '#FFD1A1'], horizon: '#FFB089', sun: '#FFC27E', sunGlow: '#FFB38A', moon: '#FFF6DE',
  cloud: '#FFD9CF', cloudOpacity: 0.8, stars: 0.08, moonOpacity: 0.2, fireflies: 0, petLight: 0, shadow: 0.12,
  hills: ['#C9C6CF', '#B9C3C2'], meadow: '#A2BFA6', trees: ['#8F6F5C', '#78A889', '#86B492', '#6C9E7E'], path: ['#EAD2BC', '#F3E1CF'],
  front: '#93BB9C', pebble: '#CDB49E', flowers: ['#F2A2B0', '#F7CF7A', '#FFF1EA'] };
const MORNING: Light = { sky: ['#CDE8F6', '#E6F4F3', '#F8F3E4'], horizon: '#FFE7B8', sun: '#FFE7A3', sunGlow: '#FFE7A3', moon: '#FFFFFF',
  cloud: '#FFFFFF', cloudOpacity: 0.9, stars: 0, moonOpacity: 0, fireflies: 0, petLight: 0, shadow: 0.16,
  hills: ['#D3E9D6', '#C2E0C6'], meadow: '#A9D4AF', trees: ['#9A7A5C', '#7DB988', '#8CC596', '#73AF7F'], path: ['#EBDDBF', '#F4EAD3'],
  front: '#9ECDA5', pebble: '#D3C29F', flowers: ['#F2A7B6', '#F7D774', '#FFFFFF'] };
const NOON: Light = { sky: ['#8DCDF1', '#BDE4F7', '#EAF7FB'], horizon: '#F4FBFD', sun: '#FFF2B0', sunGlow: '#FFF6C4', moon: '#FFFFFF',
  cloud: '#FFFFFF', cloudOpacity: 1, stars: 0, moonOpacity: 0, fireflies: 0, petLight: 0, shadow: 0.2,
  hills: ['#C4E5C3', '#ACD9AF'], meadow: '#94CC9C', trees: ['#8F6F51', '#6DB17A', '#7FC08A', '#62A570'], path: ['#EEDFC0', '#F8F0DC'],
  front: '#8BC594', pebble: '#D6C49E', flowers: ['#F59AAE', '#FFD95E', '#FFFFFF'] };
// Chiều: the light turns golden.
const GOLDEN: Light = { sky: ['#A9CDE6', '#DCE4D6', '#F9DFB0'], horizon: '#FFD79A', sun: '#FFD27A', sunGlow: '#FFD08A', moon: '#FFFFFF',
  cloud: '#FFF1DE', cloudOpacity: 0.9, stars: 0, moonOpacity: 0, fireflies: 0, petLight: 0, shadow: 0.18,
  hills: ['#D2DDB4', '#C1D4A6'], meadow: '#A9C894', trees: ['#8E6A4B', '#86B272', '#97BE80', '#78A766'], path: ['#EDD8B2', '#F7E7C8'],
  front: '#9CC48A', pebble: '#D0B78F', flowers: ['#F4A09A', '#FBCF5E', '#FFF6E6'] };
// Hoàng hôn: yellow-orange, the sun low and warm.
const SUNSET: Light = { sky: ['#E9A07E', '#F6BE8C', '#FFDCA6'], horizon: '#FF9F66', sun: '#FFB35C', sunGlow: '#FFA060', moon: '#FFF6DE',
  cloud: '#FFD9BF', cloudOpacity: 0.85, stars: 0, moonOpacity: 0, fireflies: 0, petLight: 0, shadow: 0.13,
  hills: ['#DCC9A0', '#C9C08E'], meadow: '#B5B983', trees: ['#8A5E40', '#93A566', '#A3B370', '#85995C'], path: ['#ECC9A0', '#F5DBB6'],
  front: '#A4B378', pebble: '#C9A47E', flowers: ['#F29483', '#F9C055', '#FFEBD3'] };
// Chạng vạng: the last glow on the horizon under a deepening blue, the first stars.
const DUSK: Light = { sky: ['#28366B', '#5E5390', '#D98F86'], horizon: '#E88C77', sun: '#FFB35C', sunGlow: '#FF9070', moon: '#FFF3C9',
  cloud: '#B79AB5', cloudOpacity: 0.55, stars: 0.45, moonOpacity: 0.6, fireflies: 0.5, petLight: 0.3, shadow: 0.08,
  hills: ['#5A5880', '#61668A'], meadow: '#526A7C', trees: ['#5B4855', '#46646A', '#4F6F72', '#3D5A62'], path: ['#B2A2B4', '#C6B8C6'],
  front: '#4B6476', pebble: '#90829A', flowers: ['#D29DBE', '#EAC99C', '#DCD6EC'] };

/** When each look is reached, relative to the sun times; colours blend in a straight line between neighbours. */
function keyframes({ sunrise, noon, sunset }: SunTimes): [number, Light][] {
  const marks: [number, Light][] = [
    [sunrise - 1.5, NIGHT], [sunrise - 0.75, PREDAWN], [sunrise + 0.25, DAWN], [sunrise + 2, MORNING],
    [noon - 1, NOON], [noon + 1.5, NOON], [sunset - 1.5, GOLDEN], [sunset - 0.25, SUNSET], [sunset + 0.75, DUSK], [sunset + 1.75, NIGHT],
  ];
  return marks.map(([h, light]): [number, Light] => [wrap(h), light]).sort((a, b) => a[0] - b[0]);
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mixColor(a: string, b: string, t: number) {
  const [p, q] = [hex(a), hex(b)];
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function mix<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number') return (Math.round((a + ((b as number) - a) * t) * 100) / 100) as T;
  if (typeof a === 'string') return mixColor(a, b as string, t) as T;
  if (Array.isArray(a)) return a.map((v, i) => mix(v, (b as unknown[])[i], t)) as T;
  const out = {} as T;
  for (const key in a) out[key] = mix(a[key], (b as T)[key], t);
  return out;
}

/** The scene's colours at a local hour, blended from the two nearest keyframes (wrapping past midnight). Rounded, so
 * a few seconds apart usually give the very same values and nothing needs redrawing. */
export function lightAt(hours: number, times: SunTimes = SUN_TIMES): Light {
  const marks = keyframes(times);
  const h = wrap(hours);
  let i = marks.length - 1;
  while (i >= 0 && marks[i][0] > h) i--;
  const [from, a] = i >= 0 ? marks[i] : [marks[marks.length - 1][0] - 24, marks[marks.length - 1][1]];
  const [nextAt, b] = marks[i + 1] ?? [marks[0][0] + 24, marks[0][1]];
  const span = nextAt - from;
  return mix(a, b, span > 0 ? (h - from) / span : 0);
}

/** How often the real clock is read. The sun crosses the scene in about 13 hours, well under a pixel per tick. */
const TICK_MS = 2000;
/** Frame interval while gliding to a new time, or in the fast preview. */
const FRAME_MS = 33;
/** A clock jump bigger than this (back to the app, a time zone or clock change) glides instead of snapping. */
const JUMP_HOURS = 2 / 60;
const GLIDE_MS = 1500;

/** For development only: EXPO_PUBLIC_DAYLIGHT_PREVIEW_SECONDS=60 plays a whole day in 60 seconds, from the current
 * time. It is ignored in release builds, and there is no control for it in the app. */
const PREVIEW_DAY_MS = __DEV__ ? (Number(process.env.EXPO_PUBLIC_DAYLIGHT_PREVIEW_SECONDS) || 0) * 1000 : 0;

export type Daylight = { hours: number; period: DayPeriod };

/** The time of day a scene should show, updated in real time (never by frame count or by how long the screen has been
 * open), from the right moment on the first render. Pauses while the app is in the background; on return, or after
 * a clock or time zone change, it glides to the new time (`smooth`) instead of jumping. */
export function useDaylight({ now = () => new Date(), smooth = true, previewDayMs = PREVIEW_DAY_MS }:
  { now?: () => Date; smooth?: boolean; previewDayMs?: number } = {}): Daylight {
  const clock = useRef(now);
  clock.current = now;
  const [state, setState] = useState<Daylight>(() => {
    const date = now();
    return { hours: hoursOf(date), period: periodAtHour(date.getHours()) };
  });
  const shown = useRef(state.hours);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let glide: { from: number; start: number } | null = null;
    const started = Date.now();
    const startHours = hoursOf(clock.current());
    const goal = () => previewDayMs ? wrap(startHours + ((Date.now() - started) / previewDayMs) * 24) : hoursOf(clock.current());
    const tick = () => {
      const target = goal();
      const at = Date.now();
      if (!glide && smooth && !previewDayMs && Math.abs(hoursBetween(shown.current, target)) > JUMP_HOURS) glide = { from: shown.current, start: at };
      let hours = target;
      if (glide) {
        const p = Math.min(1, (at - glide.start) / GLIDE_MS);
        const eased = p < 0.5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
        hours = wrap(glide.from + hoursBetween(glide.from, target) * eased);
        if (p >= 1) glide = null;
      }
      shown.current = hours;
      const period = periodAtHour(Math.floor(target));
      setState((s) => s.hours === hours && s.period === period ? s : { hours, period });
      timer = setTimeout(tick, glide || previewDayMs ? FRAME_MS : TICK_MS);
    };
    const pause = () => { if (timer) clearTimeout(timer); timer = undefined; };
    timer = setTimeout(tick, previewDayMs ? FRAME_MS : TICK_MS);
    const sub = AppState.addEventListener('change', (appState) => {
      pause();
      if (appState === 'active') tick();
    });
    return () => { pause(); sub.remove(); };
  }, [smooth, previewDayMs]);
  return state;
}
