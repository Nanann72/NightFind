import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { api } from '../lib/api';
import { useLocation } from '../lib/useLocation';
import { useClubs } from '../lib/clubs';
import { scanOnce } from '../lib/audioRecognition';
import { colors, radius, spacing } from '../lib/theme';

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type ClubGroup = {
  club_id: string;
  club_name: string;
  songs: {
    song_id: string;
    title: string;
    artist?: string | null;
    detected_at?: string;
    source?: string;
  }[];
};

export default function MySongs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loc = useLocation();
  const { clubs } = useClubs();
  const [data, setData] = useState<ClubGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const pulse = useSharedValue(1);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  useEffect(() => {
    if (scanning) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 700, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [scanning, pulse]);

  const onScanPress = async () => {
    if (scanning) return;
    if (Platform.OS === 'web') {
      Alert.alert(
        'Indisponible sur le web',
        "La reconnaissance audio nécessite l'app native (iPhone / Android).",
      );
      return;
    }
    if (!loc?.location) {
      Alert.alert('Localisation requise', 'Active la localisation pour identifier le club autour de toi.');
      return;
    }
    // Find nearest club within 500m
    const me = { lat: loc.location.coords.latitude, lng: loc.location.coords.longitude };
    let nearest: { club: any; km: number } | null = null;
    for (const c of clubs) {
      const km = distanceKm(me, { lat: c.lat, lng: c.lng });
      if (!nearest || km < nearest.km) nearest = { club: c, km };
    }
    if (!nearest || nearest.km > 0.5) {
      Alert.alert(
        'Aucun club détecté',
        'Tu dois être à moins de 500m d\'un club référencé pour scanner la musique.',
      );
      return;
    }
    setScanning(true);
    const result = await scanOnce(nearest.club);
    setScanning(false);
    if (!result.ok) {
      if (result.reason === 'no-mic-permission') {
        Alert.alert('Micro refusé', 'Active le microphone dans Réglages > Night Finder.');
      } else if (result.reason === 'native-only') {
        Alert.alert('Indisponible', "Disponible uniquement sur l'app iOS/Android.");
      } else {
        Alert.alert('Erreur', "Impossible de scanner la musique. Réessaie dans quelques secondes.");
      }
      return;
    }
    if (result.recognised && result.title) {
      Alert.alert(
        '🎵 Track identifié !',
        `${result.title}${result.artist ? ` — ${result.artist}` : ''}\n\nEnregistré dans ${nearest.club.name}.`,
      );
      load();
    } else {
      Alert.alert(
        'Aucun morceau identifié',
        'Approche-toi des enceintes et réessaie.',
      );
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listProfileSongs();
      setData(res.clubs);
      setTotal(res.total);
      // expand the first one by default
      if (res.clubs.length) {
        setExpanded({ [res.clubs[0].club_id]: true });
      }
    } catch {
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = (songId: string) => {
    Alert.alert('Supprimer ce morceau ?', '', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteProfileSong(songId);
            load();
          } catch {}
        },
      },
    ]);
  };

  const formatWhen = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="my-songs-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="songs-back-btn">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Mes musiques</Text>
          <Text style={styles.subtitle}>{total} morceaux capturés</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.scanWrap}>
        <Animated.View style={[styles.scanGlow, pulseStyle]} />
        <TouchableOpacity
          style={[styles.scanBtn, scanning && styles.scanBtnActive]}
          onPress={onScanPress}
          activeOpacity={0.85}
          disabled={scanning}
          testID="scan-music-btn"
        >
          {scanning ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Ionicons name="radio" size={32} color={colors.bg} />
          )}
        </TouchableOpacity>
        <Text style={styles.scanLabel}>
          {scanning ? 'Écoute en cours…' : 'Identifier la musique'}
        </Text>
        <Text style={styles.scanHelper}>
          {scanning
            ? '5 secondes d\'enregistrement, garde la main près des enceintes'
            : 'Auto quand tu es détecté en boîte · ou tape pour scanner maintenant'}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
      >
        {loading && data.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : data.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Aucun morceau encore</Text>
            <Text style={styles.emptyText}>
              Confirme ta présence dans un club pour activer la reconnaissance musicale en direct.
            </Text>
          </View>
        ) : (
          data.map((group) => {
            const isOpen = !!expanded[group.club_id];
            return (
              <View key={group.club_id} style={styles.clubBlock}>
                <TouchableOpacity
                  style={styles.clubHeader}
                  onPress={() =>
                    setExpanded((p) => ({ ...p, [group.club_id]: !p[group.club_id] }))
                  }
                  activeOpacity={0.8}
                  testID={`songs-club-${group.club_id}`}
                >
                  <View style={styles.clubIconWrap}>
                    <Ionicons name="musical-notes" size={18} color={colors.tertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clubName}>{group.club_name}</Text>
                    <Text style={styles.clubCount}>
                      {group.songs.length} morceau{group.songs.length > 1 ? 'x' : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.songsList}>
                    {group.songs.map((s) => (
                      <TouchableOpacity
                        key={s.song_id}
                        style={styles.songRow}
                        onLongPress={() => handleDelete(s.song_id)}
                        testID={`song-${s.song_id}`}
                      >
                        <View style={styles.songIcon}>
                          <Ionicons name="play" size={12} color={colors.bg} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.songTitle} numberOfLines={1}>
                            {s.title}
                          </Text>
                          <Text style={styles.songArtist} numberOfLines={1}>
                            {s.artist || 'Artiste inconnu'} · {formatWhen(s.detected_at)}
                          </Text>
                        </View>
                        {s.source === 'auto' ? (
                          <View style={styles.autoBadge}>
                            <Ionicons name="radio" size={9} color={colors.tertiary} />
                            <Text style={styles.autoText}>AUTO</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: colors.textTertiary, fontSize: 12, marginTop: 2, textAlign: 'center' },

  scanWrap: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    marginBottom: 4,
  },
  scanGlow: {
    position: 'absolute',
    top: 22,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(224,26,79,0.25)',
  },
  scanBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
  scanBtnActive: { backgroundColor: colors.tertiary },
  scanLabel: {
    marginTop: 14,
    color: colors.textPrimary,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  scanHelper: {
    marginTop: 4,
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  clubBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    overflow: 'hidden',
  },
  clubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  clubIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(34,211,238,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubName: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  clubCount: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  songsList: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  songIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  songArtist: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,211,238,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  autoText: { color: colors.tertiary, fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
