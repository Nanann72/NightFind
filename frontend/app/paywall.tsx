/**
 * Night Finder Premium — luxury Apple-style paywall.
 * Black background, subtle violet halo, 4 benefits, elegant white CTA.
 * Purchase logic unchanged (RevenueCat via usePremium).
 */
import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { usePremium } from '../lib/premium';
import { getLastOfferingsError, isRealMode } from '../lib/purchases';
import { HapticButton } from '../components/ui/HapticButton';
import { radius, spacing } from '../lib/theme';

// Fixed luxury palette — Premium is always deep black, regardless of theme.
const P = {
  bg: '#050505',
  card: '#141414',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: '#FFFFFF',
  textDim: '#A1A1AA',
  textFaint: '#5C5C64',
  violet: '#E11D48',
  violetSoft: 'rgba(225, 29, 72, 0.14)',
};

const BENEFITS = [
  { icon: 'eye-outline' as const, title: 'Voir qui est là ce soir' },
  { icon: 'infinite' as const, title: 'Swipes illimités' },
  { icon: 'options-outline' as const, title: 'Filtres avancés' },
  { icon: 'flash-outline' as const, title: 'Boost de profil' },
];

export default function Paywall() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const insets = useSafeAreaInsets();
  const { isPremium, offerings, buy, restore, loading, devMode, refreshOfferings } = usePremium();
  const [selectedId, setSelectedId] = useState<string>('annual');
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Slow-breathing halo
  const haloScale = useSharedValue(1);
  useEffect(() => {
    haloScale.value = withRepeat(
      withTiming(1.12, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [haloScale]);
  const haloStyle = useAnimatedStyle(() => ({ transform: [{ scale: haloScale.value }] }));

  useEffect(() => {
    const annual = offerings.find((p) => p.period === 'year');
    if (annual) setSelectedId(annual.identifier);
    else if (offerings.length > 0) setSelectedId(offerings[0].identifier);
  }, [offerings]);

  useEffect(() => {
    if (isPremium) {
      const t = setTimeout(() => router.back(), 1200);
      return () => clearTimeout(t);
    }
  }, [isPremium]);

  const selectedPkg = offerings.find((p) => p.identifier === selectedId) || offerings[0];

  const onPurchase = async () => {
    if (!selectedPkg) return;
    setBusy(true);
    try {
      const info = await buy(selectedPkg);
      if (info.isPremium && Platform.OS !== 'web') {
        Alert.alert(
          'Bienvenue dans Premium ✨',
          devMode
            ? '(Mode DEV) Tu as accès à toutes les fonctionnalités Premium.'
            : 'Tu as maintenant accès à toutes les fonctionnalités Premium.',
        );
      }
    } catch (e: any) {
      if (!e?.userCancelled) {
        Alert.alert('Erreur', e?.message || "Impossible de finaliser l'achat.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    setBusy(true);
    try {
      const info = await restore();
      if (!info.isPremium) {
        Alert.alert('Aucun achat trouvé', "Pas d'abonnement actif sur ce compte.");
      } else {
        Alert.alert('Restauré', 'Ton abonnement Premium a été restauré.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="paywall-screen">
      {/* Subtle violet halo */}
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <Animated.View pointerEvents="none" style={styles.haloInner} />

      <ScrollView contentContainerStyle={{ paddingBottom: 220 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="paywall-close-btn">
            <Ionicons name="close" size={20} color={P.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onRestore} testID="paywall-restore-btn" hitSlop={10}>
            <Text style={styles.restoreLink}>Restaurer mes achats</Text>
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <Animated.View entering={FadeInDown.duration(500)} style={styles.hero}>
          <View style={styles.crownWrap}>
            <MaterialCommunityIcons name="crown-outline" size={30} color={P.violet} />
          </View>
          <Text style={styles.brand}>Night Finder</Text>
          <Text style={styles.brandPremium}>PREMIUM</Text>
          <Text style={styles.subtitle}>Passe au niveau supérieur.</Text>
          {params.reason ? (
            <View style={styles.reasonPill}>
              <Ionicons name="lock-closed" size={11} color={P.violet} />
              <Text style={styles.reasonText}>{params.reason}</Text>
            </View>
          ) : null}
        </Animated.View>

        {/* 4 benefits */}
        <View style={styles.benefitsList}>
          {BENEFITS.map((b, i) => (
            <Animated.View
              entering={FadeInUp.delay(120 + i * 70).duration(380)}
              key={b.title}
              style={styles.benefitRow}
            >
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon} size={17} color={P.violet} />
              </View>
              <Text style={styles.benefitTitle}>{b.title}</Text>
              <Ionicons name="checkmark-circle" size={19} color={P.violet} />
            </Animated.View>
          ))}
        </View>

        {/* Plans */}
        <View style={styles.plansWrap}>
          {loading ? (
            <ActivityIndicator color={P.violet} style={{ marginTop: 20 }} />
          ) : offerings.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="hourglass-outline" size={32} color={P.textDim} />
              <Text style={styles.emptyTitle}>Abonnements en cours de mise en ligne</Text>
              <Text style={styles.emptyText}>
                Nos offres Premium sont en cours d&apos;approbation par l&apos;App Store.
                Reviens dans quelques heures.
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                activeOpacity={0.8}
                onPress={async () => {
                  setRetrying(true);
                  try { await refreshOfferings(); } finally { setRetrying(false); }
                }}
                disabled={retrying}
                testID="paywall-retry"
              >
                {retrying ? (
                  <ActivityIndicator color={P.text} />
                ) : (
                  <>
                    <Ionicons name="refresh" size={15} color={P.text} />
                    <Text style={styles.retryBtnText}>Réessayer</Text>
                  </>
                )}
              </TouchableOpacity>
              {isRealMode() && getLastOfferingsError() ? (
                <Text style={styles.diagText}>ⓘ {getLastOfferingsError()}</Text>
              ) : null}
            </View>
          ) : (
            offerings.map((p) => {
              const sel = p.identifier === selectedId;
              return (
                <TouchableOpacity
                  key={p.identifier}
                  activeOpacity={0.85}
                  style={[styles.planCard, sel && styles.planCardSelected]}
                  onPress={() => setSelectedId(p.identifier)}
                  testID={`paywall-plan-${p.identifier}`}
                >
                  {p.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{p.badge}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.radioOuter, sel && styles.radioOuterSel]}>
                    {sel ? <View style={styles.radioInner} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    {p.savings ? (
                      <Text style={styles.planSavings}>{p.savings}</Text>
                    ) : (
                      <Text style={styles.planDesc}>Renouvellement automatique</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.priceText}>{p.priceString}</Text>
                    <Text style={styles.priceUnit}>/{p.period === 'year' ? 'an' : 'mois'}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.footnote}>
          Abonnement Night Finder Premium — {selectedPkg?.period === 'year' ? 'annuel (79,99 €/an)' : 'mensuel (4,99 €/mois)'}. Le paiement est prélevé sur ton compte Apple ID / Google Play au moment de la confirmation. L&apos;abonnement se renouvelle automatiquement sauf désactivation au moins 24h avant l&apos;échéance, depuis les Réglages de ton store.
        </Text>
        <View style={styles.legalLinksRow}>
          <TouchableOpacity onPress={() => router.push({ pathname: '/legal', params: { doc: 'cgu' } })}>
            <Text style={styles.legalLink}>Conditions</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}>
            <Text style={styles.legalLink}>Confidentialité</Text>
          </TouchableOpacity>
        </View>
        {__DEV__ && devMode ? (
          <Text style={styles.devNote}>⚙️ Mode DEV — achat simulé. Build natif requis pour vrais paiements.</Text>
        ) : null}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 12 }]}>
        <HapticButton
          haptic="medium"
          scale={0.97}
          style={[styles.cta, busy && { opacity: 0.6 }]}
          disabled={busy || !selectedPkg}
          onPress={onPurchase}
          testID="paywall-buy-btn"
        >
          {busy ? (
            <ActivityIndicator color="#050505" />
          ) : (
            <Text style={styles.ctaText}>Essayer Premium</Text>
          )}
        </HapticButton>
        {selectedPkg ? (
          <Text style={styles.ctaPrice}>
            {selectedPkg.priceString} / {selectedPkg.period === 'year' ? 'an' : 'mois'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: P.bg },
  halo: {
    position: 'absolute',
    top: -180,
    alignSelf: 'center',
    width: 460,
    height: 460,
    borderRadius: 230,
    backgroundColor: 'rgba(225, 29, 72, 0.09)',
  },
  haloInner: {
    position: 'absolute',
    top: -60,
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(225, 29, 72, 0.06)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreLink: { color: P.textDim, fontSize: 13, fontWeight: '600' },
  hero: { alignItems: 'center', paddingHorizontal: spacing.lg, marginTop: 28 },
  crownWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: P.violetSoft,
    borderWidth: 1,
    borderColor: 'rgba(225, 29, 72, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  brand: { color: P.text, fontSize: 28, fontWeight: '700', letterSpacing: 0.3 },
  brandPremium: {
    color: P.violet,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 5,
    marginTop: 6,
  },
  subtitle: { color: P.textDim, fontSize: 15, textAlign: 'center', marginTop: 14 },
  reasonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    backgroundColor: P.violetSoft,
    borderColor: 'rgba(225, 29, 72, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  reasonText: { color: P.violet, fontSize: 12, fontWeight: '700' },
  benefitsList: { paddingHorizontal: spacing.lg, marginTop: 36, gap: 10 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: P.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: P.border,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  benefitIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: P.violetSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitTitle: { flex: 1, color: P.text, fontSize: 15, fontWeight: '600' },
  plansWrap: { paddingHorizontal: spacing.lg, marginTop: 28, gap: 12 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: P.card,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: P.border,
    padding: 18,
    position: 'relative',
  },
  planCardSelected: { borderColor: P.violet, backgroundColor: 'rgba(225, 29, 72, 0.07)' },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: P.violet,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: P.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSel: { borderColor: P.violet },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: P.violet },
  planTitle: { color: P.text, fontSize: 15, fontWeight: '700' },
  planDesc: { color: P.textFaint, fontSize: 11, marginTop: 3 },
  planSavings: { color: P.violet, fontSize: 11, fontWeight: '700', marginTop: 3 },
  priceText: { color: P.text, fontSize: 18, fontWeight: '700' },
  priceUnit: { color: P.textFaint, fontSize: 11, marginTop: -1 },
  emptyState: { alignItems: 'center', paddingHorizontal: spacing.lg, gap: 8, marginTop: 8 },
  emptyTitle: { color: P.text, fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  emptyText: { color: P.textDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.borderStrong,
  },
  retryBtnText: { color: P.text, fontWeight: '700', fontSize: 14 },
  diagText: {
    color: P.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: P.card,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: radius.lg,
  },
  footnote: {
    color: P.textFaint,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: 24,
    lineHeight: 16,
  },
  legalLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  legalLink: { color: P.textDim, fontSize: 11, fontWeight: '600', textDecorationLine: 'underline' },
  legalSep: { color: P.textFaint, fontSize: 11 },
  devNote: {
    color: P.violet,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: 10,
    fontWeight: '700',
  },
  ctaBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: 14,
    backgroundColor: 'rgba(5,5,5,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.border,
  },
  cta: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  ctaText: { color: '#050505', fontWeight: '700', fontSize: 16, letterSpacing: 0.2 },
  ctaPrice: { color: P.textDim, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 10 },
});
