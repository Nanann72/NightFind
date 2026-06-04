import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import { storage } from '../lib/storage';
import { colors, radius, spacing } from '../lib/theme';

const TUTORIAL_KEY = 'nf_swipe_tutorial_seen';
const { width } = Dimensions.get('window');

const STEPS = [
  {
    icon: 'arrow-back' as const,
    color: '#ef4444',
    direction: 'left' as const,
    title: 'Swipe à gauche',
    body: 'Pour passer un club qui ne te tente pas.',
  },
  {
    icon: 'arrow-forward' as const,
    color: '#22c55e',
    direction: 'right' as const,
    title: 'Swipe à droite',
    body: 'Pour liker et l\'ajouter à tes favoris.',
  },
  {
    icon: 'information-circle' as const,
    color: '#FFD700',
    direction: 'up' as const,
    title: 'Tape sur ℹ️',
    body: 'Pour voir les détails et la programmation.',
  },
];

export function SwipeTutorial() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const tx = useSharedValue(0);

  useEffect(() => {
    (async () => {
      const seen = await storage.get(TUTORIAL_KEY);
      if (!seen) setVisible(true);
    })();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const s = STEPS[step];
    const target = s.direction === 'left' ? -40 : s.direction === 'right' ? 40 : 0;
    const targetY = s.direction === 'up' ? -40 : 0;
    tx.value = withRepeat(
      withSequence(
        withTiming(target || targetY || 0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [visible, step]);

  const arrowStyle = useAnimatedStyle(() => {
    const s = STEPS[step];
    if (s.direction === 'up') return { transform: [{ translateY: tx.value }] };
    return { transform: [{ translateX: tx.value }] };
  });

  const next = async () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    await storage.set(TUTORIAL_KEY, '1');
    setVisible(false);
  };

  const skip = async () => {
    await storage.set(TUTORIAL_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;
  const s = STEPS[step];

  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.root} pointerEvents="box-none">
      <View style={styles.backdrop} pointerEvents="auto" />
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.arrowWrap,
            { backgroundColor: `${s.color}25`, borderColor: `${s.color}88` },
            arrowStyle,
          ]}
        >
          <Ionicons name={s.icon} size={42} color={s.color} />
        </Animated.View>
        <Text style={styles.title}>{s.title}</Text>
        <Text style={styles.body}>{s.body}</Text>

        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === step && { backgroundColor: colors.primary, width: 22 },
              ]}
            />
          ))}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={skip} style={styles.skipBtn} testID="tutorial-skip">
            <Text style={styles.skipText}>Passer</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={next} style={styles.nextBtn} testID="tutorial-next">
            <Text style={styles.nextText}>
              {step < STEPS.length - 1 ? 'Suivant' : 'C\'est parti'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.82)',
  },
  center: {
    width: Math.min(width - 48, 340),
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
  },
  arrowWrap: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 22,
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 18,
    marginBottom: 22,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
  skipBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center', backgroundColor: colors.bg },
  skipText: { color: colors.textSecondary, fontWeight: '700' },
  nextBtn: { flex: 2, paddingVertical: 14, borderRadius: radius.lg, alignItems: 'center', backgroundColor: colors.primary },
  nextText: { color: colors.bg, fontWeight: '900' },
});
