import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function BlockedUsers() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listBlocks();
      setItems(list || []);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de charger.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unblock = (userId: string, name?: string) => {
    Alert.alert(
      'Débloquer ' + (name || 'cette personne') + ' ?',
      'Vous pourrez à nouveau vous voir et vous matcher.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Débloquer',
          onPress: async () => {
            try {
              await api.unblockUser(userId);
              setItems((x) => x.filter((u) => u.user_id !== userId));
            } catch (e: any) {
              Alert.alert('Erreur', e?.message || 'Action impossible.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="blocked-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Utilisateurs bloqués</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.user_id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          ListEmptyComponent={
            <Text style={styles.empty}>Aucun utilisateur bloqué.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID={`blocked-row-${item.user_id}`}>
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFb]}>
                  <Ionicons name="person" size={20} color={colors.textTertiary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name || '—'}</Text>
                {item.username && <Text style={styles.username}>@{item.username}</Text>}
              </View>
              <TouchableOpacity
                style={styles.unblockBtn}
                onPress={() => unblock(item.user_id, item.name)}
                testID={`unblock-${item.user_id}`}
              >
                <Text style={styles.unblockText}>Débloquer</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceElevated },
  avatarFb: { alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.textPrimary, fontWeight: '700' },
  username: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  unblockBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)' },
  unblockText: { color: '#22c55e', fontSize: 12, fontWeight: '800' },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
