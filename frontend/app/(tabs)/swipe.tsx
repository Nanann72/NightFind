import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Modal,
  Alert,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  runOnJS,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeInDown,
  ZoomIn,
  SlideInLeft,
  SlideInRight,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { UserActionsMenu } from '../../components/UserActionsMenu';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

const { width, height } = Dimensions.get('window');
const CARD_W = width - 32;
const CARD_H = Math.min(620, Math.round(width * 1.55), Math.max(420, height - 360));
const SWIPE_THRESHOLD = width * 0.28;
const SWIPE_UP_THRESHOLD = height * 0.16;

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
  verified?: boolean;
  superliked_you?: boolean;
};

type Quota = {
  remaining: number | null;
  limit: number | null;
  is_premium: boolean;
  superlikes_remaining?: number;
  superlikes_limit?: number;
  boost_active?: boolean;
  boost_until?: string | null;
  likes_given_7d?: number;
  activity_boost_target?: number;
  activity_boost_active?: boolean;
  profile_completion?: number;
};

type MatchInfo = {
  match_id: string;
  peer: { user_id: string; name: string; photo?: string | null };
};

function photoUri(p?: string | null): string | null {
  if (!p || typeof p !== 'string' || p.trim().length < 16) return null;
  return p.startsWith('http') || p.startsWith('data:') ? p : `data:image/jpeg;base64,${p}`;
}

/** Round action button with press-scale animation (Tinder-style bar). */
function ActionButton({
  onPress,
  icon,
  color,
  bg,
  size,
  iconSize,
  testID,
  badge,
}: {
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  size: number;
  iconSize: number;
  testID: string;
  badge?: string | null;
}) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPressIn={() => {
        scale.value = withSpring(0.82, { damping: 14, stiffness: 300 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 10, stiffness: 260 });
      }}
      onPress={onPress}
      testID={testID}
      hitSlop={6}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            borderWidth: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: color,
            shadowOpacity: 0.45,
            shadowOffset: { width: 0, height: 3 },
            shadowRadius: 8,
            elevation: 5,
          },
          aStyle,
        ]}
      >
        <Ionicons name={icon} size={iconSize} color={color} />
        {badge ? (
          <View style={sBadge.badge}>
            <Text style={sBadge.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const sBadge = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});

/** Floating sparkle for the match celebration. */
function Sparkle({ x, delay, emoji }: { x: number; delay: number; emoji: string }) {
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withDelay(delay, withTiming(1, { duration: 250 }));
    ty.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-26, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      ),
    );
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));
  return (
    <Animated.Text style={[{ position: 'absolute', left: x, fontSize: 22 }, st]}>
      {emoji}
    </Animated.Text>
  );
}

