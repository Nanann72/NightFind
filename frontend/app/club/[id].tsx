import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, Club } from '../../lib/api';
import { useClubs } from '../../lib/clubs';
import { colors, radius, spacing } from '../../lib/theme';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = {
  mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi',
  fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
};

export default function ClubDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { favorites, toggleFavorite } = useClubs();
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api
      .getClub(String(id))
      .then(setClub)
      .catch(() => setClub(null))
      .finally(() => setLoading(false));
  }, [id]);

  const isFav = club ? favorites.has(club.club_id) : false;

  const openDirections = () => {
    if (!club) return;
    const scheme = Platform.select({
      ios: `maps:0,0?q=${club.name}@${club.lat},${club.lng}`,
      android: `geo:0,0?q=${club.lat},${club.lng}(${encodeURIComponent(club.name)})`,
    });
    const fallback = `https://www.google.com/maps/search/?api=1&query=${club.lat},${club.lng}`;
    Linking.openURL(scheme || fallback).catch(() => Linking.openURL(fallback));
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!club) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textSecondary }}>Club introuvable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="club-detail-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={styles.heroWrap}>
          <Image source={{ uri: club.photos[0] }} style={styles.hero} />
          <View style={styles.heroOverlay} />
          <TouchableOpacity
            style={[styles.headerBtn, { top: insets.top + 12, left: 16 }]}
            onPress={() => router.back()}
            testID="back-btn"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, { top: insets.top + 12, right: 16 }]}
            onPress={() => toggleFavorite(club.club_id)}
            testID="detail-fav-btn"
          >
            <Ionicons
              name={isFav ? 'heart' : 'heart-outline'}
              size={20}
              color={isFav ? colors.primary : colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={styles.heroBottom}>
            <View style={styles.chipsRow}>
              {club.music_styles.map((m) => (
                <View key={m} style={styles.chip}>
                  <Text style={styles.chipText}>{m}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.title}>{club.name}</Text>
            <Text style={styles.address}>{club.address}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Ionicons name="star" size={14} color={colors.secondary} />
                <Text style={styles.statText}>{club.rating.toFixed(1)}</Text>
              </View>
              <View style={styles.statItem}>
                <Ionicons name="cash-outline" size={14} color={colors.tertiary} />
                <Text style={styles.statText}>{club.avg_price.toFixed(0)}€ moy.</Text>
              </View>
              {club.distance_km != null && (
                <View style={styles.statItem}>
                  <Ionicons name="navigate" size={14} color={colors.tertiary} />
                  <Text style={styles.statText}>{club.distance_km.toFixed(1)} km</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <Section title="À propos">
            <Text style={styles.bodyText}>{club.description}</Text>
          </Section>

          <Section title="Horaires">
            {DAYS.map((d) => {
              const h = club.hours[d];
              return (
                <View key={d} style={styles.hourRow}>
                  <Text style={styles.dayLabel}>{DAY_LABELS[d]}</Text>
                  <Text style={styles.hourValue}>
                    {h?.open ? `${h.from} – ${h.to}` : 'Fermé'}
                  </Text>
                </View>
              );
            })}
          </Section>

          {club.features.length > 0 && (
            <Section title="Ambiance">
              <View style={styles.featRow}>
                {club.features.map((f) => (
                  <View key={f} style={styles.featChip}>
                    <Ionicons name="checkmark" size={12} color={colors.tertiary} />
                    <Text style={styles.featText}>{f.replace(/_/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          {club.events && club.events.length > 0 && (
            <Section title="Soirées à venir">
              {club.events.map((e) => (
                <View key={e.event_id} style={styles.evRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.evTitle}>{e.title}</Text>
                    <Text style={styles.evDate}>
                      {new Date(e.date).toLocaleDateString('fr-FR', {
                        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <Text style={styles.evPrice}>{e.entry_price.toFixed(0)}€</Text>
                </View>
              ))}
            </Section>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 24 + insets.bottom / 2 }]}>
        <TouchableOpacity
          style={styles.directionsBtn}
          onPress={openDirections}
          testID="directions-btn"
        >
          <Ionicons name="navigate" size={18} color={colors.textPrimary} />
          <Text style={styles.directionsText}>Itinéraire</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.favBtn}
          onPress={() => toggleFavorite(club.club_id)}
          testID="footer-fav-btn"
        >
          <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={18} color={colors.bg} />
          <Text style={styles.favText}>
            {isFav ? 'Dans vos favoris' : 'Ajouter aux favoris'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroWrap: { height: 380, position: 'relative' },
  hero: { width: '100%', height: '100%' },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.4)',
  },
  headerBtn: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(9,9,11,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  heroBottom: { position: 'absolute', bottom: 24, left: 24, right: 24 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  title: { color: colors.textPrimary, fontSize: 32, fontWeight: '900', letterSpacing: -0.5 },
  address: { color: colors.textSecondary, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 12 },
  statItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  statText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
    marginBottom: 10,
  },
  sectionBody: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bodyText: { color: colors.textPrimary, lineHeight: 22, fontSize: 14 },
  hourRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  dayLabel: { color: colors.textSecondary, fontWeight: '600' },
  hourValue: { color: colors.textPrimary, fontWeight: '700' },
  featRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.25)',
  },
  featText: { color: colors.tertiary, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  evRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  evTitle: { color: colors.textPrimary, fontWeight: '700' },
  evDate: { color: colors.textSecondary, marginTop: 2, fontSize: 12 },
  evPrice: { color: colors.secondary, fontWeight: '900' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    gap: 10,
  },
  directionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  directionsText: { color: colors.textPrimary, fontWeight: '700' },
  favBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
  favText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
});
