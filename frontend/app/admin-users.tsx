import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, AdminUser } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function AdminUsersScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user: currentUser } = useAuth();

  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // action in progress

  useEffect(() => {
    if (currentUser && !currentUser.is_admin) router.replace('/(tabs)');
  }, [currentUser, router]);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    try {
      const res = await api.adminSearchUsers(query, 60);
      setUsers(res.users);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de charger la liste');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  const promptBan = (u: AdminUser) => {
    if (u.is_banned) {
      Alert.alert(
        `Débannir ${u.name} ?`,
        u.ban_reason ? `Motif actuel : ${u.ban_reason}` : undefined,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Débannir',
            onPress: async () => {
              setBusy(u.user_id);
              try {
                await api.adminUnbanUser(u.user_id);
                await load(q);
              } finally { setBusy(null); }
            },
          },
        ],
      );
      return;
    }
    Alert.alert(
      `Bannir ${u.name} ?`,
      "Choisis la durée :",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: '24h', onPress: () => doBan(u, 24, 'Comportement inapproprié') },
        { text: '7 jours', onPress: () => doBan(u, 24 * 7, 'Violation répétée') },
        { text: '30 jours', onPress: () => doBan(u, 24 * 30, 'Violation grave') },
        { text: 'Permanent', style: 'destructive', onPress: () => doBan(u, null, 'Ban permanent') },
      ],
    );
  };

  const doBan = async (u: AdminUser, hours: number | null, reason: string) => {
    setBusy(u.user_id);
    try {
      await api.adminBanUser(u.user_id, hours, reason);
      await load(q);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Échec du ban');
    } finally { setBusy(null); }
  };

  const promptPremium = (u: AdminUser) => {
    if (u.is_premium) {
      Alert.alert(
        `${u.name} — Premium actif`,
        u.premium_expires_at ? `Expire : ${new Date(u.premium_expires_at).toLocaleString('fr-FR')}` : 'Illimité',
        [
          { text: 'Retirer Premium', style: 'destructive', onPress: () => doPremium(u, null, true) },
          { text: 'Prolonger 30 jours', onPress: () => doPremium(u, 30, false) },
          { text: 'Prolonger 1 an', onPress: () => doPremium(u, 365, false) },
          { text: 'Annuler', style: 'cancel' },
        ],
      );
      return;
    }
    Alert.alert(
      `Offrir Premium à ${u.name} ?`,
      'Choisis la durée :',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: '7 jours', onPress: () => doPremium(u, 7, false) },
        { text: '30 jours', onPress: () => doPremium(u, 30, false) },
        { text: '1 an', onPress: () => doPremium(u, 365, false) },
        { text: 'Illimité', onPress: () => doPremium(u, null, false) },
      ],
    );
  };

  const doPremium = async (u: AdminUser, days: number | null, remove: boolean) => {
    setBusy(u.user_id);
    try {
      await api.adminSetPremium(u.user_id, days, remove);
      await load(q);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Échec');
    } finally { setBusy(null); }
  };

  const renderUser = ({ item: u }: { item: AdminUser }) => (
    <View style={styles.card} testID={`user-card-${u.user_id}`}>
      <View style={styles.row}>
        {u.picture ? (
          <Image source={{ uri: u.picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarInitial}>{(u.name?.[0] || '?').toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
            {u.is_bot && <View style={[styles.badge, { backgroundColor: colors.tertiary }]}><Text style={styles.badgeText}>BOT</Text></View>}
            {u.is_premium && <View style={[styles.badge, { backgroundColor: '#F5A623' }]}><Text style={styles.badgeText}>PREMIUM</Text></View>}
            {u.is_banned && <View style={[styles.badge, { backgroundColor: colors.danger ?? '#FF3B30' }]}><Text style={styles.badgeText}>BAN</Text></View>}
          </View>
          <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
          {u.is_banned && u.ban_reason && (
            <Text style={styles.banReason} numberOfLines={2}>⛔ {u.ban_reason}</Text>
          )}
        </View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.premiumBtn]}
          onPress={() => promptPremium(u)}
          disabled={busy === u.user_id}
          testID={`btn-premium-${u.user_id}`}
        >
          <Ionicons name={u.is_premium ? 'star' : 'star-outline'} size={16} color="#F5A623" />
          <Text style={styles.actionBtnText}>{u.is_premium ? 'Gérer Premium' : 'Offrir Premium'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, u.is_banned ? styles.unbanBtn : styles.banBtn]}
          onPress={() => promptBan(u)}
          disabled={busy === u.user_id}
          testID={`btn-ban-${u.user_id}`}
        >
          {busy === u.user_id ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name={u.is_banned ? 'checkmark-circle-outline' : 'ban-outline'} size={16} color="#fff" />
              <Text style={[styles.actionBtnText, { color: '#fff' }]}>{u.is_banned ? 'Débannir' : 'Bannir'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="admin-users-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Utilisateurs</Text>
          <Text style={styles.subtitle}>{users.length} résultat{users.length > 1 ? 's' : ''}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Chercher par email ou nom…"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          testID="admin-search"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => u.user_id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(q)} tintColor={colors.primary} />}
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: colors.textSecondary }}>Aucun utilisateur trouvé</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingBottom: 10, gap: 8,
  },
  iconBtn: { width: 40, height: 40, justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 12 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  list: { padding: spacing.md, paddingBottom: 60 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.md,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceElevated },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
  email: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  banReason: { color: colors.danger ?? '#FF3B30', fontSize: 11, marginTop: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1,
  },
  premiumBtn: { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
  banBtn: { backgroundColor: colors.danger ?? '#FF3B30', borderColor: colors.danger ?? '#FF3B30' },
  unbanBtn: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  actionBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
});
