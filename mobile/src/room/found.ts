import type { InventoryItem } from '../inventory/types';
import type { Catalog, FoundStack, Layout } from './types';

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

/** A decoration as Kho đồ just read it, as the room's catalog lists it. */
export const stackOf = (item: InventoryItem & { art: string }): FoundStack => ({ item: item.art, item_id: item.id, variant: item.variant, name: item.name,
  rarity: item.rarity, rarity_label: item.rarity_label, owned: item.owned, placed: item.placed, available: item.available });

/** The catalog with this stack's latest counts: the inventory may know of a decoration the room read before it arrived. */
export function withStack(catalog: Catalog, stack: FoundStack): Catalog {
  const found = catalog.found ?? [];
  const same = (f: FoundStack) => f.item === stack.item && f.variant === stack.variant;
  return { ...catalog, found: found.some(same) ? found.map((f) => (same(f) ? stack : f)) : [...found, stack] };
}

/** "Còn 1 · Đang đặt 2": what is free and what is placed, everywhere. */
export function countsLabel(available: number, placed: number): string {
  return placed > 0 ? `Còn ${available} · Đang đặt ${placed}` : `Còn ${available}`;
}
