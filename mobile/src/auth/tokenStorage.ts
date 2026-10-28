import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '../api/client';

const KEY = 'refmi.session.v1';
const LEGACY_ASYNC_STORAGE_KEY = 'refmi_token';
// Keychain/Keystore-backed; not synced to iCloud and unavailable before first unlock.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// SecureStore has no web implementation. sessionStorage survives page refreshes
// without keeping the session after the browser tab is closed.
const useMemory = Platform.OS === 'web';
let memory: string | null = null;

function webSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function readWebSession(): string | null {
  try { return webSessionStorage()?.getItem(KEY) ?? null; } catch { return null; }
}

function writeWebSession(raw: string | null): void {
  try {
    const storage = webSessionStorage();
    if (raw === null) storage?.removeItem(KEY);
    else storage?.setItem(KEY, raw);
  } catch {}
}

export async function loadSession(): Promise<Session | null> {
  // The first release stored a plaintext access token in AsyncStorage; remove it.
  await AsyncStorage.removeItem(LEGACY_ASYNC_STORAGE_KEY).catch(() => {});
  const raw = useMemory ? readWebSession() ?? memory : await SecureStore.getItemAsync(KEY, OPTIONS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.accessToken === 'string' && typeof parsed?.refreshToken === 'string') return parsed;
  } catch {}
  await clearSession();
  return null;
}

export async function saveSession(session: Session): Promise<void> {
  const raw = JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken });
  if (useMemory) {
    memory = raw;
    writeWebSession(raw);
    return;
  }
  await SecureStore.setItemAsync(KEY, raw, OPTIONS);
}

export async function clearSession(): Promise<void> {
  if (useMemory) {
    memory = null;
    writeWebSession(null);
    return;
  }
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
}
