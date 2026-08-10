import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  useReducedMotion,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const BAR_WIDTH = 132;
const STARTUP_TIMEOUT_MS = 10_000;

/**
 * Premium launch sequence — iOS 26 style.
 *  1. Logo fades/scales in (0.82 → 1, spring) over the brand background.
 *  2. Subtle "breathing" pulse (1 → 1.035 → 1) + soft halo.
 *  3. App name slides up slightly after the logo.
 *  4. Thin rounded progress bar reflects REAL startup work
 *     (fonts → session/auth) — never artificially delayed.
 *  5. Exit: logo shrinks slightly + whole view fades → main screen.
 *  Respects Reduce Motion. Never traps the user: 10s timeout → retry UI.
 */
export default function Index() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, loading } = useAuth();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [fontsLoaded] = useFonts({
    'Exo2-BlackItalic': require('../assets/fonts/Exo2-BlackItalic.ttf'),
  });
  const [startupError, setStartupError] = useState(false);
  const navigatedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  // ---- Animated values ----
  const logoOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const logoScale = useSharedValue(reducedMotion ? 1 : 0.82);
  const pulse = useSharedValue(1);
  const halo = useSharedValue(0);
  const nameOpacity = useSharedValue(reducedMotion ? 1 : 0);
  const nameShift = useSharedValue(reducedMotion ? 0 : 10);
  const rootOpacity = useSharedValue(1);
  const progress = useSharedValue(0);

  // Phase 1+2 — entrance, then gentle breathing
  useEffect(() => {
    if (reducedMotion) return;
    logoOpacity.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    halo.value = withDelay(300, withTiming(1, { duration: 700 }));
    pulse.value = withDelay(
      850,
      withRepeat(
        withSequence(
          withTiming(1.035, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
          withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
      ),
    );
    nameOpacity.value = withDelay(380, withTiming(1, { duration: 450 }));
    nameShift.value = withDelay(380, withSpring(0, { damping: 16, stiffness: 140 }));
  }, [reducedMotion]);

  // ---- Real startup progress: fonts (45%) → session/auth (100%) ----
  useEffect(() => {
    let p = 0.12; // services/JS runtime already up
    if (fontsLoaded) p = 0.45;
    if (fontsLoaded && !loading) p = 1;
    progress.value = withTiming(p, { duration: 320, easing: Easing.out(Easing.quad) });
  }, [fontsLoaded, loading]);

  const go = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    if (user) router.replace('/(tabs)');
    else router.replace('/onboarding');
  }, [user, router]);

  // ---- Exit as soon as the app is truly ready (min 650ms to avoid flash) ----
  useEffect(() => {
    if (loading || !fontsLoaded || startupError) return;
    const elapsed = Date.now() - mountedAtRef.current;
    const wait = Math.max(0, 650 - elapsed);
    const t = setTimeout(() => {
      if (reducedMotion) {
        go();
        return;
      }
      // Logo slightly shrinks + full fade → main screen (single experience)
      logoScale.value = withTiming(0.94, { duration: 300, easing: Easing.in(Easing.cubic) });
      rootOpacity.value = withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(go)();
      });
    }, wait);
    return () => clearTimeout(t);
  }, [loading, fontsLoaded, startupError, reducedMotion, go]);

  // ---- Never trap the user on the splash ----
  useEffect(() => {
    const t = setTimeout(() => {
      if (!navigatedRef.current && (loading || !fontsLoaded)) setStartupError(true);
    }, STARTUP_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading, fontsLoaded]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value * pulse.value }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value,
    transform: [{ scale: 0.9 + halo.value * 0.1 + (pulse.value - 1) * 2 }],
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));
  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));
  const barStyle = useAnimatedStyle(() => ({ width: progress.value * BAR_WIDTH }));

  if (startupError) {
    return (
      <View style={[styles.container, styles.errorWrap]} testID="splash-error">
        <View style={styles.errorBubble}>
          <Ionicons name="cloud-offline" size={30} color={colors.danger} />
        </View>
        <Text style={styles.errorTitle}>Impossible de démarrer l&apos;application</Text>
        <Text style={styles.errorSub}>Vérifie ta connexion internet puis réessaie.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            setStartupError(false);
            navigatedRef.current = false;
            mountedAtRef.current = Date.now();
            if (!loading && fontsLoaded) go();
          }}
          testID="splash-retry"
        >
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, rootStyle]} testID="splash-screen">
      <LinearGradient
        colors={['#1c060c', colors.bg, colors.bg]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.center}>
        {/* Soft radial halo behind the logo — true radial gradient (never square) */}
        <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none">
          <Svg width={320} height={320}>
            <Defs>
              <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.32" />
                <Stop offset="55%" stopColor={colors.primary} stopOpacity="0.10" />
                <Stop offset="100%" stopColor={colors.primary} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx="160" cy="160" r="160" fill="url(#haloGrad)" />
          </Svg>
        </Animated.View>
        {fontsLoaded && (
          <Animated.Text style={[styles.nf, logoStyle]} allowFontScaling={false}>
            NF
          </Animated.Text>
        )}
        <Animated.Text style={[styles.appName, nameStyle]} allowFontScaling={false}>
          NIGHT FINDER
        </Animated.Text>
      </View>
      {/* Thin rounded progress bar reflecting real startup state */}
      <View style={styles.barZone} pointerEvents="none">
        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, barStyle]} />
        </View>
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  halo: {
    // Pure transparent wrapper — the glow comes ONLY from the SVG radial gradient,
    // so it fades to zero smoothly with no square/hard edges.
    position: 'absolute',
    width: 320,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nf: {
    color: colors.textPrimary,
    fontFamily: 'Exo2-BlackItalic',
    fontSize: 96,
    letterSpacing: 2,
    textShadowColor: colors.primary,
    textShadowRadius: 26,
    textShadowOffset: { width: 0, height: 0 },
  },
  appName: {
    marginTop: 14,
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 7,
  },
  barZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '12%',
    alignItems: 'center',
  },
  barTrack: {
    width: BAR_WIDTH,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  errorWrap: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorBubble: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorSub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    backgroundColor: colors.primary,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
    minHeight: 48,
  },
  retryText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});
