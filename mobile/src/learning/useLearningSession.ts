import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, NetworkError } from '../api/client';
import { errorMessage } from '../auth/messages';
import { learningApi } from './api';
import type { EventResponse, LearningSession } from './types';

const RELOAD_CODES = new Set(['session_ended', 'session_paused', 'session_not_found', 'turn_not_open', 'turn_not_found',
  'concurrent_update', 'invalid_transition']);
const RETRY_MS = 3000;
const COUNTDOWN_FROM = 3;
/** How long "Bắt đầu!" stays when there is nothing to wait for (the session is already running on the server). */
const START_SHOWN_MS = 700;

type Call = () => Promise<EventResponse>;
type StartOptions = {
  /** False while the game's data or pictures are still loading: the countdown waits for them. */
  ready?: boolean;
  /** Studying together: when the room starts the game (ms, this device's clock). The countdown follows it, so every
   * member starts at the same time, never because one of them finished the guide. */
  startsAt?: number | null;
};
type Handler = (response: EventResponse) => void;

/**
 * Keeps the game in sync with the backend, which owns the session. Every request goes through `run`:
 * - only one at a time (taps while a request is in flight are ignored, so nothing is sent twice by accident);
 * - on a network failure the game pauses, what the user typed stays, and the same request (same event id) is retried
 *   every few seconds or on "Thử lại" — the backend recognises the retry, so nothing is counted twice;
 * - if the session was paused or ended elsewhere (another device), it reloads the real state.
 * Every start (first play, "Chơi lại", "Tiếp tục học") goes through a 3-2-1 countdown, then "Bắt đầu!": only then
 * does the backend resume the session, so the clock, the targets, the answers and the score all wait for it.
 * Leaving the app pauses the session; during the countdown it stops and counts again from 3 on return.
 */
