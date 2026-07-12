import { useEffect, useState } from 'react';

/**
 * Tracks navigator.onLine. Note `true` only means the OS reports a network
 * interface — requests can still fail (captive portal, no signal at the
 * server) — but `false` is a reliable "definitely offline" signal for UI.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
