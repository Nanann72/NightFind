/**
 * "Plus" hub — premium grid giving access to Découverte (swipe),
 * Moments, Sorties, Recherche + shortcuts and Premium banner.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { HapticButton } from '../../components/ui/HapticButton';
import { usePremium } from '../../lib/premium';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';
import { useTranslation } from '../../lib/i18n';

export default function PlusHub() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { isPremium } = usePremium();

  const mainCards = [
    { key: 'discover', icon: 'heart' as const, title: t('plusHub.discover'), sub: t('plusHub.discoverSub'), route: '/(tabs)/swipe' },
    { key: 'moments', icon: 'flame' as const, title: t('plusHub.moments'), sub: t('plusHub.momentsSub'), route: '/feed' },
    { key: 'events', icon: 'calendar' as const, title: t('plusHub.events'), sub: t('plusHub.eventsSub'), route: '/(tabs)/events' },
    { key: 'search', icon: 'search' as const, title: t('plusHub.search'), sub: t('plusHub.searchSub'), route: '/search' },
  ];

  const rows = [
    { key: 'friends', icon: 'people-outline' as const, title: t('plusHub.friends'), route: '/friends' },
    { key: 'favorites', icon: 'bookmark-outline' as const, title: t('plusHub.favorites'), route: '/favorites' },
    { key: 'mysongs', icon: 'musical-notes-outline' as const, title: t('plusHub.mySongs'), route: '/my-songs' },
    { key: 'requests', icon: 'person-add-outline' as const, title: t('plusHub.requests'), route: '/match-requests' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="plus-hub-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140, paddingHorizontal: spacing.md }}
      >
        <Text style={styles.title}>{t('tabs.plus')}</Text>

        {!isPremium ? (
          <Animated.View entering={FadeInDown.duration(400)}>
            <HapticButton
              haptic="medium"
              scale={0.98}
              style={styles.premiumBanner}
              onPress={() => router.push('/paywall')}
              testID="plus-premium-banner"
            >
              <View style={styles.premiumHalo} pointerEvents="none" />
              <View style={styles.premiumIcon}>
                <Ionicons name="sparkles" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumTitle}>{t('plusHub.premiumTitle')}</Text>
                <Text style={styles.premiumSub}>{t('plusHub.premiumSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </HapticButton>
          </Animated.View>
        ) : null}

        <View style={styles.grid}>
          {mainCards.map((c, i) => (
            <Animated.View
              key={c.key}
              entering={FadeInDown.delay(60 + i * 60).springify().damping(18)}
              style={styles.gridItem}
            >
              <HapticButton
                haptic="light"
                scale={0.97}
                style={styles.card}
                onPress={() => router.push(c.route as any)}
                testID={`plus-card-${c.key}`}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name={c.icon} size={22} color={colors.primary} />
                </View>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardSub} numberOfLines={2}>{c.sub}</Text>
              </HapticButton>
            </Animated.View>
          ))}
        </View>

        <View style={styles.rowsCard}>
          {rows.map((r, i) => (
            <HapticButton
              key={r.key}
              haptic="light"
              scale={0.99}
              style={[styles.row, i < rows.length - 1 && styles.rowBorder]}
              onPress={() => router.push(r.route as any)}
              testID={`plus-row-${r.key}`}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={r.icon} size={18} color={colors.textSecondary} />
              </View>
              <Text style={styles.rowTitle}>{r.title}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </HapticButton>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  premiumHalo: {
    position: 'absolute',
    top: -70,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
  },
  premiumIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  premiumSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: { width: '48%', flexGrow: 1 },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    minHeight: 130,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  cardSub: { color: colors.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 17 },
  rowsCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.fillSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
});
