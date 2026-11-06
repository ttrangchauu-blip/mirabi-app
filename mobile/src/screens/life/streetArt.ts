import type { ImageSourcePropType } from 'react-native';

/** One house's patch of the rendered street: its picture, with its left, top, width and height as shares of the street. */
type Box = readonly [number, number, number, number];

/** The friends' street (`scripts/render-scenes`): the land with no houses, and a patch of the same picture for each plot, with
 * the house, its garden and the shadow it casts. Numbers are `render.mjs`'s and `cut-street.mjs`'s; a new camera means new numbers. */
export const STREET_ART: Record<'day' | 'night', { land: ImageSourcePropType; houses: ImageSourcePropType[]; boxes: readonly Box[] }> = {
  day: {
    land: require('../../../assets/world/street/land-day.webp'),
    houses: [require('../../../assets/world/street/house-0-day.webp'), require('../../../assets/world/street/house-1-day.webp'), require('../../../assets/world/street/house-2-day.webp'), require('../../../assets/world/street/house-3-day.webp'), require('../../../assets/world/street/house-4-day.webp'), require('../../../assets/world/street/house-5-day.webp')],
    boxes: [[0.0119, 0.38, 0.2263, 0.5218], [0.1719, 0.3291, 0.2256, 0.5727], [0.3356, 0.2873, 0.2219, 0.6145], [0.4906, 0.3709, 0.2231, 0.5309], [0.6525, 0.4036, 0.2238, 0.4982], [0.8175, 0.3436, 0.1825, 0.5582]],
  },
  night: {
    land: require('../../../assets/world/street/land-night.webp'),
    houses: [require('../../../assets/world/street/house-0-night.webp'), require('../../../assets/world/street/house-1-night.webp'), require('../../../assets/world/street/house-2-night.webp'), require('../../../assets/world/street/house-3-night.webp'), require('../../../assets/world/street/house-4-night.webp'), require('../../../assets/world/street/house-5-night.webp')],
    boxes: [[0.0119, 0.38, 0.19, 0.5236], [0.1719, 0.3418, 0.2256, 0.56], [0.3312, 0.2891, 0.2206, 0.6455], [0.5, 0.3855, 0.1925, 0.5164], [0.6569, 0.4036, 0.18, 0.4982], [0.8237, 0.3436, 0.1762, 0.56]],
  },
};
/** The picture's width over its height. */
export const STREET_RATIO = 1600 / 550;
/** Where, as shares of the picture: the ground in front of each plot's door, the paving at its gate, the street's lamps. */
export const STREET_DOORS: readonly (readonly [number, number])[] = [[0.0845, 0.7861], [0.2507, 0.7861], [0.4169, 0.7861], [0.5831, 0.7861], [0.7493, 0.7861], [0.9155, 0.7861]];
export const STREET_GATES: readonly (readonly [number, number])[] = [[0.0496, 0.9093], [0.2298, 0.9093], [0.4099, 0.9093], [0.5901, 0.9093], [0.7702, 0.9093], [0.9504, 0.9093]];
export const STREET_LAMPS: readonly (readonly [number, number])[] = [[0.3206, 0.5944], [0.6794, 0.5944]];
/** Where the land's ridge is at its highest: the sky is above this. */
export const STREET_RIDGE = 0.19;
