import { useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

// Paris fallback (Châtelet)
const FALLBACK = { lat: 48.8566, lng: 2.3522 };

export type Coords = { lat: number; lng: number };

type State = {
  coords: Coords;
  permission: 'granted' | 'denied' | 'undetermined';
  loading: boolean;
  error: string | null;
};

export function useLocation(autoStart = true) {
  const [state, setState] = useState<State>({
    coords: FALLBACK,
    permission: 'undetermined',
    loading: false,
    error: null,
  });

  const request = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setState((s) => ({
                  ...s,
                  coords: {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                  },
                  permission: 'granted',
                  loading: false,
                }));
                resolve();
              },
              () => {
                setState((s) => ({
                  ...s,
                  permission: 'denied',
                  loading: false,
                  error: 'Permission refusée. Affichage de Paris par défaut.',
                }));
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
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setState((s) => ({
        ...s,
        coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        permission: 'granted',
        loading: false,
      }));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e?.message || 'Localisation indisponible',
      }));
    }
  }, []);

  useEffect(() => {
    if (autoStart) {
      request();
    }
  }, [autoStart, request]);

  return { ...state, refresh: request };
}
