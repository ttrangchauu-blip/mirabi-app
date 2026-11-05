import type { RefObject } from 'react';
import type { View } from 'react-native';

/** Loaded on the first picture: a build without the native module loses this button, never the whole app. */
const viewShot = () => require('react-native-view-shot') as typeof import('react-native-view-shot');

/** A picture of this view alone, at the screen's own pixels, as a temporary file. Everything in the scene is an ordinary
 * view, an image or SVG (no GL surface), which is what view-shot captures. */
export const captureView = (view: RefObject<View | null>): Promise<string> => viewShot().captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
export const releaseView = (uri: string) => viewShot().releaseCapture(uri);
