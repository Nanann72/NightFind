import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../lib/theme';

const { width } = Dimensions.get('window');

const slides = [
  {
    title: 'Découvrez la nuit',
    subtitle:
      'Les meilleurs clubs, bars et soirées festives autour de vous, à portée de doigt.',
    image:
      'https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&q=85',
    icon: 'sparkles' as const,
  },
  {
    title: 'Swipez vos favoris',
    subtitle:
      "Glissez à droite pour ajouter à vos favoris, à gauche pour passer. C'est simple.",
    image:
      'https://images.pexels.com/photos/31923252/pexels-photo-31923252.jpeg',
    icon: 'heart' as const,
  },
  {
    title: 'Tout près de vous',
    subtitle:
      'Activez la géolocalisation pour découvrir les meilleures adresses dans un rayon de 50 km.',
    image:
      'https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&q=85',
    icon: 'location' as const,
  },
];

export default function Onboarding() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(i);
  };

  const next = () => {
    if (index < slides.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
    } else {
      router.replace('/login');
    }
  };

  return (
    <View style={styles.container} testID="onboarding-screen">
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {slides.map((s, i) => (
          <ImageBackground
            key={i}
            source={{ uri: s.image }}
            style={styles.slide}
            imageStyle={{ opacity: 0.55 }}
          >
            <View style={styles.overlay} />
            <View style={styles.content}>
              <View style={styles.iconWrap}>
                <Ionicons name={s.icon} size={32} color={colors.tertiary} />
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.subtitle}>{s.subtitle}</Text>
            </View>
          </ImageBackground>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
        <TouchableOpacity
          style={styles.cta}
          onPress={next}
          testID="onboarding-next-btn"
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>
            {index === slides.length - 1 ? 'Commencer' : 'Suivant'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.bg} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.replace('/login')}
          testID="onboarding-skip-btn"
        >
          <Text style={styles.skip}>Passer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  slide: { width, flex: 1, justifyContent: 'flex-end' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.45)',
  },
  content: { padding: spacing.xl, paddingBottom: 220 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(0,240,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.xl,
    backgroundColor: 'rgba(9,9,11,0.85)',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
  },
  dotActive: { backgroundColor: colors.primary, width: 24 },
  cta: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: spacing.md,
  },
  ctaText: { color: colors.bg, fontSize: 16, fontWeight: '800' },
  skip: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
