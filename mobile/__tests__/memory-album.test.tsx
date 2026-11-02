import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { MemoryAlbumScreen } from '../src/screens/main/MemoryAlbumScreen';
import { deviceFonts } from '../src/screens/main/MemoryPoster';
import { ConfirmProvider } from '../src/ui/ConfirmDialog';
import { ToastProvider } from '../src/ui/Toast';
import { USER, deferred, mockServer } from '../test/mockServer';

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async () => ({ exists: false })), writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}), moveAsync: jest.fn(async () => {}),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })), saveToLibraryAsync: jest.fn(async () => {}),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const memory = (over: Record<string, unknown>) => ({
  id: 7, pet_id: 'fox', event_type: 'pet_evolved', title: 'Mây đạt cấp 3', message: null, event_text: '',
  event_at: '2026-10-01T08:00:00+00:00', created_at: '2026-10-01T08:00:00+00:00', favorite: false, status: 'ready',
  snapshot: { pet_name: 'Mây', pet_id: 'fox', level: 3, element: 'fire', background: 'home', before_level: 2 },
  thumbnail_svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280"><rect id="taken-then" width="10" height="10"/></svg>',
  template_key: 'auto', palette_key: 'lilac', include_message: false, ...over,
});
const drawnSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350"/>';
const picture = (key: string) => ({ status: 200, body: { png: `PNG-${key}`, width: 1080, height: 1350, key } });

const album = (user = USER) => render(<ToastProvider><ConfirmProvider>
  <MemoryAlbumScreen user={{ ...user, level: 5, pet_name: 'Sấm' } as any} onBack={() => {}} />
</ConfirmProvider></ToastProvider>);

beforeEach(() => jest.clearAllMocks());

test('the album shows the pictures stored with each memory, not the pet as it is now', async () => {
  mockServer({ 'GET /api/memories?category=all&limit=20': { status: 200, body: { items: [memory({})], next_cursor: null } } });
  album();
  expect(await screen.findByText('Mây đạt cấp 3')).toBeTruthy();
  expect(screen.getAllByTestId('memory-image')).toHaveLength(1);
  expect(screen.queryByTestId('memory-image-pending')).toBeNull();
});

test('a picture still being drawn shows that, with no stand-in, and "Thử lại" asks the server again', async () => {
  const pending = memory({ status: 'pending', thumbnail_svg: '', image_svg: '', image_key: null });
  let drawn = false;
  const server = mockServer({
    'GET /api/memories?category=all&limit=20': { status: 200, body: { items: [pending], next_cursor: null } },
    'GET /api/memories/7': () => {
      const reply = drawn ? memory({ image_svg: drawnSvg, image_key: 'k-drawn' }) : pending;
      drawn = true;
      return { status: 200, body: reply };
    },
    'GET /api/memories/7/image': picture('k-drawn'),
  });
  album();
  fireEvent.press(await screen.findByText('Mây đạt cấp 3'));
  expect(await screen.findByText('Thử lại')).toBeTruthy();
  expect(screen.queryByTestId('memory-picture')).toBeNull();
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByTestId('memory-picture')).toBeTruthy();
  expect(server.callsTo('GET /api/memories/7')).toHaveLength(2);
});

