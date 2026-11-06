import React from 'react';
import { type ImageSourcePropType, View } from 'react-native';
import { Plate } from '../../world/diorama';

/** The games' rendered worlds (`scripts/render-scenes`, `scene-games.js`). Their skies, and everything played on them, stay drawn by the games. */
export const ARENA_ART = {
  forest: { far: require('../../../assets/world/games/forest-far.webp'), mid: require('../../../assets/world/games/forest-mid.webp'), near: require('../../../assets/world/games/forest-near.webp') },
  cave: { far: require('../../../assets/world/games/cave-far.webp'), mid: require('../../../assets/world/games/cave-mid.webp'), near: require('../../../assets/world/games/cave-near.webp') },
  castle: { far: require('../../../assets/world/games/castle-far.webp'), mid: require('../../../assets/world/games/castle-mid.webp'), near: require('../../../assets/world/games/castle-near.webp') },
  boss: { far: require('../../../assets/world/games/boss-far.webp'), mid: require('../../../assets/world/games/boss-mid.webp'), near: require('../../../assets/world/games/boss-near.webp') },
};
export const FOREST_ART = ARENA_ART.forest;
export const SPACE_ART = { far: require('../../../assets/world/games/space-far.webp'), near: require('../../../assets/world/games/space-near.webp') };
export const ERA_ART = { stone: require('../../../assets/world/games/stone.webp'), bronze: require('../../../assets/world/games/bronze.webp'), feudal: require('../../../assets/world/games/feudal.webp'), modern: require('../../../assets/world/games/modern.webp') };
export const MAP_ART = require('../../../assets/world/games/map.webp');
export const LAB_ART = require('../../../assets/world/games/lab.webp');
/** The brook of Ghép chữ's bridge: water in a soft bed, with banks that cover the road. */
export const BROOK_ART = require('../../../assets/world/games/brook.webp');
/** Its height over its width. */
export const BROOK_TALL = 320 / 960;
export const FIELD_ART = require('../../../assets/world/games/field.webp');
/** The night field's height over its width. */
export const FIELD_TALL = 660 / 1170;

/** A strip for `Parallax`: two widths long, its halves identical. The picture repeats without a seam. */
export function Strip({ source, width, height }: { source: ImageSourcePropType; width: number; height: number }) {
  return <View style={{ width: width * 2, height }}>
    <Plate source={source} width={width + 0.5} height={height} />
    <Plate source={source} width={width + 0.5} height={height} style={{ left: width }} />
  </View>;
}
