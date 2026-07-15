/**
 * Admin — Mises en avant payantes (Phase 3/4).
 * Valider (activation) ou refuser (remboursement Stripe automatique).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Promotion } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const TABS = [
  { key: 'requested', label: 'À valider' },
  { key: 'approved_awaiting_payment', label: 'Paiement' },
  { key: 'active', label: 'Actives' },
  { key: 'rejected', label: 'Refusées' },
] as const;

export default function AdminPromotions() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<string>('requested');
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (t = tab) => {
    setLoading(true);
    try {
      const r = await api.adminListPromotions(t);
      setPromos(r.promotions || []);
      setPendingCount(r.pending_count || 0);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (p: Promotion) => {
    setBusy(p.promo_id);
    try {
      await api.adminApprovePromotion(p.promo_id);
      Alert.alert('✅ Activée', `${p.club_name} est à la une pendant ${p.days} jours.`);
      load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Activation impossible');
    } finally {
      setBusy(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectFor) return;
    setBusy(rejectFor);
    try {
      const r = await api.adminRejectPromotion(rejectFor, reason.trim());
      setRejectFor(null);
      setReason('');
      Alert.alert(
        'Demande refusée',
        r.refund === 'refunded'
          ? 'Le propriétaire a été intégralement remboursé et notifié.'
          : r.refund === 'refund_failed'
            ? '⚠️ Le remboursement automatique a échoué — à traiter manuellement dans le dashboard Stripe.'
            : 'Le propriétaire a été notifié.',
      );
      load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Refus impossible');
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="promos-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mises en avant ⭐</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            testID={`ptab-${t.key}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}{t.key === 'requested' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {promos.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="star-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>Aucune demande</Text>
            </View>
          )}
          {promos.map((p) => (
            <View key={p.promo_id} style={styles.card} testID={`promo-card-${p.promo_id}`}>
              <View style={styles.cardTop}>
                <SafeImage uri={p.club_photo || undefined} style={styles.cardPhoto} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardClub} numberOfLines={1}>{p.club_name}</Text>
                  <Text style={styles.cardSub}>
                    {p.plan_label} · {p.amount.toFixed(2).replace('.', ',')} € · {fmtDate(p.created_at)}
                  </Text>
                  <Text style={[styles.payState, {
                    color: p.status === 'active' ? '#22C55E'
                      : p.status === 'approved_awaiting_payment' ? '#F59E0B' : colors.textTertiary,
                  }]}>
                    {p.status === 'active' ? `💳 Payé · jusqu'au ${fmtDate(p.ends_at)}`
                      : p.status === 'approved_awaiting_payment' ? '⏳ Validée — en attente du paiement Apple du propriétaire'
                        : p.status === 'requested' ? 'Demande gratuite — aucun paiement effectué'
                          : p.status === 'expired' ? 'Terminée' : ''}
                  </Text>
                  {p.status === 'rejected' && !!p.rejection_reason && (
                    <Text style={styles.cardSub}>Motif : {p.rejection_reason}</Text>
                  )}
                </View>
              </View>

              {p.status === 'requested' && (
                rejectFor === p.promo_id ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <TextInput
                      style={styles.reasonInput}
                      placeholder="Motif du refus (aucun paiement à rembourser)…"
                      placeholderTextColor={colors.textTertiary}
                      value={reason}
                      onChangeText={setReason}
                      testID="promo-reject-reason"
                    />
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.rejectBtn, { flex: 1 }]}
                        onPress={confirmReject}
                        disabled={busy === p.promo_id}
                        testID="promo-confirm-reject"
                      >
                        {busy === p.promo_id ? <ActivityIndicator color="#fff" /> : (
                          <Text style={styles.btnText}>Confirmer le refus</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.cancelBtn, { flex: 1 }]}
                        onPress={() => { setRejectFor(null); setReason(''); }}
                      >
                        <Text style={styles.cancelText}>Annuler</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[styles.rejectBtn, { flex: 1 }]}
                      onPress={() => setRejectFor(p.promo_id)}
                      disabled={!!busy}
                      testID={`promo-reject-${p.promo_id}`}
                    >
                      <Ionicons name="close" size={15} color="#fff" />
                      <Text style={styles.btnText}>Refuser</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.approveBtn, { flex: 1 }]}
                      onPress={() => approve(p)}
                      disabled={!!busy}
                      testID={`promo-approve-${p.promo_id}`}
                    >
                      {busy === p.promo_id ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="checkmark" size={15} color="#fff" />
                          <Text style={styles.btnText}>Valider</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )
              )}
            </View>
          ))}
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
    tabsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
    tab: {
      flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
    tabTextActive: { color: '#fff' },
    empty: { alignItems: 'center', marginTop: 60, gap: 8 },
    emptyText: { color: colors.textTertiary, fontSize: 14 },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardPhoto: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
    cardClub: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    cardSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
    payState: { fontSize: 12.5, fontWeight: '700', marginTop: 3 },
    actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    approveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      backgroundColor: '#22C55E', borderRadius: 999, paddingVertical: 12,
    },
    rejectBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      backgroundColor: '#EF4444', borderRadius: 999, paddingVertical: 12,
    },
    btnText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
    cancelBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    cancelText: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '600' },
    reasonInput: {
      backgroundColor: colors.surfaceElevated, borderRadius: radius.md, borderWidth: 1,
      borderColor: colors.border, color: colors.textPrimary, fontSize: 14,
      paddingHorizontal: spacing.md, paddingVertical: 10,
    },
  });