test('saving and sharing hand over the PNG on screen, only once it has loaded, and "saved" waits for the library', async () => {
  const opened = memory({ id: 21, image_svg: drawnSvg, image_key: 'k-21' });
  mockServer({
    'GET /api/memories?category=all&limit=20': { status: 200, body: { items: [opened], next_cursor: null } },
    'GET /api/memories/21': { status: 200, body: opened },
    'GET /api/memories/21/image': picture('k-21'),
  });
  album();
  fireEvent.press(await screen.findByText('Mây đạt cấp 3'));
  const shown = await screen.findByTestId('memory-picture');
  const file = 'file:///cache/mirabi-memory-21-k-21.png';
  expect(shown.props.source).toEqual({ uri: file });
  expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(`${file}.part`, 'PNG-k-21', { encoding: 'base64' });
  expect(screen.getByText('Đang tải ảnh kỷ niệm…')).toBeTruthy();

  // Not loaded yet: nothing to save.
  fireEvent.press(screen.getByText('Tải ảnh'));
  expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();

  fireEvent(shown, 'load');
  const saving = deferred<void>();
  (MediaLibrary.saveToLibraryAsync as jest.Mock).mockReturnValueOnce(saving.promise);
  fireEvent.press(screen.getByText('Tải ảnh'));
  await waitFor(() => expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith(file));
  expect(screen.queryByText('Đã lưu ảnh vào thư viện')).toBeNull();
  await act(async () => saving.resolve());
  expect(await screen.findByText('Đã lưu ảnh vào thư viện')).toBeTruthy();

  fireEvent.press(screen.getByText('Chia sẻ'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith(file, expect.objectContaining({ mimeType: 'image/png' })));
});

test('a picture that fails to load says so and loads it again on "Thử lại", never showing another picture', async () => {
  const opened = memory({ id: 22, image_svg: drawnSvg, image_key: 'k-22' });
  let fail = true;
  mockServer({
    'GET /api/memories?category=all&limit=20': { status: 200, body: { items: [opened], next_cursor: null } },
    'GET /api/memories/22': { status: 200, body: opened },
    'GET /api/memories/22/image': () => fail ? { status: 503, body: { detail: 'down', code: 'memory_image_unavailable' } } : picture('k-22'),
  });
  album();
  fireEvent.press(await screen.findByText('Mây đạt cấp 3'));
  expect(await screen.findByText('Chưa tải được ảnh kỷ niệm')).toBeTruthy();
  expect(screen.queryByTestId('memory-picture')).toBeNull();
  fail = false;
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByTestId('memory-picture')).toBeTruthy();
});

test('creating a memory previews the PNG the server will store and sends no pet of its own', async () => {
  const server = mockServer({
    'GET /api/memories?category=all&limit=20': { status: 200, body: { items: [], next_cursor: null } },
    'POST /api/memories/preview': { status: 200, body: { svg: drawnSvg, ...picture('k-preview').body } },
    'POST /api/memories': (req) => ({ status: 201, body: memory({ id: 9, event_type: 'manual', title: req.body.title, image_svg: '<svg/>' }) }),
  });
  album();
  fireEvent.press(await screen.findByLabelText('Tạo kỷ niệm'));
  expect((await screen.findByTestId('memory-preview')).props.source).toEqual({ uri: 'data:image/png;base64,PNG-k-preview' });
  fireEvent.press(screen.getByText('Lưu kỷ niệm'));
  await waitFor(() => expect(server.callsTo('POST /api/memories')).toHaveLength(1));
  const sent = server.callsTo('POST /api/memories')[0].body;
  expect(sent.snapshot).toBeUndefined();
  expect(sent).toMatchObject({ title: 'Ngày chúng mình gặp nhau', template_key: 'hatch', palette_key: 'sky' });
});

test('thumbnails name the Nunito file the app loaded, old and new pictures alike', () => {
  const svg = '<svg><text x="28" font-weight="800" font-family="Nunito">Học tập</text>'
    + '<text font-size="17" font-family="Nunito_600SemiBold, Nunito, sans-serif" font-weight="700">Cấp 3</text>'
    + '<text font-family="sans-serif">30/10/2026</text></svg>';
  expect(deviceFonts(svg)).toBe('<svg><text x="28" font-family="Nunito_800ExtraBold" font-weight="800">Học tập</text>'
    + '<text font-size="17" font-family="Nunito_700Bold" font-weight="700">Cấp 3</text>'
    + '<text font-family="Nunito_400Regular" font-weight="400">30/10/2026</text></svg>');
});
