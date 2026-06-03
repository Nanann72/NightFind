import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { useClubs } from '../../lib/clubs';
import { colors, radius, spacing } from '../../lib/theme';

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { favorites, clubs } = useClubs();

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const favCount = favorites.size;

  const handleSignOut = () => {
    Alert.alert('Déconnexion', 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login');
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 140 }}
      testID="profile-screen"
    >
      <View style={styles.headerWrap}>
        <View style={styles.avatarWrap}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <View style={styles.avatarRing} />
        </View>
        <Text style={styles.name}>{user?.name || 'Invité'}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
      </View>

      <View style={styles.statsRow}>
        <Stat label="Favoris" value={favCount} testID="stat-favorites" />
        <Stat label="Clubs" value={clubs.length} testID="stat-clubs" />
        <Stat label="Préférences" value={user?.music_prefs?.length || 0} testID="stat-prefs" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mon activité</Text>
        <Row
          icon="heart"
          label="Mes favoris"
          value={`${favCount}`}
          onPress={() => router.push('/favorites')}
          testID="row-favorites"
        />
        <Row
          icon="notifications"
          label="Notifications"
          onPress={() => router.push('/notifications')}
          testID="row-notifications"
        />
        <Row
          icon="options"
          label="Filtres de découverte"
          onPress={() => router.push('/filters')}
          testID="row-filters"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Préférences musicales</Text>
        <View style={styles.tags}>
          {['Techno', 'House', 'Hip-Hop', 'Disco', 'RnB', 'Latin', 'Afro'].map((m) => (
            <View key={m} style={styles.tag}>
              <Text style={styles.tagText}>{m}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.signOut}
        onPress={handleSignOut}
        testID="sign-out-btn"
      >
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.signOutText}>Se déconnecter</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Night Finder · v1.0.0</Text>
    </ScrollView>
  );
}

function Stat({ label, value, testID }: { label: string; value: number; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} testID={testID} activeOpacity={0.85}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.tertiary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {value !== undefined && <Text style={styles.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerWrap: { alignItems: 'center', paddingTop: 32, paddingHorizontal: spacing.xl },
  avatarWrap: { position: 'relative', marginBottom: 14 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: {
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 30, fontWeight: '900' },
  avatarRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  name: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  email: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: 12,
  },
  stat: {
    flex: 1,
    paddingVertical: 18,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.textSecondary, marginTop: 2, fontSize: 12, fontWeight: '600' },
  section: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,240,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { color: colors.textPrimary, fontWeight: '600', flex: 1 },
  rowValue: { color: colors.textSecondary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  signOut: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  signOutText: { color: colors.danger, fontWeight: '700' },
  version: {
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: 11,
  },
});
