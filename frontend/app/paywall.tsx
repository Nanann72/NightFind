import { useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { usePremium } from '../lib/premium';
import { colors, radius, spacing } from '../lib/theme';

const BENEFITS = [
  { icon: 'infinite' as const, title: 'Swipes illimités', desc: 'Plus de limite quotidienne' },
  { icon: 'globe-outline' as const, title: 'Rayon étendu 200km', desc: 'Voir les soirées dans toute la région' },
  { icon: 'eye' as const, title: 'Qui sera là ce soir ?', desc: 'Vois les autres utilisateurs présents au club' },
  { icon: 'options' as const, title: 'Filtres avancés', desc: 'DJ, dress code, ambiance, prix VIP' },
  { icon: 'flame' as const, title: 'Boost de profil', desc: 'Top user de la soirée' },
  { icon: 'rocket' as const, title: 'Notifications anticipées', desc: 'Les meilleurs events avant tout le monde' },
  { icon: 'bar-chart' as const, title: 'Statistiques perso', desc: 'Streak, clubs visités, soirées' },
  { icon: 'close-circle-outline' as const, title: 'Sans publicité', desc: '100% premium, 0% pub' },
];

export default function Paywall() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const insets = useSafeAreaInsets();
  const { isPremium, offerings, buy, restore, loading, devMode } = usePremium();
  const [selectedId, setSelectedId] = useState<string>('annual');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Default-select annual if present
    const annual = offerings.find((p) => p.period === 'year');
    if (annual) setSelectedId(annual.identifier);
  }, [offerings]);

  useEffect(() => {
    if (isPremium) {
      // Auto-dismiss when entitlement becomes active
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
      if (info.isPremium) {
        if (Platform.OS !== 'web') {
          Alert.alert(
            '🎉 Bienvenue dans Premium !',
            devMode
              ? '(Mode DEV) Tu as accès à toutes les fonctionnalités Premium.'
              : 'Tu as maintenant accès à toutes les fonctionnalités Premium.',
          );
        }
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
      <LinearGradient
        colors={['#1a0a14', colors.bg, colors.bg]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 200 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.closeBtn}
            testID="paywall-close-btn"
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onRestore} testID="paywall-restore-btn">
            <Text style={styles.restoreLink}>Restaurer</Text>
          </TouchableOpacity>
        </View>

        <Animated.View entering={FadeInDown.duration(500)} style={styles.hero}>
          <View style={styles.crownWrap}>
            <Ionicons name="diamond" size={32} color="#FFD700" />
          </View>
          <Text style={styles.brand}>NIGHT FINDER</Text>
          <Text style={styles.brandPremium}>PREMIUM</Text>
          <Text style={styles.subtitle}>
            Débloque toutes les soirées qui comptent près de toi
          </Text>
          {params.reason ? (
            <View style={styles.reasonPill}>
              <Ionicons name="lock-closed" size={11} color={colors.primary} />
              <Text style={styles.reasonText}>{params.reason}</Text>
            </View>
          ) : null}
        </Animated.View>

        <View style={styles.benefitsList}>
          {BENEFITS.map((b, i) => (
            <Animated.View
              entering={FadeInUp.delay(80 + i * 50).duration(380)}
              key={b.title}
              style={styles.benefitRow}
            >
              <View style={styles.benefitIcon}>
                <Ionicons name={b.icon} size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            </Animated.View>
          ))}
        </View>

        <View style={styles.plansWrap}>
          {loading || offerings.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
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
                  <View style={styles.radio}>
                    <View style={[styles.radioOuter, sel && styles.radioOuterSel]}>
                      {sel ? <View style={styles.radioInner} /> : null}
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planTitle}>{p.title}</Text>
                    {p.savings ? (
                      <Text style={styles.planSavings}>{p.savings}</Text>
                    ) : (
                      <Text style={styles.planDesc}>Renouvellement automatique</Text>
                    )}
                  </View>
                  <View style={styles.priceWrap}>
                    <Text style={styles.priceText}>{p.priceString}</Text>
                    <Text style={styles.priceUnit}>
                      /{p.period === 'year' ? 'an' : 'mois'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <Text style={styles.footnote}>
          Renouvellement automatique. Annulable à tout moment depuis les réglages de ton store.
        </Text>
        {devMode ? (
          <Text style={styles.devNote}>
            ⚙️ Mode DEV — achat simulé sur web/Expo Go. Build natif requis pour vrais paiements.
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.cta, busy && { opacity: 0.6 }]}
          disabled={busy || !selectedPkg}
          onPress={onPurchase}
          testID="paywall-buy-btn"
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.ctaText}>
              Continuer pour {selectedPkg?.priceString || ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restoreLink: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  hero: { alignItems: 'center', paddingHorizontal: spacing.lg, marginTop: 10 },
  crownWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 4,
    opacity: 0.7,
  },
  brandPremium: {
    color: '#FFD700',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 2,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 320,
    lineHeight: 21,
  },
  reasonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(224,26,79,0.12)',
    borderColor: 'rgba(224,26,79,0.4)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  reasonText: { color: colors.primary, fontSize: 12, fontWeight: '700' },

  benefitsList: { paddingHorizontal: spacing.lg, marginTop: 24, gap: 10 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(224,26,79,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  benefitDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  plansWrap: { paddingHorizontal: spacing.lg, marginTop: 24, gap: 12 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    position: 'relative',
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(224,26,79,0.08)',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 14,
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: { color: '#0a0a0a', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  radio: { width: 22, alignItems: 'center' },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSel: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  planTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  planDesc: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  planSavings: { color: '#22c55e', fontSize: 11, fontWeight: '700', marginTop: 2 },
  priceWrap: { alignItems: 'flex-end' },
  priceText: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  priceUnit: { color: colors.textTertiary, fontSize: 11, marginTop: -2 },

  footnote: {
    color: colors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: 18,
    lineHeight: 16,
  },
  devNote: {
    color: '#FFD700',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: 8,
    fontWeight: '700',
  },

  ctaBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  ctaText: { color: colors.bg, fontWeight: '900', fontSize: 16, letterSpacing: 0.3 },
});
