import { useEffect, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const PULSE_DURATION_MS = 1400;

export default function Index() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, loading } = useAuth();
  const router = useRouter();

  // Pulse animation for the diamond
  const scale = useSharedValue(0.8);
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.92, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    ring1.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }),
      -1,
    );
    ring2.value = withDelay(
      800,
      withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1),
    );
  }, []);

  useEffect(() => {
    if (loading) return;
    // Hold the splash a little so the animation can play
    const t = setTimeout(() => {
      if (user) router.replace('/(tabs)');
      else router.replace('/onboarding');
    }, 1200);
    return () => clearTimeout(t);
  }, [user, loading, router]);

  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ring1Style = useAnimatedStyle(() => ({
    opacity: 1 - ring1.value,
    transform: [{ scale: 1 + ring1.value * 2.5 }],
  }));
  const ring2Style = useAnimatedStyle(() => ({
    opacity: 1 - ring2.value,
    transform: [{ scale: 1 + ring2.value * 2.5 }],
  }));

  return (
    <View style={styles.container} testID="splash-screen">
      <LinearGradient
        colors={['#1a0a14', colors.bg, colors.bg]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.center}>
        <View style={styles.logoWrap}>
          <Animated.View style={[styles.ring, ring1Style]} />
          <Animated.View style={[styles.ring, ring2Style]} />
          <Animated.View style={[styles.logoBubble, logoStyle]}>
            <Ionicons name="moon" size={36} color={colors.primary} />
          </Animated.View>
        </View>
        <Animated.Text entering={FadeInDown.delay(200).duration(600)} style={styles.brand}>
          NIGHT FINDER
        </Animated.Text>
        <Animated.Text entering={FadeIn.delay(450).duration(600)} style={styles.tag}>
          FIND THE NIGHT.
        </Animated.Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoWrap: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  ring: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  logoBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(224,26,79,0.15)',
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 6,
  },
  tag: {
    color: colors.primary,
    marginTop: 6,
    fontSize: 11,
    letterSpacing: 4,
    fontWeight: '700',
  },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
