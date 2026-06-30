import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, Layout } from 'react-native-reanimated';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  event: 'calendar',
  promo: 'pricetag',
  nearby: 'location',
  checkin: 'radio',
};

const COLOURS: Record<string, string> = {
  event: colors.tertiary,
  promo: colors.secondary,
  nearby: colors.primary,
  checkin: colors.tertiary,
};

const LABELS: Record<string, string> = {
  event: 'Événement',
  promo: 'Promo',
  nearby: 'Près de toi',
  checkin: 'Détection',
};

type Group = { type: string; items: any[]; expanded: boolean };

export default function Notifications() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const groups: Group[] = useMemo(() => {
    const byType: Record<string, any[]> = {};
    for (const n of items) {
      const t = n.type || 'event';
      if (!byType[t]) byType[t] = [];
      byType[t].push(n);
    }
    return Object.entries(byType)
      .map(([type, list]) => ({
        type,
        items: list.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
        expanded: !!expanded[type],
      }))
      .sort((a, b) => {
        const ta = new Date(a.items[0].created_at).getTime();
        const tb = new Date(b.items[0].created_at).getTime();
        return tb - ta;
      });
  }, [items, expanded]);

  const onItemPress = (item: any) => {
    if (item.type === 'event') router.push('/(tabs)/events');
    else if (item.type === 'nearby') router.push('/(tabs)');
    else if (item.type === 'checkin') router.push('/(tabs)');
    else router.push('/(tabs)');
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

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
      >
        {loading && items.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Tout est calme</Text>
            <Text style={styles.emptyText}>
              Tu seras notifié dès qu'une bonne occasion se présentera près de toi.
            </Text>
          </View>
        ) : (
          groups.map((g, gIdx) => (
            <NotifStack
              key={g.type}
              group={g}
              index={gIdx}
              onToggle={() =>
                setExpanded((prev) => ({ ...prev, [g.type]: !prev[g.type] }))
              }
              onItemPress={onItemPress}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function NotifStack({
  group,
  index,
  onToggle,
  onItemPress,
}: {
  group: Group;
  index: number;
  onToggle: () => void;
  onItemPress: (item: any) => void;
}) {
  const tag = LABELS[group.type] || 'Info';
  const col = COLOURS[group.type] || colors.tertiary;
  const ic = ICONS[group.type] || 'notifications';
  const count = group.items.length;

  if (!group.expanded) {
    // Stacked card preview (iOS-style notification stack)
    return (
      <Animated.View
        entering={FadeInDown.delay(60 * index).duration(380)}
        layout={Layout.springify().damping(18)}
        style={styles.stackWrap}
      >
        {count > 2 && (
          <View
            style={[
              styles.stackedCard,
              styles.stackedCardBack,
              { borderColor: `${col}30` },
            ]}
          />
        )}
        {count > 1 && (
          <View
            style={[
              styles.stackedCard,
              styles.stackedCardMid,
              { borderColor: `${col}55` },
            ]}
          />
        )}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={count > 1 ? onToggle : () => onItemPress(group.items[0])}
          style={[styles.card, { borderColor: `${col}55` }]}
          testID={`notif-stack-${group.type}`}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: `${col}1F`, borderColor: `${col}66` },
            ]}
          >
            <Ionicons name={ic} size={18} color={col} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.rowTopRow}>
              <Text
                style={[
                  styles.rowTag,
                  { color: col, borderColor: `${col}66`, backgroundColor: `${col}1F` },
                ]}
              >
                {tag}
              </Text>
              <Text style={styles.rowTime}>
                {formatWhen(group.items[0].created_at)}
              </Text>
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {group.items[0].title}
            </Text>
            <Text style={styles.rowBody} numberOfLines={1}>
              {group.items[0].body}
            </Text>
          </View>
          {count > 1 ? (
            <View style={[styles.countBadge, { backgroundColor: col }]}>
              <Text style={styles.countText}>{count}</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          )}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // Expanded: render each notification as its own card
  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      layout={Layout.springify().damping(18)}
      style={{ marginBottom: 14 }}
    >
      <TouchableOpacity onPress={onToggle} style={styles.groupHeader} testID={`notif-collapse-${group.type}`}>
        <Text style={[styles.groupHeaderTitle, { color: col }]}>{tag.toUpperCase()}</Text>
        <View style={styles.groupHeaderRight}>
          <Text style={styles.groupHeaderCount}>{count}</Text>
          <Ionicons name="chevron-up" size={14} color={colors.textTertiary} />
        </View>
      </TouchableOpacity>
      {group.items.map((item, i) => (
        <Animated.View
          key={item.notif_id || i}
          entering={FadeInDown.delay(40 * i).duration(280)}
        >
          <TouchableOpacity
            style={[styles.card, { borderColor: `${col}33` }]}
            activeOpacity={0.85}
            onPress={() => onItemPress(item)}
            testID={`notif-row-${item.notif_id}`}
          >
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: `${col}1A`, borderColor: `${col}55` },
              ]}
            >
              <Ionicons name={ic} size={18} color={col} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.rowTopRow}>
                <Text
                  style={[
                    styles.rowTag,
                    { color: col, borderColor: `${col}55`, backgroundColor: `${col}1A` },
                  ]}
                >
                  {tag}
                </Text>
                <Text style={styles.rowTime}>{formatWhen(item.created_at)}</Text>
              </View>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowBody} numberOfLines={2}>
                {item.body}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

function formatWhen(iso: string) {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "À l'instant";
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `${h}h`;
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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

  // Stack
  stackWrap: { marginBottom: 16, position: 'relative', paddingTop: 12 },
  stackedCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 72,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  stackedCardMid: { top: 6 },
  stackedCardBack: { top: 0, opacity: 0.7, left: 22, right: 22 },

  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.lg,
    marginBottom: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
  countBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.bg, fontWeight: '900', fontSize: 12 },

  // Group header (expanded view)
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  groupHeaderTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  groupHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupHeaderCount: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
