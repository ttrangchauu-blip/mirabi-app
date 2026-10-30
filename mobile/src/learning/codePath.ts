// Lập trình đường đi: the program bar and the pet's walk. Mirrors expand / run_program / block_count in
// backend/app/curriculum_games.py. The app only animates with it: the backend checks every program that is run.
import type { Facing, Prompt } from './types';

export type Block = 'forward' | 'left' | 'right' | `repeat:${number}` | 'end';
export type Step = { x: number; y: number; dir: Facing };
export type Walk = { ok: boolean; reason: 'goal' | 'wall' | 'edge' | 'short'; path: Step[] };

const STEP: Record<Facing, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const TURN = { left: { N: 'W', W: 'S', S: 'E', E: 'N' }, right: { N: 'E', E: 'S', S: 'W', W: 'N' } } as const;
export const LOOP_MIN = 2;
export const LOOP_MAX = 9;

/** Blocks shown in the program bar: a loop counts as one (its closing bracket is not a block). */
export const blockCount = (program: Block[]) => program.filter((b) => b !== 'end').length;
export const isLoop = (b: Block): b is `repeat:${number}` => b.startsWith('repeat:');
export const loopTimes = (b: Block) => Number(b.split(':')[1]);
/** A loop is being filled: blocks go inside it until it is closed. */
export function openLoop(program: Block[]): boolean {
  for (let i = program.length - 1; i >= 0; i--) {
    if (program[i] === 'end') return false;
    if (isLoop(program[i])) return true;
  }
  return false;
}

/** The moves a program makes; null when it is not a complete program (an open or empty loop). */
export function expand(program: Block[]): Exclude<Block, 'end'>[] | null {
  const moves: Exclude<Block, 'end'>[] = [];
  let body: Exclude<Block, 'end'>[] | null = null;
  let times = 0;
  for (const b of program) {
    if (isLoop(b)) { if (body) return null; body = []; times = loopTimes(b); }
    else if (b === 'end') { if (!body?.length) return null; for (let i = 0; i < times; i++) moves.push(...body); body = null; }
    else (body ?? moves).push(b);
  }
  return body || !moves.length ? null : moves;
}

/** The pet's walk: it stops on the goal, before an obstacle or the edge, or after the last move. */
export function walk(level: Prompt, program: Block[]): Walk | null {
  const moves = expand(program);
  if (!moves || !level.start || !level.goal) return null;
  const walls = new Set((level.walls ?? []).map(([x, y]) => `${x},${y}`));
  let { x, y, dir } = level.start;
  const path: Step[] = [{ x, y, dir }];
  for (const move of moves.slice(0, 200)) {
    if (move === 'forward') {
      const nx = x + STEP[dir][0];
      const ny = y + STEP[dir][1];
      if (nx < 0 || ny < 0 || nx >= (level.cols ?? 0) || ny >= (level.rows ?? 0)) return { ok: false, reason: 'edge', path };
      if (walls.has(`${nx},${ny}`)) return { ok: false, reason: 'wall', path };
      x = nx; y = ny;
    } else {
      dir = TURN[move as 'left' | 'right'][dir];
    }
    path.push({ x, y, dir });
    if (x === level.goal.x && y === level.goal.y) return { ok: true, reason: 'goal', path };
  }
  return { ok: false, reason: 'short', path };
}

export const BLOCK_LABEL: Record<'forward' | 'left' | 'right' | 'repeat', string> = {
  forward: 'Tiến', left: 'Rẽ trái', right: 'Rẽ phải', repeat: 'Lặp lại',
};
