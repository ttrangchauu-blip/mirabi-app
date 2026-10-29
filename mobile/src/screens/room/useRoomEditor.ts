import { useCallback, useMemo, useRef, useState } from 'react';
import { keyOf } from '../../room/art';
import { addItem, Change, dragTo, flipItem, moveItem, Problem, rotateItem, storeItem } from '../../room/rules';
import type { Layout, RoomKind } from '../../room/types';

const HISTORY = 50;

/**
 * "Trang trí" for either room: a draft copy of the saved layout, the selected item, and an undo history. Every edit
 * goes through room/rules.ts; one with a problem is not applied (the problem is returned, for the screen to say why).
 * Nothing is saved here: the screen saves `draft`, or drops it. `selected` is a placement's key (`keyOf`): an item id, or
 * the uid of a found decoration's copy. A copy added here gets a temporary uid until the room is saved.
 */
export function useRoomEditor(kind: RoomKind, maxItems: number) {
  const [{ draft, history }, setState] = useState<{ draft: Layout | null; history: Layout[] }>({ draft: null, history: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const copies = useRef(0);

  const start = useCallback((layout: Layout) => {
    setState({ draft: { ...layout, items: layout.items.map((p) => ({ ...p })) }, history: [] }); setSelected(null);
  }, []);
  const stop = useCallback(() => { setState({ draft: null, history: [] }); setSelected(null); }, []);
  const commit = useCallback((next: Layout) => {
    setState((s) => (s.draft ? { draft: next, history: [...s.history.slice(-(HISTORY - 1)), s.draft] } : s));
  }, []);
  /** Applies a change unless it has a problem; returns the problem. */
  const apply = useCallback((change: Change): Problem | null => {
    if (!change.problem) commit(change.layout);
    return change.problem;
  }, [commit]);
  const undo = useCallback(() => {
    setState((s) => (s.history.length ? { draft: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : s));
  }, []);

  return useMemo(() => ({
    draft, selected, canUndo: history.length > 0,
    start, stop, undo, select: setSelected,
    /** Where an item dragged to (x, y) would land (every frame of a drag: nothing is checked or changed). */
    place: (item: string, x: number, y: number) => (draft ? dragTo(draft, item, x, y, kind) : null),
    /** The room with an item dragged to (x, y), and whether it may be dropped there. */
    preview: (item: string, x: number, y: number) => (draft ? moveItem(draft, item, x, y, kind) : null),
    move: (item: string, x: number, y: number) => (draft ? apply(moveItem(draft, item, x, y, kind)) : null),
    flip: () => (draft && selected ? apply(flipItem(draft, selected, kind)) : null),
    rotate: () => (draft && selected ? apply(rotateItem(draft, selected, kind)) : null),
    /** Recolours the selected item (a found decoration's copy keeps the colour it was found in). */
    variant: (variant: string) => {
      if (draft && selected) commit({ ...draft, items: draft.items.map((p) => (keyOf(p) === selected && !p.uid ? { ...p, variant } : p)) });
    },
    /** Back to the storage, with what stands on it: the ids stored, or the problem. */
    store: (): { stored: string[] } | { problem: Problem } | null => {
      if (!draft || !selected) return null;
      const change = storeItem(draft, selected, kind);
      if (change.problem) return { problem: change.problem };
      commit(change.layout); setSelected(null);
      return { stored: change.stored };
    },
    /** An item card: selects it when it is in the room, else adds it at a good place. */
    add: (item: string): 'selected' | 'added' | 'full' | Problem | null => {
      if (!draft) return null;
      if (draft.items.some((p) => p.item === item && !p.uid)) { setSelected(item); return 'selected'; }
      if (draft.items.length >= maxItems) return 'full';
      const change = addItem(draft, item, kind);
      if (change.problem) return change.problem;
      commit(change.layout); setSelected(item);
      return 'added';
    },
    /** One more copy of a found decoration (the screen checks a free copy is left first). */
    addCopy: (item: string, variant: string): 'added' | 'full' | Problem | null => {
      if (!draft) return null;
      if (draft.items.length >= maxItems) return 'full';
      const uid = `new-${++copies.current}`;
      const change = addItem(draft, item, kind, { variant, uid });
      if (change.problem) return change.problem;
      commit(change.layout); setSelected(uid);
      return 'added';
    },
    surface: (surface: 'wall' | 'floor', id: string) => { if (draft && draft[surface] !== id) commit({ ...draft, [surface]: id }); },
  }), [draft, selected, history.length, start, stop, undo, apply, commit, kind, maxItems]);
}

export type RoomEditor = ReturnType<typeof useRoomEditor>;
