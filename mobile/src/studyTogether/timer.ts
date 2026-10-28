import type { RoomSession, RoomSnapshot } from './types';

/**
 * The group timer always counts down from the server's `remaining_ms`, measured against a monotonic clock. Changing
 * the phone's time or timezone therefore can't move it, and it never compares the phone's clock with the server's.
 * After the app sleeps or returns from the background the room is re-read, which re-anchors it.
 */
export const monotonicNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

export type TimerAnchor = { remainingMs: number; at: number; running: boolean; phaseMs: number };

export function anchorFor(session: RoomSession | null, at: number = monotonicNow()): TimerAnchor | null {
  if (!session || (session.status !== 'active' && session.status !== 'paused')) return null;
  return { remainingMs: session.remaining_ms, at, running: session.status === 'active', phaseMs: session.phase_seconds * 1000 };
}

export function remainingMs(anchor: TimerAnchor | null, now: number = monotonicNow()): number {
  if (!anchor) return 0;
  return anchor.running ? Math.max(0, anchor.remainingMs - (now - anchor.at)) : anchor.remainingMs;
}

/** Share of the current phase already done, 0..1. */
export function phaseProgress(anchor: TimerAnchor | null, now: number = monotonicNow()): number {
  if (!anchor || anchor.phaseMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(anchor, now) / anchor.phaseMs));
}

/** 1499.2 s -> "25:00" (rounds up so the display reaches 00:00 exactly when the phase ends). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const formatMinutes = (seconds: number) => `${Math.floor(seconds / 60)} phút`;

/**
 * Keep the newest snapshot: a lower version (a late event) never replaces newer state, and a duplicate of the same
 * version is ignored unless the server built it later (a fresh read re-anchors the timer).
 */
export function newerSnapshot(current: RoomSnapshot | null, incoming: RoomSnapshot): boolean {
  if (!current || current.id !== incoming.id) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return Date.parse(incoming.server_time) > Date.parse(current.server_time);
}
