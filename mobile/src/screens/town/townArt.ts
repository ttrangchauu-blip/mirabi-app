import type { ImageSourcePropType } from 'react-native';

/** A patch of the rendered street: left, top, width and height as shares of the street. */
export type Box = readonly [number, number, number, number];
export type TownArt = {
  land: ImageSourcePropType[]; fountain: ImageSourcePropType[]; fountainBoxes: readonly Box[]; garden: ImageSourcePropType[]; gardenBoxes: readonly Box[];
  houses: ImageSourcePropType[]; houseBoxes: readonly Box[];
};

/** Thị trấn Mirabi (`scripts/render-scenes`): the street with what can't change, in tiles, and a patch of the same picture for each stage of
 * the fountain and the garden (stage 1 is the first) and for each friend's plot, with the shadow it casts. A new camera means new numbers. */
export const TOWN_ART: Record<'day' | 'night', TownArt> = {
  day: {
    land: [require('../../../assets/world/town/land-day-0.webp'), require('../../../assets/world/town/land-day-1.webp'), require('../../../assets/world/town/land-day-2.webp'), require('../../../assets/world/town/land-day-3.webp')],
    fountain: [require('../../../assets/world/town/fountain-1-day.webp'), require('../../../assets/world/town/fountain-2-day.webp'), require('../../../assets/world/town/fountain-3-day.webp'), require('../../../assets/world/town/fountain-4-day.webp')],
    fountainBoxes: [[0.011, 0.1389, 0.109, 0.8222], [0.0105, 0.1389, 0.1095, 0.8222], [0.0105, 0.1389, 0.1095, 0.8222], [0.0108, 0.1389, 0.1092, 0.8222]],
    garden: [require('../../../assets/world/town/garden-1-day.webp'), require('../../../assets/world/town/garden-2-day.webp'), require('../../../assets/world/town/garden-3-day.webp'), require('../../../assets/world/town/garden-4-day.webp')],
    gardenBoxes: [[0.0933, 0.1389, 0.1133, 0.8236], [0.0933, 0.1389, 0.1133, 0.8236], [0.0933, 0.1389, 0.1133, 0.8236], [0.0933, 0.1389, 0.1133, 0.8236]],
    houses: [require('../../../assets/world/town/house-0-day.webp'), require('../../../assets/world/town/house-1-day.webp'), require('../../../assets/world/town/house-2-day.webp'), require('../../../assets/world/town/house-3-day.webp'), require('../../../assets/world/town/house-4-day.webp'), require('../../../assets/world/town/house-5-day.webp'), require('../../../assets/world/town/house-6-day.webp'), require('../../../assets/world/town/house-7-day.webp'), require('../../../assets/world/town/house-8-day.webp'), require('../../../assets/world/town/house-9-day.webp'), require('../../../assets/world/town/house-10-day.webp'), require('../../../assets/world/town/house-11-day.webp')],
    houseBoxes: [[0.3988, 0.1944, 0.0633, 0.775], [0.4483, 0.1944, 0.0633, 0.7556], [0.4977, 0.1944, 0.0635, 0.7389], [0.5472, 0.1944, 0.0635, 0.7625], [0.5967, 0.1944, 0.0633, 0.7486], [0.6462, 0.1944, 0.0633, 0.7792], [0.6955, 0.1944, 0.0635, 0.7389], [0.745, 0.1944, 0.0635, 0.7389], [0.7945, 0.1944, 0.0633, 0.7389], [0.844, 0.1944, 0.063, 0.7389], [0.8933, 0.5111, 0.0632, 0.4222], [0.9428, 0.1944, 0.0572, 0.7389]],
  },
  night: {
    land: [require('../../../assets/world/town/land-night-0.webp'), require('../../../assets/world/town/land-night-1.webp'), require('../../../assets/world/town/land-night-2.webp'), require('../../../assets/world/town/land-night-3.webp')],
    fountain: [require('../../../assets/world/town/fountain-1-night.webp'), require('../../../assets/world/town/fountain-2-night.webp'), require('../../../assets/world/town/fountain-3-night.webp'), require('../../../assets/world/town/fountain-4-night.webp')],
    fountainBoxes: [[0.0117, 0.1389, 0.1083, 0.8208], [0.0107, 0.1389, 0.1093, 0.8208], [0.0105, 0.1389, 0.1095, 0.8208], [0.0107, 0.1389, 0.1093, 0.8208]],
    garden: [require('../../../assets/world/town/garden-1-night.webp'), require('../../../assets/world/town/garden-2-night.webp'), require('../../../assets/world/town/garden-3-night.webp'), require('../../../assets/world/town/garden-4-night.webp')],
    gardenBoxes: [[0.0933, 0.1389, 0.1133, 0.8222], [0.0933, 0.1389, 0.1133, 0.8222], [0.0933, 0.1389, 0.1133, 0.8222], [0.0933, 0.1389, 0.1133, 0.8222]],
    houses: [require('../../../assets/world/town/house-0-night.webp'), require('../../../assets/world/town/house-1-night.webp'), require('../../../assets/world/town/house-2-night.webp'), require('../../../assets/world/town/house-3-night.webp'), require('../../../assets/world/town/house-4-night.webp'), require('../../../assets/world/town/house-5-night.webp'), require('../../../assets/world/town/house-6-night.webp'), require('../../../assets/world/town/house-7-night.webp'), require('../../../assets/world/town/house-8-night.webp'), require('../../../assets/world/town/house-9-night.webp'), require('../../../assets/world/town/house-10-night.webp'), require('../../../assets/world/town/house-11-night.webp')],
    houseBoxes: [[0.3988, 0.1944, 0.0533, 0.7792], [0.4483, 0.1944, 0.063, 0.7486], [0.4977, 0.1944, 0.0635, 0.7833], [0.5472, 0.4944, 0.0592, 0.4389], [0.5967, 0.1944, 0.056, 0.7389], [0.6473, 0.4611, 0.0583, 0.4736], [0.6955, 0.1944, 0.054, 0.7583], [0.745, 0.5139, 0.0617, 0.4431], [0.7945, 0.1944, 0.0622, 0.7597], [0.844, 0.1944, 0.0553, 0.7681], [0.8933, 0.5111, 0.0597, 0.4222], [0.943, 0.1944, 0.057, 0.7597]],
  },
};
/** The street's width over its height. */
export const TOWN_RATIO = 6000 / 720;
type At = readonly [number, number];
/** As shares of the picture: where each place stands along the street, each plot's door, the lamps' heads, the fountain's spouts by stage, the plaza's banner. */
export const TOWN_PLACES: Record<'fountain' | 'garden' | 'plaza' | 'shop' | 'hall', number> = {"fountain": 0.0262, "garden": 0.1193, "plaza": 0.2051, "shop": 0.2796, "hall": 0.3554};
export const TOWN_DOORS: readonly At[] = [[0.4215, 0.8422], [0.4719, 0.8422], [0.5223, 0.8422], [0.5727, 0.8422], [0.6231, 0.8422], [0.6735, 0.8422], [0.7239, 0.8422], [0.7743, 0.8422], [0.8248, 0.8422], [0.8752, 0.8422], [0.9256, 0.8422], [0.976, 0.8422]];
export const TOWN_LAMPS: readonly At[] = [[0.0749, 0.6757], [0.1672, 0.6757], [0.2443, 0.6757], [0.3186, 0.6757], [0.392, 0.6757], [0.4446, 0.6757], [0.5491, 0.6757], [0.6537, 0.6757], [0.7582, 0.6757], [0.8628, 0.6757], [0.9674, 0.6757]];
export const TOWN_SPRAY: readonly At[] = [[0.0477, 0.6779], [0.0464, 0.5673], [0.0449, 0.4472]];
export const TOWN_BANNER: At = [0.2168, 0.5978];
/** How far down the picture the paving is, where names stand. */
export const TOWN_PAVING = 0.938;
/** Where the land's ridge is at its highest: the sky is above this. */
export const TOWN_RIDGE = 0.2;
