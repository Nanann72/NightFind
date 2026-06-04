import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  BG_LOCATION_TASK,
  NOTIF_ACTION_NO,
  NOTIF_ACTION_YES,
  handleBackgroundLocation,
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

// Register the background location task ONCE at module load on native.
// We use a sync require so the OS can find it when waking the app.
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    if (!TaskManager.isTaskDefined(BG_LOCATION_TASK)) {
      TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }: any) => {
        if (error) return;
        const payload = data as
          | { locations?: Array<{ coords: { latitude: number; longitude: number } }> }
          | undefined;
        const loc = payload?.locations?.[0];
        if (!loc?.coords) return;
        await handleBackgroundLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      });
    }
  } catch {
    // ignore (web or task-manager unavailable)
  }
}

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
      try {
        const actionId = response.actionIdentifier;
        const data: any = response.notification.request.content.data || {};
        const clubId = data?.club_id;
        if (!clubId) return;
        if (actionId === NOTIF_ACTION_YES) {
          api.checkIn(clubId, true).catch(() => {});
        } else if (actionId === NOTIF_ACTION_NO) {
          api.checkIn(clubId, false).catch(() => {});
        } else if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
          api.checkIn(clubId, true).catch(() => {});
        }
      } catch {
        // ignore
      }
    },
  );

  return () => {
    actionsSubscription?.remove();
    actionsSubscription = null;
  };
}
