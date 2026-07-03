import { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { useLocation } from '../lib/useLocation';
import { api, ActiveFriend, NearbyUser } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function MapImpl() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clubs } = useClubs();
  const loc = useLocation();
  const { user: currentUser } = useAuth();
  const [friends, setFriends] = useState<ActiveFriend[]>([]);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await api.activeFriends();
        if (mounted) setFriends(list || []);
      } catch {
        if (mounted) setFriends([]);
      }
    })();
    const id = setInterval(async () => {
      try {
        const list = await api.activeFriends();
        if (mounted) setFriends(list || []);
      } catch {}
    }, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // Nearby users (includes bots) — visible for all logged-in users
  useEffect(() => {
    if (!currentUser) {
      setNearbyUsers([]);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        // Default to Paris if no location yet, so bots always show in web preview
        const lat = loc.coords.lat || 48.8566;
        const lng = loc.coords.lng || 2.3522;
        const res = await api.usersNearby(lat, lng, 15);
        if (mounted) setNearbyUsers(res.users || []);
      } catch {
        if (mounted) setNearbyUsers([]);
      }
    })();
    return () => { mounted = false; };
  }, [currentUser?.user_id, loc.coords.lat, loc.coords.lng]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: 140 }}
      testID="map-screen-web"
    >
      <View style={{ padding: spacing.lg }}>
        <Text style={styles.webTitle}>Carte interactive</Text>
        <Text style={styles.webSub}>
          La carte plein écran s&apos;affiche sur mobile. Voici l&apos;activité autour de vous :
        </Text>
      </View>

      {/* Nearby users section (includes bots) */}
      {nearbyUsers.length > 0 && (
        <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
          <Text style={styles.sectionTitle}>
            👥 Utilisateurs proches ({nearbyUsers.length})
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12, paddingVertical: 8 }}
          >
            {nearbyUsers.map((u) => (
              <View key={u.user_id} style={styles.userChip} testID={`nearby-user-${u.user_id}`}>
                {u.picture ? (
                  <Image source={{ uri: u.picture }} style={styles.userAvatar} />
                ) : (
                  <View style={[styles.userAvatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarInitial}>{(u.name?.[0] || '?').toUpperCase()}</Text>
                  </View>
                )}
                {u.is_bot && (
                  <View style={styles.botTag}>
                    <Text style={styles.botTagText}>BOT</Text>
                  </View>
                )}
                <Text style={styles.userName} numberOfLines={1}>
                  {u.name}{u.age ? `, ${u.age}` : ''}
                </Text>
                <Text style={styles.userMeta}>{u.distance_km} km</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={{ paddingHorizontal: spacing.lg }}>
        <Text style={styles.sectionTitle}>🎧 Clubs autour ({clubs.length})</Text>
      </View>

      {clubs.slice(0, 40).map((c) => (
        <TouchableOpacity
          key={c.club_id}
          style={styles.clubCard}
          onPress={() => router.push({ pathname: '/club/[id]', params: { id: c.club_id } })}
          testID={`web-map-club-${c.club_id}`}
        >
          <View style={styles.clubIcon}>
            <Ionicons name="location" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.clubName}>{c.name}</Text>
            {c.address ? <Text style={styles.clubAddr} numberOfLines={1}>{c.address}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      ))}

      {friends.length > 0 && (
        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
          <Text style={styles.sectionTitle}>✨ Amis en soirée ({friends.length})</Text>
          {friends.map((f) => (
            <View key={f.username} style={styles.friendRow}>
              <View style={styles.friendDot} />
              <Text style={styles.friendName}>{f.name || `@${f.username}`}</Text>
              <Text style={styles.friendMeta}>chez {f.club_name}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    webTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
    webSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
    sectionTitle: {
      color: colors.textPrimary, fontWeight: '800', fontSize: 15,
      marginTop: spacing.sm, marginBottom: spacing.sm,
    },
    userChip: {
      width: 92, alignItems: 'center',
    },
    userAvatar: {
      width: 72, height: 72, borderRadius: 36,
      backgroundColor: colors.surface,
      borderWidth: 2, borderColor: colors.primary,
    },
    avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { color: colors.primary, fontSize: 24, fontWeight: '900' },
    botTag: {
      position: 'absolute', top: 0, right: 10,
      backgroundColor: colors.tertiary ?? '#00D9FF',
      paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
      borderWidth: 2, borderColor: colors.bg,
    },
    botTagText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
    userName: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 6 },
    userMeta: { color: colors.textSecondary, fontSize: 10 },
    clubCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg, marginBottom: 8,
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      padding: spacing.md, gap: spacing.sm,
    },
    clubIcon: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.primarySoft,
      alignItems: 'center', justifyContent: 'center',
    },
    clubName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    clubAddr: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    friendRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    friendDot: {
      width: 10, height: 10, borderRadius: 5,
      backgroundColor: '#22c55e',
    },
    friendName: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    friendMeta: { color: colors.textSecondary, fontSize: 12, marginLeft: 'auto' },
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _c = darkColors;
