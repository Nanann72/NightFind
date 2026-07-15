/**
 * Mettre en avant mon bar (Phase 3) — propriétaire vérifié.
 * Choix de formule → paiement Stripe (CB / Apple Pay) → validation admin.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { api, Promotion } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const PLANS = [
  { key: '7d' as const, price: '19,99 €', days: 7, label: '7 jours', desc: 'Idéal pour un événement ou un week-end' },
  { key: '30d' as const, price: '49,99 €', days: 30, label: '30 jours', desc: 'Visibilité maximale tout le mois' },
];

const STATUS_META: Record<string, { label: string; icon: any; color: string }> = {
  awaiting_payment: { label: 'Paiement en attente', icon: 'card-outline', color: '#F59E0B' },
  pending_review: { label: 'Payé — en attente de validation', icon: 'hourglass-outline', color: '#F59E0B' },
  active: { label: 'Active ⭐', icon: 'star', color: '#22C55E' },
  rejected: { label: 'Refusée (remboursé)', icon: 'close-circle', color: '#EF4444' },
  expired: { label: 'Terminée', icon: 'time-outline', color: '#71717A' },
};

export default function PromoteBar() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [promos, setPromos] = useState<Promotion[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.myPromotions();
      setPromos(r.promotions || []);
    } catch (e: any) {
      if (e?.status === 403) {
        Alert.alert('Accès réservé', 'Cette page est réservée aux propriétaires de bars vérifiés.');
        router.back();
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const hasOngoing = promos.some((p) => p.status === 'pending_review' || p.status === 'active');

  const pay = async (plan: '7d' | '30d') => {
    setBusy(plan);
    try {
      const origin = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : BASE_URL;
      const r = await api.createPromoCheckout(plan, origin);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.href = r.url;
      } else {
        await WebBrowser.openBrowserAsync(r.url);
        // Back from the browser → verify the payment
        router.push({ pathname: '/promotion-status', params: { session_id: r.session_id } } as any);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Paiement indisponible');
    } finally {
      setBusy(null);
    }
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="promote-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mise en avant ⭐</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <View style={styles.introCard}>
            <Ionicons name="rocket" size={26} color="#F59E0B" />
            <Text style={styles.introTitle}>Booste la visibilité de ton bar</Text>
            <Text style={styles.introText}>
              {"Ton établissement apparaît en priorité dans les listes, dans la section « À la une ⭐ » de l'accueil, avec un badge Sponsorisé. Après paiement, notre équipe valide ta demande sous 24h. En cas de refus, tu es intégralement remboursé."}
            </Text>
          </View>

          {!hasOngoing && (
            <>
              <Text style={styles.sectionTitle}>Choisis ta formule</Text>
              {PLANS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={styles.planCard}
                  onPress={() => pay(p.key)}
                  disabled={!!busy}
                  activeOpacity={0.85}
                  testID={`plan-${p.key}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planLabel}>{p.label}</Text>
                    <Text style={styles.planDesc}>{p.desc}</Text>
                  </View>
                  <View style={styles.planRight}>
                    {busy === p.key ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <>
                        <Text style={styles.planPrice}>{p.price}</Text>
                        <View style={styles.payBtn}>
                          <Ionicons name="card" size={14} color="#fff" />
                          <Text style={styles.payText}>Payer</Text>
                        </View>
                      </>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              <Text style={styles.secureNote}>
                <Ionicons name="lock-closed" size={11} color={colors.textTertiary} /> Paiement sécurisé
                par Stripe — carte bancaire et Apple Pay acceptés.
              </Text>
            </>
          )}

          {promos.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Mes mises en avant</Text>
              {promos.map((p) => {
                const meta = STATUS_META[p.status] || STATUS_META.awaiting_payment;
                return (
                  <View key={p.promo_id} style={styles.promoCard} testID={`promo-${p.status}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.promoLabel}>{p.plan_label} — {p.amount.toFixed(2).replace('.', ',')} €</Text>
                      <View style={styles.statusRow}>
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                      {p.status === 'active' && !!p.ends_at && (
                        <Text style={styles.promoSub}>{`Jusqu'au ${fmtDate(p.ends_at)}`}</Text>
                      )}
                      {p.status === 'rejected' && !!p.rejection_reason && (
                        <Text style={styles.promoSub}>Motif : {p.rejection_reason}</Text>
                      )}
                    </View>
                    {p.status === 'awaiting_payment' && (
                      <TouchableOpacity
                        onPress={() => router.push({ pathname: '/promotion-status', params: { session_id: p.session_id } } as any)}
                        style={styles.checkBtn}
                        testID={`check-${p.promo_id}`}
                      >
                        <Text style={styles.checkText}>Vérifier</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
    introCard: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
    },
    introTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
    introText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    sectionTitle: {
      color: colors.textPrimary, fontSize: 15, fontWeight: '800',
      marginTop: spacing.xl, marginBottom: spacing.sm,
    },
    planCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    },
    planLabel: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
    planDesc: { color: colors.textSecondary, fontSize: 12.5, marginTop: 3 },
    planRight: { alignItems: 'flex-end', gap: 6 },
    planPrice: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
    payBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.primary, borderRadius: 999,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    payText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
    secureNote: { color: colors.textTertiary, fontSize: 11.5, textAlign: 'center', marginTop: 4 },
    promoCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    },
    promoLabel: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '700' },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    statusText: { fontSize: 12.5, fontWeight: '700' },
    promoSub: { color: colors.textTertiary, fontSize: 12, marginTop: 3 },
    checkBtn: {
      backgroundColor: colors.primary, borderRadius: 999,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    checkText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  });
