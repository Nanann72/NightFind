/**
 * Accueil — premium home screen (iOS 26 style).
 * Header → Recherche → Explorer la carte → Clubs proches →
 * Tendance ce soir → Personnes près de toi → Moments → Tous les clubs.
 */
import { memo, useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  ScrollView,
  FlatList,
  Platform,
} from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Club, FeedMoment, NearbyUser } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useClubs } from '../../lib/clubs';
import { getRecentClubs, type RecentClub } from '../../lib/recentClubs';
import { useLocation } from '../../lib/useLocation';
import { useTabBarScroll } from '../../lib/tabBarScroll';
import { useUnreadNotifications } from '../../lib/useUnreadNotifications';
import { capturePartnerCodeFromUrl, claimPendingPartnerCode } from '../../lib/partner';
import { PartnerUnlockModal } from '../../components/PartnerUnlockModal';
import { MomentEventBanner } from '../../components/MomentEventBanner';
import { PushPrimerModal } from '../../components/PushPrimerModal';
import { SafeImage } from '../../components/SafeImage';
import { HapticButton } from '../../components/ui/HapticButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/States';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';
import { useTranslation } from '../../lib/i18n';

const QUICK_FILTERS: { key: string; label: string; emoji: string }[] = [
  { key: 'all', label: 'Pour toi', emoji: '✨' },
  { key: 'open_now', label: 'Ce soir', emoji: '🔥' },
  { key: 'techno', label: 'Techno', emoji: '🎧' },
  { key: 'vip', label: 'VIP', emoji: '💎' },
  { key: 'terrasse', label: 'Terrasse', emoji: '🌿' },
];

