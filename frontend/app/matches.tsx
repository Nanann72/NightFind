import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

export default function Matches() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMatches();
      setItems(r || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mes matches</Text>
        <TouchableOpacity onPress={() => router.push('/match-requests')} testID="goto-requests">
          <Text style={styles.headerLink}>Demandes reçues</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.match_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucun match pour l'instant. Va swiper et accepter des demandes 💞</Text>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/chat/${item.match_id}`)}
            activeOpacity={0.85}
            testID={`match-row-${item.match_id}`}
          >
            {item.photo ? (
              <Image source={{ uri: item.photo }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFb]}>
                <Ionicons name="person" size={26} color={colors.textTertiary} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.last} numberOfLines={1}>
                {item.last_message || 'Dis bonjour 👋'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  headerLink: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.textPrimary, fontWeight: '900', fontSize: 16 },
  last: { color: colors.textTertiary, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },
});
