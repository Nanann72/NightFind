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
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

export default function MatchRequests() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMatchRequests();
      setItems(r || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onAccept = async (req: any) => {
    setBusy(req.request_id);
    try {
      const r = await api.acceptMatch(req.request_id);
      setItems((x) => x.filter((it) => it.request_id !== req.request_id));
      Alert.alert('Match 💞', `Tu peux maintenant discuter avec ${req.name}.`, [
        { text: 'Plus tard', style: 'cancel' },
        { text: 'Ouvrir le chat', onPress: () => router.push(`/chat/${r.match_id}`) },
      ]);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (req: any) => {
    setBusy(req.request_id);
    try {
      await api.rejectMatch(req.request_id);
      setItems((x) => x.filter((it) => it.request_id !== req.request_id));
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Demandes reçues</Text>
        <TouchableOpacity onPress={() => router.push('/matches')} testID="goto-matches">
          <Text style={styles.headerLink}>Mes matches</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.request_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucune demande pour l'instant. Continue à swiper 💫</Text>
          )
        }
        renderItem={({ item }) => {
          const photo = (item.photos || [])[0];
          return (
            <View style={styles.card}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoFb]}>
                  <Ionicons name="person" size={48} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.gradient} />
              <View style={styles.info}>
                <Text style={styles.name}>
                  {item.name}
                  {item.age != null ? `, ${item.age}` : ''}
                </Text>
                {!!item.city && <Text style={styles.city}>{item.city}</Text>}
                {!!item.bio && (
                  <Text style={styles.bio} numberOfLines={2}>
                    {item.bio}
                  </Text>
                )}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPass]}
                    onPress={() => onReject(item)}
                    disabled={busy === item.request_id}
                    testID={`mr-reject-${item.request_id}`}
                  >
                    {busy === item.request_id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="close" size={20} color="#fff" />
                        <Text style={styles.btnText}>Refuser</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnLike]}
                    onPress={() => onAccept(item)}
                    disabled={busy === item.request_id}
                    testID={`mr-accept-${item.request_id}`}
                  >
                    {busy === item.request_id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="heart" size={20} color="#fff" />
                        <Text style={styles.btnText}>Accepter</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
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
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  headerLink: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    height: 360,
  },
  photo: { width: '100%', height: '100%', position: 'absolute' },
  photoFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  info: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  name: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  city: { color: 'rgba(255,255,255,0.8)', marginTop: 2, fontSize: 13 },
  bio: { color: 'rgba(255,255,255,0.9)', marginTop: 6, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  btnPass: { backgroundColor: '#ef4444' },
  btnLike: { backgroundColor: '#22c55e' },
  btnText: { color: '#fff', fontWeight: '900' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },
});
