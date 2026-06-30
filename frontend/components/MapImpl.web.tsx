import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { api, ActiveFriend } from '../lib/api';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function MapImpl() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clubs } = useClubs();
  const [friends, setFriends] = useState<ActiveFriend[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await api.activeFriends();
        if (mounted) setFriends(list || []);
      } catch {
        if (mounted) setFriends([]);
      }
    })();
    const id = setInterval(async () => {
      try {
        const list = await api.activeFriends();
        if (mounted) setFriends(list || []);
      } catch {}
    }, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 140 }}
      testID="map-screen-web"
    >
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.webTitle}>Carte interactive</Text>
        <Text style={styles.webSub}>
          La carte plein écran s'affiche sur mobile. Voici les {clubs.length} clubs autour de vous :
        </Text>
      </View>

      {friends.length > 0 && (
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
          <Text style={styles.sectionTitle}>Amis en soirée ({friends.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            {friends.map((f) => {
              const initials = ((f.name || f.username || '?').match(/\b\w/g) || ['?'])
                .slice(0, 2)
                .join('')
                .toUpperCase();
              return (
                <TouchableOpacity
                  key={f.user_id}
                  style={styles.friendChip}
                  onPress={() => router.push(`/club/${f.club_id}` as any)}
                  testID={`web-active-friend-${f.user_id}`}
                  activeOpacity={0.85}
                >
                  {f.picture ? (
                    <Image source={{ uri: f.picture }} style={styles.friendChipAvatar} />
                  ) : (
                    <View style={styles.friendChipFallback}>
                      <Text style={styles.friendChipFallbackText}>{initials}</Text>
                    </View>
                  )}
                  <View style={styles.dot} />
                  <Text style={styles.friendChipName} numberOfLines={1}>
                    {f.name || `@${f.username}`}
                  </Text>
                  <Text style={styles.friendChipClub} numberOfLines={1}>
                    {f.club_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={{ paddingHorizontal: spacing.lg }}>
        {clubs.map((c) => (
          <TouchableOpacity
            key={c.club_id}
            style={styles.webRow}
            onPress={() => router.push(`/club/${c.club_id}` as any)}
            testID={`web-map-row-${c.club_id}`}
          >
            <View style={styles.markerSmall}>
              <View style={styles.markerInner} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.webName}>{c.name}</Text>
              <Text style={styles.webMeta}>
                {c.address}
                {c.distance_km != null ? ` · ${c.distance_km.toFixed(1)} km` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  webTitle: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 6,
  },
  webSub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
  },
  friendChip: {
    width: 110,
    marginRight: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  friendChipAvatar: { width: 48, height: 48, borderRadius: 24 },
  friendChipFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendChipFallbackText: { color: colors.bg, fontWeight: '900', fontSize: 14 },
  dot: {
    position: 'absolute',
    top: 12,
    right: 28,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  friendChipName: { color: colors.textPrimary, fontWeight: '800', fontSize: 12, marginTop: 6 },
  friendChipClub: { color: colors.textTertiary, fontSize: 10, marginTop: 2 },
  webRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  markerSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,240,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.tertiary,
  },
  markerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tertiary,
  },
  webName: { color: colors.textPrimary, fontWeight: '700' },
  webMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
