// Written by scripts/render-scenes/gen-plates.mjs from the render's numbers: where each picture of the focus room goes, on its 640 x 440 canvas.
import type { ImageSourcePropType } from 'react-native';

export type Box = [number, number, number, number];
export type SwayPart = { source: ImageSourcePropType; box: Box; origin: [number, number]; deg: number; ms: number };
export type FocusPlate = { variant: string; anchor: [number, number]; source: ImageSourcePropType; box: Box;
  /** Where the sky goes, under the picture. */ glass?: Box; /** The hands' centre, around its anchor. */ clock?: [number, number];
  /** Its own layers that stir. */ sway?: SwayPart[]; /** What goes over a pet at its seat. */ cover?: ImageSourcePropType; coverBox?: Box };

export const FOCUS_ITEMS: Record<string, FocusPlate> = {
  window: { variant: 'morning', anchor: [320,118], source: require('../../../assets/world/focusroom/window.webp'), box: [203.5,21.5,244,204], glass: [272, 52, 96, 131], sway: [{ source: require('../../../assets/world/focusroom/window-curtainL.webp'), box: [214,30,61.5,175.5], origin: [244.75,30], deg: 0.7, ms: 3400 }, { source: require('../../../assets/world/focusroom/window-curtainR.webp'), box: [361.5,31.5,63,177], origin: [393,31.5], deg: 0.7, ms: 3900 }] },
  memo_board: { variant: 'oak', anchor: [136,116], source: require('../../../assets/world/focusroom/memo_board.webp'), box: [87.5,82,100.5,72.5] },
  wall_clock: { variant: 'mint', anchor: [470,64], source: require('../../../assets/world/focusroom/wall_clock.webp'), box: [444.5,40.5,55,56.5], clock: [0, 2] },
  calendar: { variant: 'red', anchor: [500,150], source: require('../../../assets/world/focusroom/calendar.webp'), box: [479,122,45,54] },
  rug_oval: { variant: 'lilac', anchor: [320,400], source: require('../../../assets/world/focusroom/rug_oval.webp'), box: [202,369.5,238.5,70.5] },
  desk: { variant: 'oak', anchor: [320,352], source: require('../../../assets/world/focusroom/desk.webp'), box: [224.5,198,277.5,177.5], cover: require('../../../assets/world/focusroom/desk-body.webp'), coverBox: [224.5,242.5,197,108.5] },
  book_stack: { variant: 'cool', anchor: [256,266], source: require('../../../assets/world/focusroom/book_stack.webp'), box: [235,240.5,96.5,72] },
  desk_lamp: { variant: 'sage', anchor: [384,266], source: require('../../../assets/world/focusroom/desk_lamp.webp'), box: [360.5,204,58,81] },
  mug: { variant: 'cream', anchor: [352,266], source: require('../../../assets/world/focusroom/mug.webp'), box: [345.5,253.5,25,29] },
  bookcase: { variant: 'oak', anchor: [566,330], source: require('../../../assets/world/focusroom/bookcase.webp'), box: [474.5,148.5,165.5,200.5] },
  desk_plant: { variant: 'terracotta', anchor: [566,160], source: require('../../../assets/world/focusroom/desk_plant.webp'), box: [550.5,115.5,48,42] },
  plant_monstera: { variant: 'terracotta', anchor: [74,424], source: require('../../../assets/world/focusroom/plant_monstera.webp'), box: [0,273,240,165.5], sway: [{ source: require('../../../assets/world/focusroom/plant_monstera-leaves.webp'), box: [0,274,164.5,98.5], origin: [74,386], deg: 1.1, ms: 3000 }] },
};
export const FOCUS_EXTRAS = { source: require('../../../assets/world/focusroom/extras.webp'), box: [119,342.5,482.5,97.5] as Box };
export const FOCUS_FORE: SwayPart[] = [
  { source: require('../../../assets/world/focusroom/fore-left.webp'), box: [0,399,46.5,41], origin: [0,440], deg: 1.6, ms: 3600 },
  { source: require('../../../assets/world/focusroom/fore-right.webp'), box: [599.5,392,40.5,48], origin: [640,440], deg: 1.6, ms: 4100 },
  { source: require('../../../assets/world/focusroom/fore-vine.webp'), box: [595.5,0,44,88.5], origin: [617.5,0], deg: 1.2, ms: 4600 },
];
export const FOCUS_WALLS: Record<string, { source: ImageSourcePropType; top: ImageSourcePropType }> = {
  wall_cream: { source: require('../../../assets/world/focusroom/wall_cream.jpg'), top: require('../../../assets/world/focusroom/wall_cream-top.jpg') },
  wall_mint: { source: require('../../../assets/world/focusroom/wall_mint.jpg'), top: require('../../../assets/world/focusroom/wall_mint-top.jpg') },
  wall_lilac: { source: require('../../../assets/world/focusroom/wall_lilac.jpg'), top: require('../../../assets/world/focusroom/wall_lilac-top.jpg') },
  wall_peach: { source: require('../../../assets/world/focusroom/wall_peach.jpg'), top: require('../../../assets/world/focusroom/wall_peach-top.jpg') },
  wall_sky: { source: require('../../../assets/world/focusroom/wall_sky.jpg'), top: require('../../../assets/world/focusroom/wall_sky-top.jpg') },
  wall_night: { source: require('../../../assets/world/focusroom/wall_night.jpg'), top: require('../../../assets/world/focusroom/wall_night-top.jpg') },
};
export const FOCUS_FLOORS: Record<string, { source: ImageSourcePropType; box: Box; near: ImageSourcePropType }> = {
  floor_wood_light: { source: require('../../../assets/world/focusroom/floor_wood_light.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_wood_light-near.jpg') },
  floor_wood_honey: { source: require('../../../assets/world/focusroom/floor_wood_honey.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_wood_honey-near.jpg') },
  floor_wood_rose: { source: require('../../../assets/world/focusroom/floor_wood_rose.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_wood_rose-near.jpg') },
  floor_wood_night: { source: require('../../../assets/world/focusroom/floor_wood_night.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_wood_night-near.jpg') },
  floor_tile_cream: { source: require('../../../assets/world/focusroom/floor_tile_cream.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_tile_cream-near.jpg') },
  floor_tile_blue: { source: require('../../../assets/world/focusroom/floor_tile_blue.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_tile_blue-near.jpg') },
  floor_tile_lilac: { source: require('../../../assets/world/focusroom/floor_tile_lilac.webp'), box: [0,281,640,159], near: require('../../../assets/world/focusroom/floor_tile_lilac-near.jpg') },
};
