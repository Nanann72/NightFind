import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { api } from './api';

// Module-level listeners so any screen (e.g. chats list after mark-read)
// can force an immediate badge refresh without waiting for the next poll.
const listeners = new Set<() => void>();

/** Force all mounted `useUnreadMessages` hooks to refetch immediately. */
export function triggerUnreadMessagesRefresh() {
  listeners.forEach((l) => l());
}

/**
 * Poll `/matches/unread-count` and expose the total number of unread chat
 * messages (used for the Chats tab badge). Refreshes on foreground.
 */
export function useUnreadMessages(intervalMs = 30_000) {
  const [unread, setUnread] = useState(0);
  const mounted = useRef(true);

  const refresh = async () => {
    try {
      const r = await api.matchesUnread();
      if (mounted.current) setUnread(r?.unread ?? 0);
    } catch {
      // silent (offline / not logged in)
    }
  };

  useEffect(() => {
    mounted.current = true;
    refresh();
    listeners.add(refresh);
    const id = setInterval(refresh, intervalMs);
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') refresh();
    });
    return () => {
      mounted.current = false;
      listeners.delete(refresh);
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);

  return { unread, refresh };
}
