import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { useLocation } from '../lib/useLocation';
import { api, ActiveFriend } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0f0f12' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f0f12' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#888' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c1c20' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#06121a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

export default function MapImpl() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clubs } = useClubs();
  const loc = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [friends, setFriends] = useState<ActiveFriend[]>([]);
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

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.animateToRegion(initialRegion, 400);
    }
  }, [initialRegion]);

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
                <Text style={styles.calloutTitle}>{c.name}</Text>
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

      {selected && (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => router.push(`/club/${selected.club_id}` as any)}
          style={styles.bottomCard}
          testID={`map-selected-${selected.club_id}`}
        >
          <Image source={{ uri: selected.photos[0] }} style={styles.bottomImage} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
