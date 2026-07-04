import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { api } from './api';

/**
 * Poll `/notifications/unread-count` every `intervalMs` and expose the
 * unread number. Also refreshes when the app comes back to the foreground.
 * Returns { unread, refresh }.
 */
export function useUnreadNotifications(intervalMs = 45_000) {
  const [unread, setUnread] = useState(0);
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const r = await api.notificationsUnread();
      if (mounted.current) setUnread(r?.unread ?? 0);
    } catch {
      // silent fail (offline / not logged in etc.)
    }
  };

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, intervalMs);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') refresh();
    });
    return () => {
      mounted.current = false;
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);

  return { unread, refresh };
}
