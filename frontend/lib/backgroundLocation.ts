/**
 * Geofence check-in helpers — FOREGROUND ONLY.
 *
 * ⚠️ App Store compliance (Guideline 2.5.4): the app does NOT use background
 * location. UIBackgroundModes "location" was removed from app.json and the
 * legacy TaskManager task was deleted. Geofence detection is handled by
 * GeofenceCheckIn.tsx which polls the position every 60s while the app is
 * active, using only the when-in-use permission.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Legacy task name — kept only so stopBackgroundLocation() can clean up
// the task for users coming from an old version of the app.
export const BG_LOCATION_TASK = 'night-finder-bg-location';
export const NOTIF_CATEGORY_CHECKIN = 'checkin-actions';
export const NOTIF_ACTION_YES = 'CHECKIN_YES';
export const NOTIF_ACTION_NO = 'CHECKIN_NO';

export async function registerNotifCategories() {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setNotificationCategoryAsync(NOTIF_CATEGORY_CHECKIN, [
      {
        identifier: NOTIF_ACTION_YES,
        buttonTitle: '✅ Oui, j’y suis',
        options: { opensAppToForeground: true },
      },
      {
        identifier: NOTIF_ACTION_NO,
        buttonTitle: '✋ Non',
        options: { opensAppToForeground: false, isDestructive: false },
      },
    ]);
  } catch {
    // ignore
  }
}

export type BgLocationStartResult =
  | { ok: true; mode: 'background' | 'foreground' }
  | { ok: false; reason: 'web' | 'foreground_denied' | 'background_denied' | 'error'; canAskAgain?: boolean };

/**
 * Ensure the when-in-use location permission is granted so the foreground
 * geofence (GeofenceCheckIn polling) can work. Never requests "always".
 */
export async function startBackgroundLocation(): Promise<BgLocationStartResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web' };
  try {
    const Location = await import('expo-location');
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return { ok: false, reason: 'foreground_denied', canAskAgain: fg.canAskAgain };
    }
    return { ok: true, mode: 'foreground' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function stopBackgroundLocation() {
  if (Platform.OS === 'web') return;
  try {
    // Cleanup for users who had the legacy background task registered
    // in a previous version of the app.
    const Location = await import('expo-location');
    const TaskManager = await import('expo-task-manager');
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (isRegistered) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    // ignore
  }
}
