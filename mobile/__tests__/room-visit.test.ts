import { friendQrPayload, parseFriendCode, qrPath, waitSeconds } from '../src/room/visit';
import { foldName } from '../src/screens/together/friendsUi';

test('friend QR codes hold the friend code and scanning reads it back', () => {
  expect(friendQrPayload('K7P2QX9M')).toBe('MIRABI-FRIEND:K7P2QX9M');
  expect(parseFriendCode('MIRABI-FRIEND:K7P2QX9M')).toBe('K7P2QX9M');
  expect(parseFriendCode(' mirabi-friend:k7p2qx9m ')).toBe('K7P2QX9M');
  expect(parseFriendCode('K7P2-QX9M')).toBe('K7P2QX9M');
  expect(parseFriendCode('https://example.com')).toBeNull();
  expect(parseFriendCode('Linh')).toBeNull();
  const qr = qrPath(friendQrPayload('K7P2QX9M'));
  expect(qr.size).toBeGreaterThanOrEqual(21); // a real QR symbol (version 1 is 21 x 21)
  expect(qr.d).toMatch(/^M\d+ \d+h1v1h-1z/);
});

test('name search ignores case and Vietnamese accents', () => {
  expect(foldName('Đào Lĩnh')).toBe('dao linh');
  expect(foldName('  MÂY ')).toBe('may');
});

test('cooldowns count down from the time the backend gave', () => {
  const now = Date.parse('2030-01-01T10:00:00Z');
  expect(waitSeconds({ hello: '2030-01-01T10:05:00Z' }, 'hello', now)).toBe(300);
  expect(waitSeconds({ hello: '2030-01-01T09:59:00Z' }, 'hello', now)).toBe(0);
  expect(waitSeconds({ hello: null }, 'hello', now)).toBe(0);
});
