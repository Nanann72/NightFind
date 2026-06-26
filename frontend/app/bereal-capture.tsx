import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

/**
 * BeReal-style live moment capture.
 *
 * Uses expo-image-picker's `launchCameraAsync` (which delegates to the
 * OS native camera UI) to avoid pulling in `expo-camera`'s native module —
 * the previous root cause of the iOS black-screen TestFlight crash.
 *
 * Flow:
 *  1. On mount → verify the user is still inside their 5-min capture window
 *     by calling /moments/window-state. If not → bounce back to the map.
 *  2. Show a "Prendre la photo" CTA that opens the native camera.
 *  3. Once captured, allow an optional caption then upload to
 *     POST /clubs/{club_id}/moments as base64.
 */
export default function BeRealCapture() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ club_id?: string }>();

  const [checking, setChecking] = useState(true);
  const [clubId, setClubId] = useState<string | null>(
    typeof params.club_id === 'string' ? params.club_id : null,
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1) Verify window state on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = await api.momentWindowState();
        if (cancelled) return;
        if (!ws.in_window) {
          // Either expired or already posted — bounce back politely.
          router.replace('/(tabs)');
          return;
        }
        setClubId(ws.club_id || clubId);
        setSecondsLeft(Math.max(0, ws.seconds_left || 0));
      } catch {
        // If endpoint fails (e.g. offline), allow capture if we got a club_id via params.
        if (!clubId) router.replace('/(tabs)');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2) Countdown
  useEffect(() => {
    if (checking) return;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(tickRef.current!);
          // Don't redirect immediately if user already has a photo to post.
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [checking]);

  const openCamera = async () => {
    setError(null);
    try {
      // Ensure camera permission (expo-image-picker handles the prompt + Settings redirect).
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            'Accès à la caméra refusé',
            "Va dans les Réglages pour autoriser Night Finder à utiliser la caméra et poster ton moment.",
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          setError("Autorise la caméra pour poster ton moment.");
        }
        return;
      }

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
        cameraType: ImagePicker.CameraType.back,
        allowsEditing: false,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        setError("Impossible de récupérer la photo.");
        return;
      }
      const mime = asset.mimeType || 'image/jpeg';
      setPhotoB64(`data:${mime};base64,${asset.base64}`);
    } catch (e: any) {
      setError(e?.message || "Échec ouverture caméra.");
    }
  };

  const submit = async () => {
    if (!photoB64 || !clubId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.uploadMoment(clubId, photoB64, caption.trim() || undefined);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      // Show toast-like confirmation on the destination screen via params if needed.
      router.replace({ pathname: '/(tabs)', params: { moment_posted: '1' } });
    } catch (e: any) {
      setError(e?.message || "Échec de l'envoi. Réessaie dans un instant.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = () => router.back();

  if (checking) {
    return (
      <View style={styles.loading}>
        <Ionicons name="aperture-outline" size={42} color={colors.tertiary} />
        <Text style={styles.loadingText}>Vérification de ta fenêtre…</Text>
      </View>
    );
  }

  const expired = secondsLeft <= 0 && !photoB64;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={cancel}
          style={styles.topBtn}
          testID="bereal-close"
          hitSlop={10}
        >
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>MOMENT EN DIRECT</Text>
        </View>
        <View style={styles.timer}>
          <Ionicons
            name="time-outline"
            size={14}
            color={secondsLeft < 30 ? colors.primary : colors.tertiary}
          />
          <Text
            style={[
              styles.timerText,
              { color: secondsLeft < 30 ? colors.primary : colors.tertiary },
            ]}
          >
            {Math.floor(secondsLeft / 60)
              .toString()
              .padStart(1, '0')}
            :{(secondsLeft % 60).toString().padStart(2, '0')}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {!photoB64 ? (
          <Animated.View entering={FadeIn.duration(450)} style={styles.placeholder}>
            <View style={styles.iconBubble}>
              <Ionicons name="camera" size={48} color={colors.tertiary} />
            </View>
            <Text style={styles.title}>Capture ton moment</Text>
            <Text style={styles.subtitle}>
              {expired
                ? 'Ta fenêtre de 5 min est expirée — mais tu peux quand même poster si tu as déjà ta photo.'
                : "Une photo en direct, partagée avec les fêtards présents au club ce soir. Visible 24h (7j en Premium)."}
            </Text>
            <TouchableOpacity
              style={styles.shutter}
              onPress={openCamera}
              activeOpacity={0.85}
              testID="bereal-open-camera"
            >
              <View style={styles.shutterInner}>
                <Ionicons name="camera" size={26} color={colors.bg} />
              </View>
              <Text style={styles.shutterText}>Prendre la photo</Text>
            </TouchableOpacity>
            {error && <Text style={styles.error}>{error}</Text>}
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(420)} style={styles.previewWrap}>
            <Image source={{ uri: photoB64 }} style={styles.preview} resizeMode="cover" />
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={openCamera}
              testID="bereal-retake"
            >
              <Ionicons name="refresh" size={16} color={colors.textPrimary} />
              <Text style={styles.retakeText}>Reprendre</Text>
            </TouchableOpacity>
            <View style={styles.captionWrap}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Ajoute une légende (optionnel)…"
                placeholderTextColor={colors.textTertiary}
                maxLength={140}
                style={styles.captionInput}
                multiline
                testID="bereal-caption"
              />
              <Text style={styles.captionCount}>{caption.length}/140</Text>
            </View>
            {error && <Text style={styles.error}>{error}</Text>}
          </Animated.View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {photoB64 && (
          <TouchableOpacity
            style={[styles.cta, submitting && styles.ctaDisabled]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.9}
            testID="bereal-submit"
          >
            <Ionicons name="send" size={18} color={colors.bg} />
            <Text style={styles.ctaText}>
              {submitting ? 'Envoi…' : 'Publier mon moment'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: 10,
    gap: 12,
  },
  topBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  brandDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.tertiary,
  },
  brandText: {
    color: colors.textPrimary,
    fontWeight: '900',
    letterSpacing: 2.5,
    fontSize: 10,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  timerText: { fontSize: 12, fontWeight: '800' },
  content: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  placeholder: { alignItems: 'center', gap: 16 },
  iconBubble: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(0,240,255,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,240,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  shutter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: radius.full,
    backgroundColor: colors.tertiary,
    marginTop: 12,
  },
  shutterInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(9,9,11,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterText: { color: colors.bg, fontWeight: '900', fontSize: 15 },
  previewWrap: { gap: 12 },
  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  retakeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.7)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  retakeText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  captionWrap: { marginTop: 6, position: 'relative' },
  captionInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 56,
    minHeight: 56,
    fontSize: 14,
    fontWeight: '500',
    textAlignVertical: 'top',
  },
  captionCount: {
    position: 'absolute',
    right: 10,
    bottom: 8,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  error: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: 12 },
  cta: {
    flexDirection: 'row',
    paddingVertical: 16,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.bg, fontSize: 16, fontWeight: '900' },
});
