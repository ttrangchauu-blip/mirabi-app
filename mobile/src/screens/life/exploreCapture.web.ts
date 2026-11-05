import type { RefObject } from 'react';
import type { View } from 'react-native';
import html2canvas from 'html2canvas';

/** view-shot's captureRef asks for findNodeHandle, which react-native-web doesn't have: on the web a view's ref is its DOM node, and this is what view-shot itself draws it with. */
export async function captureView(view: RefObject<View | null>): Promise<string> {
  const canvas = await html2canvas(view.current as unknown as HTMLElement, { backgroundColor: null, scale: window.devicePixelRatio || 1, logging: false, useCORS: true });
  return canvas.toDataURL('image/png');
}
export const releaseView = (_uri: string) => {};
