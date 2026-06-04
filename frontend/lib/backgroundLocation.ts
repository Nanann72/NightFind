import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { storage } from './storage';

// Background location task name (must match the one registered in TaskManager)
export const BG_LOCATION_TASK = 'night-finder-bg-location';
export const NOTIF_CATEGORY_CHECKIN = 'checkin-actions';
export const NOTIF_ACTION_YES = 'CHECKIN_YES';
export const NOTIF_ACTION_NO = 'CHECKIN_NO';

const GEOFENCE_RADIUS_KM = 0.05; // 50 m
const NOTIF_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h per club
const CLUBS_CACHE_KEY = 'nf_bg_clubs_cache';
const COOLDOWN_KEY = 'nf_bg_cooldown';

type CachedClub = {
  club_id: string;
  name: string;
  lat: number;
  lng: number;
  photo?: string;
};

function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function cacheClubsForBackground(
  clubs: { club_id: string; name: string; lat: number; lng: number; photos?: string[] }[],
) {
  try {
    const payload: CachedClub[] = clubs.map((c) => ({
      club_id: c.club_id,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      photo: c.photos?.[0],
    }));
    await storage.set(CLUBS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

async function loadCachedClubs(): Promise<CachedClub[]> {
  try {
    const raw = await storage.get(CLUBS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CachedClub[];
  } catch {
    return [];
  }
}

async function getCooldown(): Promise<Record<string, number>> {
  try {
    const raw = await storage.get(COOLDOWN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function setCooldown(map: Record<string, number>) {
  try {
    await storage.set(COOLDOWN_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

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

/**
 * Inspect current position against cached clubs. If within geofence,
 * trigger an interactive local notification with Yes/No actions.
 * Used by the background TaskManager handler.
 */
export async function handleBackgroundLocation(coords: { lat: number; lng: number }) {
  const clubs = await loadCachedClubs();
  if (!clubs.length) return;

  let nearest: CachedClub | null = null;
  let bestD = Infinity;
  for (const c of clubs) {
    const d = distanceKm(coords, { lat: c.lat, lng: c.lng });
    if (d <= GEOFENCE_RADIUS_KM && d < bestD) {
      bestD = d;
      nearest = c;
    }
  }
  if (!nearest) return;

  const cd = await getCooldown();
  const last = cd[nearest.club_id] || 0;
  if (Date.now() - last < NOTIF_COOLDOWN_MS) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `📍 Bienvenue à ${nearest.name} ?`,
      body: 'On dirait que tu viens d’arriver. Confirme-nous ta soirée.',
      categoryIdentifier: NOTIF_CATEGORY_CHECKIN,
      data: { club_id: nearest.club_id, club_name: nearest.name },
      sound: true,
    },
    trigger: null,
  });

  cd[nearest.club_id] = Date.now();
  await setCooldown(cd);
}

/**
 * Start background location updates with expo-location. Requires
 * "always" permission on iOS and ACCESS_BACKGROUND_LOCATION on Android.
 */
export type BgLocationStartResult =
  | { ok: true; mode: 'background' | 'foreground' }
  | { ok: false; reason: 'web' | 'foreground_denied' | 'background_denied' | 'error'; canAskAgain?: boolean };

export async function startBackgroundLocation(): Promise<BgLocationStartResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web' };
  try {
    const Location = await import('expo-location');
    const TaskManager = await import('expo-task-manager');

    // Ensure foreground granted first
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return { ok: false, reason: 'foreground_denied', canAskAgain: fg.canAskAgain };
    }

    // Then "always" / background permission. On Expo Go background may throw
    // or be denied — we still keep the user-facing toggle ON in foreground
    // mode so geofence works while the app is open (no dead-end).
    let bg: any = null;
    try {
      bg = await Location.requestBackgroundPermissionsAsync();
    } catch {
      return { ok: true, mode: 'foreground' };
    }
    if (bg?.status !== 'granted') {
      return { ok: true, mode: 'foreground' };
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (isRegistered) return { ok: true, mode: 'background' };

    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50, // metres
      timeInterval: 60 * 1000, // 1 min
      deferredUpdatesInterval: 60 * 1000,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'Night Finder',
        notificationBody: 'Détection des soirées autour de toi',
        notificationColor: '#E01A4F',
      },
      pausesUpdatesAutomatically: false,
    });
    return { ok: true, mode: 'background' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function stopBackgroundLocation() {
  if (Platform.OS === 'web') return;
  try {
    const Location = await import('expo-location');
    const TaskManager = await import('expo-task-manager');
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (isRegistered) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    // ignore
  }
}
