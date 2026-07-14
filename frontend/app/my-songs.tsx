import { useEffect, useState, useCallback, useMemo } from 'react';
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
  Modal,
  TextInput,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
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
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loc = useLocation();
  const { clubs } = useClubs();
  // "Move song to club" modal state
  const [moveTarget, setMoveTarget] = useState<{ song_id: string; title: string; club_id: string } | null>(null);
  const [clubSearch, setClubSearch] = useState('');
  const [moving, setMoving] = useState(false);
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
    // Find nearest club within 500m (optional — scan still works without)
    let target: any = { club_id: 'manual_scan', name: 'Scan manuel' };
    if (loc.permission === 'granted' && !loc.loading) {
      const me = { lat: loc.coords.lat, lng: loc.coords.lng };
      let nearest: { club: any; km: number } | null = null;
      for (const c of clubs) {
        const km = distanceKm(me, { lat: c.lat, lng: c.lng });
        if (!nearest || km < nearest.km) nearest = { club: c, km };
      }
      if (nearest && nearest.km <= 0.5) {
        target = nearest.club;
      }
    }
    setScanning(true);
    const result = await scanOnce(target);
    setScanning(false);
    if (!result.ok) {
      // Show the real reason from Audd/mic/etc so the user knows what to fix
      const msg =
        result.errorMessage ||
        "Impossible de scanner la musique. Réessaie dans quelques secondes.";
      if (result.reason === 'no-mic-permission') {
        Alert.alert('Micro refusé', msg);
      } else if (result.reason === 'native-only') {
        Alert.alert('Indisponible', msg);
      } else if (result.reason === 'no-audio-recorded') {
        Alert.alert('Micro presque muet', msg);
      } else if (result.reason === 'audd-not-recognised') {
        Alert.alert('Reconnaissance échouée', msg);
      } else {
        Alert.alert('Erreur', msg);
      }
      return;
    }
    if (result.recognised && result.title) {
      Alert.alert(
        '🎵 Track identifié !',
        `${result.title}${result.artist ? ` — ${result.artist}` : ''}\n\nEnregistré dans ${target.name}.`,
      );
      load();
    } else {
      Alert.alert(
        'Aucune musique reconnue',
        'Essaie de rapprocher ton téléphone de la source sonore.',
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

  /** Open the song on Spotify or Deezer — uses the direct link stored at
   *  recognition time, falls back to a search URL so the tap always works. */
  const openStream = (s: any, platform: 'spotify' | 'deezer') => {
    const q = encodeURIComponent(`${s.artist || ''} ${s.title || ''}`.trim());
    const url =
      platform === 'spotify'
        ? s.spotify || `https://open.spotify.com/search/${q}`
        : s.deezer || `https://www.deezer.com/search/${q}`;
    Linking.openURL(url).catch(() => {});
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
      <ScanningOverlay visible={scanning} />
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
            ? "10 secondes d'écoute, rapproche ton téléphone de la source sonore"
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
                        onPress={() =>
                          setMoveTarget({ song_id: s.song_id, title: s.title, club_id: group.club_id })
                        }
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
                        <TouchableOpacity
                          style={[styles.streamBtn, { backgroundColor: 'rgba(30,215,96,0.15)' }]}
                          onPress={() => openStream(s, 'spotify')}
                          hitSlop={6}
                          testID={`spotify-${s.song_id}`}
                        >
                          <FontAwesome5 name="spotify" size={16} color="#1ED760" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.streamBtn, { backgroundColor: 'rgba(161,139,250,0.15)' }]}
                          onPress={() => openStream(s, 'deezer')}
                          hitSlop={6}
                          testID={`deezer-${s.song_id}`}
                        >
                          <FontAwesome5 name="deezer" size={13} color="#A78BFA" />
                        </TouchableOpacity>
                        {s.source === 'auto' ? (
                          <View style={styles.autoBadge}>
                            <Ionicons name="radio" size={9} color={colors.tertiary} />
                            <Text style={styles.autoText}>AUTO</Text>
                          </View>
                        ) : null}
                        <Ionicons name="swap-horizontal" size={14} color={colors.textTertiary} style={{ marginLeft: 6 }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Move song to another club ─────────────────── */}
      <Modal
        visible={!!moveTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setMoveTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle} numberOfLines={1}>
              Déplacer « {moveTarget?.title} »
            </Text>
            <Text style={styles.modalSub}>Choisis la boîte de nuit où enregistrer ce morceau</Text>
            <View style={styles.modalSearchBox}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
              <TextInput
                value={clubSearch}
                onChangeText={setClubSearch}
                placeholder="Rechercher un club…"
                placeholderTextColor={colors.textTertiary}
                style={styles.modalSearchInput}
                testID="move-club-search"
              />
            </View>
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              {clubs
                .filter((c) => c.name.toLowerCase().includes(clubSearch.trim().toLowerCase()))
                .slice(0, 40)
                .map((c) => {
                  const isCurrent = c.club_id === moveTarget?.club_id;
                  return (
                    <TouchableOpacity
                      key={c.club_id}
                      style={[styles.modalClubRow, isCurrent && styles.modalClubRowCurrent]}
                      disabled={isCurrent || moving}
                      onPress={async () => {
                        if (!moveTarget) return;
                        setMoving(true);
                        try {
                          await api.moveSong(moveTarget.song_id, c.club_id);
                          setMoveTarget(null);
                          setClubSearch('');
                          await load();
                        } catch (e: any) {
                          Alert.alert('Erreur', e?.message || 'Impossible de déplacer le morceau.');
                        } finally {
                          setMoving(false);
                        }
                      }}
                      testID={`move-to-${c.club_id}`}
                    >
                      <View style={styles.modalClubIcon}>
                        <Ionicons name="business" size={15} color={colors.primary} />
                      </View>
                      <Text style={styles.modalClubName} numberOfLines={1}>{c.name}</Text>
                      {isCurrent ? (
                        <Text style={styles.modalCurrentTag}>Actuel</Text>
                      ) : (
                        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
            {moving ? <ActivityIndicator color={colors.primary} style={{ marginTop: 10 }} /> : null}
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => { setMoveTarget(null); setClubSearch(''); }}
              testID="move-cancel"
            >
              <Text style={styles.modalCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textQuaternary,
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  modalSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, marginBottom: 14 },
  modalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  modalSearchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 10, fontSize: 14 },
  modalClubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalClubRowCurrent: { opacity: 0.45 },
  modalClubIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalClubName: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  modalCurrentTag: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  modalCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  modalCancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
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
    backgroundColor: 'rgba(139,92,246,0.25)',
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
  streamBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
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


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);

/** Fullscreen elegant overlay shown while the mic listens (Shazam-like). */
function ScanningOverlay({ visible }: { visible: boolean }) {
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      ring1.value = 0;
      ring2.value = 0;
      ring1.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1);
      ring2.value = withRepeat(
        withSequence(withTiming(0, { duration: 900 }), withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) })),
        -1,
      );
    }
  }, [visible, ring1, ring2]);

  const r1Style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring1.value * 1.6 }],
    opacity: 0.5 * (1 - ring1.value),
  }));
  const r2Style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring2.value * 1.6 }],
    opacity: 0.5 * (1 - ring2.value),
  }));

  if (!visible) return null;
  return (
    <View style={ovStyles.backdrop} pointerEvents="auto" testID="scanning-overlay">
      <View style={ovStyles.center}>
        <Animated.View style={[ovStyles.ring, r1Style]} />
        <Animated.View style={[ovStyles.ring, r2Style]} />
        <View style={ovStyles.core}>
          <Ionicons name="musical-notes" size={30} color="#fff" />
        </View>
      </View>
      <Text style={ovStyles.title}>Écoute en cours…</Text>
      <Text style={ovStyles.sub}>Rapproche ton téléphone de la source sonore</Text>
    </View>
  );
}

const ovStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,5,5,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  center: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  core: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 28 },
  sub: { color: '#A1A1AA', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
});
