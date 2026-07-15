/**
 * "Mes avantages" — user coupons (partner bar -10%).
 */
import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const STATUS_UI: Record<string, { label: string; color: string; icon: any }> = {
  available: { label: 'Disponible', color: '#22C55E', icon: 'checkmark-circle' },
  used: { label: 'Utilisé', color: '#8B8B93', icon: 'checkmark-done-circle' },
  expired: { label: 'Expiré', color: '#EF4444', icon: 'time' },
};

export default function Advantages() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.myCoupons();
      setCoupons(r.coupons || []);
    } catch {
      setCoupons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="advantages-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="advantages-back-btn">
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Mes avantages</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={coupons}
        keyExtractor={(c) => c.coupon_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons name="gift-outline" size={30} color={colors.textTertiary} />
              </View>
              <Text style={styles.emptyTitle}>Aucun avantage pour le moment</Text>
              <Text style={styles.emptyText}>
                Découvre Night Finder via le QR Code d&apos;un bar partenaire pour débloquer
                une réduction exclusive.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const ui = STATUS_UI[item.status] || STATUS_UI.available;
          const exp = item.expires_at ? new Date(item.expires_at) : null;
          return (
            <View style={styles.card} testID={`coupon-${item.coupon_id}`}>
              <View style={styles.cardTop}>
                {item.club_photo ? (
                  <SafeImage uri={item.club_photo} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoFb]}>
                    <Ionicons name="business" size={20} color={colors.primary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.clubName} numberOfLines={1}>{item.club_name}</Text>
                  <Text style={styles.partnerTag}>Bar partenaire officiel</Text>
                </View>
                <View style={styles.pctBadge}>
                  <Text style={styles.pctText} allowFontScaling={false}>-{item.discount_pct}%</Text>
                </View>
              </View>
              <View style={styles.codeRow}>
                <Text style={styles.codeLabel}>Code promo</Text>
                <Text style={styles.code} allowFontScaling={false}>{item.code}</Text>
              </View>
              <View style={styles.cardBottom}>
                <View style={[styles.statusPill, { backgroundColor: `${ui.color}22` }]}>
                  <Ionicons name={ui.icon} size={13} color={ui.color} />
                  <Text style={[styles.statusText, { color: ui.color }]}>{ui.label}</Text>
                </View>
                {exp ? (
                  <Text style={styles.expiry}>
                    {item.status === 'expired' ? 'Expiré le ' : "Valable jusqu'au "}
                    {exp.toLocaleDateString('fr-FR')}
                  </Text>
                ) : null}
              </View>
              {item.status === 'available' ? (
                <Text style={styles.hint}>Montre ce code au bar pour profiter de ta réduction 🍸</Text>
              ) : null}
            </View>
          );
        }}
      />
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
    borderColor: colors.border, padding: 18, marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 48, height: 48, borderRadius: 24 },
  logoFb: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  clubName: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  partnerTag: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 },
  pctBadge: {
    backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
  },
  pctText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  codeRow: {
    marginTop: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary,
    backgroundColor: colors.primarySoft, borderRadius: 14, padding: 12, alignItems: 'center',
  },
  codeLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  code: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: 3, marginTop: 3 },
  cardBottom: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  statusText: { fontSize: 12, fontWeight: '700' },
  expiry: { color: colors.textTertiary, fontSize: 12 },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 12, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', marginTop: 80, paddingHorizontal: 30, gap: 12 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
