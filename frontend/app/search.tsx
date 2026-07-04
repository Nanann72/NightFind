import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { api, SearchUser } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const MUSIC_TAGS = [
  'techno', 'house', 'hip-hop', 'r&b', 'afro', 'reggaeton', 'edm', 'jazz', 'pop', 'rock',
];

const AGE_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: '18–25', min: 18, max: 25 },
  { label: '26–35', min: 26, max: 35 },
  { label: '36–45', min: 36, max: 45 },
  { label: '45+', min: 45 },
];

export default function UserSearch() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [q, setQ] = useState('');
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters state
  const [city, setCity] = useState('');
  const [ageIdx, setAgeIdx] = useState<number | null>(null);
  const [selectedMusic, setSelectedMusic] = useState<Set<string>>(new Set());
  const [premiumOnly, setPremiumOnly] = useState(false);

  const activeFilterCount =
    (city.trim() ? 1 : 0) +
    (ageIdx !== null ? 1 : 0) +
    (selectedMusic.size > 0 ? 1 : 0) +
    (premiumOnly ? 1 : 0);

  const clearFilters = () => {
    setCity('');
    setAgeIdx(null);
    setSelectedMusic(new Set());
    setPremiumOnly(false);
  };

  const toggleMusic = (m: string) => {
    setSelectedMusic((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

  const search = useCallback(async () => {
    const trimmed = q.trim();
    const filters = {
      minAge: ageIdx !== null ? AGE_PRESETS[ageIdx].min : undefined,
      maxAge: ageIdx !== null ? AGE_PRESETS[ageIdx].max : undefined,
      city: city.trim() || undefined,
      music: selectedMusic.size > 0 ? Array.from(selectedMusic).join(',') : undefined,
      premiumOnly: premiumOnly || undefined,
    };
    const hasAny =
      !!filters.minAge || !!filters.maxAge || !!filters.city || !!filters.music || !!filters.premiumOnly;
    if (trimmed.length < 2 && !hasAny) { setUsers([]); return; }
    setLoading(true);
    try {
      const r = await api.usersSearch(trimmed, 30, filters);
      setUsers(r.users);
    } catch { setUsers([]); }
    finally { setLoading(false); }
  }, [q, ageIdx, city, selectedMusic, premiumOnly]);

  useEffect(() => {
    const t = setTimeout(() => search(), 250);
    return () => clearTimeout(t);
  }, [search]);

  const renderUser = ({ item: u }: { item: SearchUser }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push({ pathname: '/story-viewer', params: { user_id: u.user_id, user_name: u.name } })}
      testID={`search-user-${u.user_id}`}
      activeOpacity={0.85}
    >
      {u.picture ? (
        <Image source={{ uri: u.picture }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPh]}>
          <Text style={styles.avatarInit}>{(u.name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{u.name}{u.age ? `, ${u.age}` : ''}</Text>
          {u.is_premium && (
            <View style={styles.premBadge}><Ionicons name="star" size={9} color="#fff" /></View>
          )}
        </View>
        {u.bio ? <Text style={styles.bio} numberOfLines={1}>{u.bio}</Text> : null}
        <View style={styles.metaRow}>
          {u.city ? <Text style={styles.city}>📍 {u.city}</Text> : null}
          {u.music && u.music.length > 0 ? (
            <Text style={styles.music} numberOfLines={1}>🎵 {u.music.slice(0, 3).join(' · ')}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="search-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Rechercher</Text>
        <TouchableOpacity
          style={[styles.iconBtn, showFilters && { backgroundColor: colors.primary + '22' }]}
          onPress={() => setShowFilters((s) => !s)}
          testID="search-toggle-filters"
        >
          <Ionicons
            name={showFilters ? 'options' : 'options-outline'}
            size={22}
            color={showFilters ? colors.primary : colors.textPrimary}
          />
          {activeFilterCount > 0 ? (
            <View style={styles.filterCountDot}>
              <Text style={styles.filterCountText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Nom, prénom ou bio…"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          testID="search-input"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={12}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {showFilters && (
        <Animated.View
          entering={FadeInDown.springify().damping(18)}
          layout={Layout.springify()}
          style={styles.filterPanel}
        >
          {/* Age */}
          <Text style={styles.filterLabel}>Âge</Text>
          <View style={styles.chipRow}>
            {AGE_PRESETS.map((p, i) => {
              const on = ageIdx === i;
              return (
                <TouchableOpacity
                  key={p.label}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setAgeIdx(on ? null : i)}
                  testID={`filter-age-${p.label}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* City */}
          <Text style={styles.filterLabel}>Ville</Text>
          <View style={styles.cityWrap}>
            <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Paris, Lyon, Marseille…"
              placeholderTextColor={colors.textTertiary}
              style={styles.cityInput}
              testID="filter-city-input"
            />
            {city ? (
              <TouchableOpacity onPress={() => setCity('')} hitSlop={10}>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Music */}
          <Text style={styles.filterLabel}>Musiques</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {MUSIC_TAGS.map((m) => {
              const on = selectedMusic.has(m);
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => toggleMusic(m)}
                  testID={`filter-music-${m}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Premium toggle + clear */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.chip, premiumOnly && styles.chipOn]}
              onPress={() => setPremiumOnly((p) => !p)}
              testID="filter-premium"
            >
              <Ionicons
                name="star"
                size={12}
                color={premiumOnly ? '#fff' : colors.textSecondary}
                style={{ marginRight: 4 }}
              />
              <Text style={[styles.chipText, premiumOnly && styles.chipTextOn]}>Premium seulement</Text>
            </TouchableOpacity>
            {activeFilterCount > 0 && (
              <TouchableOpacity onPress={clearFilters} testID="filter-clear">
                <Text style={styles.clearBtn}>Réinitialiser</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      )}

      <FlatList
        data={users}
        keyExtractor={(u) => u.user_id}
        renderItem={renderUser}
        contentContainerStyle={{ padding: spacing.md, gap: 8, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !loading ? (
            <Animated.View entering={FadeIn} style={{ alignItems: 'center', paddingTop: 40 }}>
              <Ionicons name="people-outline" size={38} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                {q.trim().length < 2 && activeFilterCount === 0
                  ? 'Tape 2 lettres ou applique un filtre…'
                  : 'Aucun profil trouvé'}
              </Text>
            </Animated.View>
          ) : (
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingBottom: 8,
  },
  iconBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: 20,
  },
  filterCountDot: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 16, height: 16, paddingHorizontal: 4,
    borderRadius: 8, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  filterCountText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15 },

  // Filters
  filterPanel: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  filterLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center',
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#fff' },

  cityWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  cityInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  footerRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 8,
  },
  clearBtn: { color: colors.primary, fontWeight: '800', fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarPh: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  premBadge: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: '#F5A623',
    alignItems: 'center', justifyContent: 'center',
  },
  bio: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 10, marginTop: 2, flexWrap: 'wrap' },
  city: { color: colors.textTertiary, fontSize: 11 },
  music: { color: colors.textTertiary, fontSize: 11, flex: 1 },
  emptyText: { color: colors.textSecondary, marginTop: 12, fontSize: 13, textAlign: 'center' },
});
