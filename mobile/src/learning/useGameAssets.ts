import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { petStageArt } from '../components/PetArt';
import { petSprite } from '../petSprites';

/** Never wait longer than this: a slow download only delays the pet's drawing, the game itself does not need it. */
const ASSET_WAIT_MS = 4000;

/**
 * True once the pictures the game draws from the start (the pet's artwork and its idle strip) are loaded, so the
 * 3-2-1 countdown never starts over an empty play field.
 */
export function useGameAssets(petId: string, petLevel: number) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const modules = [petStageArt(petId, petLevel), petSprite(petId, petLevel, 'idle')].filter((m): m is number => typeof m === 'number');
    const timer = setTimeout(() => { if (active) setReady(true); }, ASSET_WAIT_MS);
    Asset.loadAsync(modules).catch(() => {}).then(() => { if (active) setReady(true); });
    return () => { active = false; clearTimeout(timer); };
  }, [petId, petLevel]);
  return ready;
}
