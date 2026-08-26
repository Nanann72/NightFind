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
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMatches();
      setItems(r || []);
      triggerUnreadMessagesRefresh();
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

      <FlatList
        data={items}
        keyExtractor={(it) => it.match_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 140 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubbles-outline" size={30} color={colors.textTertiary} />
              </View>
              <Text style={styles.empty}>{t('matches.empty')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
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
            {item.unread > 0 ? (
              <View style={styles.unreadBadge} testID={`unread-badge-${item.match_id}`}>
                <Text style={styles.unreadText} allowFontScaling={false}>
                  {item.unread > 99 ? '99+' : String(item.unread)}
                </Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            )}
          </HapticButton>
        )}
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
