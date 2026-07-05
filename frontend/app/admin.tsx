import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

/**
 * Hidden admin console — only reachable if the currently logged-in user
 * has `is_admin === true`. Non-admins get redirected out immediately.
 */
export default function AdminScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [stats, setStats] = useState<{
    total_bots: number;
    premium_bots: number;
    bots_with_location: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Safety: redirect non-admin users
  useEffect(() => {
    if (user && !user.is_admin) {
      router.replace('/(tabs)');
    }
  }, [user, router]);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.adminBotStats();
      setStats(s);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de charger les stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const seed = (count: number) => {
    Alert.alert(
      `Créer ${count} bots ?`,
      `Ces ${count} utilisateurs seront visibles sur la map et dans le swipe. Tu pourras tous les supprimer en un clic.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Créer',
          onPress: async () => {
            setBusy('seed');
            try {
              const res = await api.adminSeedBots(count);
              Alert.alert('✅ Bots créés', `${res.created} bots ajoutés\n${res.sample_names.join(', ')}`);
              await load();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message || 'Échec de la création');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const wipe = () => {
    Alert.alert(
      '⚠️ Supprimer TOUS les bots ?',
      'Cette action supprimera aussi leurs messages, swipes, matches et moments. Cette opération est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer tout',
          style: 'destructive',
          onPress: async () => {
            setBusy('wipe');
            try {
              const res = await api.adminDeleteBots();
              const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
              Alert.alert('🧹 Nettoyage terminé', `${total} enregistrements supprimés`);
              await load();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message || 'Échec de la suppression');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="admin-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Admin console</Text>
          <Text style={styles.subtitle}>Compte : {user?.email}</Text>
        </View>
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
          <Text style={styles.badgeText}>Admin</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        {/* Stats card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bots actifs</Text>
          <View style={styles.statsRow}>
            <StatBlock label="Total" value={stats?.total_bots ?? '—'} colors={colors} />
            <StatBlock label="Premium" value={stats?.premium_bots ?? '—'} colors={colors} />
            <StatBlock label="Sur la map" value={stats?.bots_with_location ?? '—'} colors={colors} />
          </View>
        </View>

        {/* Seed bots */}
        <Text style={styles.section}>Générer des bots</Text>
        <View style={styles.grid}>
          <SeedBtn label="10 bots" onPress={() => seed(10)} disabled={!!busy} colors={colors} />
          <SeedBtn label="20 bots" onPress={() => seed(20)} disabled={!!busy} colors={colors} />
          <SeedBtn label="50 bots" onPress={() => seed(50)} disabled={!!busy} colors={colors} />
          <SeedBtn label="100 bots" onPress={() => seed(100)} disabled={!!busy} colors={colors} />
        </View>
        <Text style={styles.hint}>
          Les bots sont générés autour de Paris (rayon 5 km), avec une photo, une bio,
          des préférences musicales et environ 35% en Premium.
        </Text>

        {/* Cleanup */}
        <Text style={styles.section}>Modération utilisateurs</Text>
        <TouchableOpacity
          onPress={() => router.push('/admin-users')}
          style={styles.userMgmtBtn}
          activeOpacity={0.85}
          testID="admin-users-btn"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.userMgmtTitle}>Bannir · Premium · Modération</Text>
            <Text style={styles.userMgmtSub}>Rechercher, bannir (24h/7j/30j/permanent), offrir Premium (7j/30j/1an/illimité)</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.section}>Diagnostic Audd.io</Text>
        <TouchableOpacity
          onPress={() => router.push('/admin-audd')}
          style={styles.userMgmtBtn}
          activeOpacity={0.85}
          testID="admin-audd-btn"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.userMgmtTitle}>Reconnaissance musicale — test & stats</Text>
            <Text style={styles.userMgmtSub}>Config token, test live avec le micro, réponse brute Audd.io, historique</Text>
          </View>
          <Ionicons name="musical-notes-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <Text style={styles.section}>Nettoyage bots</Text>
        <TouchableOpacity
          onPress={wipe}
          disabled={!!busy}
          style={[styles.dangerBtn, !!busy && { opacity: 0.5 }]}
          activeOpacity={0.85}
          testID="admin-wipe-btn"
        >
          {busy === 'wipe' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.dangerBtnText}>Supprimer tous les bots</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.section}>Debug</Text>
        <View style={styles.card}>
          <DebugRow label="User ID" value={user?.user_id ?? '—'} />
          <DebugRow label="Premium" value={user?.is_premium ? 'oui' : 'non'} />
          <DebugRow label="Admin" value={user?.is_admin ? 'oui' : 'non'} />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function StatBlock({ label, value, colors }: { label: string; value: number | string; colors: ThemeColors }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: colors.primary, fontSize: 26, fontWeight: '900', letterSpacing: -1 }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function SeedBtn({
  label,
  onPress,
  disabled,
  colors,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        minWidth: '46%',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.md,
        paddingVertical: 18,
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
      activeOpacity={0.85}
    >
      <Ionicons name="people-outline" size={22} color={colors.primary} />
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginTop: 6 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: 10,
      gap: 8,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: colors.textSecondary, fontSize: 12 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primarySoft,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
    },
    badgeText: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
    scroll: { padding: spacing.md, paddingBottom: 60 },
    section: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    cardTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 12 },
    statsRow: { flexDirection: 'row', gap: spacing.sm },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    hint: {
      color: colors.textTertiary,
      fontSize: 12,
      marginTop: spacing.sm,
      lineHeight: 18,
    },
    dangerBtn: {
      backgroundColor: colors.danger ?? '#FF3B30',
      paddingVertical: 16,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    dangerBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    userMgmtBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    userMgmtTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    userMgmtSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  });
