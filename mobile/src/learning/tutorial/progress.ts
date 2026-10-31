import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { learningApi } from '../api';
import type { GameId } from '../types';
import { tutorialApi, TutorialProgress } from './api';
import type { TutorialDefinition } from './registry';

type Done = { status: 'completed' | 'skipped'; tutorial_version: number; gameplay_version: number };
type Unsent = { game: GameId; status: Done['status']; tutorial_version: number; gameplay_version: number; steps_done: string[] };
type Stored = { done: Partial<Record<GameId, Done>>; unsent: Unsent[] };

export type TutorialProgressApi = {
  /** The game's tutorial is still to play before the game (unknown: yes, seeing it twice beats never). */
  needs: (game: GameId) => boolean;
  /** Played to its end, every hands-on step done. */
  finish: (def: TutorialDefinition, stepsDone: string[]) => void;
  /** "Bỏ qua": not asked for again, but recorded as skipped (never as completed). */
  skip: (def: TutorialDefinition) => void;
  /** Left before its end at this step: it is asked for again next time. */
  left: (def: TutorialDefinition, step: number) => void;
  /** The game has no tutorial yet ("Chơi luôn" after "Hướng dẫn chưa sẵn sàng"): not said again until the app restarts. */
  dismiss: (game: GameId) => void;
};

/**
 * Which games' interactive tutorials this account still has to play. The server keeps it per account (so a tutorial
 * finished on one device is not asked for on another) and asks again when a tutorial or its gameplay changes; the
 * device keeps a copy per account, so one finished offline is not asked for again and is sent later. An older server
 * without interactive tutorials answers with its guides' list instead (a guide read there counts).
 */
export function useTutorialProgress(userId: number): TutorialProgressApi {
  const key = `mirabi.learning.tutorials.interactive:${userId}`;
  const [server, setServer] = useState<Partial<Record<GameId, TutorialProgress>> | null>(null);
  const [legacy, setLegacy] = useState<ReadonlySet<GameId> | null>(null);
  const [, setVersion] = useState(0);
  const stored = useRef<Stored>({ done: {}, unsent: [] });
  const dismissed = useRef(new Set<GameId>());
  const save = useCallback(() => {
    setVersion((v) => v + 1);
    void AsyncStorage.setItem(key, JSON.stringify(stored.current)).catch(() => {});
  }, [key]);

  const send = useCallback(async (u: Unsent) => {
    if (u.status === 'completed') {
      await tutorialApi.complete(u.game, { tutorial_version: u.tutorial_version, gameplay_version: u.gameplay_version, steps_done: u.steps_done });
    } else {
      await tutorialApi.saveProgress(u.game, { tutorial_version: u.tutorial_version, current_step: 0, status: 'skipped' });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(key);
        const local: Partial<Stored> = raw ? JSON.parse(raw) : {};
        stored.current = { done: { ...(local.done ?? {}), ...stored.current.done }, unsent: local.unsent ?? [] };
      } catch { /* a corrupt copy is ignored: the server knows */ }
      try {
        for (const u of stored.current.unsent) await send(u).catch((e) => { if ((e as { status?: number })?.status === 409) return; throw e; });
        stored.current = { ...stored.current, unsent: [] };
        const all = await tutorialApi.allProgress();
        if (!active) return;
        if (Object.keys(all).length) setServer(all);
        else setLegacy(new Set(await learningApi.tutorials())); // an older server: its guides' list
      } catch { /* offline: the device copy decides until the next load */ }
      if (active) save();
    })();
    return () => { active = false; };
  }, [key, save, send]);

  const needs = useCallback((game: GameId) => {
    if (dismissed.current.has(game)) return false;
    const local = stored.current.done[game];
    const p = server?.[game];
    if (p) return p.required && !(local && local.tutorial_version >= p.tutorial_version && local.gameplay_version >= p.gameplay_version);
    if (legacy?.has(game)) return false;
    return !local;
  }, [server, legacy]);

  const record = useCallback((def: TutorialDefinition, status: Done['status'], stepsDone: string[]) => {
    const game = def.game_id;
    const was = stored.current.done[game];
    if (status === 'skipped' && was?.status === 'completed' && was.tutorial_version >= def.tutorial_version) return; // never undone
    const done: Done = { status, tutorial_version: def.tutorial_version, gameplay_version: def.gameplay_version };
    const u: Unsent = { game, status, tutorial_version: def.tutorial_version, gameplay_version: def.gameplay_version, steps_done: stepsDone };
    stored.current = { ...stored.current, done: { ...stored.current.done, [game]: done } };
    save();
    send(u).catch((e) => {
      if ((e as { status?: number })?.status && (e as { status: number }).status < 500) return; // refused (outdated): nothing to resend
      stored.current = { ...stored.current, unsent: [...stored.current.unsent.filter((x) => x.game !== game), u] };
      save();
    });
  }, [save, send]);

  const finish = useCallback((def: TutorialDefinition, stepsDone: string[]) => record(def, 'completed', stepsDone), [record]);
  const skip = useCallback((def: TutorialDefinition) => record(def, 'skipped', []), [record]);
  const left = useCallback((def: TutorialDefinition, step: number) => {
    void tutorialApi.saveProgress(def.game_id, { tutorial_version: def.tutorial_version, current_step: step, status: 'in_progress' }).catch(() => {});
  }, []);

  const dismiss = useCallback((game: GameId) => { dismissed.current.add(game); }, []);

  return useMemo(() => ({ needs, finish, skip, left, dismiss }), [needs, finish, skip, left, dismiss]);
}
