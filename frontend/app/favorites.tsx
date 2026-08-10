import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Club } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { useClubs } from '../lib/clubs';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function Favorites() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toggleFavorite } = useClubs();
  const [list, setList] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const favs = await api.getFavorites();
      setList(favs);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRemove = async (c: Club) => {
    await toggleFavorite(c.club_id);
    setList((l) => l.filter((x) => x.club_id !== c.club_id));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="favorites-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="favorites-back-btn">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Mes favoris</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={list}
        keyExtractor={(c) => c.club_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="heart-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>Pas encore de favoris</Text>
              <Text style={styles.emptyText}>
                Swipez vers la droite ou appuyez sur le cœur des clubs pour les
                retrouver ici.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/club/${item.club_id}` as any)}
            activeOpacity={0.9}
            testID={`fav-row-${item.club_id}`}
          >
            <SafeImage uri={item.photos[0]} width={320} style={styles.image} />
            <View style={styles.rowBody}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                ⭐ {item.rating.toFixed(1)} · {item.music_styles[0]}
              </Text>
              <Text style={styles.address} numberOfLines={1}>
                {item.address}
              </Text>
            </View>
            <TouchableOpacity
              hitSlop={10}
              onPress={() => onRemove(item)}
              testID={`fav-remove-${item.club_id}`}
            >
              <Ionicons name="heart" size={20} color={colors.primary} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: 72, height: 72, borderRadius: 14 },
  rowBody: { flex: 1 },
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  address: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
