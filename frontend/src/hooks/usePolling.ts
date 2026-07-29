import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling<T>(
  fetcher: () => Promise<T>,
  shouldStop: (data: T) => boolean,
  intervalMs = 2000,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setLoading(true);
    setError(null);

    const poll = async () => {
      try {
        const result = await fetcher();
        setData(result);
        setLoading(false);
        if (shouldStop(result)) {
          stop();
        }
      } catch (e) {
        setError(String(e));
        setLoading(false);
        stop();
      }
    };

    poll();
    timerRef.current = setInterval(poll, intervalMs);
  }, [fetcher, shouldStop, intervalMs, stop]);

  useEffect(() => () => stop(), [stop]);

  return { data, loading, error, start, stop };
}