export function useLearningSession(initial: LearningSession, notify: (message: string, tone?: 'info' | 'error') => void,
  /** Start right away (with the countdown) even though the session is still paused, e.g. after the lesson. */ autoStart = false,
  options: StartOptions = {}) {
  const { ready = true, startsAt = null } = options;
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [localPause, setLocalPause] = useState(initial.status === 'paused' && !autoStart);
  // 3, 2, 1, then 0 ("Bắt đầu!") until the backend has resumed the session; null when not counting.
  const [countdown, setCountdown] = useState<number | null>(initial.status === 'active' || autoStart ? COUNTDOWN_FROM : null);
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const [foreground, setForeground] = useState(true);
  const foregroundRef = useRef(true);
  const startsAtRef = useRef(startsAt);
  startsAtRef.current = startsAt;
  const going = useRef(false); // "Bắt đầu!": the resume is on its way
  const busyRef = useRef(false);
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<{ call: Call; onDone?: Handler } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const apply = useCallback((next: LearningSession) => {
    // Responses can arrive out of order after retries; never go back to an older version.
    setSession((current) => (next.version >= current.version || next.id !== current.id ? next : current));
    if (next.status === 'paused') setLocalPause(true);
  }, []);

  const reload = useCallback(async () => {
    try { apply(await learningApi.session(sessionRef.current.id)); setOffline(false); }
    catch (e) { if (e instanceof NetworkError) setOffline(true); }
  }, [apply]);

  const run = useCallback((call: Call, onDone?: Handler): Promise<EventResponse | null> => {
    if (busyRef.current) return Promise.resolve(null); // a second tap while the first answer is on its way
    busyRef.current = true;
    setBusy(true);
    const job = send(call, onDone);
    inflight.current = job;
    return job;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pause, resume, end, extend, finish: never dropped. If another request is on its way, wait for it first. */
  const control = useCallback(async (call: Call, onDone?: Handler): Promise<EventResponse | null> => {
    while (busyRef.current) await inflight.current.catch(() => null);
    return run(call, onDone);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (call: Call, onDone?: Handler): Promise<EventResponse | null> => {
    try {
      const response = await call();
      pending.current = null;
      setOffline(false);
      apply(response.session);
      onDone?.(response);
      return response;
    } catch (e) {
      if (e instanceof NetworkError) {
        pending.current = { call, onDone };
        setOffline(true);
      } else if (e instanceof ApiError && RELOAD_CODES.has(e.code)) {
        pending.current = null;
        if (e.code === 'session_ended' || e.code === 'session_not_found') notify('Chặng học đã kết thúc (có thể trên thiết bị khác).', 'info');
        await reload();
      } else {
        pending.current = null;
        notify(errorMessage(e), 'error');
      }
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** Re-send the request that failed for lack of network, with the same event id. */
  const retry = useCallback(async () => {
    const job = pending.current;
    if (job) {
      const done = await run(job.call, job.onDone);
      if (done) setCountdown(COUNTDOWN_FROM);
    } else {
      await reload();
    }
  }, [reload, run]);

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => { if (!busyRef.current) void retry(); }, RETRY_MS);
    return () => clearInterval(timer);
  }, [offline, retry]);

  const pause = useCallback(() => {
    setLocalPause(true);  // the game stops at once, whatever the network does
    setCountdown(null);
    if (sessionRef.current.status === 'active') void control(() => learningApi.pause(sessionRef.current.id));
  }, [control]);

  const resume = useCallback(() => {
    foregroundRef.current = true; // a tap: the app is on screen
    setForeground(true);
    if (countdownRef.current === null) setCountdown(COUNTDOWN_FROM); // a second tap never restarts it
  }, []);

  // 3 → 2 → 1 → 0, one a second, once the game is ready and on screen. With a start time set by the room (studying
  // together), it follows that time instead, so everyone starts at the same moment.
  useEffect(() => {
    if (countdown === null || countdown === 0 || !ready || !foreground) return;
    if (startsAt !== null) {
      const tick = () => setCountdown((c) => (c === null ? null : Math.max(0, Math.ceil((startsAt - Date.now()) / 1000))));
      tick();
      const timer = setInterval(tick, 200);
      return () => clearInterval(timer);
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null || c === 0 ? c : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, ready, foreground, startsAt]);

  // "Bắt đầu!": tell the backend, and play only once it has resumed the session (it stays on screen meanwhile).
  useEffect(() => {
    if (countdown !== 0 || !ready || !foreground || going.current) return;
    going.current = true;
    const go = () => { going.current = false; setCountdown(null); setLocalPause(false); };
    if (sessionRef.current.status !== 'paused') {
      const timer = setTimeout(go, START_SHOWN_MS);
      return () => { clearTimeout(timer); going.current = false; };
    }
    void control(() => learningApi.resume(sessionRef.current.id), () => {
      if (countdownRef.current === null) { // paused (back button) while the resume was on its way: stay paused
        going.current = false;
        void control(() => learningApi.pause(sessionRef.current.id));
        return;
      }
      if (foregroundRef.current) { go(); return; }
      // The app went to the background while the resume was on its way: stop again and count from 3 on return.
      going.current = false;
      setCountdown(COUNTDOWN_FROM);
      void control(() => learningApi.pause(sessionRef.current.id));
    }).then((done) => {
      if (done) return;
      going.current = false;
      // No network: the retry counts down again once it gets through. Any other refusal: back to the pause menu.
      if (!pending.current) setCountdown(null);
    });
  }, [countdown, ready, foreground, control]);

  // Leaving the app (home button, call, lock screen) pauses the game. During the countdown nothing has started yet:
  // it stops and counts again from 3 when the app is back (a room's start time is kept as it is).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      foregroundRef.current = active;
      setForeground(active);
      if (active) return;
      if (countdownRef.current !== null) {
        // A resume on its way handles this itself when it comes back (see "Bắt đầu!" above).
        const resuming = going.current && sessionRef.current.status === 'paused';
        if (!resuming && startsAtRef.current === null) setCountdown(COUNTDOWN_FROM);
        if (!resuming && sessionRef.current.status === 'active') void control(() => learningApi.pause(sessionRef.current.id));
      } else if (sessionRef.current.status === 'active') {
        pause();
      }
    });
    return () => sub.remove();
  }, [pause, control]);

  const running = session.status === 'active' && !localPause && !offline && countdown === null;
  return { session, busy, offline, paused: localPause || (session.status === 'paused' && countdown === null), countdown,
    /** Counting waits for the game's pictures. */ preparing: countdown !== null && !ready,
    running, run, control, retry, pause, resume, reload, apply };
}

export type LearningSessionController = ReturnType<typeof useLearningSession>;
