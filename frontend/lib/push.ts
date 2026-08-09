import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { api } from './api';

/**
 * Registers the device with the Emergent push relay.
 *
 * - Must be called after login (when api has a valid token).
 * - Safe to call on every app open: backend upserts by user_id+platform.
 * - No-op on web.
 * - Requests notification permission first; aborts silently if denied.
 */
export async function registerForPush(
  userId: string,
  opts: { interactive?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!userId) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain && opts.interactive) {
      // Native prompt is only shown from the "Restez informé" primer screen
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return false;

    // CRITICAL: native FCM/APNs token, not Expo token
    const tokenResp = await Notifications.getDevicePushTokenAsync();
    if (!tokenResp?.data) return false;

    await api.registerPush({
      user_id: userId,
      platform: Platform.OS as 'ios' | 'android',
      device_token: String(tokenResp.data),
    });
    return true;
  } catch {
    // Push registration is best-effort — never block the user
    return false;
  }
}
