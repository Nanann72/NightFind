import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, FlatList } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { useLocation } from '../lib/useLocation';
import { api, ActiveFriend, NearbyUser } from '../lib/api';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { useAuth } from '../lib/auth';
import { LocationRequired } from './LocationRequired';
import { SafeImage } from './SafeImage';

const SCREEN_H = Dimensions.get('window').height;
const SHEET_PEEK = 128;
const SHEET_HALF = Math.round(SCREEN_H * 0.52);

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0f0f12' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f0f12' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#888' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c1c20' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#06121a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

export default function MapImpl() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clubs } = useClubs();
  const loc = useLocation();
  const { user: currentUser } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [friends, setFriends] = useState<ActiveFriend[]>([]);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [browseWithoutLocation, setBrowseWithoutLocation] = useState(false);
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchFriends = async () => {
      try {
        const list = await api.activeFriends();
        if (mounted) setFriends(list || []);
      } catch {
        if (mounted) setFriends([]);
      }
    };
    fetchFriends();
    const interval = setInterval(fetchFriends, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch nearby users (includes bots and any real geo-sharing users).
  // Bots are visible for everyone (they're test users designed to be swiped
  // and appear on the map) — the backend filters admin/hidden accounts.
  useEffect(() => {
    if (!currentUser) {
      setNearbyUsers([]);
      return;
    }
    let mounted = true;
    const fetch = async () => {
      try {
        const res = await api.usersNearby(loc.coords.lat, loc.coords.lng, 15);
        if (mounted) setNearbyUsers(res.users || []);
      } catch {
        if (mounted) setNearbyUsers([]);
      }
    };
    fetch();
    const interval = setInterval(fetch, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [currentUser?.user_id, loc.coords.lat, loc.coords.lng]);

  const initialRegion = useMemo(
    () => ({
      latitude: loc.coords.lat,
      longitude: loc.coords.lng,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    }),
    [loc.coords.lat, loc.coords.lng],
  );

  const selected = clubs.find((c) => c.club_id === selectedId);

  // ── Bottom sheet (Night Finder 3.0 · Phase 8) ──
  const sheetH = useSharedValue(SHEET_PEEK);
  const sheetStart = useSharedValue(0);
  const sheetPan = Gesture.Pan()
    .onStart(() => {
      sheetStart.value = sheetH.value;
    })
    .onUpdate((e) => {
      const next = sheetStart.value - e.translationY;
      sheetH.value = Math.min(SHEET_HALF, Math.max(SHEET_PEEK, next));
    })
    .onEnd((e) => {
      const goHalf =
        e.velocityY < -300 ||
        (e.velocityY < 300 && sheetH.value > (SHEET_PEEK + SHEET_HALF) / 2);
      sheetH.value = withSpring(goHalf ? SHEET_HALF : SHEET_PEEK, { damping: 20, stiffness: 190 });
    });
  const sheetStyle = useAnimatedStyle(() => ({ height: sheetH.value }));

  const sortedClubs = useMemo(
    () =>
      [...clubs].sort(
        (a, b) => ((a as any).distance_km ?? 999) - ((b as any).distance_km ?? 999),
      ),
    [clubs],
  );

  const onPickClub = (c: (typeof clubs)[number]) => {
    setSelectedId(c.club_id);
    sheetH.value = withSpring(SHEET_PEEK, { damping: 20, stiffness: 190 });
    mapRef.current?.animateToRegion(
      { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      400,
    );
  };

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.animateToRegion(initialRegion, 400);
    }
  }, [initialRegion]);

  // Apple-compliant denied state (Guideline 5.1.1/5.1.5): elegant screen with
  // "Ouvrir Réglages" — never a dead-end, user can still browse without location.
  if (loc.permission === 'denied' && !browseWithoutLocation) {
    return <LocationRequired onContinueWithout={() => setBrowseWithoutLocation(true)} />;
  }

  return (
    <View style={styles.container} testID="map-screen">
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        customMapStyle={DARK_MAP_STYLE}
      >
        {clubs.map((c) => (
          <Marker
            key={c.club_id}
            coordinate={{ latitude: c.lat, longitude: c.lng }}
            onPress={() => setSelectedId(c.club_id)}
            tracksViewChanges={false}
          >
            <View style={styles.marker}>
              <View style={styles.markerInner} />
            </View>
            <Callout tooltip onPress={() => router.push(`/club/${c.club_id}` as any)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>
                  {c.name}{(c as any).verified ? ' ✓' : ''}
                </Text>
                <Text style={styles.calloutMeta}>
                  ⭐ {c.rating.toFixed(1)} · {c.avg_price.toFixed(0)}€
                </Text>
                <Text style={styles.calloutLink}>Voir le club ›</Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {friends.map((f, idx) => {
          // small angular offset around the club to avoid overlap
          const angle = (idx * Math.PI) / 4;
          const dLat = Math.cos(angle) * 0.00035;
          const dLng = Math.sin(angle) * 0.00045;
          const initials = ((f.name || f.username || '?').match(/\b\w/g) || ['?'])
            .slice(0, 2)
            .join('')
            .toUpperCase();
          return (
            <Marker
              key={`friend-${f.user_id}`}
              coordinate={{ latitude: f.lat + dLat, longitude: f.lng + dLng }}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.friendMarker}>
                {f.picture ? (
                  <Image source={{ uri: f.picture }} style={styles.friendAvatar} />
                ) : (
                  <View style={styles.friendInitials}>
                    <Text style={styles.friendInitialsText}>{initials}</Text>
                  </View>
                )}
                <View style={styles.friendDot} />
              </View>
              <Callout tooltip>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{f.name || `@${f.username}`}</Text>
                  <Text style={styles.calloutMeta}>en soirée à {f.club_name}</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}

        {/* Bots (admin only) — visible as pink dots on the map */}
        {nearbyUsers.map((u) => (
          <Marker
            key={`bot-${u.user_id}`}
            coordinate={{ latitude: u.lat, longitude: u.lng }}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.botMarker}>
              {u.picture ? (
                <Image source={{ uri: u.picture }} style={styles.botAvatar} />
              ) : (
                <View style={[styles.friendInitials, { backgroundColor: colors.primary }]}>
                  <Text style={styles.friendInitialsText}>
                    {(u.name?.[0] ?? '?').toUpperCase()}
                  </Text>
                </View>
              )}
              {u.is_bot && <View style={styles.botBadge} />}
            </View>
            <Callout tooltip>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>
                  {u.name}
                  {u.age ? `, ${u.age}` : ''}
                </Text>
                <Text style={styles.calloutMeta}>
                  {u.is_bot ? '🤖 Bot · ' : ''}
                  à {u.distance_km} km
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.searchPill}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <Text style={styles.searchPillText}>{clubs.length} clubs autour de vous</Text>
        </View>
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={() => mapRef.current?.animateToRegion(initialRegion, 400)}
          testID="map-recenter-btn"
        >
          <Ionicons name="locate" size={18} color={colors.tertiary} />
        </TouchableOpacity>
      </View>

      {!selected && (
        <GestureDetector gesture={sheetPan}>
          <Animated.View style={[styles.sheet, sheetStyle]} testID="map-bottom-sheet">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {sortedClubs.length} lieux autour de toi
            </Text>
            <FlatList
              data={sortedClubs}
              keyExtractor={(c) => c.club_id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
              renderItem={({ item: c }) => (
                <TouchableOpacity
                  style={styles.sheetRow}
                  activeOpacity={0.85}
                  onPress={() => onPickClub(c)}
                  testID={`sheet-club-${c.club_id}`}
                >
                  <SafeImage uri={c.photos[0]} width={96} style={styles.sheetThumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.sheetMeta} numberOfLines={1}>
                      ⭐ {c.rating.toFixed(1)} · {c.music_styles[0] || 'club'}
                      {(c as any).distance_km != null ? ` · ${(c as any).distance_km.toFixed(1)} km` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            />
          </Animated.View>
        </GestureDetector>
      )}

      {selected && (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push(`/club/${selected.club_id}` as any)}
          style={styles.bottomCard}
          testID={`map-selected-${selected.club_id}`}
        >
          <SafeImage uri={selected.photos[0]} width={320} style={styles.bottomImage} />
          <View style={styles.bottomContent}>
            <Text style={styles.bottomName}>{selected.name}</Text>
            <Text style={styles.bottomMeta}>
              ⭐ {selected.rating.toFixed(1)} · {selected.avg_price.toFixed(0)}€ ·{' '}
              {selected.music_styles[0]}
            </Text>
            <Text style={styles.bottomCta}>Voir le club ›</Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedId(null)} style={styles.bottomClose}>
            <Ionicons name="close" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    zIndex: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  sheetThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.bg },
  sheetName: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
  sheetMeta: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,240,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.tertiary,
  },
  markerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tertiary,
  },
  callout: {
    backgroundColor: colors.surfaceElevated,
    padding: 12,
    borderRadius: 12,
    minWidth: 160,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  calloutTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  calloutMeta: { color: colors.textSecondary, marginTop: 2, fontSize: 12 },
  calloutLink: { color: colors.tertiary, fontWeight: '700', marginTop: 6, fontSize: 12 },
  calloutLive: { color: '#F472B6', fontWeight: '800', marginTop: 4, fontSize: 11 },
  liveBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#F472B6',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: '#fff',
  },
  liveBadgeText: { fontSize: 9 },
  topBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.85)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  searchPillText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  friendMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
  },
  friendAvatar: { width: 36, height: 36, borderRadius: 18 },
  friendInitials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInitialsText: { color: colors.bg, fontWeight: '900', fontSize: 12 },
  friendDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#fff',
  },
  botMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.tertiary ?? '#00D9FF',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 4,
  },
  botAvatar: { width: 30, height: 30, borderRadius: 15 },
  botBadge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.tertiary ?? '#00D9FF',
    borderWidth: 2,
    borderColor: '#fff',
  },
  recenterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(9,9,11,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bottomCard: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 110,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  bottomImage: { width: 90, height: 90 },
  bottomContent: { flex: 1, padding: 12, justifyContent: 'center' },
  bottomName: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
  bottomMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  bottomCta: { color: colors.tertiary, marginTop: 6, fontWeight: '700', fontSize: 12 },
  bottomClose: { padding: 12, alignSelf: 'flex-start' },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
