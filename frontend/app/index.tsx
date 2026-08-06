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
import { useFonts } from 'expo-font';
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
  const [fontsLoaded] = useFonts({
    'Exo2-BlackItalic': require('../assets/fonts/Exo2-BlackItalic.ttf'),
  });

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
        {fontsLoaded && (
          <Animated.Text style={[styles.nf, logoStyle]} allowFontScaling={false}>
            NF
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nf: {
    color: colors.textPrimary,
    fontFamily: 'Exo2-BlackItalic',
    fontSize: 96,
    letterSpacing: 2,
    textShadowColor: colors.primary,
    textShadowRadius: 28,
    textShadowOffset: { width: 0, height: 0 },
  },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
