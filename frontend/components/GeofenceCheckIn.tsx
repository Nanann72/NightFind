import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { api, Club } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useClubs } from '../lib/clubs';
import { startLiveListeningMock } from '../lib/liveListening';
import { startLiveListening } from '../lib/audioRecognition';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const GEOFENCE_RADIUS_KM = 0.05; // 50m
const POLL_INTERVAL_MS = 60 * 1000;
// Once the user confirms being at a club, don't ask again for 6h.
const CONFIRMED_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// If they said "Non" or closed the modal, wait 2h before asking again.
const DISMISSED_COOLDOWN_MS = 2 * 60 * 60 * 1000;
// Global cooldown: after ANY confirmation, don't show the geofence modal at all
// (across all clubs) for this period — user is presumed to be in nightlife mode.
const GLOBAL_CONFIRMED_COOLDOWN_MS = 4 * 60 * 60 * 1000;

const STORAGE_KEY_DISMISSED = 'nf.geofence.dismissed';
const STORAGE_KEY_CONFIRMED = 'nf.geofence.lastConfirmed';

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function GeofenceCheckIn() {
  const router = useRouter();
  const { user } = useAuth();
  const { clubs } = useClubs();
  const [candidate, setCandidate] = useState<Club | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dismissed = useRef<Record<string, number>>({});
  const lastGlobalConfirmed = useRef<number>(0);
  const [storageReady, setStorageReady] = useState(false);

  // Load persisted state (survives component remount + app relaunch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawDismissed, rawConfirmed] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_DISMISSED),
          AsyncStorage.getItem(STORAGE_KEY_CONFIRMED),
        ]);
        if (cancelled) return;
        if (rawDismissed) {
          try { dismissed.current = JSON.parse(rawDismissed) || {}; } catch { dismissed.current = {}; }
        }
        if (rawConfirmed) {
          const ts = parseInt(rawConfirmed, 10);
          if (Number.isFinite(ts)) lastGlobalConfirmed.current = ts;
        }
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistDismissed = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_DISMISSED, JSON.stringify(dismissed.current));
    } catch {}
  };
  const persistConfirmed = async (ts: number) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_CONFIRMED, String(ts));
    } catch {}
  };

  // Pulsing music icon
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 900 }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  useEffect(() => {
    if (!user || clubs.length === 0 || !storageReady) return;
    let cancelled = false;

    const tick = async () => {
      try {
        // Global cooldown: if user confirmed at ANY club recently, skip entirely.
        if (Date.now() - lastGlobalConfirmed.current < GLOBAL_CONFIRMED_COOLDOWN_MS) return;

        let coords: { lat: number; lng: number } | null = null;
        if (Platform.OS === 'web') {
          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            coords = await new Promise((resolve) => {
              navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                () => resolve(null),
                { timeout: 5000 },
              );
            });
          }
        } else {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
        if (!coords || cancelled) return;

        // Find nearest club within radius
        let nearest: Club | null = null;
        let bestD = Infinity;
        for (const c of clubs) {
          const d = distanceKm(coords, { lat: c.lat, lng: c.lng });
          if (d <= GEOFENCE_RADIUS_KM && d < bestD) {
            bestD = d;
            nearest = c;
          }
        }
        if (!nearest) return;

        const last = dismissed.current[nearest.club_id] || 0;
        if (Date.now() - last < DISMISSED_COOLDOWN_MS) return;
        setCandidate(nearest);
      } catch {
        // ignore
      }
    };

    tick();
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, clubs, storageReady]);

  const respond = async (confirmed: boolean) => {
    if (!candidate) return;
    setSubmitting(true);
    try {
      await api.checkIn(candidate.club_id, confirmed);
      if (confirmed) {
        startLiveListening(candidate);
        startLiveListeningMock(candidate);
      }
    } catch {}

    const now = Date.now();
    // Set per-club cooldown (longer if user confirmed)
    dismissed.current[candidate.club_id] = now + (confirmed
      ? CONFIRMED_COOLDOWN_MS - DISMISSED_COOLDOWN_MS  // pushes effective cooldown to 6h
      : 0);
    if (confirmed) {
      lastGlobalConfirmed.current = now;
      await persistConfirmed(now);
    }
    await persistDismissed();

    const wasConfirmed = confirmed;
    const clubId = candidate.club_id;
    setSubmitting(false);
    setCandidate(null);
    if (wasConfirmed) {
      setTimeout(() => {
        router.push({ pathname: '/moment-capture', params: { club_id: clubId } });
      }, 250);
    }
  };

  const close = () => {
    if (candidate) {
      dismissed.current[candidate.club_id] = Date.now();
      persistDismissed();
    }
    setCandidate(null);
  };

  if (!candidate) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.root}>
        <View style={styles.backdrop} />
        <Animated.View entering={FadeInDown.duration(450)} style={styles.card} testID="geofence-card">
          <View style={styles.heroWrap}>
            <Image source={{ uri: candidate.photos[0] }} style={styles.hero} />
            <View style={styles.heroOverlay} />
            <Animated.View entering={FadeIn.delay(200)} style={[styles.musicBadge, pulseStyle]}>
              <Ionicons name="musical-notes" size={18} color={colors.bg} />
            </Animated.View>
            <TouchableOpacity onPress={close} style={styles.closeBtn} testID="geofence-close">
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.heroFooter}>
              <Text style={styles.heroTag}>📍 ON DIRAIT QUE TU Y ES</Text>
              <Text style={styles.heroTitle}>{candidate.name}</Text>
              <Text style={styles.heroMeta}>
                ⭐ {candidate.rating.toFixed(1)} · {candidate.music_styles.slice(0, 2).join(' · ')}
              </Text>
            </View>
          </View>

          <View style={styles.body}>
            <Text style={styles.q}>Tu es bien à {candidate.name} ?</Text>
            <Text style={styles.qSub}>
              On a détecté ta position dans le club. Confirme pour qu'on lance
              l'écoute musicale en arrière-plan et qu'on capture la vibe.
            </Text>

            <View style={styles.bullets}>
              <View style={styles.bullet}>
                <Ionicons name="radio" size={14} color={colors.tertiary} />
                <Text style={styles.bulletText}>Reconnaissance musicale en direct</Text>
              </View>
              <View style={styles.bullet}>
                <Ionicons name="trending-up" size={14} color={colors.tertiary} />
                <Text style={styles.bulletText}>Ta vibe boost les recos des autres</Text>
              </View>
              <View style={styles.bullet}>
                <Ionicons name="shield-checkmark" size={14} color={colors.tertiary} />
                <Text style={styles.bulletText}>100% anonyme, tu peux arrêter à tout moment</Text>
              </View>
            </View>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnNo]}
                onPress={() => respond(false)}
                disabled={submitting}
                testID="geofence-no-btn"
              >
                <Text style={styles.btnNoText}>Non</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnYes]}
                onPress={() => respond(true)}
                disabled={submitting}
                testID="geofence-yes-btn"
              >
                <Ionicons name="checkmark" size={18} color={colors.bg} />
                <Text style={styles.btnYesText}>Oui, j'y suis</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.75)' },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroWrap: { height: 200, position: 'relative' },
  hero: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.45)' },
  musicBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(9,9,11,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroFooter: { position: 'absolute', bottom: 14, left: 16, right: 16 },
  heroTag: {
    color: colors.tertiary,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 4,
  },
  heroTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  heroMeta: { color: colors.textSecondary, marginTop: 2, fontSize: 12, fontWeight: '600' },

  body: { padding: 20 },
  q: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  qSub: { color: colors.textSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  bullets: { marginTop: 14, gap: 8 },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulletText: { color: colors.textPrimary, fontWeight: '600', fontSize: 12 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  btnNo: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.borderStrong },
  btnNoText: { color: colors.textPrimary, fontWeight: '800' },
  btnYes: { backgroundColor: colors.primary },
  btnYesText: { color: colors.bg, fontWeight: '900', fontSize: 15 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
