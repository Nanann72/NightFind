import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Dimensions,
  ScrollView,
  TextInput,
  Share,
  Modal,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
  FadeInDown,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { api, Club } from '../../lib/api';
import { useClubs } from '../../lib/clubs';
import { trackClubView } from '../../lib/recentClubs';
import { HapticButton } from '../../components/ui/HapticButton';
import { SafeImage } from '../../components/SafeImage';
import { radius, spacing, typography, type ThemeColors, darkColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

const { width: SCREEN_W } = Dimensions.get('window');
const HERO_HEIGHT = 360;

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = {
  mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi',
  fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
};

export default function ClubDetail() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { favorites, toggleFavorite } = useClubs();
  const [club, setClub] = useState<Club | null>(null);
  const [reviews, setReviews] = useState<{ avg: number | null; count: number; my_review: any; reviews: any[] } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSort, setReviewSort] = useState<'recent' | 'best'>('recent');
  const [justShared, setJustShared] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMatches, setShareMatches] = useState<any[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [sentTo, setSentTo] = useState<Record<string, boolean>>({});
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const openShare = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setShareOpen(true);
    setShareLoading(true);
    api.listMatches()
      .then((r) => setShareMatches(r || []))
      .catch(() => setShareMatches([]))
      .finally(() => setShareLoading(false));
  };

  const sendToMatch = async (matchId: string) => {
    if (!club || sentTo[matchId] || sendingTo) return;
    setSendingTo(matchId);
    try {
      await api.sendMessage(
        matchId,
        `👀 Regarde ce club : ${club.name} !\n📍 ${club.address || ''}`.trim(),
        undefined,
        { club_id: club.club_id, club_name: club.name, address: club.address || '' },
      );
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSentTo((prev) => ({ ...prev, [matchId]: true }));
    } catch {}
    setSendingTo(null);
  };

  const shareClub = async () => {
    if (!club) return;
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const url = `https://nightfinder.app/c/${club.club_id}`;
    const message = `Découvre ${club.name} sur Night Finder 🎉\n📍 ${club.address}\n${url}`;
    try {
      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) {
          await nav.share({ title: club.name, text: message, url });
        } else {
          await Clipboard.setStringAsync(message);
          setJustShared(true);
          setTimeout(() => setJustShared(false), 2000);
        }
      } else {
        await Share.share(Platform.OS === 'ios' ? { message, url } : { message });
      }
    } catch {}
  };
  const [myRating, setMyRating] = useState(0);
  const [myText, setMyText] = useState('');
  const [sendingReview, setSendingReview] = useState(false);

  const loadReviews = (cid: string) => {
    api.clubReviews(cid)
      .then((r) => {
        setReviews(r);
        if (r.my_review) {
          setMyRating(r.my_review.rating);
          setMyText(r.my_review.text || '');
        }
      })
      .catch(() => {});
  };

  const sortedReviews = useMemo(() => {
    const rows = [...(reviews?.reviews || [])];
    if (reviewSort === 'best') {
      rows.sort((a, b) => (b.rating - a.rating) || (new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
    }
    return rows;
  }, [reviews, reviewSort]);

  const sendReview = async () => {
    if (!club || myRating < 1 || sendingReview) return;
    setSendingReview(true);
    try {
      await api.submitClubReview(club.club_id, myRating, myText);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setReviewOpen(false);
      loadReviews(club.club_id);
    } catch {}
    setSendingReview(false);
  };
  const [loading, setLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkinMsg, setCheckinMsg] = useState<string | null>(null);
  const [moments, setMoments] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    api.listClubMoments(String(id)).then(setMoments).catch(() => {});
    loadReviews(String(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const timeAgo = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `il y a ${mins} min`;
    return `il y a ${Math.round(mins / 60)} h`;
  };

  const handleManualCheckIn = async () => {
    if (!club || checkingIn) return;
    setCheckinMsg(null);
    setCheckingIn(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setCheckinMsg(
          perm.canAskAgain
            ? 'Autorise la localisation pour te checker au club.'
            : 'Localisation refusée — active-la dans les Réglages.',
        );
        if (!perm.canAskAgain) Linking.openSettings();
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await api.checkInManual(
        club.club_id,
        pos.coords.latitude,
        pos.coords.longitude,
        pos.coords.accuracy ?? undefined,
      );
      setCheckinMsg(null);
      router.push({ pathname: '/moment-capture', params: { club_id: club.club_id } });
    } catch (e: any) {
      setCheckinMsg(String(e?.message || 'Check-in impossible. Réessaie.'));
    } finally {
      setCheckingIn(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    api
      .getClub(String(id))
      .then((c) => {
        setClub(c);
        // Smart UX: remember recently viewed venues for quick re-access
        trackClubView({
          club_id: c.club_id,
          name: c.name,
          photo: (c.photos || [])[0] || null,
          city: (c.address || '').split(',').pop()?.trim(),
        }).catch(() => {});
      })
      .catch(() => setClub(null))
      .finally(() => setLoading(false));
  }, [id]);

  const isFav = club ? favorites.has(club.club_id) : false;
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Stretchy hero — scales up when overscroll down, parallax when scroll up
  const heroAnimStyle = useAnimatedStyle(() => {
    const ty = interpolate(
      scrollY.value,
      [-HERO_HEIGHT, 0, HERO_HEIGHT],
      [-HERO_HEIGHT / 2, 0, HERO_HEIGHT * 0.55],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(scrollY.value, [-HERO_HEIGHT, 0], [2.4, 1], Extrapolation.CLAMP);
    return { transform: [{ translateY: ty }, { scale }] };
  });

  // Sticky compact header — fades in once user scrolls past 60% of hero
  const stickyHeaderStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [HERO_HEIGHT * 0.5, HERO_HEIGHT * 0.85],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  const openDirections = () => {
    if (!club) return;
    const scheme = Platform.select({
      ios: `maps:0,0?q=${club.name}@${club.lat},${club.lng}`,
      android: `geo:0,0?q=${club.lat},${club.lng}(${encodeURIComponent(club.name)})`,
    });
    const fallback = `https://www.google.com/maps/search/?api=1&query=${club.lat},${club.lng}`;
    Linking.openURL(scheme || fallback).catch(() => Linking.openURL(fallback));
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!club) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textSecondary }}>Club introuvable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="club-detail-screen">
      {/* Sticky compact header — fades in on scroll */}
      <Animated.View
        pointerEvents="none"
        style={[styles.stickyHeader, { paddingTop: insets.top }, stickyHeaderStyle]}
      >
        {Platform.OS !== 'web' ? (
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFillObject} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(12,12,15,0.92)' }]} />
        )}
        <View style={styles.stickyContent}>
          <Text style={styles.stickyTitle} numberOfLines={1}>{club.name}</Text>
        </View>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: 240 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          <Animated.View style={[styles.heroImgWrap, heroAnimStyle]}>
            <SafeImage uri={club.photos[0]} style={styles.hero} />
          </Animated.View>
          <View style={styles.heroOverlay} />
          <HapticButton
            haptic="light"
            style={[styles.headerBtn, { top: insets.top + 12, left: 16 }]}
            onPress={() => router.back()}
            testID="back-btn"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </HapticButton>
          <HapticButton
            haptic="light"
            style={[styles.headerBtn, { top: insets.top + 12, right: 64 }]}
            onPress={openShare}
            testID="share-club-btn"
          >
            <Ionicons
              name={justShared ? 'checkmark' : 'share-outline'}
              size={20}
              color={justShared ? '#4ADE80' : colors.textPrimary}
            />
          </HapticButton>
          <HapticButton
            haptic={isFav ? 'success' : 'light'}
            style={[styles.headerBtn, { top: insets.top + 12, right: 16 }]}
            onPress={() => toggleFavorite(club.club_id)}
            testID="detail-fav-btn"
          >
            <Ionicons
              name={isFav ? 'heart' : 'heart-outline'}
              size={20}
              color={isFav ? colors.primary : colors.textPrimary}
            />
          </HapticButton>

          <View style={styles.heroBottom}>
            <View style={styles.chipsRow}>
              {club.music_styles.map((m) => (
                <View key={m} style={styles.chip}>
                  <Text style={styles.chipText}>{m}</Text>
                </View>
              ))}
            </View>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { flexShrink: 1 }]}>{club.name}</Text>
              {club.verified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#fff" />
                  <Text style={styles.verifiedText}>Vérifié</Text>
                </View>
              )}
              {club.promoted && (
                <View style={[styles.verifiedBadge, { backgroundColor: '#F59E0B' }]}>
                  <Ionicons name="star" size={12} color="#fff" />
                  <Text style={styles.verifiedText}>Sponsorisé</Text>
                </View>
              )}
            </View>
            <Text style={styles.address}>{club.address}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Ionicons name="star" size={14} color={colors.secondary} />
                <Text style={styles.statText}>{club.rating.toFixed(1)}</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="cash-outline" size={14} color={colors.tertiary} />
                <Text style={styles.statText}>{club.avg_price.toFixed(0)}€ moy.</Text>
              </View>
              {club.distance_km != null && (
                <View style={styles.statItem}>
                  <Ionicons name="navigate" size={14} color={colors.tertiary} />
                  <Text style={styles.statText}>{club.distance_km.toFixed(1)} km</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {moments.length > 0 && (
            <Section title="Moments — ils y sont en ce moment ✨">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {moments.map((m: any) => (
                  <View key={m.moment_id} style={styles.momentCard} testID={`club-moment-${m.moment_id}`}>
                    <Image source={{ uri: m.image }} style={styles.momentImg} resizeMode="cover" />
                    <View style={styles.momentOverlay}>
                      <View style={styles.momentFooter}>
                        <Text style={styles.momentAuthor} numberOfLines={1}>{m.user_name}</Text>
                        <Text style={styles.momentTime}>{timeAgo(m.created_at)}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            </Section>
          )}

          <Section title="À propos">
            <Text style={styles.bodyText}>{club.description}</Text>
          </Section>

          <Section title="Horaires">
            {DAYS.map((d) => {
              const h = (club.hours as any)?.[d];
              let label: string;
              if (h == null) {
                label = '—';
              } else if (typeof h === 'string') {
                // Google Places shape: "5:00 PM – 11:30 PM" or "closed"
                const t = h.trim();
                label = !t || /^closed$/i.test(t) || /ferm/i.test(t) ? 'Fermé' : t;
              } else if (typeof h === 'object') {
                // Seed shape: {open, from, to}
                label = h.open ? `${h.from} – ${h.to}` : 'Fermé';
              } else {
                label = '—';
              }
              return (
                <View key={d} style={styles.hourRow}>
                  <Text style={styles.dayLabel}>{DAY_LABELS[d]}</Text>
                  <Text style={styles.hourValue}>{label}</Text>
                </View>
              );
            })}
          </Section>

          {club.features.length > 0 && (
            <Section title="Ambiance">
              <View style={styles.featRow}>
                {club.features.map((f) => (
                  <View key={f} style={styles.featChip}>
                    <Ionicons name="checkmark" size={12} color={colors.tertiary} />
                    <Text style={styles.featText}>{f.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {club.menu && club.menu.length > 0 && (
            <Section title="Carte & Menu">
              {club.menu.map((m, i) => (
                <View key={i} style={styles.hourRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dayLabel}>{m.name}</Text>
                    {!!m.category && <Text style={styles.menuCat}>{m.category}</Text>}
                  </View>
                  <Text style={styles.hourValue}>{Number(m.price).toFixed(2)}€</Text>
                </View>
              ))}
            </Section>
          )}

          {club.events && club.events.length > 0 && (
            <Section title="Soirées à venir">
              {club.events.map((e) => (
                <View key={e.event_id} style={styles.evRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.evTitle}>{e.title}</Text>
                    <Text style={styles.evDate}>
                      {new Date(e.date).toLocaleDateString('fr-FR', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text style={styles.evPrice}>{e.entry_price.toFixed(0)}€</Text>
                </View>
              ))}
            </Section>
          )}

          {/* ── Avis ── */}
          <View style={styles.reviewsSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <Text style={styles.reviewsTitle}>Avis</Text>
              {reviews?.avg != null && (
                <Text style={styles.reviewsAvg}>  ⭐ {reviews.avg} · {reviews.count} avis</Text>
              )}
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setReviewOpen((o) => !o)} testID="write-review-btn">
                <Text style={styles.reviewsCta}>{reviews?.my_review ? 'Modifier mon avis' : 'Laisser un avis'}</Text>
              </TouchableOpacity>
            </View>

            {reviewOpen && (
              <View style={styles.reviewForm} testID="review-form">
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                      key={n}
                      onPress={() => {
                        if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                        setMyRating(n);
                      }}
                      hitSlop={6}
                      testID={`review-star-${n}`}
                    >
                      <Ionicons name={n <= myRating ? 'star' : 'star-outline'} size={28} color={n <= myRating ? '#FDE047' : colors.textTertiary} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  value={myText}
                  onChangeText={setMyText}
                  placeholder="Raconte ta soirée (optionnel)…"
                  placeholderTextColor={colors.textTertiary}
                  style={styles.reviewInput}
                  multiline
                  maxLength={500}
                  testID="review-text-input"
                />
                <TouchableOpacity
                  style={[styles.reviewSubmit, myRating < 1 && { opacity: 0.4 }]}
                  onPress={sendReview}
                  disabled={myRating < 1 || sendingReview}
                  testID="review-submit"
                >
                  {sendingReview ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Text style={styles.reviewSubmitText}>Publier mon avis</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {(reviews?.count || 0) > 1 && (
              <View style={styles.sortRow}>
                {([['recent', 'Plus récents'], ['best', 'Meilleures notes']] as const).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.sortChip, reviewSort === key && styles.sortChipActive]}
                    onPress={() => {
                      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                      setReviewSort(key);
                    }}
                    testID={`review-sort-${key}`}
                  >
                    <Text style={[styles.sortChipText, reviewSort === key && styles.sortChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {sortedReviews.slice(0, 5).map((r, i) => (
              <Animated.View entering={FadeInDown.delay(i * 50).duration(250)} key={r.review_id || r.user_id} style={styles.reviewRow}>
                {r.user_photo ? (
                  <Image source={{ uri: r.user_photo }} style={styles.reviewAvatar} />
                ) : (
                  <View style={[styles.reviewAvatar, { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="person" size={14} color={colors.textTertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.reviewName} numberOfLines={1}>{r.user_name}</Text>
                    <Text style={styles.reviewStars} allowFontScaling={false}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</Text>
                  </View>
                  {!!r.text && <Text style={styles.reviewText}>{r.text}</Text>}
                  {!!r.reply?.text && (
                    <View style={styles.replyBox} testID={`review-reply-${r.review_id}`}>
                      <Text style={styles.replyName}>💬 Réponse de {r.reply.name || "l'établissement"}</Text>
                      <Text style={styles.replyText}>{r.reply.text}</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            ))}
            {reviews && reviews.count === 0 && !reviewOpen && (
              <Text style={styles.reviewEmpty}>Aucun avis pour l'instant — sois le premier ! ⭐</Text>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: 24 + insets.bottom / 2 }]}>
        {checkinMsg && (
          <Text style={styles.checkinMsg} testID="manual-checkin-msg">{checkinMsg}</Text>
        )}
        <HapticButton
          haptic="medium"
          style={styles.checkinBtn}
          onPress={handleManualCheckIn}
          disabled={checkingIn}
          testID="manual-checkin-btn"
        >
          {checkingIn ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Ionicons name="location" size={18} color={colors.bg} />
          )}
          <Text style={styles.checkinText}>
            {checkingIn ? 'Vérification de ta position…' : 'Je suis ici — Check-in'}
          </Text>
        </HapticButton>

        <HapticButton
          haptic="light"
          style={styles.vipBtn}
          onPress={() => router.push(`/vip-booking/${club.club_id}` as any)}
          testID="vip-booking-btn"
        >
          <Text style={styles.vipEmoji} allowFontScaling={false}>🍾</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.vipTitle}>Réserver un carré VIP</Text>
            <Text style={styles.vipSub}>Choisis ta table sur le plan de salle</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </HapticButton>
        <View style={styles.footerRow}>
          <HapticButton
            haptic="light"
            style={styles.directionsBtn}
            onPress={openDirections}
            testID="directions-btn"
          >
            <Ionicons name="navigate" size={18} color={colors.textPrimary} />
            <Text style={styles.directionsText}>Itinéraire</Text>
          </HapticButton>
          <HapticButton
            haptic={isFav ? 'light' : 'success'}
            style={styles.favBtn}
            onPress={() => toggleFavorite(club.club_id)}
            testID="footer-fav-btn"
          >
            <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={18} color={colors.bg} />
            <Text style={styles.favText}>
              {isFav ? 'Dans vos favoris' : 'Ajouter aux favoris'}
            </Text>
          </HapticButton>
        </View>
      </View>

      {/* ── Feuille de partage : envoyer à un match ou hors de l'app ── */}
      <Modal visible={shareOpen} transparent animationType="slide" onRequestClose={() => setShareOpen(false)}>
        <View style={styles.shareOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShareOpen(false)} />
          <View style={[styles.shareSheet, { paddingBottom: insets.bottom + 16 }]} testID="share-sheet">
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>Partager {club.name}</Text>

            <Text style={styles.shareSection}>Envoyer à un match 💬</Text>
            {shareLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 18 }} />
            ) : shareMatches.length === 0 ? (
              <Text style={styles.shareEmpty}>Pas encore de matchs — va faire des rencontres ! 🔥</Text>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {shareMatches.map((m) => (
                  <TouchableOpacity
                    key={m.match_id}
                    style={styles.shareRow}
                    onPress={() => sendToMatch(m.match_id)}
                    disabled={!!sentTo[m.match_id] || sendingTo === m.match_id}
                    testID={`share-match-${m.match_id}`}
                  >
                    {m.photo ? (
                      <Image source={{ uri: m.photo }} style={styles.shareAvatar} />
                    ) : (
                      <View style={[styles.shareAvatar, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="person" size={16} color={colors.textTertiary} />
                      </View>
                    )}
                    <Text style={styles.shareName} numberOfLines={1}>{m.name}</Text>
                    {sendingTo === m.match_id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : sentTo[m.match_id] ? (
                      <View style={styles.shareSentChip}>
                        <Ionicons name="checkmark" size={13} color="#4ADE80" />
                        <Text style={styles.shareSentText}>Envoyé</Text>
                      </View>
                    ) : (
                      <View style={styles.shareSendBtn}>
                        <Ionicons name="paper-plane" size={14} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.shareExternal}
              onPress={() => { setShareOpen(false); setTimeout(shareClub, 300); }}
              testID="share-external-btn"
            >
              <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.shareExternalText}>Partager en dehors de l&apos;app</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroWrap: { height: HERO_HEIGHT, position: 'relative', overflow: 'hidden' },
  heroImgWrap: { width: SCREEN_W, height: HERO_HEIGHT },
  hero: { width: '100%', height: '100%' },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  stickyContent: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 64,
  },
  stickyTitle: {
    ...typography.headline,
    color: colors.textPrimary,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.4)',
  },
  headerBtn: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(9,9,11,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroBottom: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#1D9BF0', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  verifiedText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  menuCat: { color: colors.textTertiary, fontSize: 11.5, marginTop: 1 },
  address: { color: colors.textSecondary, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  statItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  statText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
    marginBottom: 10,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bodyText: { color: colors.textPrimary, lineHeight: 22, fontSize: 14 },
  hourRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  dayLabel: { color: colors.textSecondary, fontWeight: '600' },
  hourValue: { color: colors.textPrimary, fontWeight: '700' },
  featRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.25)',
  },
  featText: { color: colors.tertiary, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  evRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  evTitle: { color: colors.textPrimary, fontWeight: '700' },
  evDate: { color: colors.textSecondary, marginTop: 2, fontSize: 12 },
  evPrice: { color: colors.secondary, fontWeight: '900' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  checkinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  checkinText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  checkinMsg: {
    color: '#F87171',
    fontSize: 12.5,
    textAlign: 'center',
    fontWeight: '600',
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  directionsText: { color: colors.textPrimary, fontWeight: '700' },
  vipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'rgba(225,29,72,0.4)',
    borderRadius: 16,
    padding: 14,
    marginHorizontal: spacing.lg,
    marginTop: 10,
  },
  vipEmoji: { fontSize: 22 },
  vipTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  vipSub: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  reviewsSection: { marginTop: 22 },
  reviewsTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  reviewsAvg: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '700' },
  reviewsCta: { color: colors.primary, fontSize: 13.5, fontWeight: '800' },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortChipText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '700' },
  sortChipTextActive: { color: '#fff' },
  reviewForm: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  reviewInput: {
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    minHeight: 70,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  reviewSubmit: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  reviewSubmitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  reviewRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  reviewAvatar: { width: 30, height: 30, borderRadius: 15 },
  reviewName: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '800', flexShrink: 1 },
  reviewStars: { color: '#FDE047', fontSize: 12 },
  reviewText: { color: colors.textSecondary, fontSize: 13.5, marginTop: 2, lineHeight: 18.5 },
  replyBox: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  replyName: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '800' },
  replyText: { color: colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  shareOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  shareSheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  shareHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: 14,
  },
  shareTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginBottom: 14 },
  shareSection: { color: colors.textTertiary, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  shareEmpty: { color: colors.textSecondary, fontSize: 13.5, marginVertical: 12 },
  shareRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, minHeight: 52,
  },
  shareAvatar: { width: 40, height: 40, borderRadius: 20 },
  shareName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  shareSendBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  shareSentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  shareSentText: { color: '#4ADE80', fontSize: 12.5, fontWeight: '800' },
  shareExternal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingVertical: 13, marginTop: 14, minHeight: 46,
  },
  shareExternalText: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '800' },
  reviewEmpty: { color: colors.textTertiary, fontSize: 13 },
  favBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  favText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  // Moments (live-photo)
  momentsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  momentsHeaderHint: {
    color: colors.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
  },
  momentCard: {
    width: 110,
    height: 150,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(244,114,182,0.4)',
    position: 'relative',
  },
  momentImg: { width: '100%', height: '100%' },
  momentOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 50,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  momentFooter: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    right: 8,
  },
  momentAuthor: { color: '#fff', fontWeight: '800', fontSize: 11 },
  momentTime: { color: '#D4D4D8', fontSize: 10, marginTop: 1 },
  momentBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(255,193,7,0.95)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  momentBadgeText: { fontSize: 10 },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: '#18181B',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  modalImg: { width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000' },
  modalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  modalAuthor: { color: '#fff', fontWeight: '900', fontSize: 14 },
  modalTime: { color: '#A1A1AA', fontSize: 12 },
  modalCaption: {
    color: '#E4E4E7',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  modalClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
