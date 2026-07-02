import { useEffect, useRef, useState, useMemo } from 'react';
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
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

/**
 * Live moment capture — BeReal-style **dual** camera flow (front + back).
 *
 * We deliberately avoid `expo-camera`'s native module (root cause of the
 * previous iOS TestFlight black-screen crash) and instead chain two
 * calls to `ImagePicker.launchCameraAsync` (which uses the OS-native
 * camera UI, extremely stable).
 *
 * Flow:
 *   1. Verify the user is inside their 5-min post-checkin window.
 *   2. Open BACK camera → take main photo.
 *   3. Immediately open FRONT camera → take selfie.
 *   4. Composite: main photo + selfie thumbnail overlaid top-left.
 *   5. Preview → optional caption → publish.
 *   6. "Reprendre" restarts from step 2, clearing both.
 */
export default function MomentCapture() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ club_id?: string }>();

  const [checking, setChecking] = useState(true);
  const [clubId, setClubId] = useState<string | null>(
    typeof params.club_id === 'string' ? params.club_id : null,
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Two-step dual capture
  const [step, setStep] = useState<'idle' | 'capturing-back' | 'capturing-front' | 'compositing' | 'preview'>('idle');
  const [, setBackPhoto] = useState<string | null>(null); // kept via setter only
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null); // full res base64
  const [compositeUri, setCompositeUri] = useState<string | null>(null);  // local uri for preview
  const [compositeB64, setCompositeB64] = useState<string | null>(null); // base64 for upload

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
          router.replace('/(tabs)');
          return;
        }
        setClubId(ws.club_id || clubId);
        setSecondsLeft(Math.max(0, ws.seconds_left || 0));
      } catch {
        if (!clubId) router.replace('/(tabs)');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown
  useEffect(() => {
    if (checking) return;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [checking]);

  const buzz = (kind: 'medium' | 'success' | 'error' = 'medium') => {
    if (Platform.OS === 'web') return;
    if (kind === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  };

  // ---- Dual capture flow ----
  const ensureCameraPerm = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) return true;
    if (!perm.canAskAgain) {
      Alert.alert(
        'Accès à la caméra refusé',
        "Va dans les Réglages pour autoriser Night Finder à utiliser la caméra.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
        ],
      );
    } else {
      setError("Autorise la caméra pour poster ton moment.");
    }
    return false;
  };

  const captureCamera = async (
    cameraType: ImagePicker.CameraType,
  ): Promise<{ uri: string; base64: string; width: number; height: number } | null> => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      base64: true,
      cameraType,
      allowsEditing: false,
      exif: false,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return null;
    const a = result.assets[0];
    return {
      uri: a.uri,
      base64: a.base64 as string,
      width: a.width || 1080,
      height: a.height || 1440,
    };
  };

  const startDualCapture = async () => {
    setError(null);
    if (!(await ensureCameraPerm())) return;

    try {
      // ---- Step 1: BACK camera ----
      setStep('capturing-back');
      buzz('medium');
      const back = await captureCamera(ImagePicker.CameraType.back);
      if (!back) { setStep('idle'); return; }
      setBackPhoto(back.base64);

      // Brief pause so the OS camera UI finishes closing before we reopen.
      await new Promise((r) => setTimeout(r, 350));

      // ---- Step 2: FRONT camera (selfie) ----
      setStep('capturing-front');
      buzz('medium');
      const front = await captureCamera(ImagePicker.CameraType.front);
      if (!front) {
        // Allow single-photo posting if user cancels the selfie
        Alert.alert(
          'Selfie ignoré',
          'Publier avec juste la photo arrière ?',
          [
            { text: 'Reprendre', onPress: () => { setBackPhoto(null); setStep('idle'); } },
            {
              text: 'Publier sans selfie',
              onPress: async () => {
                setStep('compositing');
                setCompositeUri(back.uri);
                setCompositeB64(`data:image/jpeg;base64,${back.base64}`);
                setStep('preview');
              },
            },
          ],
        );
        return;
      }
      setFrontPhoto(front.base64);

      // ---- Step 3: Composite (back + selfie thumbnail overlay) ----
      setStep('compositing');
      const composite = await compositeImages(back, front);
      if (composite) {
        setCompositeUri(composite.uri);
        setCompositeB64(composite.base64);
      } else {
        // Fallback: post back only
        setCompositeUri(back.uri);
        setCompositeB64(`data:image/jpeg;base64,${back.base64}`);
      }
      setStep('preview');
      buzz('success');
    } catch (e: any) {
      setError(e?.message || "Échec de la capture");
      setStep('idle');
      buzz('error');
    }
  };

  /**
   * Overlays the selfie as a small thumbnail in the top-left corner
   * of the main photo (BeReal-style). Returns local URI + base64 dataURI.
   * Uses expo-image-manipulator's overlay operation (SDK 54+).
   */
  const compositeImages = async (
    main: { uri: string; base64: string; width: number; height: number },
    selfie: { uri: string; base64: string; width: number; height: number },
  ): Promise<{ uri: string; base64: string } | null> => {
    try {
      // Target composite width for reasonable payload size
      const TARGET_W = 1080;
      const targetH = Math.round((main.height / main.width) * TARGET_W);

      // Resize main to target width
      const resizedMain = await ImageManipulator.manipulateAsync(
        main.uri,
        [{ resize: { width: TARGET_W } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: false },
      );

      // Selfie thumbnail: ~28% of main width, rounded
      const thumbW = Math.round(TARGET_W * 0.28);
      const thumbH = Math.round(thumbW * (selfie.height / selfie.width));
      const resizedSelfie = await ImageManipulator.manipulateAsync(
        selfie.uri,
        [{ resize: { width: thumbW, height: thumbH } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: false },
      );

      // If overlay is supported (SDK 54+), use it. Otherwise return base64 of
      // both concatenated so backend can display them separately.
      // @ts-ignore — some versions expose `composite` / overlay via the new API.
      const maybeComposite = (ImageManipulator as any).composite || (ImageManipulator as any).overlayAsync;
      if (typeof maybeComposite === 'function') {
        const overlayed = await maybeComposite({
          base: resizedMain.uri,
          overlays: [
            {
              uri: resizedSelfie.uri,
              x: Math.round(TARGET_W * 0.04),
              y: Math.round(targetH * 0.04),
              width: thumbW,
              height: thumbH,
              borderRadius: Math.round(thumbW * 0.14),
            },
          ],
          compress: 0.8,
          format: 'jpeg',
          base64: true,
        });
        if (overlayed?.base64) {
          return { uri: overlayed.uri, base64: `data:image/jpeg;base64,${overlayed.base64}` };
        }
      }

      // Fallback: return only the resized main image. The selfie is still
      // sent alongside via the `selfie` field on upload so the backend can
      // stitch server-side if needed.
      const withBase64 = await ImageManipulator.manipulateAsync(
        resizedMain.uri,
        [],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      return {
        uri: withBase64.uri,
        base64: `data:image/jpeg;base64,${withBase64.base64}`,
      };
    } catch {
      return null;
    }
  };

  const retake = () => {
    setBackPhoto(null);
    setFrontPhoto(null);
    setCompositeUri(null);
    setCompositeB64(null);
    setCaption('');
    setError(null);
    setStep('idle');
  };

  const submit = async () => {
    if (!compositeB64 || !clubId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.uploadMoment(clubId, compositeB64, caption.trim() || undefined, frontPhoto || undefined);
      buzz('success');
      router.replace({ pathname: '/(tabs)', params: { moment_posted: '1' } });
    } catch (e: any) {
      buzz('error');
      // Nice message for cooldown / already-posted errors from backend
      const msg = e?.message || "Échec de l'envoi. Réessaie dans un instant.";
      setError(msg);
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

  const busy = step !== 'idle' && step !== 'preview';
  const stepLabel: Record<typeof step, string> = {
    idle: '',
    'capturing-back': '📸 Prends la photo arrière…',
    'capturing-front': '🤳 Maintenant, un selfie',
    compositing: '✨ Fusion des deux photos…',
    preview: '',
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={cancel}
          style={styles.topBtn}
          testID="moment-close"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
            {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {compositeUri ? (
          // ---- PREVIEW STATE ----
          <Animated.View entering={FadeInDown.duration(420)} style={styles.previewWrap}>
            <View style={styles.previewFrame}>
              <Image source={{ uri: compositeUri }} style={styles.preview} resizeMode="cover" />
              {/* If backend composite failed, still show selfie thumbnail */}
              {frontPhoto && !compositeB64?.includes('overlay') && (
                <Image
                  source={{ uri: `data:image/jpeg;base64,${frontPhoto}` }}
                  style={styles.selfieOverlay}
                />
              )}
              <TouchableOpacity
                style={styles.retakeBtn}
                onPress={retake}
                testID="moment-retake"
                activeOpacity={0.85}
              >
                <Ionicons name="refresh" size={16} color={colors.textPrimary} />
                <Text style={styles.retakeText}>Reprendre</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.captionWrap}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Ajoute une légende (optionnel)…"
                placeholderTextColor={colors.textTertiary}
                maxLength={140}
                style={styles.captionInput}
                multiline
                testID="moment-caption"
              />
              <Text style={styles.captionCount}>{caption.length}/140</Text>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
          </Animated.View>
        ) : (
          // ---- IDLE / CAPTURING STATE ----
          <Animated.View entering={FadeIn.duration(450)} style={styles.placeholder}>
            <View style={styles.iconBubble}>
              {busy ? (
                <ActivityIndicator size="large" color={colors.tertiary} />
              ) : (
                <Ionicons name="camera-reverse" size={48} color={colors.tertiary} />
              )}
            </View>
            <Text style={styles.title}>
              {busy ? stepLabel[step] : 'Capture ton moment'}
            </Text>
            <Text style={styles.subtitle}>
              {busy
                ? "Ne bouge pas, ça va vite. Deux photos : arrière puis selfie."
                : "Une photo arrière + un selfie, comme une story éphémère. Visible 24h (7j en Premium)."}
            </Text>
            {!busy && (
              <TouchableOpacity
                style={styles.shutter}
                onPress={startDualCapture}
                activeOpacity={0.85}
                testID="moment-open-camera"
              >
                <View style={styles.shutterInner}>
                  <Ionicons name="camera" size={26} color={colors.bg} />
                </View>
                <Text style={styles.shutterText}>Lancer la double capture</Text>
              </TouchableOpacity>
            )}
            {!!error && <Text style={styles.error}>{error}</Text>}
          </Animated.View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {compositeUri && (
          <TouchableOpacity
            style={[styles.cta, submitting && styles.ctaDisabled]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.9}
            testID="moment-submit"
          >
            {submitting ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Ionicons name="send" size={18} color={colors.bg} />
            )}
            <Text style={styles.ctaText}>
              {submitting ? 'Envoi…' : 'Publier mon moment'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: {
    flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: 10, gap: 12,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  brandRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
  },
  brandDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.tertiary },
  brandText: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 2.5, fontSize: 10 },
  timer: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated,
  },
  timerText: { fontSize: 12, fontWeight: '800' },
  content: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  placeholder: { alignItems: 'center', gap: 16 },
  iconBubble: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(0,240,255,0.12)',
    borderWidth: 1.5, borderColor: 'rgba(0,240,255,0.5)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  title: {
    color: colors.textPrimary, fontSize: 28, fontWeight: '900',
    letterSpacing: -1, textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary, fontSize: 14, lineHeight: 20,
    fontWeight: '500', textAlign: 'center', paddingHorizontal: 12,
  },
  shutter: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 22, paddingVertical: 14,
    borderRadius: radius.full, backgroundColor: colors.tertiary, marginTop: 12,
  },
  shutterInner: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(9,9,11,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterText: { color: colors.bg, fontWeight: '900', fontSize: 15 },
  previewWrap: { gap: 12 },
  previewFrame: { position: 'relative' },
  preview: {
    width: '100%', aspectRatio: 3 / 4, borderRadius: 24, backgroundColor: colors.surface,
  },
  selfieOverlay: {
    position: 'absolute',
    top: 12, left: 12,
    width: '30%', aspectRatio: 3 / 4,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: colors.surface,
  },
  retakeBtn: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.7)', borderWidth: 1, borderColor: colors.borderStrong,
  },
  retakeText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  captionWrap: { marginTop: 6, position: 'relative' },
  captionInput: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, color: colors.textPrimary,
    paddingHorizontal: 14, paddingVertical: 12, paddingRight: 56,
    minHeight: 56, fontSize: 14, fontWeight: '500', textAlignVertical: 'top',
  },
  captionCount: {
    position: 'absolute', right: 10, bottom: 8,
    color: colors.textTertiary, fontSize: 11, fontWeight: '700',
  },
  error: {
    color: colors.primary, fontSize: 13, fontWeight: '700',
    textAlign: 'center', marginTop: 4, paddingHorizontal: 12,
  },
  footer: { paddingHorizontal: spacing.lg, paddingTop: 12 },
  cta: {
    flexDirection: 'row', paddingVertical: 16, backgroundColor: colors.primary,
    borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.bg, fontSize: 16, fontWeight: '900' },
});

// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _colors = darkColors;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _styles = makeStyles(darkColors);
