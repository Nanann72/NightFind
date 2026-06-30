import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, NFEvent } from '../../lib/api';
import { useClubs } from '../../lib/clubs';
import { usePremium } from '../../lib/premium';
import { useTabBarScroll } from '../../lib/tabBarScroll';
import { addToCalendar } from '../../lib/calendar';
import { radius, spacing, type ThemeColors, darkColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

export default function Events() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { clubs } = useClubs();
  const { isPremium } = usePremium();
  const { onScroll: onScrollHide } = useTabBarScroll();
  const [events, setEvents] = useState<NFEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  // Create event modal
  const [showCreate, setShowCreate] = useState(false);
  const [ceTitle, setCeTitle] = useState('');
  const [ceDescription, setCeDescription] = useState('');
  const [ceDj, setCeDj] = useState('');
  const [ceDate, setCeDate] = useState(defaultDateString());
  const [cePrice, setCePrice] = useState('');
  const [ceLocationName, setCeLocationName] = useState('');
  const [ceLocationAddress, setCeLocationAddress] = useState('');
  const [ceVisibility, setCeVisibility] = useState<'public' | 'friends_only'>('public');
  const [creating, setCreating] = useState(false);

  const resetCreateForm = () => {
    setCeTitle('');
    setCeDescription('');
    setCeDj('');
    setCeDate(defaultDateString());
    setCePrice('');
    setCeLocationName('');
    setCeLocationAddress('');
    setCeVisibility('public');
  };

  const onFabPress = () => {
    if (!isPremium) {
      Alert.alert(
        'Réservé aux Premium 💎',
        "Crée tes propres soirées et invite tes amis ! Cette fonctionnalité est réservée aux membres Night Finder Premium.",
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Passer Premium', onPress: () => router.push('/paywall') },
        ],
      );
      return;
    }
    setShowCreate(true);
  };

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

  const onCreateSubmit = async () => {
    if (!ceTitle.trim()) {
      Alert.alert('Titre manquant', 'Donne un titre à ta soirée.');
      return;
    }
    if (!ceLocationName.trim()) {
      Alert.alert('Lieu manquant', 'Indique le nom du lieu.');
      return;
    }
    const isoDate = parseInputDate(ceDate);
    if (!isoDate) {
      Alert.alert('Date invalide', 'Format attendu : JJ/MM/AAAA HH:mm');
      return;
    }
    if (new Date(isoDate).getTime() <= Date.now()) {
      Alert.alert('Date passée', 'La date doit être dans le futur.');
      return;
    }
    setCreating(true);
    try {
      await api.createEvent({
        title: ceTitle.trim(),
        location_name: ceLocationName.trim(),
        location_address: ceLocationAddress.trim(),
        visibility: ceVisibility,
        description: ceDescription.trim(),
        dj: ceDj.trim(),
        date: isoDate,
        entry_price: Number(cePrice.replace(',', '.')) || 0,
      });
      setShowCreate(false);
      resetCreateForm();
      await load();
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('402') || /Premium/i.test(msg)) {
        Alert.alert(
          'Réservé aux Premium 💎',
          'La création de soirées est uniquement disponible pour les membres Premium.',
        );
      } else {
        Alert.alert('Erreur', msg || "Impossible de créer l'événement.");
      }
    } finally {
      setCreating(false);
    }
  };

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
        `Prix d'entrée : ${ev.entry_price ? `${ev.entry_price.toFixed(0)}€` : 'libre'}`;
      const ok = await addToCalendar({
        title: `${ev.title}${ev.club_name ? ` @ ${ev.club_name}` : ''}`,
        startsAt: start,
        endsAt: end,
        location,
        notes,
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

      <Animated.FlatList
        data={events}
        keyExtractor={(e: NFEvent) => e.event_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}
        scrollEventThrottle={16}
        onScroll={(e) => onScrollHide(e.nativeEvent.contentOffset.y)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucune soirée à venir. Crée la première via le bouton +.</Text>
          )
        }
        renderItem={({ item, index }: { item: NFEvent; index: number }) => (
          <Animated.View entering={FadeInDown.delay(index * 40).springify().damping(18)}>
          <View style={styles.card} testID={`event-card-${item.event_id}`}>
            <Image source={{ uri: item.photo || '' }} style={styles.image} />
            <View style={styles.gradient} />
            <View style={styles.cardBody}>
              <View style={styles.dateBadge}>
                <Ionicons name="calendar" size={12} color={colors.secondary} />
                <Text style={styles.dateText}>{formatDate(item.date)}</Text>
              </View>
              <Text style={styles.evTitle}>{item.title}</Text>
              <Text style={styles.evClub}>
                {(item as any).location_name || item.club_name}
                {(item as any).visibility === 'friends_only' ? '  ·  🔒 Privée' : ''}
              </Text>
              <Text style={styles.evDesc} numberOfLines={2}>
                {item.description}
              </Text>
              <View style={styles.row}>
                <View>
                  <Text style={styles.priceLabel}>Entrée</Text>
                  <Text style={styles.priceText}>
                    {item.entry_price ? `${item.entry_price.toFixed(0)}€` : 'Libre'}
                  </Text>
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
          </Animated.View>
        )}
      />

      {/* FAB to create an event */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 90 }, !isPremium && styles.fabLocked]}
        onPress={onFabPress}
        activeOpacity={0.85}
        testID="create-event-fab"
      >
        <Ionicons name={isPremium ? 'add' : 'lock-closed'} size={isPremium ? 28 : 22} color={colors.bg} />
      </TouchableOpacity>

      {/* Create event modal */}
      <Modal
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
        transparent={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: colors.bg }}
        >
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={() => setShowCreate(false)}
              testID="create-event-close"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Créer une soirée</Text>
            <TouchableOpacity
              onPress={onCreateSubmit}
              disabled={creating}
              testID="create-event-submit"
            >
              {creating ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.modalSave}>Publier</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>Titre *</Text>
            <TextInput
              value={ceTitle}
              onChangeText={setCeTitle}
              placeholder="Ex. Techno All Night"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              maxLength={120}
              testID="ce-title"
            />

            <Text style={styles.label}>Date *</Text>
            <TextInput
              value={ceDate}
              onChangeText={setCeDate}
              placeholder="JJ/MM/AAAA HH:mm"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="ce-date"
              autoCapitalize="none"
            />
            <Text style={styles.helper}>Ex : 25/12/2026 23:30</Text>

            <Text style={styles.label}>Lieu *</Text>
            <TextInput
              value={ceLocationName}
              onChangeText={setCeLocationName}
              placeholder="Nom du lieu (ex. Loft du 13)"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="ce-location-name"
              maxLength={120}
            />
            <View style={{ height: 8 }} />
            <TextInput
              value={ceLocationAddress}
              onChangeText={setCeLocationAddress}
              placeholder="Adresse (optionnel)"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="ce-location-address"
              maxLength={200}
            />

            <Text style={styles.label}>Qui peut voir cette soirée ? *</Text>
            <View style={styles.segWrap}>
              <TouchableOpacity
                style={[styles.segBtn, ceVisibility === 'public' && styles.segBtnActive]}
                onPress={() => setCeVisibility('public')}
                testID="ce-vis-public"
                activeOpacity={0.85}
              >
                <Ionicons
                  name="globe"
                  size={16}
                  color={ceVisibility === 'public' ? colors.bg : colors.textPrimary}
                />
                <Text style={[styles.segText, ceVisibility === 'public' && styles.segTextActive]}>
                  Publique
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, ceVisibility === 'friends_only' && styles.segBtnActive]}
                onPress={() => setCeVisibility('friends_only')}
                testID="ce-vis-friends"
                activeOpacity={0.85}
              >
                <Ionicons
                  name="lock-closed"
                  size={16}
                  color={ceVisibility === 'friends_only' ? colors.bg : colors.textPrimary}
                />
                <Text
                  style={[styles.segText, ceVisibility === 'friends_only' && styles.segTextActive]}
                >
                  Mes amis
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.helper}>
              {ceVisibility === 'public'
                ? 'Visible par tout le monde dans l\'onglet Soirées.'
                : 'Visible uniquement par tes amis Night Finder.'}
            </Text>

            <Text style={styles.label}>DJ / artiste</Text>
            <TextInput
              value={ceDj}
              onChangeText={setCeDj}
              placeholder="Nom du DJ ou de l'artiste"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="ce-dj"
            />

            <Text style={styles.label}>Prix d'entrée (€)</Text>
            <TextInput
              value={cePrice}
              onChangeText={setCePrice}
              placeholder="0 pour libre"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              keyboardType="numeric"
              testID="ce-price"
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              value={ceDescription}
              onChangeText={setCeDescription}
              placeholder="Décris la soirée, l'ambiance, le lineup..."
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, styles.inputArea]}
              multiline
              maxLength={500}
              testID="ce-description"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function defaultDateString() {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
  d.setHours(23, 0, 0, 0);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseInputDate(s: string): string | null {
  // Accept "DD/MM/YYYY HH:mm" or ISO directly
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (m) {
    const [, dd, mm, yyyy, HH, MM] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  // Fallback ISO
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  brand: {
    color: colors.primary,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 3,
    marginBottom: 4,
  },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
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
  row: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },

  // FAB
  fab: {
    position: 'absolute',
    right: 22,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
  fabLocked: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: colors.primary,
    shadowOpacity: 0,
  },

  // Segmented (public/friends)
  segWrap: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  segBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segText: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  segTextActive: { color: colors.bg },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  modalSave: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  label: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  inputArea: { minHeight: 90, textAlignVertical: 'top' },
  helper: { color: colors.textTertiary, fontSize: 12, marginTop: 6 },
  clubList: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  clubRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  clubName: { color: colors.textPrimary, fontWeight: '700' },
  clubAddr: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
  selectedClub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  selectedClubName: { color: colors.textPrimary, fontWeight: '800' },
  selectedClubAddr: { color: colors.textTertiary, fontSize: 12, marginTop: 2 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
