import { ImageSourcePropType } from 'react-native';
import { petById, PetId } from './pets';

/** What a pet is doing that has its own drawn animation. `idle` is the pet just standing around (blinking, waving). */
export type PetActivity = 'walk' | 'study' | 'idle';

/** Each sheet is a `cols` x `rows` grid of square frames, played left to right then top to bottom, cut from an
 * element's sheet by scripts/slice-sprite-sheet.mjs. `cycleMs` is one full loop: a relaxed stride, a slow breath over
 * the book, an unhurried round of blinks, waves and smiles. */
export type SpriteLayout = { cols: number; rows: number; cycleMs: number };
export const SPRITE_LAYOUT: Record<PetActivity, SpriteLayout> = {
  walk: { cols: 8, rows: 1, cycleMs: 1200 },
  study: { cols: 8, rows: 1, cycleMs: 2400 },
  idle: { cols: 8, rows: 4, cycleMs: 4800 },
};
export const WALK_CYCLE_MS = SPRITE_LAYOUT.walk.cycleMs;

/** Sheets per activity and pet, indexed by evolution stage (Lv.0 to Lv.6). A pet or stage without one keeps its
 * still artwork with PetArt's own motion. */
const SPRITES: Record<PetActivity, Partial<Record<PetId, (ImageSourcePropType | undefined)[]>>> = {
  walk: {
    penguin: [
      require('../assets/pets/ice/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/ice/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/ice/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/ice/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/ice/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/ice/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/ice/walk/Lv6_Vua_Bang_Walk.png'),
    ],
    turtle: [
      require('../assets/pets/grass/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/grass/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/grass/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/grass/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/grass/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/grass/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/grass/walk/Lv6_Vua_Co_Walk.png'),
    ],
    dolphin: [
      require('../assets/pets/water/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/water/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/water/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/water/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/water/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/water/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/water/walk/Lv6_Vua_Nuoc_Walk.png'),
    ],
    bunny: [
      require('../assets/pets/electric/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/electric/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/electric/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/electric/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/electric/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/electric/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/electric/walk/Lv6_Vua_Dien_Walk.png'),
    ],
    fox: [
      require('../assets/pets/fire/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/fire/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/fire/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/fire/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/fire/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/fire/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/fire/walk/Lv6_Vua_Lua_Walk.png'),
    ],
    cat: [
      require('../assets/pets/mist/walk/Lv0_Trung_Pet_Walk.png'),
      require('../assets/pets/mist/walk/Lv1_So_Sinh_Walk.png'),
      require('../assets/pets/mist/walk/Lv2_Phat_Trien_Walk.png'),
      require('../assets/pets/mist/walk/Lv3_Nang_Cao_Walk.png'),
      require('../assets/pets/mist/walk/Lv4_Truong_Thanh_Walk.png'),
      require('../assets/pets/mist/walk/Lv5_Dai_Than_Walk.png'),
      require('../assets/pets/mist/walk/Lv6_Vua_Suong_Walk.png'),
    ],
  },
  study: {
    penguin: [
      require('../assets/pets/ice/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/ice/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/ice/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/ice/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/ice/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/ice/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/ice/study/Lv6_Vua_Bang_Study.png'),
    ],
    turtle: [
      require('../assets/pets/grass/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/grass/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/grass/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/grass/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/grass/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/grass/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/grass/study/Lv6_Vua_Co_Study.png'),
    ],
    dolphin: [
      require('../assets/pets/water/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/water/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/water/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/water/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/water/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/water/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/water/study/Lv6_Vua_Nuoc_Study.png'),
    ],
    bunny: [
      require('../assets/pets/electric/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/electric/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/electric/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/electric/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/electric/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/electric/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/electric/study/Lv6_Vua_Dien_Study.png'),
    ],
    fox: [
      require('../assets/pets/fire/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/fire/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/fire/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/fire/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/fire/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/fire/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/fire/study/Lv6_Vua_Lua_Study.png'),
    ],
    cat: [
      require('../assets/pets/mist/study/Lv0_Trung_Pet_Study.png'),
      require('../assets/pets/mist/study/Lv1_So_Sinh_Study.png'),
      require('../assets/pets/mist/study/Lv2_Phat_Trien_Study.png'),
      require('../assets/pets/mist/study/Lv3_Nang_Cao_Study.png'),
      require('../assets/pets/mist/study/Lv4_Truong_Thanh_Study.png'),
      require('../assets/pets/mist/study/Lv5_Dai_Than_Study.png'),
      require('../assets/pets/mist/study/Lv6_Vua_Suong_Study.png'),
    ],
  },
  idle: {
    penguin: [
      require('../assets/pets/ice/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/ice/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/ice/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/ice/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/ice/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/ice/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/ice/idle/Lv6_Vua_Bang_Idle.png'),
    ],
    turtle: [
      require('../assets/pets/grass/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/grass/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/grass/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/grass/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/grass/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/grass/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/grass/idle/Lv6_Vua_Co_Idle.png'),
    ],
    dolphin: [
      require('../assets/pets/water/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/water/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/water/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/water/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/water/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/water/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/water/idle/Lv6_Vua_Nuoc_Idle.png'),
    ],
    bunny: [
      require('../assets/pets/electric/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/electric/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/electric/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/electric/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/electric/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/electric/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/electric/idle/Lv6_Vua_Dien_Idle.png'),
    ],
    fox: [
      require('../assets/pets/fire/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/fire/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/fire/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/fire/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/fire/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/fire/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/fire/idle/Lv6_Vua_Lua_Idle.png'),
    ],
    cat: [
      require('../assets/pets/mist/idle/Lv0_Trung_Pet_Idle.png'),
      require('../assets/pets/mist/idle/Lv1_So_Sinh_Idle.png'),
      require('../assets/pets/mist/idle/Lv2_Phat_Trien_Idle.png'),
      require('../assets/pets/mist/idle/Lv3_Nang_Cao_Idle.png'),
      require('../assets/pets/mist/idle/Lv4_Truong_Thanh_Idle.png'),
      require('../assets/pets/mist/idle/Lv5_Dai_Than_Idle.png'),
      require('../assets/pets/mist/idle/Lv6_Vua_Suong_Idle.png'),
    ],
  },
};

