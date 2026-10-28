import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePetHatch } from '../src/screens/main/usePetHatch';

const KEY = 'refmi.petLevelSeen.v1:7:turtle';
const user = (level: number) => ({ id: 7, pet: 'turtle', level });

beforeEach(async () => { await AsyncStorage.clear(); });

test('a pet last seen as an egg hatches once it reaches Lv.1, and only once', async () => {
  await AsyncStorage.setItem(KEY, '0');
  const { result } = renderHook(() => usePetHatch(user(1)));
  await waitFor(() => expect(result.current.hatching).toBe(true));
  // Not remembered until the hatching has been watched, so closing the app mid-way shows it again.
  expect(await AsyncStorage.getItem(KEY)).toBe('0');
  act(() => result.current.done());
  expect(result.current.hatching).toBe(false);
  await waitFor(async () => expect(await AsyncStorage.getItem(KEY)).toBe('1'));
});

test('the egg levelling up while the app is open hatches it', async () => {
  const { result, rerender } = renderHook(({ level }: { level: number }) => usePetHatch(user(level)), { initialProps: { level: 0 } });
  await waitFor(async () => expect(await AsyncStorage.getItem(KEY)).toBe('0'));
  expect(result.current.hatching).toBe(false);
  rerender({ level: 1 });
  await waitFor(() => expect(result.current.hatching).toBe(true));
});

test('a device that never saw the egg just remembers the level, without a hatching', async () => {
  const { result } = renderHook(() => usePetHatch(user(3)));
  await waitFor(async () => expect(await AsyncStorage.getItem(KEY)).toBe('3'));
  expect(result.current.hatching).toBe(false);
});
