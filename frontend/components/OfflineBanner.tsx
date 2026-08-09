import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { SlideInUp, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onNetworkStatus, pingBackend } from '../lib/api';

/**
 * Global "Connexion perdue" banner. Listens to network failures emitted by
 * the API layer, then pings the backend every 5s until it recovers — the
 * app keeps working with the data already on screen (graceful offline).
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  const retry = useCallback(async () => {
    const ok = await pingBackend();
    if (ok) setOffline(false);
    return ok;
  }, []);

  useEffect(() => {
    const unsub = onNetworkStatus((isOffline) => setOffline(isOffline));
    return unsub;
  }, []);

  useEffect(() => {
    if (!offline) return;
    const iv = setInterval(retry, 5000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') retry();
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [offline, retry]);

  if (!offline) return null;
  return (
    <Animated.View
      entering={SlideInUp.springify().damping(18)}
      exiting={FadeOut.duration(200)}
      style={[st.wrap, { top: insets.top + 4 }]}
      pointerEvents="none"
      testID="offline-banner"
    >
      <View style={st.pill}>
        <Ionicons name="cloud-offline" size={14} color="#fff" />
        <Text style={st.text}>Connexion perdue — reconnexion…</Text>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 999 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(24,24,27,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  text: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
