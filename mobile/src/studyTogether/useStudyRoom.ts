import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '../api/client';
import { togetherApi } from './api';
import type { ConnectionStatus, RealtimeClient } from './realtime';
import { anchorFor, newerSnapshot, remainingMs, TimerAnchor } from './timer';
import type { ReactionKey, RoomSnapshot } from './types';

/** Heartbeat + refresh interval while the socket is unavailable. The socket's own ping covers presence otherwise. */
export const FALLBACK_POLL_MS = 15000;
const REACTION_VISIBLE_MS = 3500;

export type LiveReaction = { key: number; userId: number; reaction: ReactionKey };

/**
 * Live state of one study room. The server's snapshot is the only source of truth: realtime events and REST responses
 * both go through `apply`, which keeps the newest version. The countdown is re-anchored on every snapshot.
 */
export function useStudyRoom(roomId: number, client: RealtimeClient, initial: RoomSnapshot | null = null) {
  const [room, setRoom] = useState<RoomSnapshot | null>(initial);
  const [anchor, setAnchor] = useState<TimerAnchor | null>(() => anchorFor(initial?.session ?? null));
  const [error, setError] = useState<unknown>(null);
  const [gone, setGone] = useState(false);
  const [endedSessionId, setEndedSessionId] = useState<number | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>(client.status);
  const [reactions, setReactions] = useState<LiveReaction[]>([]);
  const current = useRef<RoomSnapshot | null>(initial);
  const mounted = useRef(true);
  const reactionKey = useRef(0);

  const apply = useCallback((snap: RoomSnapshot) => {
    if (!mounted.current || snap.id !== roomId || !newerSnapshot(current.current, snap)) return;
    const previous = current.current;
    current.current = snap;
    setRoom(snap);
    setAnchor(anchorFor(snap.session));
    setError(null);
    if (previous?.session && !snap.session && snap.last_session_id === previous.session.id) setEndedSessionId(previous.session.id);
    if (snap.status === 'closed') setGone(true);
  }, [roomId]);

  const refresh = useCallback(async () => {
    try {
      apply(await togetherApi.heartbeat(roomId));
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError(e);
    }
  }, [apply, roomId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    client.subscribe(roomId);
    const offMessage = client.onMessage((m) => {
      if (!('room_id' in m) || m.room_id !== roomId) return;
      if (m.type === 'room.snapshot' || m.type === 'room.updated') apply(m.room);
      else if (m.type === 'room.removed') setGone(true);
      else if (m.type === 'room.reaction') {
        const key = ++reactionKey.current;
        setReactions((list) => [...list.slice(-5), { key, userId: m.user_id, reaction: m.reaction }]);
        setTimeout(() => { if (mounted.current) setReactions((list) => list.filter((r) => r.key !== key)); }, REACTION_VISIBLE_MS);
      } else if (m.type === 'error' && m.code === 'room_not_found') setGone(true);
    });
    const offStatus = client.onStatus(setConnection);
    setConnection(client.status);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') { client.wake(); void refresh(); }
    });
    return () => {
      mounted.current = false;
      offMessage(); offStatus(); appState.remove();
      client.unsubscribe(roomId);
    };
  }, [apply, client, refresh, roomId]);

  // Without the socket, poll (and send presence) at a calm pace instead of hammering the API.
  useEffect(() => {
    if (connection === 'online' || gone) return;
    const timer = setInterval(() => { void refresh(); }, FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [connection, gone, refresh]);

  // When the countdown reaches zero, ask for the next phase (the server also pushes it).
  useEffect(() => {
    if (!anchor?.running) return;
    const timer = setTimeout(() => { void refresh(); }, remainingMs(anchor) + 1500);
    return () => clearTimeout(timer);
  }, [anchor, refresh]);

  const act = useCallback(async <T extends { room?: RoomSnapshot }>(call: () => Promise<T>): Promise<T> => {
    const result = await call();
    if (result?.room) apply(result.room);
    return result;
  }, [apply]);

  return { room, anchor, error, gone, endedSessionId, connection, reactions, refresh, apply, act,
    clearEnded: () => setEndedSessionId(null) };
}
