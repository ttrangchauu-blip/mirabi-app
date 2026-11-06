/** A subject's map: the top of the hillside (half as tall as it is wide), then a square that repeats going down. */
export const TRAIL_TOP = { day: require('../../../assets/world/learn/trail-top-day.webp'), night: require('../../../assets/world/learn/trail-top-night.webp') };
export const TRAIL_TILE = { day: require('../../../assets/world/learn/trail-tile-day.webp'), night: require('../../../assets/world/learn/trail-tile-night.webp') };
/** Where the hillside's ridge is, as a share of its top part. */
export const TRAIL_RIDGE = 0.18;
/** A point of the map by its state, and the stones between two points. A point's picture is square; its face is centred at this share of its height. */
export const POINT = {
  LOCKED: { day: require('../../../assets/world/learn/point-locked-day.webp'), night: require('../../../assets/world/learn/point-locked-night.webp') },
  UNLOCKED: { day: require('../../../assets/world/learn/point-open-day.webp'), night: require('../../../assets/world/learn/point-open-night.webp') },
  IN_PROGRESS: { day: require('../../../assets/world/learn/point-doing-day.webp'), night: require('../../../assets/world/learn/point-doing-night.webp') },
  COMPLETED: { day: require('../../../assets/world/learn/point-done-day.webp'), night: require('../../../assets/world/learn/point-done-night.webp') },
};
export const POINT_FACE = 0.39;
export const STEPS = [{ day: require('../../../assets/world/learn/step-0-day.webp'), night: require('../../../assets/world/learn/step-0-night.webp') }, { day: require('../../../assets/world/learn/step-1-day.webp'), night: require('../../../assets/world/learn/step-1-night.webp') }];
