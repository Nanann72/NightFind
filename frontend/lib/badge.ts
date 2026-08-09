import { Platform } from 'react-native';
import { api } from './api';

/**
 * iOS/Android app icon badge — synced with the in-app unread count.
 * - syncBadge(): fetch unread count and set the native badge.
 * - clearBadge(): set badge to 0 (call when the user opens Notifications).
 * No-op on web.
 */
export async function syncBadge(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    const { unread } = await api.notificationsUnread();
    await Notifications.setBadgeCountAsync(Math.max(0, unread || 0));
  } catch {
    // best-effort
  }
}

export async function clearBadge(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // best-effort
  }
}
