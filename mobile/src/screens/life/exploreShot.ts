import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { webBlob, webDownload } from '../main/memoryPicture';
import { captureView, releaseView } from './exploreCapture';

/** The phone's photo library said no. `canAskAgain` false: only the system's settings can change that now. */
export class PhotosDenied extends Error {
  constructor(readonly canAskAgain: boolean) {
    super(canAskAgain ? 'Mirabi cần quyền lưu ảnh để giữ lại khung cảnh này.' : 'Mirabi chưa được phép lưu ảnh. Hãy cho phép truy cập Ảnh trong Cài đặt.');
  }
}

/** A picture of the scene alone: what is captured is that view, and the buttons stand outside it. */
export const captureScene = (scene: RefObject<View | null>) => captureView(scene);

/** Saves a picture from `captureScene`: to the photo library on a phone, as a download on the web. Only says "saved" once it is. */
export async function saveScene(uri: string, name = 'mirabi-kham-pha'): Promise<'saved' | 'downloading'> {
  if (Platform.OS === 'web') {
    webDownload(await webBlob(uri), `${name}-${Date.now()}.png`);
    return 'downloading';
  }
  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) throw new PhotosDenied(permission.canAskAgain !== false);
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'saved';
  } finally {
    releaseView(uri);
  }
}
