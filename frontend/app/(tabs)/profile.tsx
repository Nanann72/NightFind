import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
  Linking,
  ScrollView,
  Modal,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../lib/auth';
import { useClubs } from '../../lib/clubs';
import { api } from '../../lib/api';
import { usePremium } from '../../lib/premium';
import { useTabBarScroll } from '../../lib/tabBarScroll';
import { useThemeColors } from '../../lib/themeContext';
import { useTranslation } from '../../lib/i18n';
import { radius, spacing, type ThemeColors } from '../../lib/theme';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { onScroll: onScrollHide } = useTabBarScroll();
  const { user } = useAuth();
  const { favorites, clubs } = useClubs();
  const { isPremium, devMode } = usePremium();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t } = useTranslation();

  // Instagram-style stats — fetched from backend
  const [matchesCount, setMatchesCount] = useState(0);
  const [likesReceived, setLikesReceived] = useState(0);
  const [friendsCount, setFriendsCount] = useState(0);

  // Instagram-style Highlights + Tabs
  const [myMoments, setMyMoments] = useState<any[]>([]);
  const [loadingMoments, setLoadingMoments] = useState(true);
  const [activeTab, setActiveTab] = useState<'moments' | 'favorites'>('moments');
  const [previewMoment, setPreviewMoment] = useState<any | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const shareUrl = useMemo(() => {
    const handle = (user as any)?.username || user?.name || 'me';
    return `https://nightfinder.app/u/${encodeURIComponent(handle)}`;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const matches = await api.listMatches();
        if (!cancelled) setMatchesCount(Array.isArray(matches) ? matches.length : 0);
      } catch {}
      try {
        const fr: any = await api.listFriends();
        const list = Array.isArray(fr) ? fr : fr?.friends || [];
        if (!cancelled) setFriendsCount(list.length);
      } catch {}
      const likes = (user as any)?.likes_received_count ?? 0;
      if (!cancelled) setLikesReceived(likes);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await api.listMyMoments();
        if (!cancelled) setMyMoments(Array.isArray(m) ? m : []);
      } catch {
        if (!cancelled) setMyMoments([]);
      } finally {
        if (!cancelled) setLoadingMoments(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const favoriteClubs = useMemo(
    () => clubs.filter((c: any) => favorites.has(c.club_id)).slice(0, 24),
    [clubs, favorites],
  );
  const activeHighlights = useMemo(
    () => myMoments.filter((m) => m.active).slice(0, 10),
    [myMoments],
  );

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Animated.ScrollView
        style={[styles.container, { paddingTop: insets.top }]}
        contentContainerStyle={{ paddingBottom: 140 }}
        scrollEventThrottle={16}
        onScroll={(e) => onScrollHide(e.nativeEvent.contentOffset.y)}
        testID="profile-screen"
      >
        {/* HEADER — avatar + name + email + hamburger */}
        <View style={styles.headerWrap}>
          <TouchableOpacity
            style={[styles.hamburgerBtn, { top: insets.top + 12 }]}
            onPress={() => router.push('/settings' as any)}
            testID="profile-settings-btn"
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.avatarWrap}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            <View style={styles.avatarRing} />
          </View>
          <Text style={styles.name}>{user?.name || t('common.guest')}</Text>
          <Text style={styles.email}>{user?.email || ''}</Text>
        </View>

        {/* STATS */}
        <View style={styles.statsRow}>
          <Stat label="Abonnés" value={friendsCount} testID="stat-followers" styles={styles} />
          <Stat label="Likes reçus" value={likesReceived} testID="stat-likes" styles={styles} />
          <Stat label="Matches" value={matchesCount} testID="stat-matches" styles={styles} />
        </View>

        {/* ACTION BUTTONS */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/swipe-profile' as any)}
            testID="action-edit-profile"
          >
            <Text style={styles.actionText}>{t('profile.edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            activeOpacity={0.7}
            onPress={() => setShareOpen(true)}
            testID="action-share-profile"
          >
            <Text style={styles.actionText}>{t('profile.share')}</Text>
          </TouchableOpacity>
        </View>

        {/* STORY HIGHLIGHTS — Moments actifs */}
        {(loadingMoments || activeHighlights.length > 0) && (
          <View style={styles.highlightsWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.highlightsContent}
            >
              {activeHighlights.map((m) => {
                const img = m.image
                  ? (typeof m.image === 'string' && m.image.startsWith('data:')
                      ? m.image
                      : `data:image/jpeg;base64,${m.image}`)
                  : null;
                return (
                  <TouchableOpacity
                    key={m.moment_id}
                    style={styles.highlightItem}
                    activeOpacity={0.85}
                    onPress={() => setPreviewMoment(m)}
                    testID={`highlight-${m.moment_id}`}
                  >
                    <LinearGradient
                      colors={['#F2C94C', '#E01A4F', '#9B23E6'] as any}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.highlightRing}
                    >
                      <View style={styles.highlightInner}>
                        {img ? (
                          <Image source={{ uri: img }} style={styles.highlightImg} />
                        ) : (
                          <View style={[styles.highlightImg, styles.highlightImgFallback]}>
                            <Ionicons name="image" size={20} color={colors.textTertiary} />
                          </View>
                        )}
                      </View>
                    </LinearGradient>
                    <Text style={styles.highlightLabel} numberOfLines={1}>
                      {m.club_name || t('profile.momentFallback')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {loadingMoments && activeHighlights.length === 0 && (
                <View style={{ paddingVertical: 18, paddingHorizontal: 4 }}>
                  <ActivityIndicator color={colors.textTertiary} />
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* TAB BAR */}
        <View style={styles.tabsBar}>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('moments')}
            testID="tab-moments"
          >
            <Ionicons
              name="grid"
              size={22}
              color={activeTab === 'moments' ? colors.textPrimary : colors.textTertiary}
            />
            <View
              style={[
                styles.tabIndicator,
                activeTab === 'moments' && styles.tabIndicatorActive,
              ]}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => setActiveTab('favorites')}
            testID="tab-favorites"
          >
            <Ionicons
              name="heart"
              size={22}
              color={activeTab === 'favorites' ? colors.textPrimary : colors.textTertiary}
            />
            <View
              style={[
                styles.tabIndicator,
                activeTab === 'favorites' && styles.tabIndicatorActive,
              ]}
            />
          </TouchableOpacity>
        </View>

        {/* GRID */}
        {activeTab === 'moments' ? (
          loadingMoments ? (
            <View style={styles.gridEmpty}>
              <ActivityIndicator color={colors.textTertiary} />
            </View>
          ) : myMoments.length === 0 ? (
            <View style={styles.gridEmpty}>
              <View style={styles.gridEmptyIcon}>
                <Ionicons name="aperture-outline" size={32} color={colors.textTertiary} />
              </View>
              <Text style={styles.gridEmptyTitle}>{t('profile.emptyMomentsTitle')}</Text>
              <Text style={styles.gridEmptySub}>
                {t('profile.emptyMomentsSub')}
              </Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {myMoments.map((m, idx) => {
                const img = m.image
                  ? (typeof m.image === 'string' && m.image.startsWith('data:')
                      ? m.image
                      : `data:image/jpeg;base64,${m.image}`)
                  : null;
                return (
                  <TouchableOpacity
                    key={m.moment_id || idx}
                    style={styles.gridCell}
                    activeOpacity={0.8}
                    onPress={() => setPreviewMoment(m)}
                    testID={`grid-moment-${idx}`}
                  >
                    {img ? (
                      <Image source={{ uri: img }} style={styles.gridImage} />
                    ) : (
                      <View style={[styles.gridImage, styles.highlightImgFallback]}>
                        <Ionicons name="image" size={20} color={colors.textTertiary} />
                      </View>
                    )}
                    {!m.active && (
                      <View style={styles.gridExpiredOverlay}>
                        <Ionicons name="time-outline" size={14} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )
        ) : favoriteClubs.length === 0 ? (
          <View style={styles.gridEmpty}>
            <View style={styles.gridEmptyIcon}>
              <Ionicons name="heart-outline" size={32} color={colors.textTertiary} />
            </View>
            <Text style={styles.gridEmptyTitle}>{t('profile.emptyFavoritesTitle')}</Text>
            <Text style={styles.gridEmptySub}>
              {t('profile.emptyFavoritesSub')}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {favoriteClubs.map((c: any, idx: number) => {
              const photo =
                c.photo || (Array.isArray(c.photos) && c.photos[0]) || c.cover_photo || null;
              return (
                <TouchableOpacity
                  key={c.club_id || idx}
                  style={styles.gridCell}
                  activeOpacity={0.8}
                  onPress={() => router.push(`/club/${c.club_id}` as any)}
                  testID={`grid-fav-${idx}`}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.gridImage} />
                  ) : (
                    <View style={[styles.gridImage, styles.highlightImgFallback]}>
                      <Ionicons name="business" size={20} color={colors.textTertiary} />
                    </View>
                  )}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.75)']}
                    style={styles.gridLabelOverlay}
                  >
                    <Text style={styles.gridLabel} numberOfLines={1}>
                      {c.name}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* PREMIUM CARD — compact upsell at the bottom */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.premiumCard, isPremium && styles.premiumCardActive]}
          onPress={() => router.push('/paywall')}
          testID="premium-card"
        >
          <View style={styles.premiumIconWrap}>
            <Ionicons
              name={isPremium ? 'diamond' : 'diamond-outline'}
              size={22}
              color={isPremium ? '#FFD700' : colors.primary}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.premiumTitle}>
              {isPremium ? t('profile.premiumActive') : t('profile.premiumGoTo')}
            </Text>
            <Text style={styles.premiumSub}>
              {isPremium
                ? `${t('profile.premiumActiveSub')}${devMode ? ' (DEV)' : ''}`
                : t('profile.premiumGoToSub')}
            </Text>
          </View>
          {isPremium ? (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>{t('profile.badgeActive')}</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          )}
        </TouchableOpacity>
      </Animated.ScrollView>

      {/* Share Profile Modal — QR code + native share + copy link */}
      <Modal
        visible={shareOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setShareOpen(false)}
      >
        <View style={styles.shareRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShareOpen(false)}
          />
          <View style={styles.shareCard} testID="share-profile-modal">
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>{t('share.title')}</Text>
            <Text style={styles.shareSub}>
              {t('share.sub')}
            </Text>

            <View style={styles.qrWrap}>
              <View style={styles.qrInner}>
                <QRCode
                  value={shareUrl}
                  size={196}
                  color="#0a0a0a"
                  backgroundColor="#ffffff"
                />
              </View>
              <Text style={styles.qrHandle}>
                {(user as any)?.username
                  ? `@${(user as any).username}`
                  : (user?.name || 'Night Finder')}
              </Text>
              <Text style={styles.qrUrl} numberOfLines={1}>{shareUrl}</Text>
            </View>

            <View style={styles.shareActions}>
              <TouchableOpacity
                style={styles.shareBtnPrimary}
                onPress={async () => {
                  try {
                    if (Platform.OS === 'web') {
                      const navAny = (typeof navigator !== 'undefined' ? (navigator as any) : null);
                      if (navAny?.share) {
                        await navAny.share({ url: shareUrl, title: 'Night Finder', text: t('profile.shareMessage') });
                      } else {
                        await Clipboard.setStringAsync(shareUrl);
                      }
                    } else {
                      await Share.share({
                        message: `${t('profile.shareMessage')} : ${shareUrl}`,
                        url: shareUrl,
                      });
                    }
                  } catch {}
                }}
                testID="share-btn-share"
                activeOpacity={0.8}
              >
                <Ionicons name="share-outline" size={18} color={colors.bg} />
                <Text style={styles.shareBtnPrimaryText}>{t('share.shareLink')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareBtnSecondary}
                onPress={async () => {
                  await Clipboard.setStringAsync(shareUrl);
                  // Subtle feedback: open the native share or just close
                }}
                testID="share-btn-copy"
                activeOpacity={0.8}
              >
                <Ionicons name="copy-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.shareBtnSecondaryText}>{t('common.copy')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.shareClose}
              onPress={() => setShareOpen(false)}
              testID="share-close"
            >
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Moment Preview Modal */}
      <Modal
        visible={!!previewMoment}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewMoment(null)}
      >
        <View style={styles.previewRoot}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setPreviewMoment(null)}
          />
          {previewMoment && (
            <View style={styles.previewCard} testID="moment-preview-modal">
              {(() => {
                const raw = previewMoment.image;
                const img = raw
                  ? (typeof raw === 'string' && raw.startsWith('data:')
                      ? raw
                      : `data:image/jpeg;base64,${raw}`)
                  : null;
                return img ? (
                  <Image source={{ uri: img }} style={styles.previewImage} resizeMode="contain" />
                ) : (
                  <View style={[styles.previewImage, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="image" size={48} color={colors.textTertiary} />
                  </View>
                );
              })()}
              <View style={styles.previewMeta}>
                <Ionicons name="location" size={14} color={colors.textSecondary} />
                <Text style={styles.previewClubName} numberOfLines={1}>
                  {previewMoment.club_name || 'Club'}
                </Text>
                {!previewMoment.active && (
                  <View style={styles.previewExpired}>
                    <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
                    <Text style={styles.previewExpiredText}>{t('profile.expired')}</Text>
                  </View>
                )}
              </View>
              {previewMoment.caption ? (
                <Text style={styles.previewCaption}>{previewMoment.caption}</Text>
              ) : null}
              <TouchableOpacity
                style={styles.previewClose}
                onPress={() => setPreviewMoment(null)}
                testID="moment-preview-close"
              >
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

function Stat({
  label,
  value,
  testID,
  styles,
}: {
  label: string;
  value: number;
  testID?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerWrap: {
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: spacing.xl,
    position: 'relative',
  },
  hamburgerBtn: {
    position: 'absolute',
    right: spacing.md,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: {
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 30, fontWeight: '900' },
  avatarRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  name: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  email: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: 12,
  },
  stat: {
    flex: 1,
    paddingVertical: 18,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.textSecondary, marginTop: 2, fontSize: 12, fontWeight: '600' },

  actionRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    backgroundColor: colors.fill,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: -0.2,
  },

  // Story Highlights
  highlightsWrap: { marginTop: spacing.lg },
  highlightsContent: { paddingHorizontal: spacing.lg, gap: 14, alignItems: 'flex-start' },
  highlightItem: { alignItems: 'center', width: 72 },
  highlightRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightInner: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    backgroundColor: colors.bg,
    padding: 2,
  },
  highlightImg: { width: '100%', height: '100%', borderRadius: 30 },
  highlightImgFallback: {
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 6,
    maxWidth: 72,
    textAlign: 'center',
    fontWeight: '500',
  },

  // Tab bar
  tabsBar: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingTop: 12 },
  tabIndicator: {
    height: 2,
    width: '100%',
    backgroundColor: 'transparent',
    marginTop: 10,
  },
  tabIndicatorActive: { backgroundColor: colors.textPrimary },

  // Grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 0 },
  gridCell: {
    width: `${100 / 3}%`,
    aspectRatio: 1,
    padding: 1,
    position: 'relative',
  },
  gridImage: { width: '100%', height: '100%', backgroundColor: colors.surfaceElevated },
  gridLabelOverlay: {
    position: 'absolute',
    left: 1,
    right: 1,
    bottom: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    paddingTop: 24,
  },
  gridLabel: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: -0.1 },
  gridExpiredOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridEmpty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: spacing.xl },
  gridEmptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  gridEmptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  gridEmptySub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Premium card
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    backgroundColor: 'rgba(224,26,79,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(224,26,79,0.5)',
  },
  premiumCardActive: {
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderColor: 'rgba(255,215,0,0.5)',
  },
  premiumIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  premiumSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  premiumBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  premiumBadgeText: { color: '#0a0a0a', fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  // Moment Preview Modal
  previewRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  previewCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewImage: { width: '100%', aspectRatio: 1, backgroundColor: '#000' },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  previewClubName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  previewExpired: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  previewExpiredText: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  previewCaption: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    lineHeight: 19,
  },
  previewClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Share Profile Modal
  shareRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  shareCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl + 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  shareHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 16,
  },
  shareTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  shareSub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  qrWrap: { alignItems: 'center', marginVertical: spacing.md },
  qrInner: {
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  qrHandle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 14,
    letterSpacing: -0.3,
  },
  qrUrl: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
    maxWidth: 280,
  },
  shareActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: spacing.lg,
  },
  shareBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  shareBtnPrimaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  shareBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.fill,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  shareBtnSecondaryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  shareClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
