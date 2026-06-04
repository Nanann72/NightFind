import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

// Paris fallback (Châtelet)
const FALLBACK = { lat: 48.8566, lng: 2.3522 };

export type Coords = { lat: number; lng: number };

type State = {
  coords: Coords;
  city: string | null;
  permission: 'granted' | 'denied' | 'undetermined';
  loading: boolean;
  error: string | null;
};

/** Best-effort reverse geocoding using Nominatim (OSM) so we don't need
 *  a paid Google Geocoding key. Works on web AND native. */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    // First try expo-location's built-in reverseGeocodeAsync on native (no key needed)
    if (Platform.OS !== 'web') {
      try {
        const places = await Location.reverseGeocodeAsync({
          latitude: lat,
          longitude: lng,
        });
        const p = places?.[0];
        const city = p?.city || p?.subregion || p?.region || null;
        if (city) return city;
      } catch {
        // fallthrough
      }
    }
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lng}`,
      { headers: { 'Accept-Language': 'fr' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address || {};
    return a.city || a.town || a.village || a.municipality || a.county || null;
  } catch {
    return null;
  }
}

export function useLocation(autoStart = true) {
  const [state, setState] = useState<State>({
    coords: FALLBACK,
    city: null,
    permission: 'undetermined',
    loading: false,
    error: null,
  });

  const resolveCity = useCallback(async (lat: number, lng: number) => {
    const city = await reverseGeocode(lat, lng);
    if (city) {
      setState((s) => ({ ...s, city }));
    }
  }, []);

  const request = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const coords = {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                };
                setState((s) => ({
                  ...s,
                  coords,
                  permission: 'granted',
                  loading: false,
                }));
                resolveCity(coords.lat, coords.lng);
                resolve();
              },
              () => {
                setState((s) => ({
                  ...s,
                  permission: 'denied',
                  loading: false,
                  error: 'Permission refusée. Affichage de Paris par défaut.',
                }));
                resolveCity(FALLBACK.lat, FALLBACK.lng);
                resolve();
              },
              { timeout: 6000 },
            );
          });
          return;
        }
        setState((s) => ({ ...s, loading: false, permission: 'denied' }));
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState((s) => ({
          ...s,
          permission: 'denied',
          loading: false,
          error: 'Permission refusée. Affichage de Paris par défaut.',
        }));
        resolveCity(FALLBACK.lat, FALLBACK.lng);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setState((s) => ({
        ...s,
        coords,
        permission: 'granted',
        loading: false,
      }));
      resolveCity(coords.lat, coords.lng);
    } catch (e: any) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e?.message || 'Localisation indisponible',
      }));
    }
  }, [resolveCity]);

  useEffect(() => {
    if (autoStart) {
      request();
    }
  }, [autoStart, request]);

  return { ...state, refresh: request };
}
