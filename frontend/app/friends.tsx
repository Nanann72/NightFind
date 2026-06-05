import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

type Tab = 'friends' | 'incoming' | 'outgoing' | 'search';

export default function Friends() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('friends');
  const [data, setData] = useState<{ friends: any[]; incoming: any[]; outgoing: any[] }>({ friends: [], incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await api.listFriends()); } catch { /* */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (tab !== 'search' || query.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setSearchResults(await api.searchFriends(query.trim())); } catch { setSearchResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, tab]);

  const sendRequest = async (u: any) => {
    try { await api.sendFriendRequest(u.user_id); Alert.alert('Demande envoyée', `À @${u.username}`); load(); }
    catch (e: any) { Alert.alert('Erreur', e.message || 'Impossible'); }
  };
  const accept = async (id: string) => { try { await api.acceptFriend(id); load(); } catch {} };
  const reject = async (id: string) => { try { await api.rejectFriend(id); load(); } catch {} };
  const remove = async (uid: string) => {
    Alert.alert('Retirer cet ami ?', '', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: async () => { await api.removeFriend(uid); load(); } },
    ]);
  };

  const renderUser = (u: any, actions: React.ReactNode) => (
    <View key={u.user_id || u.friendship_id} style={styles.userRow}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{(u.username || u.name || '?').slice(0, 2).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.userName}>{u.name || u.username}</Text>
        <Text style={styles.userHandle}>@{u.username || '...'}</Text>
      </View>
      {actions}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="friends-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><Ionicons name="arrow-back" size={22} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.title}>Mes amis</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.tabs}>
        {([
          { k: 'friends', l: 'Amis', n: data.friends.length },
          { k: 'incoming', l: 'Reçues', n: data.incoming.length },
          { k: 'outgoing', l: 'Envoyées', n: data.outgoing.length },
          { k: 'search', l: 'Ajouter', n: -1 },
        ] as { k: Tab; l: string; n: number }[]).map((t) => (
          <TouchableOpacity key={t.k} style={[styles.tab, tab === t.k && styles.tabActive]} onPress={() => setTab(t.k)} testID={`friends-tab-${t.k}`}>
            <Text style={[styles.tabText, tab === t.k && styles.tabTextActive]}>
              {t.l}{t.n > 0 ? ` (${t.n})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'search' && (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher par @username"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
            autoCapitalize="none"
            testID="friends-search-input"
          />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />}

        {tab === 'friends' && !loading && data.friends.length === 0 && (
          <Text style={styles.empty}>Aucun ami pour l'instant. Ajoute-en via l'onglet "Ajouter".</Text>
        )}
        {tab === 'friends' && data.friends.map((u) => renderUser(u, (
          <TouchableOpacity onPress={() => remove(u.user_id)} testID={`friend-remove-${u.user_id}`}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </TouchableOpacity>
        )))}

        {tab === 'incoming' && !loading && data.incoming.length === 0 && (
          <Text style={styles.empty}>Pas de demandes reçues.</Text>
        )}
        {tab === 'incoming' && data.incoming.map((u) => renderUser(u, (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={() => accept(u.friendship_id)} style={styles.acceptBtn}>
              <Ionicons name="checkmark" size={18} color={colors.bg} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => reject(u.friendship_id)} style={styles.rejectBtn}>
              <Ionicons name="close" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        )))}

        {tab === 'outgoing' && !loading && data.outgoing.length === 0 && (
          <Text style={styles.empty}>Aucune demande en attente.</Text>
        )}
        {tab === 'outgoing' && data.outgoing.map((u) => renderUser(u, (
          <Text style={styles.pending}>En attente</Text>
        )))}

        {tab === 'search' && searching && <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />}
        {tab === 'search' && !searching && query.trim().length >= 2 && searchResults.length === 0 && (
          <Text style={styles.empty}>Aucun résultat pour "{query}"</Text>
        )}
        {tab === 'search' && searchResults.map((u) => renderUser(u, (
          <TouchableOpacity onPress={() => sendRequest(u)} style={styles.addBtn} testID={`friend-add-${u.user_id}`}>
            <Ionicons name="person-add" size={16} color={colors.bg} />
            <Text style={styles.addBtnText}>Ajouter</Text>
          </TouchableOpacity>
        )))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: 12 },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: 6, paddingBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.bg, fontWeight: '900' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginTop: 4, marginBottom: 8, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 12, fontSize: 14 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(224,26,79,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  userName: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  userHandle: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 40, paddingHorizontal: 20, lineHeight: 20 },
  acceptBtn: { backgroundColor: '#22c55e', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { backgroundColor: colors.surface, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  pending: { color: colors.textTertiary, fontSize: 11, fontStyle: 'italic' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full },
  addBtnText: { color: colors.bg, fontWeight: '800', fontSize: 12 },
});
