import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { markSheetsLoaded, petStageArt } from '../components/PetArt';
import { petSprite } from '../petSprites';

/** Never wait longer than this: a slow download only delays the pet's drawing, the game itself does not need it. */
const ASSET_WAIT_MS = 4000;

/**
 * True once the pictures the game draws from the start (the pet's artwork, its idle strip and its move strips) are
 * loaded, so the 3-2-1 countdown never starts over an empty play field and the pet's first dart is not a still.
 */
export function useGameAssets(petId: string, petLevel: number) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const sheets = (['idle', 'moveRight', 'moveLeft'] as const).map((a) => petSprite(petId, petLevel, a)).filter((m): m is number => typeof m === 'number');
    const modules = [petStageArt(petId, petLevel), ...sheets].filter((m): m is number => typeof m === 'number');
    const timer = setTimeout(() => { if (active) setReady(true); }, ASSET_WAIT_MS);
    // Downloaded sheets show at once: a move lasts a fraction of a second, too short to wait for the picture to load.
    Asset.loadAsync(modules).then(() => markSheetsLoaded(sheets), () => {}).then(() => { if (active) setReady(true); });
    return () => { active = false; clearTimeout(timer); };
  }, [petId, petLevel]);
  return ready;
}