export default function SwipePeople() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [deck, setDeck] = useState<SwipeProfile[]>([]);
  const [deckTotal, setDeckTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [sameClub, setSameClub] = useState(false);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [premiumFeature, setPremiumFeature] = useState<null | 'rewind' | 'boost'>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const loadDeck = useCallback(async () => {
    setLoading(true);
    try {
      const [d, q] = await Promise.all([api.swipeDeck(sameClub), api.swipeQuota()]);
      setDeck(d as any);
      setDeckTotal((d as any[])?.length || 0);
      setQuota(q as any);
    } catch {
      setDeck([]);
    } finally {
      setLoading(false);
    }
  }, [sameClub]);

  useEffect(() => {
    loadDeck();
  }, [loadDeck]);

  const profileComplete = !!user && (user as any).dob && Array.isArray((user as any).photos) && (user as any).photos.length > 0;
  const isPremium = !!quota?.is_premium;

  const finishSwipe = useCallback(
    async (action: 'like' | 'pass' | 'superlike') => {
      if (deck.length === 0 || busy) return;
      setBusy(true);
      const card = deck[0];
      tx.value = 0;
      ty.value = 0;
      // Optimistically pop
      setDeck((d) => d.slice(1));
      setPhotoIdx(0);
      try {
        const fn =
          action === 'like' ? api.swipeLike : action === 'superlike' ? api.swipeSuperlike : api.swipePass;
        const res: any = await fn(card.user_id);
        const q = await api.swipeQuota();
        setQuota(q as any);
        if (res?.matched && res?.match_id) {
          setMatch({ match_id: res.match_id, peer: res.peer || { user_id: card.user_id, name: card.name, photo: (card.photos || [])[0] } });
        }
      } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('402') || msg.includes('Limite')) {
          setLimitModalOpen(true);
          setDeck((d) => [card, ...d]);
        } else if (msg.includes('429') || msg.includes('Super Like')) {
          Alert.alert('Plus de Super Likes ⭐', msg.replace(/^\d+:?\s*/, '') || "Tu as utilisé tous tes Super Likes aujourd'hui.");
          setDeck((d) => [card, ...d]);
        }
      } finally {
        setBusy(false);
      }
    },
    [deck, tx, ty, busy],
  );

  const onRewind = useCallback(async () => {
    if (!isPremium) {
      setPremiumFeature('rewind');
      return;
    }
    try {
      const res: any = await api.swipeRewind();
      if (res?.profile) {
        tx.value = 0;
        ty.value = 0;
        setPhotoIdx(0);
        setDeck((d) => [res.profile, ...d.filter((p) => p.user_id !== res.profile.user_id)]);
        const q = await api.swipeQuota();
        setQuota(q as any);
      }
    } catch (e: any) {
      Alert.alert('Rewind ⟲', (e?.message || 'Aucun swipe à annuler.').replace(/^\d+:?\s*/, ''));
    }
  }, [isPremium, tx, ty]);

  const onBoost = useCallback(() => {
    if (!isPremium) {
      setPremiumFeature('boost');
      return;
    }
    if (quota?.boost_active) {
      Alert.alert('Boost ⚡', 'Ton Boost est déjà actif ! Ton profil est montré en priorité.');
      return;
    }
    Alert.alert(
      'Activer le Boost ⚡',
      'Ton profil sera montré en premier aux autres pendant 30 minutes. 1 Boost par jour.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Booster',
          onPress: async () => {
            try {
              await api.swipeBoost();
              const q = await api.swipeQuota();
              setQuota(q as any);
              Alert.alert('Boost activé ! ⚡', 'Ton profil est en tête des decks pendant 30 min.');
            } catch (e: any) {
              Alert.alert('Boost ⚡', (e?.message || 'Impossible pour le moment.').replace(/^\d+:?\s*/, ''));
            }
          },
        },
      ],
    );
  }, [isPremium, quota?.boost_active]);

  const swipeOff = useCallback(
    (action: 'like' | 'pass' | 'superlike') => {
      if (busy || deck.length === 0) return;
      if (action === 'superlike') {
        ty.value = withTiming(-height, { duration: 300 });
      } else {
        tx.value = withTiming(action === 'like' ? width * 1.5 : -width * 1.5, { duration: 220 });
      }
      finishSwipe(action);
    },
    [busy, deck.length, tx, ty, finishSwipe],
  );

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      const up = e.translationY < -SWIPE_UP_THRESHOLD && Math.abs(e.translationY) > Math.abs(e.translationX);
      if (up) {
        ty.value = withTiming(-height, { duration: 280 });
        tx.value = withTiming(tx.value, { duration: 280 });
        runOnJS(finishSwipe)('superlike');
      } else if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
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

  // Card behind grows as the top card is dragged away
  const nextCardStyle = useAnimatedStyle(() => {
    const progress = Math.min(
      1,
      Math.max(Math.abs(tx.value) / SWIPE_THRESHOLD, Math.abs(ty.value) / SWIPE_UP_THRESHOLD),
    );
    return {
      transform: [
        { scale: interpolate(progress, [0, 1], [0.94, 1], Extrapolation.CLAMP) },
        { translateY: interpolate(progress, [0, 1], [14, 0], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(progress, [0, 1], [0.85, 1], Extrapolation.CLAMP),
    };
  });

  const likeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const passOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));
  const superOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-SWIPE_UP_THRESHOLD, -20, 0], [1, 0, 0], Extrapolation.CLAMP),
  }));

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plus'));

  // Profile incomplete state
  if (!profileComplete) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 40 }]} testID="swipe-incomplete-banner">
        <TouchableOpacity style={[styles.backBtn, styles.backBtnFloating, { top: insets.top + 8 }]} onPress={goBack} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
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

  const top = deck[0];
  const behind = deck.slice(1, 3);
  const validPhotos = top ? (top.photos || []).filter((p) => typeof p === 'string' && p.trim().length > 16) : [];
  const photoSrc = top ? photoUri(validPhotos[photoIdx] || validPhotos[0]) : null;
  const initial = top ? (top.name || '?').trim().charAt(0).toUpperCase() : '?';
  const myPhoto = photoUri(((user as any)?.photos || [])[0]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="swipe-people-screen">
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.backBtn}
            testID="swipe-back-btn"
            hitSlop={8}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>SWIPE</Text>
            <Text style={styles.title}>Découvre du monde</Text>
          </View>
          {deckTotal > 0 && deck.length > 0 && (
            <View style={styles.deckCounter} testID="deck-counter">
              <Text style={styles.deckCounterText} allowFontScaling={false}>
                {Math.min(deckTotal - deck.length + 1, deckTotal)}/{deckTotal}
              </Text>
            </View>
          )}
          {quota?.boost_active && (
            <View style={styles.boostPill} testID="boost-active-pill">
              <Ionicons name="flash" size={13} color="#E6C15A" />
              <Text style={styles.boostPillText}>Boost actif</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.likesHubBtn}
            onPress={() => router.push('/likes-hub' as any)}
            testID="likes-hub-btn"
            hitSlop={8}
          >
            <Ionicons name="heart" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
        {/* Analyse de crush — boost d'activité Tinder-like (10 likes) */}
        {quota && (
          quota.activity_boost_active ? (
            <View style={[styles.crushBanner, styles.crushBannerActive]} testID="crush-banner">
              <Text style={styles.crushIcon}>🚀</Text>
              <Text style={styles.crushText}>Ton profil est mis en avant — continue de liker !</Text>
            </View>
          ) : (
            <View style={styles.crushBanner} testID="crush-banner">
              <Text style={styles.crushIcon}>💘</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.crushTitle}>Analyse de crush</Text>
                <Text style={styles.crushText}>
                  Envoie encore {Math.max(0, (quota.activity_boost_target ?? 10) - (quota.likes_given_7d ?? 0))} likes pour être mis en avant
                </Text>
              </View>
            </View>
          )
        )}
        {/* Complétion du profil */}
        {quota != null && (quota.profile_completion ?? 100) < 100 && (
          <TouchableOpacity
            style={styles.completionPill}
            onPress={() => router.push('/swipe-profile' as any)}
            testID="completion-pill"
          >
            <View style={styles.completionBarBg}>
              <View style={[styles.completionBarFill, { width: `${quota.profile_completion ?? 0}%` }]} />
            </View>
            <Text style={styles.completionText}>
              Profil complété à {quota.profile_completion}% — complète-le pour plus de matchs →
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.quotaRow}>
          <Ionicons name="flash" size={14} color={colors.primary} />
          <Text style={styles.quotaText}>
            {quota?.is_premium
              ? 'Swipes illimités · Premium 💎'
              : `${quota?.remaining ?? 10} / ${quota?.limit ?? 10} swipes restants aujourd'hui`}
          </Text>
          <Text style={styles.quotaDot}>·</Text>
          <Ionicons name="star" size={13} color="#0ea5e9" />
          <Text style={styles.quotaText}>{quota?.superlikes_remaining ?? 1} Super Like{(quota?.superlikes_remaining ?? 1) > 1 ? 's' : ''}</Text>
        </View>
        {/* Toggle "Swipe en club" — onboarding slide #03 */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modePill, !sameClub && styles.modePillActive]}
            onPress={() => setSameClub(false)}
            testID="swipe-mode-all"
          >
            <Ionicons name="globe" size={13} color={!sameClub ? colors.bg : '#A1A1AA'} />
            <Text style={[styles.modePillText, !sameClub && styles.modePillTextActive]}>
              Partout
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, sameClub && styles.modePillActive]}
            onPress={() => setSameClub(true)}
            testID="swipe-mode-club"
          >
            <Ionicons name="location" size={13} color={sameClub ? colors.bg : '#F472B6'} />
            <Text style={[styles.modePillText, sameClub && styles.modePillTextActive]}>
              Dans mon club
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {!top ? (
        <View style={[styles.center, { paddingTop: 40 }]}>
          <Ionicons name="sparkles" size={64} color={colors.tertiary} />
          <Text style={styles.bigTitle}>Plus personne à découvrir</Text>
          <Text style={styles.sub}>Repasse demain ou invite tes amis sur Night Finder.</Text>
          <TouchableOpacity style={styles.cta} onPress={loadDeck} testID="reload-deck">
            <Text style={styles.ctaText}>Rafraîchir</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={[styles.cardArea, { width: CARD_W, height: CARD_H }]}>
            {/* ---- Card stack: 2 cards behind ---- */}
            {behind
              .map((p, i) => {
                const bPhoto = photoUri((p.photos || []).find((ph) => typeof ph === 'string' && ph.trim().length > 16));
                const isNext = i === 0;
                const staticStyle = {
                  transform: [{ scale: isNext ? 0.94 : 0.9 }, { translateY: isNext ? 14 : 26 }],
                  opacity: isNext ? 0.85 : 0.55,
                };
                return (
                  <Animated.View
                    key={p.user_id}
                    style={[styles.card, styles.cardBehind, isNext ? nextCardStyle : staticStyle, { zIndex: -1 - i }]}
                    pointerEvents="none"
                  >
                    {bPhoto ? (
                      <Image source={{ uri: bPhoto }} style={styles.photo} />
                    ) : (
                      <View style={[styles.photo, styles.photoFallback]}>
                        <View style={styles.fallbackBubble}>
                          <Text style={styles.fallbackInitial}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text>
                        </View>
                      </View>
                    )}
                    <View style={styles.gradient} />
                  </Animated.View>
                );
              })
              .reverse()}

            {/* ---- Top card ---- */}
            <GestureDetector gesture={gesture}>
              <Animated.View style={[styles.card, cardStyle]}>
                {photoSrc ? (
                  <Image source={{ uri: photoSrc }} style={styles.photo} />
                ) : (
                  <View style={[styles.photo, styles.photoFallback]}>
                    <View style={styles.fallbackBubble}>
                      <Text style={styles.fallbackInitial}>{initial}</Text>
                    </View>
                    <Text style={styles.fallbackHint}>Photo non disponible</Text>
                  </View>
                )}
                {/* Photo progress bars */}
                {validPhotos.length > 1 && (
                  <View style={styles.dotsRow}>
                    {validPhotos.map((_, i) => (
                      <View key={i} style={[styles.dot, i === photoIdx && styles.dotActive]} />
                    ))}
                  </View>
                )}
                {/* "T'a super-liké" badge */}
                {top.superliked_you && (
                  <View style={styles.superlikedBadge} testID="superliked-you-badge">
                    <Ionicons name="star" size={13} color="#fff" />
                    <Text style={styles.superlikedBadgeText}>{"T'a super-liké"}</Text>
                  </View>
                )}
                {/* Report/Block menu — Apple 1.2 UGC */}
                <View style={styles.menuBtn} pointerEvents="box-none">
                  <UserActionsMenu
                    targetUserId={top.user_id}
                    targetName={top.name}
                    context="swipe"
                    onBlocked={() => {
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
                    onPress={() => setPhotoIdx((i) => Math.min(validPhotos.length - 1, i + 1))}
                  />
                </View>

                {/* LIKE / NOPE / SUPER LIKE stamps */}
                <Animated.View style={[styles.overlay, styles.overlayLike, likeOpacity]}>
                  <Text style={[styles.overlayText, { color: '#22c55e' }]}>{"J'AIME"}</Text>
                </Animated.View>
                <Animated.View style={[styles.overlay, styles.overlayPass, passOpacity]}>
                  <Text style={[styles.overlayText, { color: '#ef4444' }]}>NOPE</Text>
                </Animated.View>
                <Animated.View style={[styles.overlaySuper, superOpacity]}>
                  <Text style={[styles.overlayText, { color: '#0ea5e9' }]}>SUPER LIKE</Text>
                  <Ionicons name="star" size={26} color="#0ea5e9" />
                </Animated.View>

                <View style={styles.gradient} />
                <View style={styles.info}>
                  <View style={styles.infoTopRow}>
                    <Text style={styles.name}>
                      {top.name}
                      {top.age != null ? `, ${top.age}` : ''}
                      {top.verified ? '  ' : ''}
                      {top.verified ? (
                        <Ionicons name="checkmark-circle" size={22} color="#3B82F6" />
                      ) : null}
                    </Text>
                    <TouchableOpacity
                      style={styles.detailsBtn}
                      onPress={() => router.push(`/user/${top.user_id}` as any)}
                      hitSlop={8}
                      testID="swipe-details-btn"
                    >
                      <Ionicons name="chevron-up-circle" size={30} color="#fff" />
                    </TouchableOpacity>
                  </View>
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
                    <Text style={styles.insta}>📸 @{String(top.instagram).replace(/^@+/, '')}</Text>
                  )}
                </View>
              </Animated.View>
            </GestureDetector>
          </View>

          {/* ---- Tinder-style action bar: floats above the tab bar ---- */}
          <View
            style={[
              styles.actions,
              { position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 96, zIndex: 30 },
            ]}
            pointerEvents="box-none"
          >
            <ActionButton
              onPress={onRewind}
              icon="refresh"
              color="#eab308"
              bg="rgba(234,179,8,0.12)"
              size={48}
              iconSize={24}
              testID="action-rewind"
            />
            <ActionButton
              onPress={() => swipeOff('pass')}
              icon="close"
              color="#ef4444"
              bg="rgba(239,68,68,0.12)"
              size={62}
              iconSize={34}
              testID="action-pass"
            />
            <ActionButton
              onPress={() => swipeOff('superlike')}
              icon="star"
              color="#0ea5e9"
              bg="rgba(14,165,233,0.12)"
              size={48}
              iconSize={24}
              testID="action-superlike"
              badge={quota?.superlikes_remaining != null ? String(quota.superlikes_remaining) : null}
            />
            <ActionButton
              onPress={() => swipeOff('like')}
              icon="heart"
              color="#22c55e"
              bg="rgba(34,197,94,0.12)"
              size={62}
              iconSize={32}
              testID="action-like"
            />
            <ActionButton
              onPress={onBoost}
              icon="flash"
              color="#E6C15A"
              bg="rgba(230,193,90,0.12)"
              size={48}
              iconSize={24}
              testID="action-boost"
            />
          </View>
        </>
      )}

      {/* ================= "C'EST UN MATCH !" ================= */}
      <Modal visible={!!match} transparent animationType="fade" onRequestClose={() => setMatch(null)}>
        <View style={styles.matchRoot} testID="match-modal">
          <LinearGradient
            colors={['#2b0a12', '#150507', '#000']}
            style={StyleSheet.absoluteFill}
          />
          {/* Floating sparkles */}
          <View style={styles.sparklesLayer} pointerEvents="none">
            <Sparkle x={width * 0.12} delay={0} emoji="✨" />
            <Sparkle x={width * 0.82} delay={200} emoji="💫" />
            <Sparkle x={width * 0.28} delay={400} emoji="⭐" />
            <Sparkle x={width * 0.68} delay={600} emoji="✨" />
            <Sparkle x={width * 0.48} delay={300} emoji="❤️" />
          </View>
          {match && (
            <View style={styles.matchContent}>
              <Animated.Text entering={ZoomIn.springify().damping(11)} style={styles.matchTitle}>
                {"C'EST UN"}
              </Animated.Text>
              <Animated.Text entering={ZoomIn.delay(150).springify().damping(9)} style={styles.matchTitleBig}>
                MATCH !
              </Animated.Text>
              <Animated.Text entering={FadeIn.delay(500)} style={styles.matchSub}>
                {match.peer.name} et toi vous êtes likés mutuellement
              </Animated.Text>

              <View style={styles.matchAvatars}>
                <Animated.View entering={SlideInLeft.delay(250).springify().damping(12)}>
                  {myPhoto ? (
                    <Image source={{ uri: myPhoto }} style={styles.matchAvatar} />
                  ) : (
                    <View style={[styles.matchAvatar, styles.matchAvatarFb]}>
                      <Text style={styles.matchAvatarInitial}>
                        {((user as any)?.name || '?').trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </Animated.View>
                <Animated.View entering={ZoomIn.delay(550).springify().damping(7)} style={styles.matchHeart}>
                  <Ionicons name="heart" size={30} color="#fff" />
                </Animated.View>
                <Animated.View entering={SlideInRight.delay(250).springify().damping(12)}>
                  {photoUri(match.peer.photo) ? (
                    <Image source={{ uri: photoUri(match.peer.photo)! }} style={styles.matchAvatar} />
                  ) : (
                    <View style={[styles.matchAvatar, styles.matchAvatarFb]}>
                      <Text style={styles.matchAvatarInitial}>
                        {(match.peer.name || '?').trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </Animated.View>
              </View>

              <Animated.View entering={FadeInDown.delay(700)} style={{ alignSelf: 'stretch', gap: 12 }}>
                <TouchableOpacity
                  style={styles.matchCtaPrimary}
                  activeOpacity={0.85}
                  onPress={() => {
                    const mid = match.match_id;
                    setMatch(null);
                    router.push(`/chat/${mid}` as any);
                  }}
                  testID="match-send-message"
                >
                  <Ionicons name="chatbubble" size={18} color="#fff" />
                  <Text style={styles.matchCtaPrimaryText}>Envoyer un message</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.matchCtaSecondary}
                  activeOpacity={0.85}
                  onPress={() => setMatch(null)}
                  testID="match-keep-swiping"
                >
                  <Text style={styles.matchCtaSecondaryText}>Continuer à swiper</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}
        </View>
      </Modal>

      {/* ================= Premium feature modal (Rewind / Boost) ================= */}
      <Modal
        visible={!!premiumFeature}
        transparent
        animationType="fade"
        onRequestClose={() => setPremiumFeature(null)}
      >
        <View style={styles.limitOverlay}>
          <TouchableOpacity style={styles.limitBackdrop} activeOpacity={1} onPress={() => setPremiumFeature(null)} />
          <View style={styles.limitCard} testID="premium-feature-modal">
            <View style={styles.limitGemWrap}>
              <Text style={styles.limitGem}>{premiumFeature === 'rewind' ? '⟲' : '⚡'}</Text>
            </View>
            <Text style={styles.limitTitle}>
              {premiumFeature === 'rewind' ? 'Rewind' : 'Boost'} Premium
            </Text>
            <Text style={styles.limitSub}>
              {premiumFeature === 'rewind'
                ? 'Tu as passé quelqu\'un par erreur ? Annule ton dernier swipe avec Premium.'
                : 'Sois montré en premier dans les decks pendant 30 minutes avec Premium.'}
            </Text>
            <TouchableOpacity
              style={styles.limitCta}
              onPress={() => { setPremiumFeature(null); router.push('/paywall'); }}
              activeOpacity={0.85}
              testID="premium-feature-cta"
            >
              <Text style={styles.limitCtaText}>Passer Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.limitSkip} onPress={() => setPremiumFeature(null)}>
              <Text style={styles.limitSkipText}>Plus tard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Premium swipe-limit modal — branded */}
      <Modal
        visible={limitModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLimitModalOpen(false)}
      >
        <View style={styles.limitOverlay}>
          <TouchableOpacity style={styles.limitBackdrop} activeOpacity={1} onPress={() => setLimitModalOpen(false)} />
          <View style={styles.limitCard}>
            <View style={styles.limitGemWrap}>
              <Text style={styles.limitGem}>💎</Text>
            </View>
            <Text style={styles.limitTitle}>Limite atteinte</Text>
            <Text style={styles.limitSub}>
              {`Tu as utilisé tes ${quota?.limit ?? 10} swipes du jour. Passe Premium pour swiper sans limite, voir qui t'a liké, et débloquer le mode 200 km.`}
            </Text>
            <View style={styles.limitPerks}>
              <View style={styles.limitPerkRow}>
                <Ionicons name="infinite" size={16} color={colors.primary} />
                <Text style={styles.limitPerkText}>Swipes illimités</Text>
              </View>
              <View style={styles.limitPerkRow}>
                <Ionicons name="eye" size={16} color={colors.primary} />
                <Text style={styles.limitPerkText}>{"Vois qui t'a liké"}</Text>
              </View>
              <View style={styles.limitPerkRow}>
                <Ionicons name="refresh" size={16} color={colors.primary} />
                <Text style={styles.limitPerkText}>Rewind + Boost + 5 Super Likes</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.limitCta}
              onPress={() => { setLimitModalOpen(false); router.push('/paywall'); }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Passer Premium"
            >
              <Text style={styles.limitCtaText}>Passer Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.limitSkip} onPress={() => setLimitModalOpen(false)}>
              <Text style={styles.limitSkipText}>Plus tard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', backgroundColor: colors.bg, padding: 24 },
  header: { width: '100%', paddingHorizontal: spacing.lg, marginBottom: 12, alignSelf: 'flex-start' },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtnFloating: { position: 'absolute', left: spacing.lg, zIndex: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { color: colors.primary, fontWeight: '900', fontSize: 11, letterSpacing: 3 },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  deckCounter: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginRight: 8,
  },
  deckCounterText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  likesHubBtn: {
    width: 40, height: 40, borderRadius: 20, marginLeft: 8,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  crushBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
    marginTop: 10,
  },
  crushBannerActive: { borderColor: colors.primary },
  crushIcon: { fontSize: 18 },
  crushTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  crushText: { color: colors.textSecondary, fontSize: 12 },
  completionPill: { marginTop: 8 },
  completionBarBg: {
    height: 4, borderRadius: 2, backgroundColor: colors.surfaceElevated, overflow: 'hidden',
  },
  completionBarFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  completionText: { color: colors.textSecondary, fontSize: 11.5, marginTop: 5 },
  boostPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: 'rgba(230,193,90,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(230,193,90,0.5)',
  },
  boostPillText: { color: '#E6C15A', fontSize: 11, fontWeight: '900' },
  quotaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  quotaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  quotaDot: { color: colors.textTertiary, fontSize: 12 },
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modePillActive: {
    backgroundColor: '#F472B6',
    borderColor: '#F472B6',
  },
  modePillText: {
    color: '#A1A1AA',
    fontWeight: '700',
    fontSize: 12,
  },
  modePillTextActive: {
    color: colors.bg,
  },
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
  cardBehind: { position: 'absolute', top: 0, left: 0 },
  photo: { width: '100%', height: '100%' },
  photoFallback: {
    backgroundColor: '#1b1424',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  fallbackBubble: {
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: 'rgba(224,26,79,0.18)',
    borderWidth: 2,
    borderColor: 'rgba(224,26,79,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackInitial: {
    color: '#fff',
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: -1,
  },
  fallbackHint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Premium modals
  limitOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  limitBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,5,18,0.82)' },
  limitCard: {
    backgroundColor: '#1a1226',
    borderRadius: 28,
    padding: 26,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: 'rgba(224,26,79,0.35)',
    alignItems: 'center',
  },
  limitGemWrap: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(224,26,79,0.18)',
    borderWidth: 2, borderColor: 'rgba(224,26,79,0.55)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  limitGem: { fontSize: 36, color: '#fff' },
  limitTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 6, textAlign: 'center' },
  limitSub: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  limitPerks: { alignSelf: 'stretch', gap: 10, marginBottom: 18 },
  limitPerkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  limitPerkText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  limitCta: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    paddingVertical: 15, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  limitCtaText: { color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 0.3 },
  limitSkip: { paddingVertical: 12, marginTop: 4 },
  limitSkipText: { color: 'rgba(255,255,255,0.6)', fontWeight: '700', fontSize: 14 },
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
  superlikedBadge: {
    position: 'absolute',
    top: 26,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0ea5e9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    zIndex: 10,
  },
  superlikedBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
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
  infoTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailsBtn: { marginLeft: 10 },
  name: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
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
    borderWidth: 4,
    borderRadius: 10,
    transform: [{ rotate: '-14deg' }],
    zIndex: 20,
  },
  overlayLike: { left: 20, borderColor: '#22c55e' },
  overlayPass: { right: 20, borderColor: '#ef4444', transform: [{ rotate: '14deg' }] },
  overlaySuper: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 4,
    borderRadius: 10,
    borderColor: '#0ea5e9',
    transform: [{ rotate: '-8deg' }],
    zIndex: 20,
  },
  overlayText: { fontSize: 30, fontWeight: '900', letterSpacing: 2 },

  actions: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },

  // Match celebration
  matchRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sparklesLayer: { ...StyleSheet.absoluteFillObject, top: height * 0.16 },
  matchContent: { alignItems: 'center', paddingHorizontal: 32, alignSelf: 'stretch' },
  matchTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 6,
  },
  matchTitleBig: {
    color: colors.primary,
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: colors.primary,
    textShadowRadius: 24,
    textShadowOffset: { width: 0, height: 0 },
  },
  matchSub: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 10, textAlign: 'center' },
  matchAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 34,
    marginBottom: 40,
  },
  matchAvatar: {
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#1b1424',
  },
  matchAvatarFb: { alignItems: 'center', justifyContent: 'center' },
  matchAvatarInitial: { color: '#fff', fontSize: 44, fontWeight: '900' },
  matchHeart: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -16,
    zIndex: 2,
    borderWidth: 3,
    borderColor: '#fff',
  },
  matchCtaPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 999,
  },
  matchCtaPrimaryText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  matchCtaSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  matchCtaSecondaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },

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
