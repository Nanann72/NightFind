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
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getToken } from '../lib/storage';
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
  const [cooldownPopup, setCooldownPopup] = useState<{ title: string; message: string } | null>(null);
  const [successPopup, setSuccessPopup] = useState(false);
  const [clubId, setClubId] = useState<string | null>(
    typeof params.club_id === 'string' ? params.club_id : null,
  );
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Two-step dual capture
  const [step, setStep] = useState<'idle' | 'camera' | 'capturing-back' | 'capturing-front' | 'compositing' | 'preview'>('idle');
  const [, setBackPhoto] = useState<string | null>(null); // kept via setter only
  const [frontPhoto, setFrontPhoto] = useState<string | null>(null); // full res base64
  const [compositeUri, setCompositeUri] = useState<string | null>(null);  // local uri for preview
  const [compositeB64, setCompositeB64] = useState<string | null>(null); // base64 for upload

  const [caption, setCaption] = useState('');
  const [flashOn, setFlashOn] = useState(false);
  const [audience, setAudience] = useState<'public' | 'friends'>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Caméra in-app (capture simultanée) + reprise unique
  const cameraRef = useRef<CameraView | null>(null);
  const frontResolverRef = useRef<((v: any) => void) | null>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [shooting, setShooting] = useState(false);
  const [retakesLeft, setRetakesLeft] = useState(1);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [recording, setRecording] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const previewPlayer = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = false;
  });
  useEffect(() => {
    if (videoUri) {
      try {
        previewPlayer.replace(videoUri);
        previewPlayer.play();
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUri]);

  const switchMode = async (m: 'photo' | 'video') => {
    if (m === 'video' && !micPerm?.granted) {
      const r = await requestMicPerm();
      if (!r.granted && !r.canAskAgain) {
        setError('Micro requis pour la vidéo — active-le dans les réglages.');
        return;
      }
      if (!r.granted) return;
    }
    setMode(m);
  };

  const recordVideo = async () => {
    if (!cameraRef.current) return;
    if (recording) {
      cameraRef.current.stopRecording();
      return;
    }
    setRecording(true);
    setError(null);
    buzz('medium');
    try {
      const v = await cameraRef.current.recordAsync({ maxDuration: 8 });
      if (v?.uri) {
        setVideoUri(v.uri);
        setStep('preview');
        buzz('success');
      }
    } catch (e: any) {
      setError(e?.message || 'Échec de la vidéo');
    } finally {
      setRecording(false);
    }
  };

  // 1) Verify window state on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ws = await api.momentWindowState();
        if (cancelled) return;
        if (ws.already_posted_here) {
          setClubId(ws.club_id || clubId);
          setCooldownPopup({
            title: 'Tu as déjà posté ici 📸',
            message: `Tu as déjà partagé un moment ${ws.club_name ? `au ${ws.club_name}` : 'dans cet établissement'} ces dernières 24h. Reviens dans ${ws.club_cooldown_hours_left ?? 24}h ou change d'établissement pour pouvoir reposter ✨`,
          });
          return;
        }
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

  // ---- Capture simultanée in-app (un seul déclencheur) ----
  // 1 tap : photo arrière capturée → bascule caméra avant → selfie AUTO.
  const takeShot = async (): Promise<{ uri: string; base64: string; width: number; height: number } | null> => {
    const cam = cameraRef.current;
    if (!cam) return null;
    const photo = await cam.takePictureAsync({ quality: 0.75, base64: true, exif: false });
    if (!photo?.base64) return null;
    return { uri: photo.uri, base64: photo.base64, width: photo.width || 1080, height: photo.height || 1440 };
  };

  const onShutterPress = async () => {
    if (shooting) return;
    setShooting(true);
    setError(null);
    try {
      // Photo arrière — instantanée
      buzz('medium');
      const back = await takeShot();
      if (!back) throw new Error('Capture arrière échouée');
      setBackPhoto(back.base64);

      // Bascule caméra avant : le selfie part AUTOMATIQUEMENT dès que prête
      setStep('capturing-front');
      setFacing('front');
      const front = await new Promise<Awaited<ReturnType<typeof takeShot>>>((resolve) => {
        frontResolverRef.current = resolve;
        // filet de sécurité si onCameraReady ne se déclenche pas
        setTimeout(async () => {
          if (frontResolverRef.current) {
            frontResolverRef.current = null;
            try { resolve(await takeShot()); } catch { resolve(null); }
          }
        }, 2500);
      });

      setStep('compositing');
      if (front?.base64) {
        buzz('medium');
        // Selfie séparé (overlay déplaçable/échangeable côté feed) — on ne
        // "brûle" plus le selfie dans la photo principale.
        try {
          const small = await ImageManipulator.manipulateAsync(
            front.uri,
            [{ resize: { width: 480 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          setFrontPhoto(`data:image/jpeg;base64,${small.base64}`);
        } catch {
          setFrontPhoto(`data:image/jpeg;base64,${front.base64}`);
        }
      }
      setCompositeUri(back.uri);
      setCompositeB64(`data:image/jpeg;base64,${back.base64}`);
      setStep('preview');
      buzz('success');
    } catch (e: any) {
      setError(e?.message || 'Échec de la capture');
      setStep('camera');
      buzz('error');
    } finally {
      setShooting(false);
      setFacing('back');
    }
  };

  const onCameraReady = async () => {
    // Auto-capture du selfie dès que la caméra avant est prête
    if (facing === 'front' && frontResolverRef.current) {
      const resolve = frontResolverRef.current;
      frontResolverRef.current = null;
      await new Promise((r) => setTimeout(r, 350)); // stabilisation exposition
      try {
        resolve(await takeShot());
      } catch {
        resolve(null);
      }
    }
  };

  const startDualCapture = async () => {
    setError(null);
    if (Platform.OS === 'web') {
      return startDualCaptureLegacy();
    }
    if (!camPerm?.granted) {
      const res = await requestCamPerm();
      if (!res.granted) {
        if (!res.canAskAgain) {
          Alert.alert(
            'Accès à la caméra refusé',
            'Va dans les Réglages pour autoriser Night Finder à utiliser la caméra.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          setError('Autorise la caméra pour poster ton moment.');
        }
        return;
      }
    }
    setFacing('back');
    setStep('camera');
  };

  const startDualCaptureLegacy = async () => {
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

      // ---- Step 3: selfie en data-URI léger (pas de composite brûlé) ----
      setStep('compositing');
      try {
        const small = await ImageManipulator.manipulateAsync(
          front.uri,
          [{ resize: { width: 480 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
        );
        setFrontPhoto(`data:image/jpeg;base64,${small.base64}`);
      } catch {
        setFrontPhoto(`data:image/jpeg;base64,${front.base64}`);
      }
      setCompositeUri(back.uri);
      setCompositeB64(`data:image/jpeg;base64,${back.base64}`);
      setStep('preview');
      buzz('success');
    } catch (e: any) {
      setError(e?.message || "Échec de la capture");
      setStep('idle');
      buzz('error');
    }
  };

  const retake = () => {
    if (retakesLeft <= 0) return;
    setRetakesLeft((n) => n - 1);
    setBackPhoto(null);
    setFrontPhoto(null);
    setCompositeUri(null);
    setCompositeB64(null);
    setVideoUri(null);
    setCaption('');
    setError(null);
    setFacing('back');
    setStep(Platform.OS === 'web' ? 'idle' : 'camera');
  };

  const submit = async () => {
    if ((!compositeB64 && !videoUri) || !clubId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (videoUri) {
        // ── Moment vidéo : upload vers l'object storage puis création ──
        const token = await getToken();
        const fd = new FormData();
        fd.append('file', { uri: videoUri, name: 'moment.mp4', type: 'video/mp4' } as any);
        const up = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/moments/video-upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error(err?.detail || 'Upload vidéo impossible');
        }
        const { media_id } = await up.json();
        await api.uploadMoment(clubId, undefined, caption.trim() || undefined, undefined, audience, media_id);
      } else {
        await api.uploadMoment(clubId, compositeB64!, caption.trim() || undefined, frontPhoto || undefined, audience);
      }
      buzz('success');
      setSuccessPopup(true);
    } catch (e: any) {
      buzz('error');
      // Cooldown / already-posted → pop-up premium ; autres erreurs → message inline
      const msg = e?.message || "Échec de l'envoi. Réessaie dans un instant.";
      if (e?.status === 429 || e?.status === 409) {
        setCooldownPopup({ title: 'Pas si vite ! ⏳', message: msg });
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = () => router.back();

  const dismissCooldown = () => {
    setCooldownPopup(null);
    router.replace('/(tabs)');
  };

  const goExplore = () => {
    setCooldownPopup(null);
    router.replace('/(tabs)/map');
  };

  const cooldownModal = (
    <Modal visible={!!cooldownPopup} transparent animationType="fade" onRequestClose={dismissCooldown}>
      <View style={styles.popupOverlay}>
        <Animated.View entering={FadeInDown.duration(250)} style={styles.popupCard} testID="moment-cooldown-popup">
          <View style={styles.popupIconWrap}>
            <Ionicons name="hourglass-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.popupTitle}>{cooldownPopup?.title}</Text>
          <Text style={styles.popupMsg}>{cooldownPopup?.message}</Text>
          <TouchableOpacity style={styles.popupPrimary} onPress={goExplore} testID="moment-popup-explore">
            <Ionicons name="map-outline" size={17} color="#fff" />
            <Text style={styles.popupPrimaryText}>Changer d&apos;établissement</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.popupSecondary} onPress={dismissCooldown} testID="moment-popup-ok">
            <Text style={styles.popupSecondaryText}>OK, je reviendrai</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );

  const successModal = (
    <Modal visible={successPopup} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.popupOverlay}>
        <Animated.View entering={FadeInDown.duration(250)} style={styles.popupCard} testID="moment-success-popup">
          <View style={[styles.popupIconWrap, { backgroundColor: 'rgba(74,222,128,0.14)' }]}>
            <Ionicons name="checkmark-circle" size={30} color="#4ADE80" />
          </View>
          <Text style={styles.popupTitle}>Moment posté ! 🎉</Text>
          <Text style={styles.popupMsg}>
            Ton moment est en ligne — tes amis peuvent le découvrir dès maintenant.
          </Text>
          <TouchableOpacity
            style={styles.popupPrimary}
            onPress={() => { setSuccessPopup(false); router.replace('/feed' as any); }}
            testID="moment-success-feed"
          >
            <Ionicons name="images-outline" size={17} color="#fff" />
            <Text style={styles.popupPrimaryText}>Voir le feed</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.popupSecondary}
            onPress={() => { setSuccessPopup(false); router.replace({ pathname: '/(tabs)', params: { moment_posted: '1' } }); }}
            testID="moment-success-ok"
          >
            <Text style={styles.popupSecondaryText}>Retour à l&apos;accueil</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );

  if (checking || cooldownPopup) {
    return (
      <View style={styles.loading}>
        <Ionicons name="aperture-outline" size={42} color={colors.tertiary} />
        <Text style={styles.loadingText}>Vérification de ta fenêtre…</Text>
        {cooldownModal}
      </View>
    );
  }

  const busy = step !== 'idle' && step !== 'preview' && step !== 'camera';
  const stepLabel: Record<typeof step, string> = {
    idle: '',
    camera: '',
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
        {step === 'camera' || step === 'capturing-front' ? (
          // ---- CAMÉRA IN-APP : 1 tap → arrière + selfie AUTO ----
          <View style={styles.cameraWrap}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              mode={mode === 'video' ? 'video' : 'picture'}
              flash={flashOn ? 'on' : 'off'}
              enableTorch={flashOn && facing === 'back'}
              onCameraReady={onCameraReady}
              animateShutter={false}
            />
            <View style={styles.cameraOverlay} pointerEvents="box-none">
              <TouchableOpacity
                style={[styles.flashBtn, flashOn && styles.flashBtnOn]}
                onPress={() => setFlashOn((f) => !f)}
                testID="moment-flash-toggle"
                hitSlop={8}
              >
                <Ionicons name={flashOn ? 'flash' : 'flash-off'} size={18} color={flashOn ? '#111' : '#fff'} />
              </TouchableOpacity>
              <Text style={styles.cameraHint}>
                {step === 'capturing-front' || facing === 'front'
                  ? '🤳 Selfie automatique… ne bouge pas'
                  : 'Un seul déclenchement : arrière + selfie'}
              </Text>
              {facing === 'back' && !shooting && !recording && (
                <View style={styles.modeRow}>
                  <TouchableOpacity
                    style={[styles.modePill, mode === 'photo' && styles.modePillActive]}
                    onPress={() => switchMode('photo')}
                    testID="moment-mode-photo"
                  >
                    <Text style={[styles.modePillText, mode === 'photo' && { color: '#111' }]} allowFontScaling={false}>Photo</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modePill, mode === 'video' && styles.modePillActive]}
                    onPress={() => switchMode('video')}
                    testID="moment-mode-video"
                  >
                    <Text style={[styles.modePillText, mode === 'video' && { color: '#111' }]} allowFontScaling={false}>Vidéo 8s</Text>
                  </TouchableOpacity>
                </View>
              )}
              {facing === 'back' && !shooting && (
                <TouchableOpacity
                  style={[styles.camShutter, recording && { borderColor: colors.primary }]}
                  onPress={mode === 'video' ? recordVideo : onShutterPress}
                  activeOpacity={0.85}
                  testID="moment-shutter"
                >
                  <View style={[styles.camShutterInner, recording && { backgroundColor: colors.primary, borderRadius: 8 }]} />
                </TouchableOpacity>
              )}
              {shooting && facing === 'back' && (
                <ActivityIndicator size="large" color="#fff" style={{ marginBottom: 26 }} />
              )}
            </View>
          </View>
        ) : compositeUri || videoUri ? (
          // ---- PREVIEW STATE ----
          <Animated.View entering={FadeInDown.duration(420)} style={styles.previewWrap}>
            <View style={styles.previewFrame}>
              {videoUri ? (
                <VideoView player={previewPlayer} style={styles.preview} contentFit="cover" nativeControls={false} />
              ) : (
                <Image source={{ uri: compositeUri! }} style={styles.preview} resizeMode="cover" />
              )}
              {/* If backend composite failed, still show selfie thumbnail */}
              {frontPhoto && !compositeB64?.includes('overlay') && (
                <Image
                  source={{ uri: frontPhoto }}
                  style={styles.selfieOverlay}
                />
              )}
              {retakesLeft > 0 ? (
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={retake}
                  testID="moment-retake"
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh" size={16} color={colors.textPrimary} />
                  <Text style={styles.retakeText}>Reprendre (1 seule fois)</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.retakeBtn}>
                  <Ionicons name="lock-closed" size={14} color={colors.textTertiary} />
                  <Text style={[styles.retakeText, { color: colors.textTertiary }]}>Reprise utilisée</Text>
                </View>
              )}
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

            {/* ── Audience : Public / Amis ── */}
            <View style={styles.audienceRow}>
              <TouchableOpacity
                style={[styles.audienceChip, audience === 'public' && styles.audienceChipActive]}
                onPress={() => setAudience('public')}
                testID="moment-audience-public"
              >
                <Ionicons name="globe-outline" size={15} color={audience === 'public' ? '#fff' : colors.textSecondary} />
                <Text style={[styles.audienceText, audience === 'public' && styles.audienceTextActive]}>Public</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.audienceChip, audience === 'friends' && styles.audienceChipActive]}
                onPress={() => setAudience('friends')}
                testID="moment-audience-friends"
              >
                <Ionicons name="people-outline" size={15} color={audience === 'friends' ? '#fff' : colors.textSecondary} />
                <Text style={[styles.audienceText, audience === 'friends' && styles.audienceTextActive]}>Amis</Text>
              </TouchableOpacity>
              <Text style={styles.audienceHint}>
                {audience === 'friends' ? 'Visible par tes abonnés uniquement' : 'Visible par tout le monde'}
              </Text>
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
        {(compositeUri || videoUri) && (
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
      {successModal}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  cameraWrap: {
    flex: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  flashBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashBtnOn: { backgroundColor: '#FDE047' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modePill: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  modePillActive: { backgroundColor: '#fff' },
  modePillText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  audienceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  audienceChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  audienceText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  audienceTextActive: { color: '#fff' },
  audienceHint: { color: colors.textTertiary, fontSize: 11.5, flexShrink: 1 },
  cameraHint: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: 14,
  },
  camShutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  camShutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#fff',
  },
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
  popupOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  popupCard: {
    width: '100%', maxWidth: 360, backgroundColor: colors.surfaceElevated,
    borderRadius: 24, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  popupIconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(225,29,72,0.14)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  popupTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  popupMsg: {
    color: colors.textSecondary, fontSize: 14.5, lineHeight: 21,
    textAlign: 'center', marginTop: 8, marginBottom: 20,
  },
  popupPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingVertical: 14, alignSelf: 'stretch',
  },
  popupPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  popupSecondary: { paddingVertical: 14, alignSelf: 'stretch', alignItems: 'center' },
  popupSecondaryText: { color: colors.textSecondary, fontSize: 14.5, fontWeight: '700' },
});

// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _colors = darkColors;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _styles = makeStyles(darkColors);
