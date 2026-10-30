import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { request } from './shared';

/** A memory picture as the server renders it (backend memory_render.py): a 1080 x 1350 PNG drawn from the picture
 * stored when the memory happened, with the app's Nunito files. The detail view shows this file and "Tải ảnh" /
 * "Chia sẻ" hand over the same file, so what is saved is what was on screen: same letters, colours and layout, at full
 * size, without any of the screen's buttons. Phones keep it in the cache folder under the picture's key (it changes
 * only if the picture is drawn again); the web holds it as a data: URI. */
export type PictureReply = { png: string; width: number; height: number; key: string };

const WEB = Platform.OS === 'web';
const shown = new Map<string, string>();
const fileFor = (id: number, key: string) => `${FileSystem.cacheDirectory}mirabi-memory-${id}-${key}.png`;

/** The URI of memory `id`'s PNG, downloaded once per picture. `fresh` skips the cache (a file that failed to show). */
export async function memoryPicture(id: number, key?: string | null, fresh = false): Promise<string> {
  if (key && !fresh) {
    const known = shown.get(`${id}:${key}`);
    if (known) return known;
    if (!WEB && (await FileSystem.getInfoAsync(fileFor(id, key))).exists) return remember(id, key, fileFor(id, key));
  }
  const reply = await request(`/api/memories/${id}/image`) as PictureReply;
  if (WEB) return remember(id, reply.key, `data:image/png;base64,${reply.png}`);
  // Written beside the cache entry and moved in whole, so an interrupted write never leaves half a picture cached.
  const file = fileFor(id, reply.key);
  await FileSystem.writeAsStringAsync(`${file}.part`, reply.png, { encoding: FileSystem.EncodingType.Base64 });
  await FileSystem.deleteAsync(file, { idempotent: true });
  await FileSystem.moveAsync({ from: `${file}.part`, to: file });
  return remember(id, reply.key, file);
}

function remember(id: number, key: string, uri: string) {
  shown.set(`${id}:${key}`, uri);
  return uri;
}

const fileName = (id: number) => `mirabi-memory-${id}.png`;

async function webBlob(uri: string) {
  return (await fetch(uri)).blob();
}

function webDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later: revoking right after click() can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Saves the shown PNG: to the photo library on a phone (resolves once it is saved), as a download on the web.
 * Returns what happened, so the caller only says "saved" when it was. */
export async function savePicture(uri: string, id: number): Promise<'saved' | 'downloading'> {
  if (WEB) {
    webDownload(await webBlob(uri), fileName(id));
    return 'downloading';
  }
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('Mirabi chưa được phép lưu ảnh. Hãy cho phép truy cập Ảnh trong Cài đặt rồi thử lại.');
  await MediaLibrary.saveToLibraryAsync(uri);
  return 'saved';
}

/** Opens the share sheet with the shown PNG. A browser that cannot share files downloads it instead. */
export async function sharePicture(uri: string, id: number, title: string): Promise<'shared' | 'downloading' | 'cancelled'> {
  if (WEB) {
    const blob = await webBlob(uri);
    const file = new File([blob], fileName(id), { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (!nav.canShare?.({ files: [file] })) {
      webDownload(blob, fileName(id));
      return 'downloading';
    }
    try {
      await nav.share({ files: [file], title });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      throw e;
    }
    return 'shared';
  }
  if (!await Sharing.isAvailableAsync()) throw new Error('Thiết bị không hỗ trợ chia sẻ.');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Chia sẻ kỷ niệm' });
  return 'shared';
}
