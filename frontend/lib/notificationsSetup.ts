import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import {
  NOTIF_ACTION_NO,
  NOTIF_ACTION_YES,
  registerNotifCategories,
} from './backgroundLocation';
import { api } from './api';

// Foreground notification presentation behaviour
if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // Backward compatibility for older expo-notifications
        shouldShowAlert: true,
      }),
    });
  } catch {
    // ignore
  }
}

// Android: create the default channel at module scope (before any push lands)
if (Platform.OS === 'android') {
  try {
    Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
    });
  } catch {
    // ignore
  }
}

// NOTE (App Store Guideline 2.5.4): the legacy background-location TaskManager
// task was removed — geofence detection is now foreground-only and handled by
// GeofenceCheckIn.tsx while the app is active.

let actionsSubscription: { remove: () => void } | null = null;

/**
 * Subscribe to interactive notification responses (Yes / No buttons)
 * and call the check-in API accordingly.
 */
export function attachNotificationActionListeners() {
  if (Platform.OS === 'web') return () => {};
  if (actionsSubscription) return () => actionsSubscription?.remove();

  // Make sure our action category is registered before listening
  registerNotifCategories();

  actionsSubscription = Notifications.addNotificationResponseReceivedListener(
    async (response) => {
      await handleNotificationResponse(response);
    },
  );

  // Cold-start tap: app launched by tapping a notification while killed
  Notifications.getLastNotificationResponseAsync()
    .then((resp) => {
      if (resp) handleNotificationResponse(resp);
    })
    .catch(() => {});

  return () => {
    actionsSubscription?.remove();
    actionsSubscription = null;
  };
}

async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
) {
  try {
    const actionId = response.actionIdentifier;
    const data: any = response.notification.request.content.data || {};
    const clubId = data?.club_id;

    // Interactive geofence buttons
    if (clubId && (actionId === NOTIF_ACTION_YES || actionId === NOTIF_ACTION_NO)) {
      if (actionId === NOTIF_ACTION_YES) {
        api.checkIn(clubId, true).catch(() => {});
      } else if (actionId === NOTIF_ACTION_NO) {
        api.checkIn(clubId, false).catch(() => {});
      }
      return;
    }

    // Push-driven deeplinks (friend_request, friend_accepted, friend_at_club, …)
    const url: string | undefined = data?.deeplink || data?.action_url;
    if (url) {
      if (url.startsWith('http')) {
        await Linking.openURL(url);
      } else {
        try {
          router.push(url as any);
        } catch {
          // ignore — router not ready yet
        }
      }
      return;
    }

    // Default behaviour for the legacy geofence notification (tap = confirm)
    if (clubId && actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      api.checkIn(clubId, true).catch(() => {});
    }
  } catch {
    // ignore
  }
}
