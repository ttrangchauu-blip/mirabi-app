import { useEffect, useMemo, useRef, useState } from 'react';
import { lightAt, type Light, mixColor, sunAt, useDaylight } from '../components/daylight';
import { useReduceMotion } from '../components/useReduceMotion';
import type { WeatherReading } from './weather';

/**
 * What the sky is doing, as numbers a scene can draw: `moodOf` turns a weather reading into cloud, rain, fog, wind and
 * gloom; with no reading the mood is a calm default, the time of day alone, and nothing pretends it is real weather.
 * `shade` then colours the hour's light with it. Everything blends, so morning into noon or dry into rain never swaps
 * a background at once.
 */
export type Mood = {
  /** 0–1: how far the light is taken by cloud. */ gloom: number;
  /** 0–1: how much of the sky is cloud. */ cover: number;
  /** 0 dry, 1 rain, 2 a storm's heavier rain (a number so it can fade). */ rain: number;
  /** 0–1. */ snow: number;
  /** 0–1. */ fog: number;
  /** How strongly leaves and grass move: 0.4 a still day, 1 a breeze, up to 1.6 hard wind. */ wind: number;
};

export const CALM: Mood = { gloom: 0, cover: 0.25, rain: 0, snow: 0, fog: 0, wind: 0.5 };

export function moodOf(reading: WeatherReading | null): Mood {
  if (!reading) return CALM;
  const wind = Math.min(1.6, 0.4 + (reading.wind_kmh ?? 0) / 30);
  switch (reading.condition) {
    case 'clear': return { ...CALM, cover: Math.min(0.3, reading.cloud_cover / 100), wind };
    case 'cloudy': return { ...CALM, gloom: 0.35, cover: Math.max(0.6, reading.cloud_cover / 100), wind };
    case 'fog': return { ...CALM, gloom: 0.45, cover: 0.8, fog: 1, wind: Math.min(wind, 0.6) };
    case 'rain': return { ...CALM, gloom: 0.65, cover: 1, rain: 1, wind: Math.max(wind, 0.8) };
    case 'storm': return { ...CALM, gloom: 0.9, cover: 1, rain: 2, wind: Math.max(wind, 1.3) };
    case 'snow': return { ...CALM, gloom: 0.4, cover: 0.9, snow: 1, wind };
    default: return CALM;
  }
}

const overcastSky = ['#7F92A6', '#9DADBC', '#BDC8D1'] as const;
const nightOvercast = ['#141C33', '#1F2A45', '#2E3A55'] as const;

/** The hour's light under this mood. Rounded by daylight's own colours, so it rarely changes between two ticks. */
export function shade(light: Light, mood: Mood): Light {
  const g = mood.gloom;
  const clearOfCloud = 1 - mood.cover * 0.85;
  if (g === 0 && mood.cover <= CALM.cover && !mood.fog) return light;
  const night = light.stars > 0.3;
  const toward = night ? nightOvercast : overcastSky;
  const greyed = (color: string) => mixColor(color, night ? '#2A3350' : '#8E9CA3', g * 0.45);
  return {
    ...light,
    sky: light.sky.map((color, i) => mixColor(color, toward[i], g)) as Light['sky'],
    horizon: greyed(light.horizon),
    sun: mixColor(light.sun, '#E6ECEF', g),
    sunGlow: mixColor(light.sunGlow, '#D5DEE3', g),
    cloud: mixColor(light.cloud, night ? '#3D4865' : '#B6C2CB', g),
    cloudOpacity: Math.min(1, light.cloudOpacity + mood.cover * 0.2),
    stars: Math.round(light.stars * clearOfCloud * 100) / 100,
    moonOpacity: Math.round(light.moonOpacity * (1 - g * 0.8) * 100) / 100,
    fireflies: mood.rain > 0 || mood.snow > 0 ? 0 : Math.round(light.fireflies * (1 - g) * 100) / 100,
    shadow: Math.round(light.shadow * (1 - g * 0.75) * 100) / 100,
    hills: light.hills.map(greyed) as Light['hills'],
    meadow: greyed(light.meadow),
    trees: light.trees.map(greyed) as Light['trees'],
    path: light.path.map(greyed) as Light['path'],
    front: greyed(light.front),
    pebble: greyed(light.pebble),
    flowers: light.flowers.map((c) => mixColor(c, '#9AA4AC', g * 0.3)) as Light['flowers'],
  };
}

/** The room in the light of the hour and the sky: a colour over the room, under the pet, so the pet keeps its colours.
 * Warm at both ends of the day, none at noon, a deep blue at night (the lamps stand out), greyer under cloud. */
export function roomLight(hours: number, mood: Mood): { color: string; opacity: number } {
  const sun = sunAt(hours);
  const up = Math.max(0, Math.min(1, (sun.altitude + 0.25) / 0.5)); // 0 in the dark, 1 once well up
  const low = Math.max(0, 1 - Math.abs(sun.altitude - 0.12) / 0.3); // the low sun of morning and evening
  const dark = 1 - up;
  const warm = low * (1 - mood.gloom);
  const base = mixColor(mixColor('#FFC98E', '#1B2A5C', dark), '#5C6E86', Math.min(1, mood.gloom * (1 - dark * 0.7)));
  const opacity = dark * 0.3 + warm * 0.14 + mood.gloom * up * 0.16;
  return { color: base, opacity: Math.round(opacity * 50) / 50 };
}

const sameMood = (a: Mood, b: Mood) => a.gloom === b.gloom && a.cover === b.cover && a.rain === b.rain && a.snow === b.snow && a.fog === b.fog && a.wind === b.wind;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const blendMood = (a: Mood, b: Mood, t: number): Mood => ({ gloom: lerp(a.gloom, b.gloom, t), cover: lerp(a.cover, b.cover, t), rain: lerp(a.rain, b.rain, t),
  snow: lerp(a.snow, b.snow, t), fog: lerp(a.fog, b.fog, t), wind: lerp(a.wind, b.wind, t) });

const BLEND_MS = 6000;
const STEP_MS = 250;

/** The mood on screen: on a new reading it goes over in a few seconds, never in one frame. */
export function useBlendedMood(target: Mood): Mood {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (sameMood(current.current, target)) return;
    if (reduce) { current.current = target; setShown(target); return; }
    const from = current.current;
    const started = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / BLEND_MS);
      const next = t >= 1 ? target : blendMood(from, target, t * t * (3 - 2 * t));
      current.current = next;
      setShown(next);
      if (t >= 1) clearInterval(timer);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [target, reduce]);
  return shown;
}

/** A scene's sky: the hour (from the shared clock), the mood and the light they make together. */
export function useAtmosphere(reading: WeatherReading | null, now?: () => Date) {
  const reduce = useReduceMotion();
  const { hours, period } = useDaylight({ now, smooth: !reduce });
  const targetMood = useMemo(() => moodOf(reading), [reading]);
  const mood = useBlendedMood(targetMood);
  const light = useSameValue(useMemo(() => shade(lightAt(hours), mood), [hours, mood]));
  return { hours, period, mood, light, night: light.stars > 0.3 };
}

/** The previous object while the new one has the same values, so what depends on it doesn't redraw. */
export function useSameValue<T>(value: T): T {
  const ref = useRef(value);
  if (JSON.stringify(ref.current) !== JSON.stringify(value)) ref.current = value;
  return ref.current;
}
