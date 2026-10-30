/**
 * Keeps the falling words (and words held for a shot) from overlapping. Each target has a natural spot (its lane, and
 * the height its fall has reached); when it would cover another one it moves aside: first sideways to a free spot
 * (another lane or an edge), and only when the field is too narrow for that it waits just above the word below it,
 * above the top of the field if need be (out of sight until there is room). A falling word is never pushed down ahead
 * of its fall nor jumps back up: it only ever waits, then falls on. So a new word always comes in from the top.
 * Plain functions: the play field eases the displayed offsets, so a target slides aside instead of jumping.
 */

export type Box = { id: string; left: number; top: number; width: number; height: number };
export type Spot = { left: number; top: number };

/** Space kept between two targets. */
export const GAP = 6;
/** The field's side margin. */
export const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hits = (a: Box, b: Box) =>
  a.left < b.left + b.width + GAP && b.left < a.left + a.width + GAP && a.top < b.top + b.height + GAP && b.top < a.top + a.height + GAP;

/** Lanes spread over the whole width (left edges of `laneWidth`-wide lanes), at least one. */
export function laneLefts(width: number, laneWidth: number): number[] {
  const count = Math.max(1, Math.floor((width - 2 * MARGIN + GAP) / (laneWidth + GAP)));
  if (count === 1) return [Math.max(MARGIN, (width - laneWidth) / 2)];
  const pitch = (width - 2 * MARGIN - laneWidth) / (count - 1);
  return Array.from({ length: count }, (_, i) => MARGIN + i * pitch);
}

/**
 * Where every box in `items` goes, clear of `fixed` (words held for a shot: they never move) and of the boxes placed
 * before it. Give `items` from the ground up (the word closest to the ground first): a word higher up then waits above
 * the ones below. `laneCentres` are the spots worth trying first; `field` bounds everything.
 */
export function resolveOverlaps(fixed: Box[], items: Box[], laneCentres: number[], field: { width: number; height: number }): Map<string, Spot> {
  const placed: Box[] = [...fixed];
  const out = new Map<string, Spot>();
  for (const item of items) {
    const maxLeft = Math.max(MARGIN, field.width - item.width - MARGIN);
    const maxTop = Math.max(0, field.height - item.height);
    const at = (left: number, top: number, minTop = 0): Box => ({ ...item, left: clamp(left, MARGIN, maxLeft), top: clamp(top, minTop, maxTop) });
    const hidden = -item.height - GAP; // just above the field, out of sight
    let box = at(item.left, item.top);
    if (placed.some((p) => hits(box, p))) {
      // Sideways first: every lane, both edges and right beside each blocking box, the nearest free one.
      const xs = [...laneCentres.map((c) => c - item.width / 2), MARGIN, maxLeft,
        ...placed.flatMap((p) => [p.left - item.width - GAP, p.left + p.width + GAP])];
      const free = xs.map((x) => at(x, item.top)).filter((b) => !placed.some((p) => hits(b, p)))
        .sort((a, b) => Math.abs(a.left - item.left) - Math.abs(b.left - item.left))[0];
      if (free) box = free;
      else {
        // No room beside: it waits just above whatever it would cover, above the field's top if need be. Never below:
        // a word is not pushed ahead of its fall.
        for (let i = 0; i <= placed.length && placed.some((p) => hits(box, p)); i++) {
          const blocking = placed.filter((p) => hits(box, p));
          box = at(box.left, Math.min(box.top, Math.min(...blocking.map((p) => p.top)) - item.height - GAP), hidden);
          if (box.top <= hidden) break; // out of sight: it comes in once there is room
        }
      }
    }
    placed.push(box);
    out.set(item.id, { left: box.left, top: box.top });
  }
  return out;
}
