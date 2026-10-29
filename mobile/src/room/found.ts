import type { FoundStack, Layout } from './types';

/**
 * Found decorations in a room being decorated. The backend counts a copy as placed once the room is saved
 * (`FoundStack.placed`); the draft adds copies (temporary uids) and stores others, so what is free right now is what
 * was free, plus this room's saved copies, minus this room's copies in the draft.
 */
const copiesIn = (layout: Layout, stack: Pick<FoundStack, 'item' | 'variant'>) =>
  layout.items.filter((p) => p.uid && p.item === stack.item && p.variant === stack.variant).length;

export function placedHere(stack: Pick<FoundStack, 'item' | 'variant'>, draft: Layout): number {
  return copiesIn(draft, stack);
}

export function freeCopies(stack: FoundStack, saved: Layout, draft: Layout): number {
  return Math.max(0, stack.available + copiesIn(saved, stack) - copiesIn(draft, stack));
}

/** "Còn 1 · Đang đặt 2": what is free and what is placed, everywhere. */
export function countsLabel(available: number, placed: number): string {
  return placed > 0 ? `Còn ${available} · Đang đặt ${placed}` : `Còn ${available}`;
}
