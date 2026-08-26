/**
 * Chats tab — iMessage-style conversation list.
 */
import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { triggerUnreadMessagesRefresh } from '../../lib/useUnreadMessages';
import { HapticButton } from '../../components/ui/HapticButton';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';
import { useTranslation } from '../../lib/i18n';

export default function ChatsTab() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [tab, setTab] = useState<'conv' | 'req'>('conv');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, reqs] = await Promise.all([
        api.listMatches(),
        api.listMatchRequests().catch(() => []),
      ]);
      setItems(r || []);
      setRequests(reqs || []);
      triggerUnreadMessagesRefresh();
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.last_message || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  };

  const acceptReq = async (r: any) => {
    try { await api.acceptMatch(r.request_id); } catch {}
    load();
  };
  const rejectReq = async (r: any) => {
    try { await api.rejectMatch(r.request_id); } catch {}
    load();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="chats-screen">
      <View style={styles.header}>
        <Text style={styles.title}>{t('tabs.chats')}</Text>
        <HapticButton
          haptic="light"
          scale={0.94}
          style={styles.headerBtn}
          onPress={() => router.push('/match-requests')}
          testID="goto-requests"
        >
          <Ionicons name="person-add-outline" size={19} color={colors.textPrimary} />
        </HapticButton>
      </View>

      {/* ── Recherche ── */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher"
          placeholderTextColor={colors.textTertiary}
          style={styles.searchInput}
          testID="chats-search-input"
        />
      </View>

      {/* ── Onglets Conversations / Demandes ── */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={styles.tabBtn}
          onPress={() => setTab('conv')}
          testID="tab-conversations"
        >
          <Text style={[styles.tabText, tab === 'conv' && styles.tabTextActive]}>
            Conversations
          </Text>
          {tab === 'conv' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabBtn}
          onPress={() => setTab('req')}
          testID="tab-requests"
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.tabText, tab === 'req' && styles.tabTextActive]}>
              Demandes
            </Text>
            {requests.length > 0 && (
              <View style={styles.reqBadge}>
                <Text style={styles.reqBadgeText} allowFontScaling={false}>
                  {requests.length}
                </Text>
              </View>
            )}
          </View>
          {tab === 'req' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>

      <FlatList
        data={tab === 'conv' ? filteredItems : requests}
        keyExtractor={(it) => it.match_id || it.request_id || it.user_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 140 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons
                  name={tab === 'conv' ? 'chatbubbles-outline' : 'heart-outline'}
                  size={30}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.empty}>
                {tab === 'conv' ? t('matches.empty') : 'Aucune demande pour l\'instant'}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) =>
          tab === 'conv' ? (
            <HapticButton
              haptic="light"
              scale={0.985}
              style={styles.row}
              onPress={() => router.push(`/chat/${item.match_id}`)}
              testID={`match-row-${item.match_id}`}
            >
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFb]}>
                  <Ionicons name="person" size={24} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                <Text
                  style={[styles.last, item.unread > 0 && styles.lastUnread]}
                  numberOfLines={1}
                >
                  {item.last_message || t('matches.sayHi')}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.time} allowFontScaling={false}>{fmtTime(item.last_at)}</Text>
                {item.unread > 0 ? (
                  <View style={styles.unreadBadge} testID={`unread-badge-${item.match_id}`}>
                    <Text style={styles.unreadText} allowFontScaling={false}>
                      {item.unread > 99 ? '99+' : String(item.unread)}
                    </Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                )}
              </View>
            </HapticButton>
          ) : (
            <View style={styles.row} testID={`request-row-${item.request_id}`}>
              {item.photos?.[0] ? (
                <Image source={{ uri: item.photos[0] }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFb]}>
                  <Ionicons name="person" size={24} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.rowBody}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name}{item.age ? `, ${item.age}` : ''}
                  </Text>
                  {item.superlike && <Text allowFontScaling={false}>⭐</Text>}
                </View>
                <Text style={styles.last} numberOfLines={1}>
                  {item.superlike ? 'T\'a envoyé un Super Like !' : 'A liké ton profil'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={() => acceptReq(item)}
                testID={`accept-req-${item.request_id}`}
              >
                <Ionicons name="heart" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectBtn}
                onPress={() => rejectReq(item)}
                testID={`reject-req-${item.request_id}`}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: '700', letterSpacing: 0.3 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radius.lg,
    marginTop: 4,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, borderBottomWidth: 0 },
  name: { color: colors.textPrimary, fontWeight: '600', fontSize: 17 },
  last: { color: colors.textSecondary, fontSize: 14, marginTop: 3 },
  lastUnread: { color: colors.textPrimary, fontWeight: '700' },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginBottom: 4,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14.5, paddingVertical: 0 },
  tabsRow: {
    flexDirection: 'row',
    gap: 22,
    paddingHorizontal: spacing.lg,
    marginTop: 10,
    marginBottom: 6,
  },
  tabBtn: { paddingBottom: 8 },
  tabText: { color: colors.textTertiary, fontSize: 14.5, fontWeight: '700' },
  tabTextActive: { color: colors.primary },
  tabUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  reqBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqBadgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  time: { color: colors.textTertiary, fontSize: 11.5, fontWeight: '600' },
  acceptBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: { alignItems: 'center', marginTop: 80, gap: 16 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
});
