import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Architecture prepared for FCM migration; uses local notifications now.
export async function ensureNotifPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const Notifications = await import('expo-notifications');
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return true;
    const ask = await Notifications.requestPermissionsAsync();
    return ask.granted;
  } catch {
    return false;
  }
}

export async function scheduleEventReminder(
  title: string,
  body: string,
  triggerDate: Date,
) {
  if (Platform.OS === 'web') return null;
  try {
    const ok = await ensureNotifPermissions();
    if (!ok) return null;
    const Notifications = await import('expo-notifications');
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { date: triggerDate } as any,
    });
    return id;
  } catch {
    return null;
  }
}