export default function Home() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { clubs, loading, favorites, refresh, toggleFavorite, filters, setFilters, setCoords } = useClubs();
  const [recents, setRecents] = useState<RecentClub[]>([]);
  useFocusEffect(
    useCallback(() => {
      getRecentClubs().then(setRecents).catch(() => {});
    }, []),
  );
  const loc = useLocation();
  const { onScroll: onScrollHide } = useTabBarScroll();
  const { unread } = useUnreadNotifications();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('all');
  const [people, setPeople] = useState<NearbyUser[]>([]);
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [featured, setFeatured] = useState<Club[]>([]);
  const [unlockedCoupon, setUnlockedCoupon] = useState<any | null>(null);
  const [live, setLive] = useState<Record<string, number>>({});

  // Partner bar: capture code from launch URL (QR/deep link), then claim the
  // -10% coupon once authenticated → 🎉 unlock modal.
  useEffect(() => {
    (async () => {
      await capturePartnerCodeFromUrl();
      const coupon = await claimPendingPartnerCode();
      if (coupon) setUnlockedCoupon(coupon);
    })();
  }, []);

  useEffect(() => {
    if (loc.loading) return;
    setCoords(loc.permission === 'granted' ? loc.coords : null);
  }, [loc.loading, loc.permission, loc.coords.lat, loc.coords.lng, setCoords]);

  // People nearby + moments (best effort, silent failures)
  useEffect(() => {
    if (loc.loading) return;
    api.usersNearby(loc.coords.lat, loc.coords.lng, 25)
      .then((r) => setPeople((r.users || []).slice(0, 12)))
      .catch(() => {});
    api.momentsFeed(10)
      .then((r) => setMoments(r.moments || []))
      .catch(() => {});
    api.featuredPromotions()
      .then((r) => setFeatured((r.clubs || []).slice(0, 8)))
      .catch(() => {});
  }, [loc.loading, loc.coords.lat, loc.coords.lng]);

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

  const nearby = useMemo(
    () =>
      [...filtered]
        .filter((c) => c.distance_km !== null && c.distance_km !== undefined)
        .sort((a, b) => (a.distance_km ?? 99) - (b.distance_km ?? 99))
        .slice(0, 8),
    [filtered],
  );

  const trending = useMemo(
    () => [...filtered].sort((a, b) => b.rating - a.rating).slice(0, 8),
    [filtered],
  );

  // Live "people here" counts for the hero cards (engagement)
  useEffect(() => {
    const ids = trending.map((c) => c.club_id);
    if (ids.length === 0) return;
    api.activityLive(ids)
      .then((r) => setLive((prev) => ({ ...prev, ...(r.counts || {}) })))
      .catch(() => {});
  }, [trending]);

  const onQuickFilter = (k: string) => {
    setActive(k);
    const next = { ...filters, open_now: false, vip: false, terrasse: false, music: undefined as string | undefined };
    if (k === 'open_now') next.open_now = true;
    if (k === 'vip') next.vip = true;
    if (k === 'terrasse') next.terrasse = true;
    if (k === 'techno') next.music = 'techno';
    setFilters(next);
  };

  const Header = (
    <View>
      {/* ── Header ─────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
            Night <Text style={{ color: colors.primary }}>Finder</Text>
          </Text>
          <View style={styles.locRow}>
            <Ionicons name="location" size={12} color={colors.primary} />
            <Text style={styles.subtitle}>
              {(user as any)?.city || t('home.readyTonight')}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push('/notifications')}
            testID="open-notifications-btn"
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            {unread > 0 ? (
              <View style={styles.badge} testID="notif-badge">
                <Text style={styles.badgeText} allowFontScaling={false}>
                  {unread > 99 ? '99+' : String(unread)}
                </Text>
              </View>
            ) : null}
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

      {/* ── Search ─────────────────────────────── */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('home.searchPh')}
          placeholderTextColor={colors.textTertiary}
          style={styles.search}
          testID="discover-search-input"
        />
      </View>

      {/* ── Mode Soirée : Ce soir je sors ──────── */}
      <HapticButton
        haptic="medium"
        scale={0.98}
        style={styles.tonightBanner}
        onPress={() => router.push('/tonight' as any)}
        testID="tonight-banner"
      >
        <Text style={styles.tonightEmoji} allowFontScaling={false}>🎉</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.tonightTitle}>Ce soir je sors</Text>
          <Text style={styles.tonightSub}>Club, itinéraire et amis en un geste</Text>
        </View>
        <View style={styles.tonightArrow}>
          <Ionicons name="arrow-forward" size={16} color={colors.primary} />
        </View>
      </HapticButton>

      {/* ── Explore map banner ─────────────────── */}
      <HapticButton
        haptic="light"
        scale={0.98}
        style={styles.exploreBanner}
        onPress={() => router.push('/(tabs)/map')}
        testID="explore-map-banner"
      >
        <View style={styles.exploreIcon}>
          <Ionicons name="map" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.exploreTitle}>{t('home.exploreMap')}</Text>
          <Text style={styles.exploreSub}>{t('home.exploreMapSub')}</Text>
        </View>
        <View style={styles.exploreArrow}>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </View>
      </HapticButton>

      {/* ── Quick filters ──────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        style={{ marginTop: spacing.md }}
      >
        {QUICK_FILTERS.map((item) => {
          const isActive = active === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => onQuickFilter(item.key)}
              testID={`chip-${item.key}`}
              activeOpacity={0.85}
            >
              <Text style={styles.chipEmoji} allowFontScaling={false}>{item.emoji}</Text>
              <Text
                style={[styles.chipText, isActive && styles.chipTextActive]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Live : ce soir sur Night Finder ────── */}
      <MomentEventBanner />

      {/* ── Récemment consultés (UX intelligente) ─ */}
      {recents.length > 0 && (
        <View>
          <SectionHeader title="Récemment consultés" colors={colors} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.hList, { marginBottom: 18 }]}
          >
            {recents.map((r) => (
              <TouchableOpacity
                key={r.club_id}
                style={styles.recentCard}
                activeOpacity={0.85}
                onPress={() => router.push(`/club/${r.club_id}` as any)}
                testID={`recent-club-${r.club_id}`}
              >
                <SafeImage uri={r.photo} width={320} style={styles.recentImg} />
                <Text style={styles.recentName} numberOfLines={1}>{r.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── À la une (mises en avant payées) ───── */}
      {featured.length > 0 && (
        <View>
          <SectionHeader title="À la une ⭐" colors={colors} />
          <FlatList
            horizontal
            data={featured}
            keyExtractor={(c) => `feat-${c.club_id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <MiniClubCard club={item} onPress={() => router.push(`/club/${item.club_id}` as any)} />
            )}
          />
        </View>
      )}

      {/* ── Clubs proches ──────────────────────── */}
      {nearby.length > 0 && (
        <View>
          <SectionHeader
            title={t('home.nearbyClubs')}
            action={t('home.seeAll')}
            onAction={() => router.push('/(tabs)/map')}
            colors={colors}
          />
          <FlatList
            horizontal
            data={nearby}
            keyExtractor={(c) => `near-${c.club_id}`}
            initialNumToRender={4}
            windowSize={5}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <MiniClubCard club={item} onPress={() => router.push(`/club/${item.club_id}` as any)} />
            )}
          />
        </View>
      )}

      {/* ── Tendance ce soir ───────────────────── */}
      {trending.length > 0 && (
        <View>
          <SectionHeader title={t('home.trending')} colors={colors} />
          <FlatList
            horizontal
            data={trending}
            keyExtractor={(c) => `trend-${c.club_id}`}
            initialNumToRender={4}
            windowSize={5}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <TrendCard
                club={item}
                live={live[item.club_id]}
                onPress={() => router.push(`/club/${item.club_id}` as any)}
              />
            )}
          />
        </View>
      )}

      {/* ── Personnes près de toi ──────────────── */}
      {people.length > 0 && (
        <View>
          <SectionHeader
            title={t('home.peopleNearby')}
            action={t('home.seeAll')}
            onAction={() => router.push('/(tabs)/swipe')}
            colors={colors}
          />
          <FlatList
            horizontal
            data={people}
            keyExtractor={(p) => `p-${p.user_id}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.person}
                activeOpacity={0.85}
                onPress={() => router.push('/(tabs)/swipe')}
                testID={`person-${item.user_id}`}
              >
                {item.picture ? (
                  <Image source={{ uri: item.picture }} style={styles.personAvatar} />
                ) : (
                  <View style={[styles.personAvatar, styles.personFb]}>
                    <Ionicons name="person" size={26} color={colors.textTertiary} />
                  </View>
                )}
                <Text style={styles.personName} numberOfLines={1}>
                  {item.name.split(' ')[0]}{item.age ? `, ${item.age}` : ''}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ── Moments ────────────────────────────── */}
      {moments.length > 0 && (
        <View>
          <SectionHeader
            title={t('home.moments')}
            action={t('home.seeAll')}
            onAction={() => router.push('/feed')}
            colors={colors}
          />
          <FlatList
            horizontal
            data={moments}
            keyExtractor={(m) => m.moment_id}
            initialNumToRender={4}
            windowSize={5}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.momentCard}
                activeOpacity={0.9}
                onPress={() => router.push('/feed')}
                testID={`home-moment-${item.moment_id}`}
              >
                <SafeImage uri={item.image} style={styles.momentImage} />
                <View style={styles.momentOverlay} />
                <View style={styles.momentInfo}>
                  <Text style={styles.momentClub} numberOfLines={1}>
                    {item.club_name || item.user_name}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <SectionHeader title={t('home.allClubs')} colors={colors} />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="discover-screen">
      <PartnerUnlockModal coupon={unlockedCoupon} onClose={() => setUnlockedCoupon(null)} />
      <Animated.FlatList
        data={filtered}
        keyExtractor={(c) => c.club_id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        scrollEventThrottle={16}
        initialNumToRender={5}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== 'web'}
        onScroll={(e) => onScrollHide(e.nativeEvent.contentOffset.y)}
        ListHeaderComponent={Header}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => refresh()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingHorizontal: spacing.lg, gap: 16, marginTop: 4 }} testID="home-skeleton">
              {[0, 1, 2].map((i) => (
                <View key={i} style={{ gap: 10 }}>
                  <Skeleton height={190} borderRadius={radius.xl} />
                  <Skeleton width="55%" height={16} />
                  <Skeleton width="35%" height={12} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="compass-outline"
              title={t('home.empty')}
              message="Élargis tes filtres ou rafraîchis pour découvrir de nouveaux lieux."
              ctaLabel="Rafraîchir"
              onCta={() => refresh()}
              testID="home-empty-state"
            />
          )
        }
        renderItem={({ item, index }) => (
          <Animated.View
            entering={index < 8 ? FadeInDown.delay(index * 40).springify().damping(18) : undefined}
          >
            <ClubCard
              club={item}
              isFav={favorites.has(item.club_id)}
              onToggleFav={() => toggleFavorite(item.club_id)}
              onPress={() => router.push(`/club/${item.club_id}` as any)}
            />
          </Animated.View>
        )}
      />
      <PushPrimerModal userId={user?.user_id} />
    </View>
  );
}

/* ────────────────────────────── Sub-components ── */

/** Animated favourite heart — instant optimistic feedback + light haptic. */
function FavHeart({
  isFav,
  onToggle,
  style,
  testID,
}: {
  isFav: boolean;
  onToggle: () => void;
  style?: any;
  testID?: string;
}) {
  const colors = useThemeColors();
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <TouchableOpacity
      style={style}
      hitSlop={10}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      onPress={() => {
        scale.value = withSequence(
          withSpring(1.35, { damping: 6, stiffness: 320 }),
          withSpring(1, { damping: 9 }),
        );
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onToggle();
      }}
    >
      <Animated.View style={aStyle}>
        <Ionicons
          name={isFav ? 'heart' : 'heart-outline'}
          size={20}
          color={isFav ? colors.primary : '#fff'}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

function SectionHeader({
  title,
  action,
  onAction,
  colors,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  colors: ThemeColors;
}) {
  return (
    <View style={sectionStyles.row}>
      <Text style={[sectionStyles.title, { color: colors.textPrimary }]}>{title}</Text>
      {action && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={10}>
          <Text style={[sectionStyles.action, { color: colors.textSecondary }]}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm + 4,
  },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: 0.2 },
  action: { fontSize: 13, fontWeight: '600' },
});

const MiniClubCard = memo(function MiniClubCard({ club, onPress }: { club: Club; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <HapticButton haptic="soft" scale={0.97} style={styles.miniCard} onPress={onPress} testID={`near-card-${club.club_id}`}>
      <SafeImage uri={club.photos?.[0]} width={480} style={styles.miniImage} />
      {club.promoted && (
        <View style={styles.sponsoredChip}>
          <Text style={styles.sponsoredText}>Sponsorisé</Text>
        </View>
      )}
      <View style={styles.miniBody}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.miniName, { flexShrink: 1 }]} numberOfLines={1}>{club.name}</Text>
          {club.verified && <Ionicons name="checkmark-circle" size={14} color="#1D9BF0" />}
        </View>
        <Text style={styles.miniMeta} numberOfLines={1}>
          {club.distance_km != null ? `${club.distance_km.toFixed(1)} km · ` : ''}
          {club.music_styles?.[0] || ''}
        </Text>
      </View>
    </HapticButton>
  );
}, (prev, next) => prev.club === next.club);

