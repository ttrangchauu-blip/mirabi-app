import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { IconName } from '../ui/kit';
import { request } from '../screens/main/shared';

/**
 * The real weather where the user is, for the living world. There is no switch and no way to choose a weather: it comes
 * from the device's rough location, if the user allows it, through the backend (world.py), which reads it once per map
 * cell. The location is rounded to about 11 km on the device, before it goes anywhere.
 *
 * Without permission, a connection or a recent reading there is simply no reading: the scenes go by the clock and
 * nothing says it is sunny. A reading kept on the device is used only until its `stale` limit.
 */
export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';
export type WeatherReading = {
  condition: WeatherCondition; temperature_c: number; wind_kmh: number; windy: boolean; cloud_cover: number; is_day: boolean;
  fetched_at: string; expires_at: string; stale: boolean; source: string;
};
export type WeatherStatus = 'waiting' | 'live' | 'stale' | 'unavailable' | 'no_permission';

type Place = { lat: number; lon: number };
const PLACE_KEY = 'mirabi.world.place.v1';
const READING_KEY = 'mirabi.world.weather.v1';
/** What the app may still show from its own copy when it can't reach the backend (the backend's rule for a stale reading). */
const KEEP_HOURS = 6;
const REFRESH_MS = 30 * 60_000;
/** A phone that can't find itself this quickly just goes by the clock for now. */
const LOCATE_MS = 8000;

/** One decimal: about 11 km. Nothing more exact ever leaves this file. */
export const roughPlace = (lat: number, lon: number): Place => ({ lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 });

const validReading = (value: any): value is WeatherReading & { available: true } =>
  !!value && value.available === true && typeof value.condition === 'string' && typeof value.temperature_c === 'number'
  && typeof value.fetched_at === 'string' && typeof value.expires_at === 'string';

/** The device's rough location: asks once when it can (the system remembers the answer), never again after a "no". */
async function findPlace(): Promise<Place | null> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  const position = await Location.getLastKnownPositionAsync({ maxAge: 3 * 3_600_000 })
    ?? await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), LOCATE_MS); })]);
  return position ? roughPlace(position.coords.latitude, position.coords.longitude) : null;
}

const readJson = async <T,>(key: string): Promise<T | null> => {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
};

/** Whether a kept reading may still be shown. */
export function usableReading(kept: WeatherReading | null, now = Date.now()): WeatherReading | null {
  if (!kept || !validReading({ ...kept, available: true })) return null;
  const age = now - Date.parse(kept.fetched_at);
  if (!(age >= 0) || age > KEEP_HOURS * 3_600_000) return null;
  return { ...kept, stale: kept.stale || now > Date.parse(kept.expires_at) };
}

type World = { reading: WeatherReading | null; status: WeatherStatus };
const WeatherContext = createContext<World>({ reading: null, status: 'unavailable' });
export const useWeather = () => useContext(WeatherContext);

/** Starts when `enabled` first turns on (the first visit to the living world, not at login, so permission is asked
 * where it makes sense). Refreshes on return to the app and every half hour. Answers arriving late are dropped. */
export function WeatherProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [world, setWorld] = useState<World>({ reading: null, status: 'waiting' });
  // Once started it stays on: the world keeps its weather while another tab is open.
  const [started, setStarted] = useState(enabled);
  if (enabled && !started) setStarted(true);
  const latest = useRef(0);
  useEffect(() => {
    if (!started) return;
    let active = true;
    const refresh = async () => {
      const run = ++latest.current;
      const current = () => active && run === latest.current;
      const kept = usableReading(await readJson<WeatherReading>(READING_KEY));
      if (!current()) return;
      if (kept) setWorld((w) => (w.reading ? w : { reading: kept, status: kept.stale ? 'stale' : 'live' }));
      if (kept && !kept.stale) return; // still good: not read again
      let place: Place | null = null;
      try { place = await findPlace(); if (place) void AsyncStorage.setItem(PLACE_KEY, JSON.stringify(place)).catch(() => {}); } catch { place = await readJson<Place>(PLACE_KEY); }
      if (!current()) return;
      if (!place) { setWorld(kept ? { reading: kept, status: 'stale' } : { reading: null, status: 'no_permission' }); return; }
      try {
        const answer = await request(`/api/world/weather?lat=${place.lat}&lon=${place.lon}`);
        if (!current()) return;
        if (validReading(answer)) {
          void AsyncStorage.setItem(READING_KEY, JSON.stringify(answer)).catch(() => {});
          setWorld({ reading: answer, status: answer.stale ? 'stale' : 'live' });
        } else setWorld({ reading: null, status: 'unavailable' });
      } catch {
        if (current()) setWorld(kept ? { reading: kept, status: 'stale' } : { reading: null, status: 'unavailable' });
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { active = false; clearInterval(timer); sub.remove(); };
  }, [started]);
  return <WeatherContext.Provider value={world}>{children}</WeatherContext.Provider>;
}

const NAMES: Record<WeatherCondition, string> = { clear: 'Trời quang', cloudy: 'Nhiều mây', rain: 'Trời mưa', storm: 'Có giông', fog: 'Có sương mù', snow: 'Có tuyết' };

/** What a reading says, in the app's words; `night` from the scene's clock. */
export function describeWeather(reading: WeatherReading, night: boolean): { icon: IconName; text: string; label: string } {
  const icon: IconName = reading.condition === 'clear' ? (night ? 'moon' : 'sunny')
    : reading.condition === 'cloudy' ? (night ? 'cloudy-night' : 'partly-sunny')
    : reading.condition === 'rain' ? 'rainy' : reading.condition === 'storm' ? 'thunderstorm' : reading.condition === 'snow' ? 'snow' : 'cloud';
  const name = NAMES[reading.condition];
  const wind = reading.windy ? ', có gió' : '';
  const when = reading.stale ? `, cập nhật lúc ${new Date(reading.fetched_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : '';
  return { icon, text: `${reading.temperature_c}°`, label: `${name}${wind}, ${reading.temperature_c} độ${when}` };
}

/** A line for "Cá nhân hóa": what the world goes by, and where the weather comes from. */
export function weatherNote({ status, reading }: World): string {
  if (reading) return `Theo thời tiết thực ở khu vực của bạn${reading.stale ? ' (lần cập nhật gần nhất)' : ''}. Nguồn: ${reading.source}.`;
  if (status === 'no_permission') return 'Chưa có quyền vị trí: thế giới đổi theo giờ trong ngày, không hiển thị thời tiết.';
  if (status === 'waiting') return 'Thế giới đổi theo giờ trong ngày và thời tiết ở khu vực của bạn.';
  return 'Chưa có dữ liệu thời tiết: thế giới đổi theo giờ trong ngày.';
}
