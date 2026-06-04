import { useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, NFEvent } from '../../lib/api';
import { useClubs } from '../../lib/clubs';
import { addToCalendar } from '../../lib/calendar';
import { colors, radius, spacing } from '../../lib/theme';

export default function Events() {
  const insets = useSafeAreaInsets();
  const { clubs } = useClubs();
  const [events, setEvents] = useState<NFEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.listEvents();
      setEvents(list);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onAddToCalendar = async (ev: NFEvent) => {
    setAdding(ev.event_id);
    try {
      const club = clubs.find((c) => c.club_id === ev.club_id);
      const start = new Date(ev.date);
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      const location = club
        ? `${club.name} — ${club.address || ''}${
            club.lat && club.lng ? ` (${club.lat.toFixed(5)},${club.lng.toFixed(5)})` : ''
          }`
        : ev.club_name || 'Night Finder';
      const notes =
        `${ev.description || ''}\n\n` +
        `DJ : ${ev.dj || '—'}\n` +
        `Prix d'entrée : ${ev.entry_price ? `${ev.entry_price.toFixed(0)}€` : 'libre'}\n` +
        (ev.booking_url ? `Réservation : ${ev.booking_url}` : '');
      const ok = await addToCalendar({
        title: `${ev.title}${ev.club_name ? ` @ ${ev.club_name}` : ''}`,
        startsAt: start,
        endsAt: end,
        location,
        notes,
        url: ev.booking_url,
      });
      if (ok) setAdded((m) => ({ ...m, [ev.event_id]: true }));
    } finally {
      setAdding(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="events-screen">
      <View style={styles.header}>
        <Text style={styles.brand}>NIGHT FINDER</Text>
        <Text style={styles.title}>Soirées à venir</Text>
        <Text style={styles.subtitle}>
          DJ invités, soirées thématiques, lives exclusifs.
        </Text>
      </View>

      <FlatList
        data={events}
        keyExtractor={(e) => e.event_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucune soirée à venir.</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={`event-card-${item.event_id}`}>
            <Image source={{ uri: item.photo || '' }} style={styles.image} />
            <View style={styles.gradient} />
            <View style={styles.cardBody}>
              <View style={styles.dateBadge}>
                <Ionicons name="calendar" size={12} color={colors.secondary} />
                <Text style={styles.dateText}>{formatDate(item.date)}</Text>
              </View>
              <Text style={styles.evTitle}>{item.title}</Text>
              <Text style={styles.evClub}>{item.club_name}</Text>
              <Text style={styles.evDesc} numberOfLines={2}>
                {item.description}
              </Text>
              <View style={styles.row}>
                <View style={styles.priceBox}>
                  <Text style={styles.priceLabel}>Entrée</Text>
                  <Text style={styles.priceText}>{item.entry_price.toFixed(0)}€</Text>
                </View>
                <TouchableOpacity
                  style={[styles.reserveBtn, added[item.event_id] && styles.reserveBtnDone]}
                  onPress={() => onAddToCalendar(item)}
                  disabled={adding === item.event_id}
                  testID={`agenda-btn-${item.event_id}`}
                  activeOpacity={0.85}
                >
                  {adding === item.event_id ? (
                    <ActivityIndicator color={colors.bg} />
                  ) : added[item.event_id] ? (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color={colors.bg} />
                      <Text style={styles.reserveText}>Ajouté</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="calendar-outline" size={16} color={colors.bg} />
                      <Text style={styles.reserveText}>Agenda</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  brand: {
    color: colors.primary,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 3,
    marginBottom: 4,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  subtitle: { color: colors.textSecondary, marginTop: 4 },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', height: 180 },
  gradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    backgroundColor: 'rgba(9,9,11,0.45)',
  },
  cardBody: { padding: 18 },
  dateBadge: {
    position: 'absolute',
    top: -14,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  dateText: { color: colors.secondary, fontWeight: '800', fontSize: 12 },
  evTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  evClub: { color: colors.tertiary, fontWeight: '700', marginTop: 4 },
  evDesc: { color: colors.textSecondary, marginTop: 8, fontSize: 13, lineHeight: 18 },
  row: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceBox: { },
  priceLabel: { color: colors.textTertiary, fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  priceText: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  reserveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    minWidth: 130,
    justifyContent: 'center',
  },
  reserveBtnDone: { backgroundColor: '#22c55e' },
  reserveText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
});
