import { useEffect, useRef, useState } from 'react';

/**
 * Play time in ms that only advances while `running`. Pausing, a lost connection or an open explanation stop it, so
 * targets freeze exactly where they were. With reduced motion it ticks once a second: targets step instead of glide.
 * `tickMs`: how often it re-renders. The falling-word games move their words in their own frame loop and only read
 * this for the clock and the spawn timer, so they tick it slowly.
 */
export function useGameClock(running: boolean, reduceMotion: boolean, tickMs = 50) {
  const [ms, setMs] = useState(0);
  const base = useRef(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) setMs(base.current + Date.now() - startedAt.current);
    }, reduceMotion ? Math.max(1000, tickMs) : tickMs);
    return () => {
      clearInterval(timer);
      if (startedAt.current !== null) base.current += Date.now() - startedAt.current;
      startedAt.current = null;
      setMs(base.current);
    };
  }, [running, reduceMotion, tickMs]);
  return ms;
}
