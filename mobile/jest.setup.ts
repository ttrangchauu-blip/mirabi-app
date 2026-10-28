import { AccessibilityInfo } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// In-memory stand-in for the Keychain/Keystore.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { store.delete(key); }),
    __store: store,
  };
});

jest.mock('expo-audio', () => {
  // One stable player per test file, like the real hook keeps one player per component.
  const player = { loop: false, volume: 1, play: jest.fn(), pause: jest.fn(), replace: jest.fn() };
  return {
    useAudioPlayer: () => player,
    setAudioModeAsync: jest.fn(async () => {}),
  };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(), getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })), setNotificationChannelAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => 'test-notification'), cancelScheduledNotificationAsync: jest.fn(async () => {}),
  AndroidImportance: { DEFAULT: 3 }, SchedulableTriggerInputTypes: { DATE: 'date' },
}));
// The friend QR scanner: a camera that is allowed and shows nothing; tests call onBarcodeScanned themselves.
jest.mock('expo-camera', () => {
  const { View } = require('react-native');
  const permission = { granted: true, canAskAgain: true, status: 'granted' };
  return { CameraView: (props: any) => require('react').createElement(View, { testID: 'qr-camera', ...props }),
    useCameraPermissions: () => [permission, jest.fn(async () => permission)] };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => {}) }));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Keep decorative animations static so tests are deterministic.
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

// Game pictures load at once in tests (a test that needs to wait replaces this with its own promise).
jest.spyOn(require('expo-asset').Asset, 'loadAsync').mockImplementation(async () => []);
