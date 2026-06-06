import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
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
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { UserActionsMenu } from '../../components/UserActionsMenu';
import { colors, radius, spacing } from '../../lib/theme';

const { width } = Dimensions.get('window');
const CARD_W = width - 32;
const CARD_H = Math.min(620, Math.round(width * 1.55));
const SWIPE_THRESHOLD = width * 0.28;

type SwipeProfile = {
  user_id: string;
  name: string;
  username?: string | null;
  age?: number | null;
  bio?: string;
  city?: string;
  instagram?: string;
  photos?: string[];
  music_prefs?: string[];
  fav_clubs?: string[];
};

export default function SwipePeople() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [deck, setDeck] = useState<SwipeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<{ remaining: number | null; limit: number | null; is_premium: boolean } | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q] = await Promise.all([api.swipeDeck(), api.swipeQuota()]);
      setDeck(d as any);
      setQuota(q);
    } catch {
      setDeck([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const profileComplete = !!user && (user as any).dob && Array.isArray((user as any).photos) && (user as any).photos.length > 0;

  const finishSwipe = useCallback(
    async (action: 'like' | 'pass') => {
      if (deck.length === 0) return;
      const card = deck[0];
      tx.value = 0;
      ty.value = 0;
      // Optimistically pop
      setDeck((d) => d.slice(1));
      setPhotoIdx(0);
      try {
        const fn = action === 'like' ? api.swipeLike : api.swipePass;
        await fn(card.user_id);
        // Refresh quota
        const q = await api.swipeQuota();
        setQuota(q);
        if (action === 'like') {
          // Soft feedback toast
        }
      } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('402') || msg.includes('Limite')) {
          Alert.alert(
            'Limite atteinte 💎',
            `Tu as utilisé tes ${quota?.limit ?? 10} swipes du jour. Passe Premium pour swiper sans limite !`,
            [
              { text: 'Plus tard', style: 'cancel' },
              { text: 'Passer Premium', onPress: () => router.push('/paywall') },
            ],
          );
          // Re-add the card we removed
          setDeck((d) => [card, ...d]);
        }
      }
    },
    [deck, tx, ty, quota, router],
  );

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        const dir = e.translationX > 0 ? 'like' : 'pass';
        tx.value = withTiming(e.translationX > 0 ? width * 1.5 : -width * 1.5, { duration: 220 });
        ty.value = withTiming(ty.value, { duration: 220 });
        runOnJS(finishSwipe)(dir);
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      {
        rotate: `${interpolate(tx.value, [-width / 2, 0, width / 2], [-15, 0, 15], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));

  const likeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const passOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  // Profile incomplete state
  if (!profileComplete) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40 }]} testID="swipe-incomplete-banner">
        <Ionicons name="person-circle" size={72} color={colors.tertiary} />
        <Text style={styles.bigTitle}>Complète ton profil pour swiper</Text>
        <Text style={styles.sub}>
          Ajoute au moins 1 photo et ta date de naissance pour rencontrer du monde.
        </Text>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push('/profile')}
          testID="goto-profile-btn"
        >
          <Text style={styles.ctaText}>Compléter mon profil</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (deck.length === 0) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
        <Ionicons name="sparkles" size={64} color={colors.tertiary} />
        <Text style={styles.bigTitle}>Plus personne à découvrir</Text>
        <Text style={styles.sub}>Repasse demain ou invite tes amis sur Night Finder.</Text>
        <TouchableOpacity style={styles.cta} onPress={loadDeck} testID="reload-deck">
          <Text style={styles.ctaText}>Rafraîchir</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const top = deck[0];
  const photo = top.photos?.[photoIdx] || top.photos?.[0];
  const photoSrc = photo
    ? photo.startsWith('http') || photo.startsWith('data:')
      ? photo
      : `data:image/jpeg;base64,${photo}`
    : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="swipe-people-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>SWIPE</Text>
        <Text style={styles.title}>Découvre du monde</Text>
        <View style={styles.quotaRow}>
          <Ionicons name="flash" size={14} color={colors.primary} />
          <Text style={styles.quotaText}>
            {quota?.is_premium
              ? 'Swipes illimités · Premium 💎'
              : `${quota?.remaining ?? 10} / ${quota?.limit ?? 10} swipes restants aujourd'hui`}
          </Text>
        </View>
      </View>

      <View style={[styles.cardArea, { width: CARD_W, height: CARD_H }]}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.card, cardStyle]}>
            {photoSrc ? (
              <Image source={{ uri: photoSrc }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoFallback]}>
                <Ionicons name="person" size={120} color={colors.textTertiary} />
              </View>
            )}
            {/* Photo pager dots */}
            {(top.photos?.length ?? 0) > 1 && (
              <View style={styles.dotsRow}>
                {top.photos!.map((_, i) => (
                  <View key={i} style={[styles.dot, i === photoIdx && styles.dotActive]} />
                ))}
              </View>
            )}
            {/* Report/Block menu — Apple 1.2 UGC */}
            <View style={styles.menuBtn} pointerEvents="box-none">
              <UserActionsMenu
                targetUserId={top.user_id}
                targetName={top.name}
                context="swipe"
                onBlocked={() => {
                  // Remove this profile from the deck after block
                  setDeck((d) => d.filter((p) => p.user_id !== top.user_id));
                }}
                renderTrigger={(open) => (
                  <TouchableOpacity
                    onPress={open}
                    style={styles.menuBtnCircle}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Signaler ou bloquer ce profil"
                    accessibilityRole="button"
                    testID="swipe-card-menu"
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              />
            </View>
            {/* Tap left/right to switch photos */}
            <View style={styles.tapZones}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => setPhotoIdx((i) => Math.max(0, i - 1))}
              />
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => setPhotoIdx((i) => Math.min((top.photos?.length ?? 1) - 1, i + 1))}
              />
            </View>

            {/* LIKE / PASS overlays */}
            <Animated.View style={[styles.overlay, styles.overlayLike, likeOpacity]}>
              <Text style={styles.overlayText}>LIKE</Text>
            </Animated.View>
            <Animated.View style={[styles.overlay, styles.overlayPass, passOpacity]}>
              <Text style={styles.overlayText}>NOPE</Text>
            </Animated.View>

            <View style={styles.gradient} />
            <View style={styles.info}>
              <Text style={styles.name}>
                {top.name}
                {top.age != null ? `, ${top.age}` : ''}
              </Text>
              {!!top.city && <Text style={styles.city}>{top.city}</Text>}
              {!!top.bio && (
                <Text style={styles.bio} numberOfLines={3}>
                  {top.bio}
                </Text>
              )}
              {top.music_prefs && top.music_prefs.length > 0 && (
                <View style={styles.tagsRow}>
                  {top.music_prefs.slice(0, 4).map((m) => (
                    <View key={m} style={styles.tag}>
                      <Text style={styles.tagText}>{m}</Text>
                    </View>
                  ))}
                </View>
              )}
              {!!top.instagram && (
                <Text style={styles.insta}>📸 @{top.instagram}</Text>
              )}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + 120 }]}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.passBtn]}
          onPress={() => {
            tx.value = withTiming(-width * 1.5, { duration: 220 });
            finishSwipe('pass');
          }}
          testID="action-pass"
          activeOpacity={0.8}
        >
          <Ionicons name="close" size={32} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.likeBtn]}
          onPress={() => {
            tx.value = withTiming(width * 1.5, { duration: 220 });
            finishSwipe('like');
          }}
          testID="action-like"
          activeOpacity={0.8}
        >
          <Ionicons name="heart" size={32} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: colors.bg, padding: 24 },
  header: { width: '100%', paddingHorizontal: spacing.lg, marginBottom: 12, alignSelf: 'flex-start' },
  brand: { color: colors.primary, fontWeight: '900', fontSize: 11, letterSpacing: 3 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  quotaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  quotaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  cardArea: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 6,
  },
  photo: { width: '100%', height: '100%' },
  photoFallback: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  dotsRow: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 4,
  },
  dot: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: '#fff' },
  menuBtn: { position: 'absolute', top: 26, right: 14, zIndex: 10 },
  menuBtnCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  tapZones: { position: 'absolute', top: 24, left: 0, right: 0, bottom: 220, flexDirection: 'row' },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  info: { position: 'absolute', bottom: 18, left: 18, right: 18 },
  name: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  city: { color: 'rgba(255,255,255,0.8)', marginTop: 2, fontSize: 14 },
  bio: { color: 'rgba(255,255,255,0.9)', marginTop: 10, fontSize: 14, lineHeight: 19 },
  tagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 10 },
  tag: { backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  insta: { color: 'rgba(255,255,255,0.85)', marginTop: 8, fontSize: 12 },

  overlay: {
    position: 'absolute',
    top: 32,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 3,
    borderRadius: 8,
    transform: [{ rotate: '-12deg' }],
  },
  overlayLike: { left: 24, borderColor: '#22c55e' },
  overlayPass: { right: 24, borderColor: '#ef4444', transform: [{ rotate: '12deg' }] },
  overlayText: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: 2 },

  actions: {
    flexDirection: 'row',
    gap: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  passBtn: { backgroundColor: '#ef4444' },
  likeBtn: { backgroundColor: '#22c55e' },

  bigTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 18,
    textAlign: 'center',
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  cta: {
    marginTop: 22,
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  ctaText: { color: colors.bg, fontWeight: '900' },
});