const TrendCard = memo(function TrendCard({ club, live, onPress }: { club: Club; live?: number; onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <HapticButton haptic="soft" scale={0.97} style={styles.trendCard} onPress={onPress} testID={`trend-card-${club.club_id}`}>
      <SafeImage uri={club.photos?.[0]} width={480} style={styles.trendImage} />
      <View style={styles.trendOverlay} />
      {live != null && (
        <View style={styles.liveBadge}>
          <Ionicons name="people" size={11} color="#fff" />
          <Text style={styles.liveText} allowFontScaling={false}>{live}</Text>
        </View>
      )}
      {club.top_rated && (
        <View style={[styles.topRatedBadge, { top: live != null ? 42 : 10, left: 10 }]}>
          <Text style={styles.topRatedText} allowFontScaling={false}>❤️ Coup de cœur</Text>
        </View>
      )}
      <View style={styles.trendBody}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.trendName, { flexShrink: 1 }]} numberOfLines={1}>{club.name}</Text>
          {club.verified && <Ionicons name="checkmark-circle" size={14} color="#1D9BF0" />}
        </View>
        <View style={styles.trendMetaRow}>
          <Ionicons name="star" size={12} color={colors.secondary} />
          <Text style={styles.trendMeta}>
            {club.user_rating_count ? `${club.user_rating!.toFixed(1)} (${club.user_rating_count})` : club.rating.toFixed(1)}
          </Text>
          <Text style={styles.trendMeta}>·</Text>
          <Text style={[styles.trendMeta, { flexShrink: 1 }]} numberOfLines={1}>{club.music_styles?.slice(0, 2).join(' / ')}</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.trendVoir}>
            <Text style={styles.trendVoirText} allowFontScaling={false}>Voir</Text>
          </View>
        </View>
      </View>
    </HapticButton>
  );
}, (prev, next) => prev.club === next.club && prev.live === next.live);

