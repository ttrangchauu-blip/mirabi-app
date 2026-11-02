// The rules the subject gameplays follow on the device (backend app/lesson_games.py decides every answer): where a
// card may go, what an angle or a rectangle measures, how many atoms each side of an equation has. Pure functions, so
// they are tested without drawing anything (__tests__/subject-games.test.tsx).

// --- Hành trình dòng thời gian -----------------------------------------------------------------------------------

export type Marker = { id: string; label: string; slots: number };
/** event id → marker id */
export type Placement = Record<string, string>;

export const markerLoad = (placed: Placement, marker: string) => Object.values(placed).filter((m) => m === marker).length;

/** Puts an event on a marker (or the first marker with room), never over a marker's places. Placing an event that is
 * already on the timeline moves it. Unknown markers and full markers leave everything as it was. */
export function placeEvent(placed: Placement, markers: Marker[], event: string, marker?: string): Placement {
  const { [event]: _moved, ...rest } = placed;
  const target = marker ? markers.find((m) => m.id === marker) : markers.find((m) => markerLoad(rest, m.id) < m.slots);
  if (!target || markerLoad(rest, target.id) >= target.slots) return placed;
  return { ...rest, [event]: target.id };
}

export const timelineFull = (placed: Placement, markers: Marker[]) => markers.every((m) => markerLoad(placed, m.id) === m.slots);
export const timelineAnswer = (placed: Placement) => Object.entries(placed).map(([event, marker]) => `${marker}:${event}`);
/** After a wrong answer, the backend's kept "m2:e1": what stays where it is. */
export const keptPlacement = (kept: string[] | null | undefined): Placement =>
  Object.fromEntries((kept ?? []).map((token) => token.split(':')).filter((p) => p.length === 2).map(([m, e]) => [e, m]));

// --- Xây câu --------------------------------------------------------------------------------------------------------

/** Puts a tile on the first free place of the line; a tile already on it is not placed twice. */
export function placeTile(line: (string | null)[], tile: string): (string | null)[] {
  if (line.includes(tile)) return line;
  const free = line.indexOf(null);
  if (free < 0) return line;
  const next = [...line];
  next[free] = tile;
  return next;
}

/** Takes a tile off the line: its wagon is empty again, the others stay where they are; locked ones never move. */
export function removeTile(line: (string | null)[], index: number, locked: number): (string | null)[] {
  if (index < locked || !line[index]) return line;
  return line.map((id, i) => (i === index ? null : id));
}

// --- Xưởng hình học -------------------------------------------------------------------------------------------------

/** The angle (0–180°, on the protractor's steps) of a point dragged around the vertex; below the baseline it stays at
 * the nearest end (0° on the right, 180° on the left). */
export function angleAt(dx: number, dy: number, step: number): number {
  let deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (deg < 0) deg = dx >= 0 ? 0 : 180;
  return Math.max(0, Math.min(180, Math.round(deg / step) * step));
}

export function armEnd(cx: number, cy: number, radius: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(r), y: cy - radius * Math.sin(r) };
}

export const clampStep = (value: number, step: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(value / step) * step));

/** The kind of an angle, as shown once it is checked (never before: it is what some tasks ask). */
export const angleKind = (deg: number) => (deg === 0 ? 'chưa có góc' : deg < 90 ? 'góc nhọn' : deg === 90 ? 'góc vuông' : deg < 180 ? 'góc tù' : 'góc bẹt');

/** The rectangle's size from the corner dragged on the grid (cells of `cell` px), within 1…cols × 1…rows. */
export function rectAt(x: number, y: number, cell: number, cols: number, rows: number): [number, number] {
  return [Math.max(1, Math.min(cols, Math.round(x / cell))), Math.max(1, Math.min(rows, Math.round(y / cell)))];
}

// --- Cân bằng phương trình -----------------------------------------------------------------------------------------

export type Species = { id: string; formula: string; side: 'left' | 'right'; atoms: Record<string, number> };

