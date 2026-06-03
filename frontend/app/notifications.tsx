import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  event: 'calendar',
  promo: 'pricetag',
  nearby: 'location',
};

const COLOURS: Record<string, string> = {
  event: colors.tertiary,
  promo: colors.secondary,
  nearby: colors.primary,
};

const LABELS: Record<string, string> = {
  event: 'Événement',
  promo: 'Promo',
  nearby: 'Près de toi',
};

export default function Notifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listNotifications();
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onPress = (item: any) => {
    if (item.type === 'event') router.push('/(tabs)/events');
    else if (item.type === 'nearby') router.push('/(tabs)');
    else if (item.type === 'promo') router.push('/(tabs)');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="notifications-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="notif-back-btn">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={styles.iconBtn} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(n, i) => n.notif_id || String(i)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>Tout est calme</Text>
              <Text style={styles.emptyText}>
                Tu seras notifié dès qu'une bonne occasion se présentera près de
                toi.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const ic = ICONS[item.type] || 'notifications';
          const col = COLOURS[item.type] || colors.tertiary;
          const tag = LABELS[item.type] || 'Info';
          return (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onPress(item)}
              activeOpacity={0.85}
              testID={`notif-row-${item.notif_id}`}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${col}1A`, borderColor: `${col}55` }]}>
                <Ionicons name={ic} size={18} color={col} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTopRow}>
                  <Text style={[styles.rowTag, { color: col, borderColor: `${col}55`, backgroundColor: `${col}1A` }]}>
                    {tag}
                  </Text>
                  <Text style={styles.rowTime}>
                    {new Date(item.created_at).toLocaleString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowBody} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        }}
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
    paddingVertical: 12,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.lg,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rowTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowTag: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    textTransform: 'uppercase',
    overflow: 'hidden',
  },
  rowTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  rowBody: { color: colors.textSecondary, marginTop: 2, fontSize: 13 },
  rowTime: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
