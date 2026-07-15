/**
 * Admin — Bar Partenaire Officiel (-10%).
 * Choose THE partner bar, generate QR + deep link, toggle offer, redeem coupons.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Image, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { api, Club } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function AdminPartner() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Club[]>([]);
  const [redeemCode, setRedeemCode] = useState('');
  const [qrKey, setQrKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.adminGetPartnerBar();
      setCfg(r.configured ? r : null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Chargement impossible');
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

  const selectClub = async (club: Club) => {
    setBusy(true);
    try {
      const r = await api.adminSetPartnerBar(club.club_id, true, 30);
      setCfg({ ...r, stats: cfg?.stats || { issued: 0, used: 0 } });
      setSearch('');
      setResults([]);
      setQrKey((k) => k + 1);
      Alert.alert('✅ Bar partenaire défini', `${club.name} est maintenant le bar partenaire officiel.`);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de définir le bar');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (value: boolean) => {
    if (!cfg) return;
    setBusy(true);
    try {
      if (value) {
        const r = await api.adminSetPartnerBar(cfg.club_id, true, cfg.expires_days || 30);
        setCfg({ ...cfg, ...r });
      } else {
        await api.adminDisablePartnerBar();
        setCfg({ ...cfg, active: false });
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Action impossible');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Copié', text);
    } catch {}
  };

  const redeem = async () => {
    const code = redeemCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    try {
      await api.adminRedeemCoupon(code);
      setRedeemCode('');
      Alert.alert('✅ Coupon validé', 'La réduction a été marquée comme utilisée.');
      load();
    } catch (e: any) {
      Alert.alert('Impossible', e?.message || 'Coupon invalide');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="admin-partner-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="partner-back-btn">
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Bar Partenaire</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {cfg ? (
              <View style={styles.card}>
                <View style={styles.rowTop}>
                  {cfg.club_photo ? (
                    <SafeImage uri={cfg.club_photo} style={styles.logo} />
                  ) : (
                    <View style={[styles.logo, styles.logoFb]}>
                      <Ionicons name="business" size={20} color={colors.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clubName} numberOfLines={1}>{cfg.club_name}</Text>
                    <Text style={styles.sub}>-{cfg.discount_pct}% · expire {cfg.expires_days} j après déblocage</Text>
                  </View>
                  <Switch
                    value={!!cfg.active}
                    onValueChange={toggleActive}
                    disabled={busy}
                    trackColor={{ true: colors.primary, false: colors.surfaceHigher }}
                    testID="partner-active-switch"
                  />
                </View>

                <View style={styles.statsRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statVal}>{cfg.stats?.issued ?? 0}</Text>
                    <Text style={styles.statLabel}>Coupons émis</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statVal}>{cfg.stats?.used ?? 0}</Text>
                    <Text style={styles.statLabel}>Utilisés</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statVal}>{cfg.partner_code}</Text>
                    <Text style={styles.statLabel}>Code partenaire</Text>
                  </View>
                </View>

                <View style={styles.qrWrap}>
                  <Image
                    key={qrKey}
                    source={{ uri: `${BASE_URL}/api/partner/qr?v=${qrKey}` }}
                    style={styles.qr}
                    resizeMode="contain"
                  />
                  <Text style={styles.qrHint}>QR Code à afficher dans le bar</Text>
                </View>

                <TouchableOpacity style={styles.linkRow} onPress={() => copy(cfg.deep_link)} testID="copy-deeplink">
                  <Ionicons name="link" size={16} color={colors.primary} />
                  <Text style={styles.linkText} numberOfLines={1}>{cfg.deep_link}</Text>
                  <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.linkRow} onPress={() => copy(cfg.partner_code)} testID="copy-code">
                  <Ionicons name="pricetag" size={16} color={colors.primary} />
                  <Text style={styles.linkText}>Code à saisir à l&apos;inscription : {cfg.partner_code}</Text>
                  <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.emptyTitle}>Aucun bar partenaire configuré</Text>
                <Text style={styles.sub}>Recherche un établissement ci-dessous pour le définir.</Text>
              </View>
            )}

            {/* Choose / change partner bar */}
            <Text style={styles.section}>{cfg ? 'Changer de bar partenaire' : 'Choisir le bar partenaire'}</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Rechercher un bar / club…"
                placeholderTextColor={colors.textTertiary}
                style={styles.searchInput}
                testID="partner-club-search"
              />
            </View>
            {results.map((c) => (
              <TouchableOpacity
                key={c.club_id}
                style={styles.resultRow}
                onPress={() => selectClub(c)}
                disabled={busy}
                testID={`partner-select-${c.club_id}`}
              >
                <SafeImage uri={c.photos?.[0]} style={styles.resultImg} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{c.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {/* Redeem a coupon */}
            <Text style={styles.section}>Valider un coupon client</Text>
            <View style={styles.redeemRow}>
              <TextInput
                value={redeemCode}
                onChangeText={setRedeemCode}
                placeholder="NF-XXXXXX"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                style={[styles.searchInput, styles.redeemInput]}
                testID="redeem-input"
              />
              <TouchableOpacity
                style={[styles.redeemBtn, busy && { opacity: 0.5 }]}
                onPress={redeem}
                disabled={busy}
                testID="redeem-btn"
              >
                <Text style={styles.redeemBtnText}>Valider</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  card: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.xl, borderWidth: 1,
    borderColor: colors.border, padding: 18,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 48, height: 48, borderRadius: 24 },
  logoFb: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  clubName: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  statsRow: {
    flexDirection: 'row', marginTop: 16, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  statLabel: { color: colors.textTertiary, fontSize: 10, marginTop: 3, textAlign: 'center' },
  qrWrap: { alignItems: 'center', marginTop: 16 },
  qr: { width: 180, height: 180, backgroundColor: '#fff', borderRadius: 12 },
  qrHint: { color: colors.textTertiary, fontSize: 11, marginTop: 8 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: 12,
  },
  linkText: { flex: 1, color: colors.textSecondary, fontSize: 12 },
  section: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 11, fontSize: 14 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  resultImg: { width: 40, height: 40, borderRadius: 10 },
  resultName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  redeemRow: { flexDirection: 'row', gap: 10 },
  redeemInput: {
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.pill, paddingHorizontal: 16, letterSpacing: 2,
  },
  redeemBtn: {
    backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  redeemBtnText: { color: '#fff', fontWeight: '700' },
});
