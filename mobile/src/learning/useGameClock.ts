import { useEffect, useRef, useState } from 'react';

/**
 * Play time in ms that only advances while `running`. Pausing, a lost connection or an open explanation stop it, so
 * targets freeze exactly where they were. With reduced motion it ticks once a second: targets step instead of glide.
 */
export function useGameClock(running: boolean, reduceMotion: boolean) {
  const [ms, setMs] = useState(0);
  const base = useRef(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (startedAt.current !== null) setMs(base.current + Date.now() - startedAt.current);
    }, reduceMotion ? 1000 : 50);
    return () => {
      clearInterval(timer);
      if (startedAt.current !== null) base.current += Date.now() - startedAt.current;
      startedAt.current = null;
      setMs(base.current);
    };
  }, [running, reduceMotion]);
  return ms;
}