/** element → [atoms on the left, atoms on the right] for these coefficients. */
export function atomCounts(species: Species[], coefficients: number[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  species.forEach((s, i) => {
    for (const [el, n] of Object.entries(s.atoms)) {
      const row = (out[el] ??= [0, 0]);
      row[s.side === 'left' ? 0 : 1] += n * (coefficients[i] ?? 1);
    }
  });
  return out;
}

export const balanced = (counts: Record<string, [number, number]>) => Object.values(counts).every(([a, b]) => a === b);

/** How far the balance leans (−1 left heavier … 1 right heavier), from the atoms on each side; level when they match. */
export function tilt(counts: Record<string, [number, number]>): number {
  let left = 0;
  let right = 0;
  for (const [a, b] of Object.values(counts)) { left += a; right += b; }
  if (balanced(counts)) return 0;
  const diff = (right - left) / Math.max(1, left + right);
  // Unequal elements with equal totals still lean a little: never level unless it is balanced.
  return Math.max(-1, Math.min(1, diff === 0 ? 0.08 : diff * 2.5));
}

/** A formula as text and subscript runs: "Ca(OH)2" → Ca, (OH), ₂ … */
export function formulaParts(formula: string): { text: string; sub: boolean }[] {
  return (formula.match(/\d+|[^\d]+/g) ?? []).map((text) => ({ text, sub: /^\d+$/.test(text) }));
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';
export const subscript = (formula: string) => formula.replace(/\d/g, (d) => SUB[Number(d)]);

export function equationText(species: Species[], coefficients: number[]): string {
  const side = (name: 'left' | 'right') => species.map((s, i) => [s, coefficients[i] ?? 1] as const).filter(([s]) => s.side === name)
    .map(([s, c]) => `${c === 1 ? '' : c}${subscript(s.formula)}`).join(' + ');
  return `${side('left')} → ${side('right')}`;
}

/** One colour per element, the usual model-kit colours where there is one. */
export const ATOM_COLOR: Record<string, string> = { H: '#F4F6F8', O: '#E8534A', C: '#3D3D46', N: '#4A78E8', Cl: '#4CC36B', Na: '#9B6BD8',
  Mg: '#3FAF8F', Al: '#A9B4C2', Fe: '#C9762C', Zn: '#7F8FA6', K: '#B05BD1', Ca: '#6FB86F', P: '#F29B38', S: '#F2D33A', Cu: '#D9824A' };
export const atomColor = (el: string) => ATOM_COLOR[el] ?? '#C7B8F0';

// --- Cầu trục số -----------------------------------------------------------------------------------------------

export type Ticks = Record<string, number>;
/** The tick under a finger `x` pixels along a line `width` wide with ticks 0..`ticks`. */
export const tickAt = (x: number, width: number, ticks: number) => Math.max(0, Math.min(ticks, Math.round((x / Math.max(width, 1)) * ticks)));
export const numberLineAnswer = (placed: Ticks) => Object.entries(placed).map(([point, tick]) => `${point}:${tick}`);
export const keptTicks = (kept: string[] | null | undefined): Ticks =>
  Object.fromEntries((kept ?? []).map((k) => k.split(':')).map(([point, tick]) => [point, Number(tick)]));

// --- Giải toán từng bước ---------------------------------------------------------------------------------------

export type Calc = { left: string | null; op: string | null; right: string | null };
export const OPERATORS = ['+', '−', '×', ':'] as const;
/** A chip goes in the first empty side; tapping a chip already used takes it out. */
export function pickChip(calc: Calc, chip: string): Calc {
  if (calc.left === chip) return { ...calc, left: null };
  if (calc.right === chip) return { ...calc, right: null };
  if (!calc.left) return { ...calc, left: chip };
  if (!calc.right) return { ...calc, right: chip };
  return { ...calc, right: chip };
}
/** What can be typed as a result: digits, one decimal comma, one fraction bar, a leading minus. */
export function typedNumber(text: string): string {
  let out = text.replace(/[^\d,/−-]/g, '').replace(/-/g, '−');
  out = out.replace(/(?!^)−/g, '');
  const firstComma = out.indexOf(',');
  if (firstComma >= 0) out = out.slice(0, firstComma + 1) + out.slice(firstComma + 1).replace(/,/g, '');
  const firstBar = out.indexOf('/');
  if (firstBar >= 0) out = out.slice(0, firstBar + 1) + out.slice(firstBar + 1).replace(/\//g, '');
  return out.slice(0, 12);
}
export const stepAnswer = (calc: Calc, result: string) => [calc.left ?? '', calc.op === '−' ? '-' : calc.op ?? '', calc.right ?? '',
  result.replace('−', '-')];
export const calcReady = (calc: Calc, result: string) => !!calc.left && !!calc.op && !!calc.right && /\d/.test(result);

// --- Soi câu -----------------------------------------------------------------------------------------------------

export type Paint = Record<string, string>; // piece → highlighter
/** Painting a piece with the highlighter in hand; the same colour again clears it. Locked pieces never change. */
export function paintWord(paint: Paint, word: string, colour: string, locked: Paint = {}): Paint {
  if (locked[word]) return paint;
  const next = { ...paint };
  if (next[word] === colour) delete next[word];
  else next[word] = colour;
  return next;
}
export const paintAnswer = (paint: Paint) => {
  const pairs = Object.entries(paint).map(([word, colour]) => `${word}:${colour}`);
  return pairs.length ? pairs : ['none'];
};
export const keptPaint = (kept: string[] | null | undefined): Paint =>
  Object.fromEntries((kept ?? []).map((k) => k.split(':') as [string, string]));
/** The highlighter colours, in order (c1, c2, c3): light fill, ink. */
export const HIGHLIGHTERS: { fill: string; ink: string }[] = [
  { fill: '#BFE6FF', ink: '#0F5C8C' }, { fill: '#FFD7A8', ink: '#9A4A00' }, { fill: '#D7F2C2', ink: '#2F6B12' }];
