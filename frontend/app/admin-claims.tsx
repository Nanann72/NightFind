/**
 * Admin — Revendications d'établissements (Phase 2).
 * Liste des demandes (en attente / approuvées / refusées), détail avec
 * documents (pièce d'identité + Kbis), approbation / refus motivé.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Image, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, BarClaim } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const TABS = [
  { key: 'pending', label: 'En attente' },
  { key: 'approved', label: 'Approuvées' },
  { key: 'rejected', label: 'Refusées' },
] as const;

const ROLE_LABEL: Record<string, string> = {
  proprietaire: 'Propriétaire', gerant: 'Gérant', manager: 'Manager',
};

export default function AdminClaims() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [claims, setClaims] = useState<BarClaim[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Detail modal
  const [detail, setDetail] = useState<BarClaim | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async (t = tab) => {
    setLoading(true);
    try {
      const r = await api.adminListBarClaims(t);
      setClaims(r.claims || []);
      setPendingCount(r.pending_count || 0);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (claim: BarClaim) => {
    setDetail(claim);
    setRejectMode(false);
    setRejectReason('');
    setDetailLoading(true);
    try {
      const full = await api.adminBarClaimDetail(claim.claim_id);
      setDetail(full);
    } catch {
      // keep the light version
    } finally {
      setDetailLoading(false);
    }
  };

  const approve = () => {
    if (!detail) return;
    Alert.alert(
      'Approuver la demande ?',
      `${detail.club_name} recevra le badge Vérifié et ${detail.owner_name} deviendra propriétaire.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Approuver',
          onPress: async () => {
            setBusy(true);
            try {
              await api.adminApproveBarClaim(detail.claim_id);
              setDetail(null);
              Alert.alert('✅ Approuvée', `${detail.club_name} est maintenant un bar Vérifié.`);
              load();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message || 'Approbation impossible');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const reject = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.adminRejectBarClaim(detail.claim_id, rejectReason.trim());
      setDetail(null);
      Alert.alert('Demande refusée', 'Le demandeur a été notifié.');
      load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Refus impossible');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.adminRevokeVerified(detail.club_id);
      setDetail(null);
      Alert.alert('Badge révoqué', `${detail.club_name} n'est plus un bar Vérifié.`);
      load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Révocation impossible');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch { return ''; }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="claims-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Revendications</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            testID={`tab-${t.key}`}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}{t.key === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          {claims.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="file-tray-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>Aucune demande</Text>
            </View>
          )}
          {claims.map((c) => (
            <TouchableOpacity
              key={c.claim_id}
              style={styles.card}
              onPress={() => openDetail(c)}
              activeOpacity={0.85}
              testID={`claim-card-${c.claim_id}`}
            >
              <SafeImage uri={c.club_photo || undefined} style={styles.cardPhoto} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardClub} numberOfLines={1}>{c.club_name}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>
                  {c.owner_name} · {ROLE_LABEL[c.role] || c.role}
                </Text>
                <Text style={styles.cardDate}>{fmtDate(c.created_at)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Detail modal */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setDetail(null)} style={styles.backBtn} testID="detail-close">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Demande</Text>
            <View style={{ width: 40 }} />
          </View>
          {detail && (
            <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
              <View style={styles.card}>
                <SafeImage uri={detail.club_photo || undefined} style={styles.cardPhoto} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardClub}>{detail.club_name}</Text>
                  <Text style={styles.cardSub} numberOfLines={2}>{detail.club_address}</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Demandeur</Text>
              <View style={styles.infoCard}>
                {[
                  ['person-outline', detail.owner_name],
                  ['briefcase-outline', ROLE_LABEL[detail.role] || detail.role],
                  ['mail-outline', detail.email],
                  ['call-outline', detail.phone],
                  ['at-outline', `Compte : ${detail.user_email || detail.user_id}`],
                  ['calendar-outline', `Envoyée le ${fmtDate(detail.created_at)}`],
                ].map(([icon, value], i) => (
                  <View key={i} style={styles.infoRow}>
                    <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
                    <Text style={styles.infoText}>{value}</Text>
                  </View>
                ))}
              </View>

              {/* Verdict du robot IA */}
              {detail.ai_verdict && (
                <>
                  <Text style={styles.sectionTitle}>🤖 Vérification automatique</Text>
                  <View style={styles.infoCard} testID="ai-verdict">
                    <View style={styles.infoRow}>
                      <Ionicons
                        name={detail.ai_verdict.approve === true ? 'checkmark-circle'
                          : detail.ai_verdict.approve === false ? 'close-circle' : 'help-circle'}
                        size={16}
                        color={detail.ai_verdict.approve === true ? '#22C55E'
                          : detail.ai_verdict.approve === false ? '#EF4444' : '#F59E0B'}
                      />
                      <Text style={styles.infoText}>
                        {detail.ai_verdict.approve === true
                          ? `Approuvé par le robot (confiance ${Math.round((detail.ai_verdict.confidence || 0) * 100)}%)`
                          : detail.ai_verdict.approve === false
                            ? `Refus recommandé (confiance ${Math.round((detail.ai_verdict.confidence || 0) * 100)}%)`
                            : 'Verdict incertain — examen manuel requis'}
                      </Text>
                    </View>
                    {detail.ai_verdict.checks && Object.entries(detail.ai_verdict.checks).map(([k, v]) => (
                      <View key={k} style={styles.infoRow}>
                        <Ionicons name={v ? 'checkmark' : 'close'} size={14} color={v ? '#22C55E' : '#EF4444'} />
                        <Text style={[styles.infoText, { fontSize: 12.5 }]}>
                          {{
                            id_valid: "Pièce d'identité lisible",
                            id_name_matches: 'Nom conforme à la pièce',
                            kbis_valid: 'Kbis valide',
                            kbis_establishment_matches: 'Établissement sur le Kbis',
                          }[k] || k}
                        </Text>
                      </View>
                    ))}
                    {!!detail.ai_verdict.notes && (
                      <Text style={[styles.infoText, { fontSize: 12.5, color: colors.textSecondary }]}>
                        {detail.ai_verdict.notes}
                      </Text>
                    )}
                  </View>
                </>
              )}

              <Text style={styles.sectionTitle}>Documents</Text>
              {detailLoading ? (
                <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />
              ) : (
                <>
                  <Text style={styles.docCaption}>{"Pièce d'identité"}</Text>
                  {detail.id_document ? (
                    <Image source={{ uri: detail.id_document }} style={styles.docImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.cardSub}>Document indisponible</Text>
                  )}
                  <Text style={styles.docCaption}>Extrait Kbis</Text>
                  {detail.kbis_document ? (
                    <Image source={{ uri: detail.kbis_document }} style={styles.docImage} resizeMode="contain" />
                  ) : (
                    <Text style={styles.cardSub}>Document indisponible</Text>
                  )}
                </>
              )}

              {detail.status === 'pending' ? (
                <>
                  {rejectMode ? (
                    <>
                      <Text style={styles.sectionTitle}>Motif du refus</Text>
                      <TextInput
                        style={styles.reasonInput}
                        placeholder="Ex : Kbis illisible, identité non concordante…"
                        placeholderTextColor={colors.textTertiary}
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        multiline
                        testID="reject-reason"
                      />
                      <TouchableOpacity
                        style={[styles.rejectBtn, busy && { opacity: 0.6 }]}
                        onPress={reject}
                        disabled={busy}
                        testID="confirm-reject"
                      >
                        {busy ? <ActivityIndicator color="#fff" /> : (
                          <Text style={styles.btnText}>Confirmer le refus</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => setRejectMode(false)}>
                        <Text style={styles.cancelText}>Annuler</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.rejectBtn, { flex: 1 }, busy && { opacity: 0.6 }]}
                        onPress={() => setRejectMode(true)}
                        disabled={busy}
                        testID="reject-btn"
                      >
                        <Ionicons name="close" size={17} color="#fff" />
                        <Text style={styles.btnText}>Refuser</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.approveBtn, { flex: 1 }, busy && { opacity: 0.6 }]}
                        onPress={approve}
                        disabled={busy}
                        testID="approve-btn"
                      >
                        <Ionicons name="checkmark" size={17} color="#fff" />
                        <Text style={styles.btnText}>Approuver</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.statusBanner}>
                    <Ionicons
                      name={detail.status === 'approved' ? 'checkmark-circle' : 'close-circle'}
                      size={18}
                      color={detail.status === 'approved' ? '#22C55E' : '#EF4444'}
                    />
                    <Text style={styles.statusBannerText}>
                      {detail.status === 'approved'
                        ? `Approuvée le ${fmtDate(detail.reviewed_at)}`
                        : `Refusée le ${fmtDate(detail.reviewed_at)}${detail.rejection_reason ? ` — ${detail.rejection_reason}` : ''}`}
                    </Text>
                  </View>
                  {detail.status === 'approved' && (
                    <TouchableOpacity
                      style={[styles.rejectBtn, { marginTop: spacing.md }, busy && { opacity: 0.6 }]}
                      onPress={revoke}
                      disabled={busy}
                      testID="revoke-btn"
                    >
                      <Ionicons name="shield-outline" size={16} color="#fff" />
                      <Text style={styles.btnText}>Révoquer le badge Vérifié</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </Modal>
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
    tabsRow: {
      flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
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
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    },
    cardPhoto: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
    cardClub: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    cardSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
    cardDate: { color: colors.textTertiary, fontSize: 11.5, marginTop: 2 },
    sectionTitle: {
      color: colors.textPrimary, fontSize: 15, fontWeight: '800',
      marginTop: spacing.lg, marginBottom: spacing.sm,
    },
    infoCard: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border, gap: 10,
    },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    infoText: { color: colors.textPrimary, fontSize: 14, flex: 1 },
    docCaption: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 4 },
    docImage: {
      width: '100%', height: 260, borderRadius: radius.lg,
      backgroundColor: colors.surfaceElevated, marginBottom: spacing.md,
    },
    actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
    approveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: '#22C55E', borderRadius: 999, paddingVertical: 15,
    },
    rejectBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: '#EF4444', borderRadius: 999, paddingVertical: 15,
      marginTop: 0,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    cancelBtn: { alignItems: 'center', paddingVertical: 14 },
    cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
    reasonInput: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.border, color: colors.textPrimary, fontSize: 14.5,
      padding: spacing.md, minHeight: 80, textAlignVertical: 'top', marginBottom: spacing.md,
    },
    statusBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xl,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    },
    statusBannerText: { color: colors.textPrimary, fontSize: 13.5, flex: 1, lineHeight: 19 },
  });
