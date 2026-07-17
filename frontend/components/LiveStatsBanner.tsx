/**
 * Bandeau "live" de l'accueil — stats temps réel (actifs, moments, check-ins).
 * Rafraîchi toutes les 60s. Point vert pulsant façon "live".
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { api, LiveStats } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';

export function LiveStatsBanner({ colors }: { colors: ThemeColors }) {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
    );
  }, [pulse]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.statsLive().then((s) => alive && setStats(s)).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!stats) return null;
  const empty =
    !stats.active_users && !stats.moments_tonight && !stats.checkins_tonight;
  if (empty) return null;

  const items: { value: number; label: string }[] = [
    { value: stats.active_users, label: stats.active_users > 1 ? 'actifs' : 'actif' },
    { value: stats.moments_tonight, label: stats.moments_tonight > 1 ? 'Moments' : 'Moment' },
    { value: stats.checkins_tonight, label: 'check-ins' },
  ];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.liveRow}>
        <Animated.View style={[styles.dot, dotStyle]} />
        <Text style={[styles.liveLabel, { color: colors.textSecondary }]} allowFontScaling={false}>
          CE SOIR SUR NIGHT FINDER
        </Text>
      </View>
      <View style={styles.statsRow}>
        {items.map((it, i) => (
          <View key={it.label} style={[styles.stat, i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border }]}>
            <Text style={[styles.value, { color: colors.text }]} allowFontScaling={false}>
              {it.value}
            </Text>
            <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1} allowFontScaling={false}>
              {it.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  liveLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  statsRow: {
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
  },
  label: {
    fontSize: 11,
    marginTop: 1,
  },
});
