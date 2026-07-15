/**
 * Revendiquer mon établissement (Phase 2 — Bar Vérifié).
 * Le propriétaire choisit son bar, remplit ses infos et upload
 * pièce d'identité + Kbis. La demande part au dashboard Admin.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api, Club, BarClaim } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const ROLES = [
  { key: 'proprietaire', label: 'Propriétaire' },
  { key: 'gerant', label: 'Gérant' },
  { key: 'manager', label: 'Manager' },
];

const STATUS_META: Record<string, { label: string; icon: any; color: string }> = {
  pending: { label: 'En attente de validation', icon: 'hourglass-outline', color: '#F59E0B' },
  approved: { label: 'Approuvée — Bar Vérifié ✓', icon: 'checkmark-circle', color: '#22C55E' },
  rejected: { label: 'Refusée', icon: 'close-circle', color: '#EF4444' },
};

export default function ClaimBar() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<BarClaim[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Club[]>([]);
  const [club, setClub] = useState<Club | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('proprietaire');
  const [idDoc, setIdDoc] = useState<string | null>(null);
  const [kbisDoc, setKbisDoc] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.myBarClaims();
      setClaims(r.claims || []);
      setShowForm((r.claims || []).length === 0);
    } catch {
      setShowForm(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Club search (debounced-lite)
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const clubs = await api.listClubs({ search: q });
        setResults((clubs || []).slice(0, 8));
      } catch { setResults([]); }
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const pickDocument = async (which: 'id' | 'kbis') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert(
          'Accès aux photos refusé',
          'Autorise Night Finder à accéder à ta galerie dans les Réglages pour envoyer tes documents.',
        );
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.base64) return;
    const uri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
    if (which === 'id') setIdDoc(uri);
    else setKbisDoc(uri);
  };

  const submit = async () => {
    if (!club) { Alert.alert('Établissement manquant', 'Recherche et sélectionne ton bar.'); return; }
    if (!ownerName.trim() || !email.trim() || !phone.trim()) {
      Alert.alert('Champs incomplets', 'Nom, email et téléphone sont obligatoires.');
      return;
    }
    if (!email.includes('@')) { Alert.alert('Email invalide', 'Vérifie ton adresse email.'); return; }
    if (!idDoc || !kbisDoc) {
      Alert.alert('Documents manquants', "Ajoute ta pièce d'identité et ton extrait Kbis.");
      return;
    }
    setSubmitting(true);
    try {
      await api.submitBarClaim({
        club_id: club.club_id,
        owner_name: ownerName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role,
        id_document: idDoc,
        kbis_document: kbisDoc,
      });
      Alert.alert(
        '✅ Demande envoyée',
        'Ta demande de revendication a été transmise. Tu recevras une notification dès qu\'elle sera traitée.',
      );
      setShowForm(false);
      setClub(null); setOwnerName(''); setEmail(''); setPhone('');
      setIdDoc(null); setKbisDoc(null); setSearch('');
      load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Envoi impossible');
    } finally {
      setSubmitting(false);
    }
  };

  const renderDocBox = (which: 'id' | 'kbis') => {
    const uri = which === 'id' ? idDoc : kbisDoc;
    const label = which === 'id' ? "Pièce d'identité" : 'Extrait Kbis';
    return (
      <TouchableOpacity
        style={styles.docBox}
        onPress={() => pickDocument(which)}
        activeOpacity={0.85}
        testID={`doc-${which}`}
      >
        {uri ? (
          <>
            <Image source={{ uri }} style={styles.docPreview} />
            <View style={styles.docCheck}>
              <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
            </View>
          </>
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={26} color={colors.primary} />
            <Text style={styles.docLabel}>{label}</Text>
            <Text style={styles.docHint}>Appuie pour ajouter une photo</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="claim-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Revendiquer mon bar</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Existing claims */}
            {claims.length > 0 && (
              <View style={{ marginBottom: spacing.lg }}>
                <Text style={styles.sectionTitle}>Mes demandes</Text>
                {claims.map((c) => {
                  const meta = STATUS_META[c.status] || STATUS_META.pending;
                  return (
                    <View key={c.claim_id} style={styles.claimCard} testID={`claim-${c.status}`}>
                      <SafeImage uri={c.club_photo || undefined} style={styles.claimPhoto} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.claimClub} numberOfLines={1}>{c.club_name}</Text>
                        <View style={styles.statusRow}>
                          <Ionicons name={meta.icon} size={15} color={meta.color} />
                          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                        </View>
                        {c.status === 'rejected' && !!c.rejection_reason && (
                          <Text style={styles.rejectReason}>Motif : {c.rejection_reason}</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
                {!showForm && (
                  <TouchableOpacity
                    style={styles.newClaimBtn}
                    onPress={() => setShowForm(true)}
                    testID="new-claim-btn"
                  >
                    <Ionicons name="add" size={18} color={colors.primary} />
                    <Text style={styles.newClaimText}>Nouvelle demande</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {showForm && (
              <>
                {/* Intro */}
                <View style={styles.introCard}>
                  <Ionicons name="business" size={26} color={colors.primary} />
                  <Text style={styles.introTitle}>Vous êtes propriétaire ou gérant ?</Text>
                  <Text style={styles.introText}>
                    Revendique ton établissement pour obtenir le badge Vérifié et accéder
                    aux fonctionnalités professionnelles. Un admin validera ta demande.
                  </Text>
                </View>

                {/* 1. Club */}
                <Text style={styles.sectionTitle}>1. Ton établissement</Text>
                {club ? (
                  <View style={styles.claimCard}>
                    <SafeImage uri={club.photos?.[0]} style={styles.claimPhoto} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.claimClub} numberOfLines={1}>{club.name}</Text>
                      <Text style={styles.clubAddr} numberOfLines={1}>{club.address}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setClub(null)} testID="clear-club">
                      <Ionicons name="close-circle" size={22} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <View style={styles.searchBox}>
                      <Ionicons name="search" size={18} color={colors.textTertiary} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Rechercher ton bar / club…"
                        placeholderTextColor={colors.textTertiary}
                        value={search}
                        onChangeText={setSearch}
                        testID="club-search"
                      />
                    </View>
                    {results.map((r) => (
                      <TouchableOpacity
                        key={r.club_id}
                        style={styles.resultRow}
                        onPress={() => { setClub(r); setSearch(''); setResults([]); }}
                        testID={`result-${r.club_id}`}
                      >
                        <SafeImage uri={r.photos?.[0]} style={styles.resultPhoto} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
                          <Text style={styles.clubAddr} numberOfLines={1}>{r.address}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </>
                )}

                {/* 2. Infos */}
                <Text style={styles.sectionTitle}>2. Tes informations</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Nom et prénom"
                  placeholderTextColor={colors.textTertiary}
                  value={ownerName}
                  onChangeText={setOwnerName}
                  autoCapitalize="words"
                  testID="owner-name"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email professionnel"
                  placeholderTextColor={colors.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="owner-email"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Téléphone"
                  placeholderTextColor={colors.textTertiary}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  testID="owner-phone"
                />
                <View style={styles.rolesRow}>
                  {ROLES.map((r) => (
                    <TouchableOpacity
                      key={r.key}
                      style={[styles.roleChip, role === r.key && styles.roleChipActive]}
                      onPress={() => setRole(r.key)}
                      testID={`role-${r.key}`}
                    >
                      <Text style={[styles.roleText, role === r.key && styles.roleTextActive]}>
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 3. Documents */}
                <Text style={styles.sectionTitle}>3. Justificatifs</Text>
                <Text style={styles.docsHint}>
                  {"Photo de ta pièce d'identité + extrait Kbis de l'établissement (moins de 3 mois)."}
                </Text>
                <View style={styles.docsRow}>
                  {renderDocBox('id')}
                  {renderDocBox('kbis')}
                </View>

                {/* Submit */}
                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={submitting}
                  activeOpacity={0.85}
                  testID="submit-claim"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="shield-checkmark" size={18} color="#fff" />
                      <Text style={styles.submitText}>Envoyer ma demande</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.legalNote}>
                  Tes documents sont transmis de manière sécurisée et utilisés uniquement
                  pour vérifier ton identité de propriétaire.
                </Text>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
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
    sectionTitle: {
      color: colors.textPrimary, fontSize: 15, fontWeight: '800',
      marginTop: spacing.lg, marginBottom: spacing.sm,
    },
    introCard: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border,
    },
    introTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
    introText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    claimCard: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm,
      borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    },
    claimPhoto: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
    claimClub: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    clubAddr: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    statusText: { fontSize: 12.5, fontWeight: '700' },
    rejectReason: { color: colors.textTertiary, fontSize: 12, marginTop: 3 },
    newClaimBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.primary, borderStyle: 'dashed',
    },
    newClaimText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface, borderRadius: radius.lg,
      paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 12, fontSize: 15 },
    resultRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      paddingVertical: 8, paddingHorizontal: 4,
    },
    resultPhoto: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceElevated },
    resultName: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '600' },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.border, color: colors.textPrimary, fontSize: 15,
      paddingHorizontal: spacing.md, paddingVertical: 13, marginBottom: spacing.sm,
    },
    rolesRow: { flexDirection: 'row', gap: spacing.sm },
    roleChip: {
      flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    roleText: { color: colors.textSecondary, fontSize: 13.5, fontWeight: '700' },
    roleTextActive: { color: '#fff' },
    docsHint: { color: colors.textTertiary, fontSize: 12.5, marginBottom: spacing.sm, lineHeight: 18 },
    docsRow: { flexDirection: 'row', gap: spacing.sm },
    docBox: {
      flex: 1, height: 130, borderRadius: radius.lg, borderWidth: 1.5,
      borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center',
      justifyContent: 'center', gap: 4, backgroundColor: colors.surface, overflow: 'hidden',
    },
    docPreview: { width: '100%', height: '100%' },
    docCheck: {
      position: 'absolute', top: 6, right: 6, backgroundColor: '#fff', borderRadius: 12,
    },
    docLabel: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
    docHint: { color: colors.textTertiary, fontSize: 11 },
    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 16,
      marginTop: spacing.xl,
    },
    submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    legalNote: {
      color: colors.textTertiary, fontSize: 11.5, textAlign: 'center',
      marginTop: spacing.md, lineHeight: 16,
    },
  });