/** The egg hatching (Lv.0 to Lv.1): cracks spreading over the shell, played once. A pet without a sheet here hatches
 * from its still egg artwork instead (see PetHatch). */
export const HATCH_LAYOUT: SpriteLayout = { cols: 8, rows: 1, cycleMs: 2600 };
const HATCH: Partial<Record<PetId, ImageSourcePropType>> = {
  dolphin: require('../assets/pets/water/hatch/Lv0_Trung_Pet_Hatch.png'),
  fox: require('../assets/pets/fire/hatch/Lv0_Trung_Pet_Hatch.png'),
  turtle: require('../assets/pets/grass/hatch/Lv0_Trung_Pet_Hatch.png'),
  penguin: require('../assets/pets/ice/hatch/Lv0_Trung_Pet_Hatch.png'),
  bunny: require('../assets/pets/electric/hatch/Lv0_Trung_Pet_Hatch.png'),
  cat: require('../assets/pets/mist/hatch/Lv0_Trung_Pet_Hatch.png'),
};
export const petHatchSprite = (petId: string | null | undefined) => HATCH[petById(petId).id];

/** Evolution stage clamped to the drawn ones, Lv.0 to Lv.6. */
export const stageIndex = (stage: number) => Number.isFinite(stage) ? Math.max(0, Math.min(6, Math.floor(stage))) : 1;

export const petSprite = (petId: string | null | undefined, stage: number, activity: PetActivity) =>
  SPRITES[activity][petById(petId).id]?.[stageIndex(stage)];

/** Whether the pet has a drawn strip for this, so callers can drop props or motion the strip already includes. */
export const hasSprite = (petId: string | null | undefined, stage: number, activity: PetActivity) =>
  !!petSprite(petId, stage, activity);
