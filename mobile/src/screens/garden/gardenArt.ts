import type { ImageSourcePropType } from 'react-native';

type Stages = { day: ImageSourcePropType[]; night: ImageSourcePropType[] };

/** The home garden's rendered pictures (`scripts/render-scenes`). */
export const YARD = { day: require('../../../assets/world/yard/land-day.webp'), night: require('../../../assets/world/yard/land-night.webp') };
export const BED = {
  dry: { day: require('../../../assets/world/yard/bed-dry-day.webp'), night: require('../../../assets/world/yard/bed-dry-night.webp') },
  wet: { day: require('../../../assets/world/yard/bed-wet-day.webp'), night: require('../../../assets/world/yard/bed-wet-night.webp') },
};
/** What moves over the land, each from its foot: boxes as shares of the land's picture (`cut-yard.mjs` prints them), its own time and how far it bends. */
export const YARD_SWAY: { day: ImageSourcePropType; night: ImageSourcePropType; x: number; y: number; w: number; h: number; ms: number; depth: number; low?: boolean }[] = [
  { day: require('../../../assets/world/yard/treeL-day.webp'), night: require('../../../assets/world/yard/treeL-night.webp'), x: 0, y: 0.0633, w: 0.182, h: 0.1513, ms: 3400, depth: 0.7 },
  { day: require('../../../assets/world/yard/treeR-day.webp'), night: require('../../../assets/world/yard/treeR-night.webp'), x: 0.82, y: 0.0573, w: 0.165, h: 0.1553, ms: 3900, depth: 0.65 },
  { day: require('../../../assets/world/yard/blossom-day.webp'), night: require('../../../assets/world/yard/blossom-night.webp'), x: 0.672, y: 0.086, w: 0.134, h: 0.1247, ms: 3100, depth: 0.9 },
  { day: require('../../../assets/world/yard/flowersL-day.webp'), night: require('../../../assets/world/yard/flowersL-night.webp'), x: 0, y: 0.5427, w: 0.194, h: 0.1033, ms: 2300, depth: 2.6, low: true },
  { day: require('../../../assets/world/yard/flowersR-day.webp'), night: require('../../../assets/world/yard/flowersR-night.webp'), x: 0.805, y: 0.5427, w: 0.195, h: 0.0927, ms: 2700, depth: 2.4, low: true },
];
/** The clouds, and their height over their width. */
export const CLOUDS: { day: ImageSourcePropType; night: ImageSourcePropType; tall: number }[] = [
  { day: require('../../../assets/world/yard/cloud-0-day.webp'), night: require('../../../assets/world/yard/cloud-0-night.webp'), tall: 0.582 },
  { day: require('../../../assets/world/yard/cloud-1-day.webp'), night: require('../../../assets/world/yard/cloud-1-night.webp'), tall: 0.681 },
  { day: require('../../../assets/world/yard/cloud-2-day.webp'), night: require('../../../assets/world/yard/cloud-2-night.webp'), tall: 0.540 },
];
const PLANTS: Record<string, Stages> = {
  seed_daisy: { day: [require('../../../assets/world/yard/daisy-0-day.webp'), require('../../../assets/world/yard/daisy-1-day.webp'), require('../../../assets/world/yard/daisy-2-day.webp')], night: [require('../../../assets/world/yard/daisy-0-night.webp'), require('../../../assets/world/yard/daisy-1-night.webp'), require('../../../assets/world/yard/daisy-2-night.webp')] },
  seed_sunflower: { day: [require('../../../assets/world/yard/sunflower-0-day.webp'), require('../../../assets/world/yard/sunflower-1-day.webp'), require('../../../assets/world/yard/sunflower-2-day.webp')], night: [require('../../../assets/world/yard/sunflower-0-night.webp'), require('../../../assets/world/yard/sunflower-1-night.webp'), require('../../../assets/world/yard/sunflower-2-night.webp')] },
  seed_tulip: { day: [require('../../../assets/world/yard/tulip-0-day.webp'), require('../../../assets/world/yard/tulip-1-day.webp'), require('../../../assets/world/yard/tulip-2-day.webp')], night: [require('../../../assets/world/yard/tulip-0-night.webp'), require('../../../assets/world/yard/tulip-1-night.webp'), require('../../../assets/world/yard/tulip-2-night.webp')] },
  seed_lavender: { day: [require('../../../assets/world/yard/lavender-0-day.webp'), require('../../../assets/world/yard/lavender-1-day.webp'), require('../../../assets/world/yard/lavender-2-day.webp')], night: [require('../../../assets/world/yard/lavender-0-night.webp'), require('../../../assets/world/yard/lavender-1-night.webp'), require('../../../assets/world/yard/lavender-2-night.webp')] },
  seed_succulent: { day: [require('../../../assets/world/yard/succulent-0-day.webp'), require('../../../assets/world/yard/succulent-1-day.webp'), require('../../../assets/world/yard/succulent-2-day.webp')], night: [require('../../../assets/world/yard/succulent-0-night.webp'), require('../../../assets/world/yard/succulent-1-night.webp'), require('../../../assets/world/yard/succulent-2-night.webp')] },
  seed_strawberry: { day: [require('../../../assets/world/yard/strawberry-0-day.webp'), require('../../../assets/world/yard/strawberry-1-day.webp'), require('../../../assets/world/yard/strawberry-2-day.webp')], night: [require('../../../assets/world/yard/strawberry-0-night.webp'), require('../../../assets/world/yard/strawberry-1-night.webp'), require('../../../assets/world/yard/strawberry-2-night.webp')] },
  seedling: { day: [require('../../../assets/world/yard/seedling-0-day.webp'), require('../../../assets/world/yard/seedling-1-day.webp'), require('../../../assets/world/yard/seedling-2-day.webp')], night: [require('../../../assets/world/yard/seedling-0-night.webp'), require('../../../assets/world/yard/seedling-1-night.webp'), require('../../../assets/world/yard/seedling-2-night.webp')] },
};
/** The yard's height over its width, and where its ridge is, as a share of its height. */
export const YARD_TALL = 1.5;
export const YARD_RIDGE = 0.06;
/** Shares of its height too: the top of its far hills, the foot of its fence and the end of its pond. */
export const YARD_HILLTOP = 0.008;
export const YARD_FENCE = 0.201;
export const YARD_POND_END = 0.259;
/** Across its height: where the pet walks behind the fence, and in front of it. Across its width: the open gate, how far
 * the lawn behind the fence runs between its nearest trees, and where the pond ends. */
export const YARD_LAWN = 0.188;
export const YARD_FRONT = 0.247;
export const YARD_GATE_X = 0.537;
export const YARD_LAWN_X = [0.22, 0.78] as const;
export const YARD_POND_RIGHT = 0.37;
/** A plot's height over its width, and above its foot, as shares of its width: where its soil's far edge is and the middle of the soil. */
export const BED_TALL = 0.5;
export const BED_FRAME_TOP = 0.37;
export const BED_SOIL = 0.235;
/** A plant's picture over its width; its foot is at FOOT of its height from the top. */
export const PLANT_TALL = 1.4;
export const PLANT_FOOT = 0.79;
/** A seed's plant at its stage (0 sprout, 1 growing, 2 grown); an unknown seed grows as a seedling. */
export const plantArt = (itemId: string, stage: number, night = false) => {
  const stages = PLANTS[itemId] ?? PLANTS.seedling;
  return stages[night ? 'night' : 'day'][Math.max(0, Math.min(2, stage))];
};
