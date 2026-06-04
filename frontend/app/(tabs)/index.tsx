import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Club } from '../../lib/api';
import { useClubs } from '../../lib/clubs';
import { useLocation } from '../../lib/useLocation';
import { SafeImage } from '../../components/SafeImage';
import { colors, radius, spacing } from '../../lib/theme';

const QUICK_FILTERS: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'Tous', icon: 'sparkles' },
  { key: 'open_now', label: 'Ouvert', icon: 'time' },
  { key: 'vip', label: 'VIP', icon: 'diamond' },
  { key: 'terrasse', label: 'Terrasse', icon: 'leaf' },
];

export default function Discover() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clubs, loading, favorites, refresh, toggleFavorite, filters, setFilters, setCoords } = useClubs();
  const loc = useLocation();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('all');

  useEffect(() => {
    if (loc.loading) return;
    setCoords(loc.permission === 'granted' ? loc.coords : null);
  }, [loc.loading, loc.permission, loc.coords.lat, loc.coords.lng, setCoords]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.music_styles.join(' ').toLowerCase().includes(q),
    );
  }, [clubs, search]);

  const onQuickFilter = (k: string) => {
    setActive(k);
    if (k === 'all') setFilters({ ...filters, open_now: false, vip: false, terrasse: false });
    if (k === 'open_now') setFilters({ ...filters, open_now: true, vip: false, terrasse: false });
    if (k === 'vip') setFilters({ ...filters, vip: true, open_now: false, terrasse: false });
    if (k === 'terrasse') setFilters({ ...filters, terrasse: true, open_now: false, vip: false });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="discover-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>NIGHT FINDER</Text>
          <Text style={styles.h1}>
            Ce soir à {loc.city || 'Paris'} 🌃
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/notifications')}
            testID="open-notifications-btn"
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/filters')}
            testID="open-filters-btn"
          >
            <Ionicons name="options-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un club, un quartier, un style..."
          placeholderTextColor={colors.textTertiary}
          style={styles.search}
          testID="discover-search-input"
        />
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={QUICK_FILTERS}
        keyExtractor={(i) => i.key}
        contentContainerStyle={styles.chipsRow}
        renderItem={({ item }) => {
          const isActive = active === item.key;
          return (
            <TouchableOpacity
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onQuickFilter(item.key)}
              testID={`chip-${item.key}`}
            >
              <Ionicons
                name={item.icon}
                size={14}
                color={isActive ? colors.bg : colors.textPrimary}
              />
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.club_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => refresh(loc.permission === 'granted' ? loc.coords : null)}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucun club ne correspond pour le moment.</Text>
          )
        }
        renderItem={({ item }) => (
          <ClubCard
            club={item}
            isFav={favorites.has(item.club_id)}
            onToggleFav={() => toggleFavorite(item.club_id)}
            onPress={() => router.push(`/club/${item.club_id}` as any)}
          />
        )}
      />
    </View>
  );
}

function ClubCard({
  club,
  isFav,
  onToggleFav,
  onPress,
}: {
  club: Club;
  isFav: boolean;
  onToggleFav: () => void;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={onPress}
      testID={`club-card-${club.club_id}`}
    >
      <View style={styles.cardImageWrap}>
        <SafeImage uri={club.photos?.[0]} style={styles.cardImage} />
        <View style={styles.cardOverlay} />
        <TouchableOpacity
          style={styles.favBtn}
          onPress={onToggleFav}
          testID={`fav-btn-${club.club_id}`}
          hitSlop={10}
        >
          <Ionicons
            name={isFav ? 'heart' : 'heart-outline'}
            size={20}
            color={isFav ? colors.primary : colors.textPrimary}
          />
        </TouchableOpacity>
        {club.distance_km !== null && club.distance_km !== undefined && (
          <View style={styles.distanceBadge}>
            <Ionicons name="navigate" size={11} color={colors.tertiary} />
            <Text style={styles.distanceText}>{club.distance_km.toFixed(1)} km</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{club.name}</Text>
          <View style={styles.cardMeta}>
            <Ionicons name="star" size={13} color={colors.secondary} />
            <Text style={styles.cardMetaText}>{club.rating.toFixed(1)}</Text>
            <Text style={styles.cardMetaText}>·</Text>
            <Text style={styles.cardMetaText}>{club.avg_price.toFixed(0)}€</Text>
            <Text style={styles.cardMetaText}>·</Text>
            <Text style={styles.cardMetaText} numberOfLines={1}>
              {club.music_styles.slice(0, 2).join(' / ')}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 4,
  },
  h1: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  search: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 12,
    fontSize: 14,
  },
  chipsRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 92,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.tertiary, borderColor: colors.tertiary },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.bg, fontWeight: '800' },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardImageWrap: { height: 180, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.35)',
  },
  favBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(9,9,11,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  distanceBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.4)',
  },
  distanceText: {
    color: colors.tertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  cardContent: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
  },
  cardName: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  empty: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 60,
  },
});
