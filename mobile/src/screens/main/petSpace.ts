import type { WalkStatus } from './shared';

/** What /api/pet/space says about the pet's walk, read the same way wherever the walk is shown. */
export type FoundItem = { id?: string; name: string; emoji: string };
export type PetSpace = { status: WalkStatus; seconds_left: number; walk_minutes: number; started_at?: string | null; return_at?: string | null; server_now?: string; task_cycle_id?: string | null; last_find?: FoundItem | null; collection: { id: string; name: string; emoji: string; count: number }[] };

/** Server times are UTC. Older backends sent them without an offset, which JS would read as local time. */
function serverTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizePetSpace(value: any): PetSpace | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.collection)) return null;
  const aliases: Record<string, WalkStatus> = {
    locked: 'locked', idle: 'locked', ready: 'ready', waiting_hatch: 'waiting_hatch', walking: 'walking', exploring: 'walking',
    returned: 'returned', return_ready: 'returned', returning: 'returned', rested: 'rested', completed: 'rested',
  };
  const returnAt = serverTime(value.return_at ?? value.returns_at);
  const rawStatus = String(value.status ?? value.state ?? '').toLowerCase();
  const status = aliases[rawStatus] ?? (returnAt && new Date(returnAt).getTime() > Date.now() ? 'walking' : 'locked');
  const minutes = Number(value.walk_minutes);
  const serverNowIso = serverTime(value.server_now);
  const serverNow = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();
  const fromReturnAt = returnAt ? Math.max(0, Math.ceil((new Date(returnAt).getTime() - serverNow) / 1000)) : 0;
  const secondsLeft = Number(value.seconds_left);
  return { ...value, status, return_at: returnAt, started_at: serverTime(value.started_at), server_now: serverNowIso ?? undefined,
    walk_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 480,
    seconds_left: Number.isFinite(secondsLeft) && secondsLeft > 0 ? secondsLeft : fromReturnAt } as PetSpace;
}

export function formatRemaining(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