const ClubCard = memo(function ClubCard({
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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <HapticButton
      haptic="soft"
      scale={0.98}
      style={styles.card}
      onPress={onPress}
      testID={`club-card-${club.club_id}`}
    >
      <View style={styles.cardImageWrap}>
        <SafeImage uri={club.photos?.[0]} width={640} style={styles.cardImage} />
        <View style={styles.cardOverlay} />
        <FavHeart
          isFav={isFav}
          onToggle={onToggleFav}
          style={styles.favBtn}
          testID={`fav-btn-${club.club_id}`}
        />
        {club.distance_km !== null && club.distance_km !== undefined && (
          <View style={styles.distanceBadge}>
            <Ionicons name="navigate" size={11} color="#fff" />
            <Text style={styles.distanceText}>{club.distance_km.toFixed(1)} km</Text>
          </View>
        )}
        {club.top_rated && (
          <View style={[styles.topRatedBadge, { top: club.distance_km != null ? 52 : 14 }]} testID={`top-rated-${club.club_id}`}>
            <Text style={styles.topRatedText} allowFontScaling={false}>❤️ Coup de cœur</Text>
          </View>
        )}
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{club.name}</Text>
          <View style={styles.cardMeta}>
            <Ionicons name="star" size={13} color={colors.secondary} />
            <Text style={styles.cardMetaText}>
              {club.user_rating_count ? `${club.user_rating!.toFixed(1)} (${club.user_rating_count} avis)` : club.rating.toFixed(1)}
            </Text>
            <Text style={styles.cardMetaText}>·</Text>
            <Text style={styles.cardMetaText}>{club.avg_price.toFixed(0)}€</Text>
            <Text style={styles.cardMetaText}>·</Text>
            <Text style={styles.cardMetaText} numberOfLines={1}>
              {club.music_styles.slice(0, 2).join(' / ')}
            </Text>
          </View>
        </View>
      </View>
    </HapticButton>
  );
}, (prev, next) => prev.club === next.club && prev.isFav === next.isFav);

