import { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useClubs } from '../../lib/clubs';
import { api, Club } from '../../lib/api';
import { colors, radius, spacing } from '../../lib/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CARD_W = Math.min(SCREEN_W - 32, 380);
const CARD_H = Math.min(SCREEN_H * 0.6, 560);
const SWIPE_THRESHOLD = 120;

export default function Swipe() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clubs, loading, toggleFavorite } = useClubs();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);

  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const deck = useMemo(() => clubs.slice(index, index + 3), [clubs, index]);

  useEffect(() => {
    if (clubs.length > 0 && index >= clubs.length) setDone(true);
  }, [clubs, index]);

  const goNext = (liked: boolean) => {
    const current = clubs[index];
    if (current) {
      api.recordSwipe(current.club_id, liked ? 'like' : 'skip').catch(() => {});
      if (liked) {
        toggleFavorite(current.club_id).catch?.(() => {});
      }
    }
    x.value = 0;
    y.value = 0;
    setIndex((i) => i + 1);
  };

  const onLike = () => {
    Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    x.value = withTiming(SCREEN_W, { duration: 250 }, () => runOnJS(goNext)(true));
  };
  const onSkip = () => {
    Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    x.value = withTiming(-SCREEN_W, { duration: 250 }, () => runOnJS(goNext)(false));
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY;
    })
    .onEnd(() => {
      if (x.value > SWIPE_THRESHOLD) {
        x.value = withTiming(SCREEN_W, { duration: 200 }, () => runOnJS(goNext)(true));
      } else if (x.value < -SWIPE_THRESHOLD) {
        x.value = withTiming(-SCREEN_W, { duration: 200 }, () => runOnJS(goNext)(false));
      } else {
        x.value = withSpring(0);
        y.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      {
        rotate: `${interpolate(
          x.value,
          [-SCREEN_W / 2, 0, SCREEN_W / 2],
          [-12, 0, 12],
          Extrapolation.CLAMP,
        )}deg`,
      },
    ],
  }));

  const likeOverlay = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const skipOverlay = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  if (loading) {
    return (
      <View style={[styles.container, styles.center]} testID="swipe-screen">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (done || deck.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]} testID="swipe-screen-empty">
        <Text style={styles.title}>Swipe</Text>
        <View style={styles.empty}>
          <Ionicons name="sparkles" size={48} color={colors.secondary} />
          <Text style={styles.emptyTitle}>C'est tout pour ce soir</Text>
          <Text style={styles.emptyText}>
            Vous avez parcouru tous les clubs disponibles. Modifiez vos filtres
            ou revenez plus tard.
          </Text>
          <TouchableOpacity
            style={styles.resetBtn}
            onPress={() => {
              setIndex(0);
              setDone(false);
            }}
            testID="swipe-reset-btn"
          >
            <Text style={styles.resetText}>Recommencer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]} testID="swipe-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Swipe</Text>
        <Text style={styles.subtitle}>
          {clubs.length - index} clubs à découvrir
        </Text>
      </View>

      <View style={styles.deckWrap}>
        {deck
          .slice()
          .reverse()
          .map((c, ri) => {
            const isTop = ri === deck.length - 1;
            const offset = (deck.length - 1 - ri) * 10;
            const scale = 1 - (deck.length - 1 - ri) * 0.04;
            if (isTop) {
              return (
                <GestureDetector key={c.club_id} gesture={pan}>
                  <Animated.View style={[styles.card, cardStyle]} testID={`swipe-card-${c.club_id}`}>
                    <CardContent club={c} />
                    <Animated.View style={[styles.overlay, styles.likeOverlay, likeOverlay]}>
                      <Text style={styles.likeText}>LIKE</Text>
                    </Animated.View>
                    <Animated.View style={[styles.overlay, styles.skipOverlay, skipOverlay]}>
                      <Text style={styles.skipText}>NOPE</Text>
                    </Animated.View>
                  </Animated.View>
                </GestureDetector>
              );
            }
            return (
              <View
                key={c.club_id}
                style={[
                  styles.card,
                  styles.cardBg,
                  {
                    transform: [{ scale }, { translateY: offset }],
                    opacity: 0.6,
                  },
                ]}
              >
                <CardContent club={c} />
              </View>
            );
          })}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, styles.skipBtn]} onPress={onSkip} testID="swipe-skip-btn">
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.infoBtn]}
          onPress={() => router.push(`/club/${clubs[index].club_id}` as any)}
          testID="swipe-info-btn"
        >
          <Ionicons name="information" size={22} color={colors.bg} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.likeBtn]} onPress={onLike} testID="swipe-like-btn">
          <Ionicons name="heart" size={28} color={colors.bg} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CardContent({ club }: { club: Club }) {
  return (
    <View style={styles.cardContent}>
      <Image source={{ uri: club.photos[0] }} style={styles.cardImage} />
      <View style={styles.cardGradient} />
      <View style={styles.cardInfo}>
        <View style={styles.cardChips}>
          {club.music_styles.slice(0, 3).map((m) => (
            <View key={m} style={styles.cardChip}>
              <Text style={styles.cardChipText}>{m}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.cardName}>{club.name}</Text>
        <Text style={styles.cardMeta}>
          ⭐ {club.rating.toFixed(1)} · {club.avg_price.toFixed(0)}€
          {club.distance_km != null ? ` · ${club.distance_km.toFixed(1)} km` : ''}
        </Text>
        <Text style={styles.cardDesc} numberOfLines={2}>
          {club.description}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, marginTop: 2 },
  deckWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cardBg: { borderColor: colors.border },
  cardContent: { flex: 1 },
  cardImage: { width: '100%', height: '100%' },
  cardGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.4)',
  },
  cardInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 24,
  },
  cardChips: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  cardChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cardChipText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  cardName: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  cardMeta: { color: colors.textPrimary, marginTop: 4, fontWeight: '700' },
  cardDesc: { color: colors.textSecondary, marginTop: 6, fontSize: 13 },
  overlay: {
    position: 'absolute',
    top: 30,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 3,
  },
  likeOverlay: {
    right: 24,
    borderColor: colors.primary,
    transform: [{ rotate: '12deg' }],
  },
  skipOverlay: {
    left: 24,
    borderColor: '#71717A',
    transform: [{ rotate: '-12deg' }],
  },
  likeText: { color: colors.primary, fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  skipText: { color: '#A1A1AA', fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    paddingBottom: 120,
    paddingTop: 12,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  skipBtn: { backgroundColor: colors.surface, borderColor: colors.borderStrong },
  infoBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  likeBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 16,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  resetBtn: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  resetText: { color: colors.bg, fontWeight: '800' },
});
