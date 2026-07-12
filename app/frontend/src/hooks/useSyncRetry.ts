import { useEffect, useRef } from 'react';

/**
 * While `active` (a save failed on connectivity and is waiting to upload),
 * re-attempt it when the connection plausibly returned: the `online` event
 * and the app coming back to the foreground. There is no Background Sync on
 * iOS, so foreground triggers plus the manual "Sync now" button are the whole
 * retry story.
 */
export function useSyncRetry(active: boolean, retry: () => void): void {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!active) return;
    const attempt = () => {
      if (navigator.onLine) retryRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') attempt();
    };
    window.addEventListener('online', attempt);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', attempt);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active]);
}
