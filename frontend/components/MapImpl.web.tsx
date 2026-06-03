import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { colors, radius, spacing } from '../lib/theme';

export default function MapImpl() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clubs } = useClubs();

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 140 }}
      testID="map-screen-web"
    >
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.webTitle}>Carte interactive</Text>
        <Text style={styles.webSub}>
          La carte plein écran (Apple Maps sur iOS, OpenStreetMap sur Android)
          s'affiche dans l'app mobile. Voici les {clubs.length} clubs autour de
          vous :
        </Text>
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        {clubs.map((c) => (
          <TouchableOpacity
            key={c.club_id}
            style={styles.webRow}
            onPress={() => router.push(`/club/${c.club_id}` as any)}
            testID={`web-map-row-${c.club_id}`}
          >
            <View style={styles.markerSmall}>
              <View style={styles.markerInner} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.webName}>{c.name}</Text>
              <Text style={styles.webMeta}>
                {c.address}
                {c.distance_km != null ? ` · ${c.distance_km.toFixed(1)} km` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  webTitle: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 6,
  },
  webSub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  webRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  markerSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,240,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.tertiary,
  },
  markerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.tertiary,
  },
  webName: { color: colors.textPrimary, fontWeight: '700' },
  webMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
