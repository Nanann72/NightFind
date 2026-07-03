import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, SearchUser } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function UserSearch() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [q, setQ] = useState('');
  const [users, setUsers] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setUsers([]); return; }
    setLoading(true);
    try {
      const r = await api.usersSearch(query.trim(), 30);
      setUsers(r.users);
    } catch { setUsers([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  const renderUser = ({ item: u }: { item: SearchUser }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push({ pathname: '/story-viewer', params: { user_id: u.user_id, user_name: u.name } })}
      testID={`search-user-${u.user_id}`}
      activeOpacity={0.85}
    >
      {u.picture ? (
        <Image source={{ uri: u.picture }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPh]}>
          <Text style={styles.avatarInit}>{(u.name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{u.name}{u.age ? `, ${u.age}` : ''}</Text>
          {u.is_premium && (
            <View style={styles.badge}><Ionicons name="star" size={9} color="#fff" /></View>
          )}
        </View>
        {u.bio ? <Text style={styles.bio} numberOfLines={1}>{u.bio}</Text> : null}
        {u.city ? <Text style={styles.city}>📍 {u.city}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="search-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Rechercher</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Nom ou prénom…"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          testID="search-input"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} hitSlop={12}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => u.user_id}
        renderItem={renderUser}
        contentContainerStyle={{ padding: spacing.md, gap: 8, paddingBottom: 60 }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Ionicons name="people-outline" size={38} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                {q.trim().length < 2 ? 'Tape au moins 2 lettres…' : 'Aucun profil trouvé'}
              </Text>
            </View>
          ) : (
            <View style={{ paddingTop: 40, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingBottom: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarPh: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: colors.primary, fontSize: 18, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  badge: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: '#F5A623',
    alignItems: 'center', justifyContent: 'center',
  },
  bio: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  city: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  emptyText: { color: colors.textSecondary, marginTop: 12, fontSize: 13 },
});
