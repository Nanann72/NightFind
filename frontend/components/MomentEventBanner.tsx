import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useThemeColors } from '../lib/themeContext';
import { radius } from '../lib/theme';
import { HapticButton } from './ui/HapticButton';

/**
 * Compact home banner shown while a BeReal-style Moment event is live.
 * Countdown is derived from the server end time (shared clock offset).
 */
export function MomentEventBanner() {
  const colors = useThemeColors();
  const router = useRouter();
  const [event, setEvent] = useState<any | null>(null);
  const [now, setNow] = useState(Date.now());
  const offsetRef = useRef(0);

  const sync = useCallback(async () => {
    try {
      const res = await api.momentEventCurrent();
      offsetRef.current = new Date(res.server_time).getTime() - Date.now();
      setEvent(res.event);
    } catch {}
  }, []);

  useEffect(() => {
    sync();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const resync = setInterval(sync, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    return () => {
      clearInterval(tick);
      clearInterval(resync);
      sub.remove();
    };
  }, [sync]);

  if (!event) return null;
  const serverNow = now + offsetRef.current;
  const remaining = new Date(event.ends_at).getTime() - serverNow;
  if (remaining <= 0) return null;
  const total = Math.floor(remaining / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');

  return (
    <Animated.View entering={FadeInDown.springify().damping(15)}>
      <HapticButton
        onPress={() => router.push('/moment-event' as any)}
        haptic="medium"
        style={[st.banner, { backgroundColor: colors.primary }]}
        testID="moment-event-banner"
      >
        <View style={st.boltWrap}>
          <Ionicons name="flash" size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>⚡ Moment Night Finder — Postez maintenant !</Text>
          <Text style={st.sub}>Tout le monde poste en même temps</Text>
        </View>
        <Text style={st.counter}>{mm}:{ss}</Text>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.8)" />
      </HapticButton>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  boltWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 13, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
  counter: { color: '#fff', fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
