import Constants from 'expo-constants';

// A dedicated local port avoids stale Windows reload workers left on 8001.
const DEV_API_PORT = 8011;

/** Host of the computer running Metro (e.g. "192.168.1.20"), which in development also runs the API. */
function devMachineHost(): string | undefined {
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost;
  return typeof hostUri === 'string' ? hostUri.split(':')[0] || undefined : undefined;
}

// Only EXPO_PUBLIC_* values reach the app bundle, and everything in the bundle is public.
// Never put backend secrets, database credentials, or AI provider keys here.
export function resolveApiUrl(
  raw: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  isDev: boolean = __DEV__,
  devHost: string | undefined = devMachineHost(),
): string {
  // Without an explicit URL, development builds talk to the API on the same machine as Metro, so a phone,
  // emulator or browser all work without editing .env.
  const fallback = `http://${isDev && devHost ? devHost : 'localhost'}:${DEV_API_PORT}`;
  const url = (raw?.trim() || fallback).replace(/\/+$/, '');
  if (!isDev && !url.startsWith('https://')) {
    // Fail closed: release builds must never send credentials over plain HTTP.
    throw new Error('EXPO_PUBLIC_API_URL must use https:// in production builds');
  }
  return url;
}
