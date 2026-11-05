// Written by scripts/render-scenes/gen-plates.mjs from the render's numbers: where each picture of the group room goes, on its 640 x 440 canvas.
import type { ImageSourcePropType } from 'react-native';

export type Box = [number, number, number, number];
export type SwayPart = { source: ImageSourcePropType; box: Box; origin: [number, number]; deg: number; ms: number };
export const GROUP_ROOM = require('../../../assets/world/grouproom/room.jpg') as ImageSourcePropType;
export const GROUP_TOP = require('../../../assets/world/grouproom/room-top.jpg') as ImageSourcePropType;
export const GROUP_NEAR = require('../../../assets/world/grouproom/room-near.jpg') as ImageSourcePropType;
export const GROUP_TABLE = { source: require('../../../assets/world/grouproom/table.webp') as ImageSourcePropType, box: [105,239,437.5,101.5] as Box };
export const GROUP_FRAME = { source: require('../../../assets/world/grouproom/win-frame.webp') as ImageSourcePropType, box: [21.5,22,171.5,161] as Box };
/** Where the sky goes, under the frame. */
export const GROUP_GLASS: Box = [69, 50, 86, 120];
/** Where the board's writing goes. */
export const GROUP_BOARD: Box = [250, 58, 176, 92];
export const GROUP_SWAY: SwayPart[] = [
  { source: require('../../../assets/world/grouproom/win-curtainL.webp'), box: [29.5,25.5,47.5,177], origin: [53.25,25.5], deg: 0.7, ms: 3400 },
  { source: require('../../../assets/world/grouproom/win-curtainR.webp'), box: [143,27,45,179], origin: [165.5,27], deg: 0.7, ms: 3900 },
];
export const GROUP_FORE: SwayPart[] = [
  { source: require('../../../assets/world/grouproom/fore-left.webp'), box: [0,392,41,48], origin: [0,440], deg: 1.6, ms: 3600 },
  { source: require('../../../assets/world/grouproom/fore-right.webp'), box: [593.5,391.5,46.5,48.5], origin: [640,440], deg: 1.6, ms: 4100 },
];
/** The eight seats: five chairs behind the table (their pets go under the table's picture) and three poufs in front. `foot` is where a pet's feet go. */
export const GROUP_SEATS: { source: ImageSourcePropType; box: Box; foot: [number, number]; row: 'back' | 'front' }[] = [
  { source: require('../../../assets/world/grouproom/seat0.webp'), box: [154,195,66,117], foot: [180.9,241.5], row: 'back' },
  { source: require('../../../assets/world/grouproom/seat1.webp'), box: [205,197,115,115], foot: [255.5,243.7], row: 'back' },
  { source: require('../../../assets/world/grouproom/seat2.webp'), box: [279,199,96.5,115], foot: [330.8,245.9], row: 'back' },
  { source: require('../../../assets/world/grouproom/seat3.webp'), box: [357,181,159,136.5], foot: [407,248.2], row: 'back' },
  { source: require('../../../assets/world/grouproom/seat4.webp'), box: [445.5,163.5,148.5,158.5], foot: [484,250.5], row: 'back' },
  { source: require('../../../assets/world/grouproom/seat5.webp'), box: [141.5,352,82.5,42.5], foot: [174.1,360.1], row: 'front' },
  { source: require('../../../assets/world/grouproom/seat6.webp'), box: [270.5,356.5,81,43.5], foot: [303.6,365.1], row: 'front' },
  { source: require('../../../assets/world/grouproom/seat7.webp'), box: [402,361.5,80,44], foot: [435.7,370.1], row: 'front' },
];