/* ────────────────────────────── Styles ── */

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  h1: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 3,
  },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', lineHeight: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  search: { flex: 1, color: colors.textPrimary, paddingVertical: 13, fontSize: 15 },
  exploreBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: 'rgba(225, 29, 72, 0.25)',
    borderRadius: radius.xl,
    padding: 16,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  tonightBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: 16,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  tonightEmoji: { fontSize: 26 },
  tonightTitle: { color: '#fff', fontSize: 17, fontWeight: '900' },
  tonightSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  tonightArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(225, 29, 72, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exploreTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  exploreSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  exploreArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsRow: { paddingHorizontal: spacing.lg, gap: 10, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipEmoji: { fontSize: 14, lineHeight: 18 },
  chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  hList: { paddingHorizontal: spacing.lg, gap: 12 },
  recentCard: { width: 124 },
  recentImg: { width: 124, height: 82, borderRadius: radius.md, marginBottom: 6 },
  recentName: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  // Mini club card (Clubs proches)
  miniCard: {
    width: 190,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  miniImage: { width: '100%', height: 110 },
  sponsoredChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.95)',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sponsoredText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  miniBody: { padding: 12 },
  miniName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  miniMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  // Trend card
  trendCard: {
    width: 250,
    height: 150,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  trendImage: { width: '100%', height: '100%' },
  trendOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.32)' },
  trendBody: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  trendName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  trendMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  trendMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  trendVoir: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  trendVoirText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  // People
  person: { alignItems: 'center', width: 76 },
  personAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  personFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  personName: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 6, maxWidth: 76, textAlign: 'center' },
  // Moments
  momentCard: {
    width: 130,
    height: 180,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  momentImage: { width: '100%', height: '100%' },
  momentOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.25)' },
  momentInfo: { position: 'absolute', left: 10, right: 10, bottom: 10 },
  momentClub: { color: '#fff', fontSize: 12, fontWeight: '700' },
  // Main vertical card
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  cardImageWrap: { height: 200, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.35)' },
  favBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(5,5,5,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
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
    borderRadius: radius.pill,
    backgroundColor: 'rgba(5,5,5,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  distanceText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  topRatedBadge: {
    position: 'absolute',
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  topRatedText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  cardContent: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  cardName: { color: '#fff', fontSize: 21, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMetaText: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '600' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
});
