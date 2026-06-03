import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
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

const COLORS: Record<string, string> = {
  event: colors.tertiary,
  promo: colors.secondary,
  nearby: colors.primary,
};

export default function Notifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listNotifications()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="notifications-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="notif-back-btn">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(n, i) => n.notif_id || String(i)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucune notification pour le moment.</Text>
          )
        }
        renderItem={({ item }) => {
          const ic = ICONS[item.type] || 'notifications';
          const col = COLORS[item.type] || colors.tertiary;
          return (
            <View style={styles.row} testID={`notif-row-${item.notif_id}`}>
              <View style={[styles.iconWrap, { backgroundColor: `${col}1A`, borderColor: `${col}55` }]}>
                <Ionicons name={ic} size={18} color={col} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowBody}>{item.body}</Text>
                <Text style={styles.rowTime}>
                  {new Date(item.created_at).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
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
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rowTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  rowBody: { color: colors.textSecondary, marginTop: 2, fontSize: 13 },
  rowTime: { color: colors.textTertiary, marginTop: 4, fontSize: 11 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
});
