import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  Modal,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../lib/api';
import { UserActionsMenu } from '../../components/UserActionsMenu';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

function momentImg(m: any): string | null {
  const raw = m?.image;
  if (!raw || typeof raw !== 'string') return null;
  return raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`;
}

export default function UserPublicProfile() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMoment, setPreviewMoment] = useState<any | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await api.getUserProfile(String(id));
      setProfile(p);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Profil introuvable');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const friendship = profile?.friendship || { status: 'none' };

  const onFriendAction = async () => {
    if (friendBusy || !profile) return;
    setFriendBusy(true);
    try {
      if (friendship.status === 'none') {
        await api.sendFriendRequest(profile.user_id);
      } else if (friendship.status === 'pending_in' && friendship.friendship_id) {
        await api.acceptFriend(friendship.friendship_id);
      } else if (friendship.status === 'accepted') {
        Alert.alert('Retirer cet ami ?', '', [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Retirer',
            style: 'destructive',
            onPress: async () => {
              await api.removeFriend(profile.user_id);
              load();
            },
          },
        ]);
        setFriendBusy(false);
        return;
      }
      await load();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Action impossible');
    } finally {
      setFriendBusy(false);
    }
  };

  const friendBtn = useMemo(() => {
    switch (friendship.status) {
      case 'accepted':
        return { label: 'Amis ✓', icon: 'people' as const, secondary: true };
      case 'pending_out':
        return { label: 'Demande envoyée', icon: 'time-outline' as const, secondary: true, disabled: true };
      case 'pending_in':
        return { label: 'Accepter la demande', icon: 'checkmark' as const, secondary: false };
      default:
        return { label: 'Ajouter en ami', icon: 'person-add' as const, secondary: false };
    }
  }, [friendship.status]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.container, styles.centerFill, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Ionicons name="person-circle-outline" size={56} color={colors.textTertiary} />
        <Text style={styles.errorTitle}>Profil introuvable</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stats = profile.stats || {};
  const avatar = profile.picture || (profile.photos || [])[0] || null;
  const initials = (profile.name || profile.username || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((s: string) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const moments: any[] = Array.isArray(profile.moments) ? profile.moments : [];
  const extraPhotos: string[] = (profile.photos || []).filter((p: string) => p !== avatar);

  return (
    <View style={styles.container} testID="user-profile-screen">
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="up-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {profile.username ? `@${profile.username}` : profile.name}
        </Text>
        {!profile.is_me ? (
          <UserActionsMenu
            targetUserId={profile.user_id}
            targetName={profile.name}
            context="profile"
            onBlocked={() => router.back()}
          />
        ) : (
          <View style={{ width: 26 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Identity */}
        <View style={styles.identity}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFb]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {profile.name}
              {profile.age ? `, ${profile.age}` : ''}
            </Text>
            {profile.is_premium && (
              <Ionicons name="diamond" size={16} color="#FFD700" style={{ marginLeft: 6 }} />
            )}
          </View>
          {!!profile.city && (
            <View style={styles.cityRow}>
              <Ionicons name="location-outline" size={13} color={colors.textTertiary} />
              <Text style={styles.city}>{profile.city}</Text>
            </View>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats.friends ?? 0}</Text>
            <Text style={styles.statLabel}>Amis</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats.moments ?? 0}</Text>
            <Text style={styles.statLabel}>Moments</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats.checkins ?? 0}</Text>
            <Text style={styles.statLabel}>Check-ins</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats.likes_received ?? 0}</Text>
            <Text style={styles.statLabel}>J&apos;aime</Text>
          </View>
        </View>

        {/* Friend CTA */}
        {!profile.is_me && (
          <TouchableOpacity
            style={[styles.friendBtn, friendBtn.secondary && styles.friendBtnSecondary]}
            onPress={onFriendAction}
            disabled={friendBusy || friendBtn.disabled}
            activeOpacity={0.8}
            testID="up-friend-btn"
          >
            {friendBusy ? (
              <ActivityIndicator color={friendBtn.secondary ? colors.textPrimary : colors.bg} size="small" />
            ) : (
              <>
                <Ionicons
                  name={friendBtn.icon}
                  size={17}
                  color={friendBtn.secondary ? colors.textPrimary : colors.bg}
                />
                <Text style={[styles.friendBtnText, friendBtn.secondary && styles.friendBtnTextSecondary]}>
                  {friendBtn.label}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Bio */}
        {!!profile.bio && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>BIO</Text>
            <Text style={styles.bio}>{profile.bio}</Text>
          </View>
        )}

        {/* Instagram */}
        {!!profile.instagram && (
          <TouchableOpacity
            style={styles.igRow}
            onPress={() =>
              Linking.openURL(`https://instagram.com/${String(profile.instagram).replace('@', '')}`)
            }
            activeOpacity={0.7}
          >
            <Ionicons name="logo-instagram" size={18} color={colors.primary} />
            <Text style={styles.igText}>@{String(profile.instagram).replace('@', '')}</Text>
          </TouchableOpacity>
        )}

        {/* Music prefs */}
        {Array.isArray(profile.music_prefs) && profile.music_prefs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>MUSIQUE</Text>
            <View style={styles.chipsWrap}>
              {profile.music_prefs.map((g: string) => (
                <View key={g} style={styles.chip}>
                  <Text style={styles.chipText}>{g}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Extra photos */}
        {extraPhotos.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PHOTOS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {extraPhotos.map((p, i) => (
                <Image key={i} source={{ uri: p }} style={styles.extraPhoto} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Moments grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MOMENTS</Text>
          {moments.length === 0 ? (
            <View style={styles.momentsEmpty}>
              <Ionicons name="aperture-outline" size={28} color={colors.textTertiary} />
              <Text style={styles.momentsEmptyText}>Aucun moment récent</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {moments.map((m, idx) => {
                const img = momentImg(m);
                return (
                  <TouchableOpacity
                    key={m.moment_id || idx}
                    style={styles.gridCell}
                    activeOpacity={0.8}
                    onPress={() => setPreviewMoment(m)}
                    testID={`up-moment-${idx}`}
                  >
                    {img ? (
                      <Image source={{ uri: img }} style={styles.gridImage} />
                    ) : (
                      <View style={[styles.gridImage, styles.gridImgFb]}>
                        <Ionicons name="image" size={20} color={colors.textTertiary} />
                      </View>
                    )}
                    {!m.active && (
                      <View style={styles.gridExpired}>
                        <Ionicons name="time-outline" size={13} color="#fff" />
                      </View>
                    )}
                    {!!m.club_name && (
                      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={styles.gridLabelWrap}>
                        <Text style={styles.gridLabel} numberOfLines={1}>
                          {m.club_name}
                        </Text>
                      </LinearGradient>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Moment preview modal */}
      <Modal
        visible={!!previewMoment}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewMoment(null)}
      >
        <View style={styles.previewRoot}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPreviewMoment(null)} />
          {previewMoment && (
            <View style={styles.previewCard}>
              {momentImg(previewMoment) ? (
                <View>
                  <Image source={{ uri: momentImg(previewMoment)! }} style={styles.previewImage} resizeMode="cover" />
                  {!!previewMoment.selfie && (
                    <Image
                      source={{
                        uri: String(previewMoment.selfie).startsWith('data:')
                          ? previewMoment.selfie
                          : `data:image/jpeg;base64,${previewMoment.selfie}`,
                      }}
                      style={styles.previewSelfie}
                      resizeMode="cover"
                    />
                  )}
                </View>
              ) : null}
              <View style={styles.previewMeta}>
                {!!previewMoment.club_name && (
                  <Text style={styles.previewClub}>{previewMoment.club_name}</Text>
                )}
                {!!previewMoment.caption && (
                  <Text style={styles.previewCaption}>{previewMoment.caption}</Text>
                )}
              </View>
              <TouchableOpacity style={styles.previewClose} onPress={() => setPreviewMoment(null)}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centerFill: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  backBtnText: { color: colors.textPrimary, fontWeight: '800', fontSize: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  identity: { alignItems: 'center', paddingTop: 24, paddingHorizontal: spacing.lg },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface },
  avatarFb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong },
  avatarInitials: { color: colors.textPrimary, fontSize: 30, fontWeight: '900' },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  name: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  city: { color: colors.textTertiary, fontSize: 13 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statNum: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  statLabel: { color: colors.textTertiary, fontSize: 11, marginTop: 2, fontWeight: '700' },
  statDivider: { width: 1, height: 26, backgroundColor: colors.border },
  friendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    minHeight: 48,
  },
  friendBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  friendBtnText: { color: colors.bg, fontSize: 15, fontWeight: '900' },
  friendBtnTextSecondary: { color: colors.textPrimary },
  section: { marginTop: 26, paddingHorizontal: spacing.lg },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 10,
  },
  bio: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  igRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  igText: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  extraPhoto: { width: 110, height: 150, borderRadius: radius.md, backgroundColor: colors.surface },
  momentsEmpty: { alignItems: 'center', paddingVertical: 26, gap: 8 },
  momentsEmptyText: { color: colors.textTertiary, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  gridCell: {
    width: '32.4%',
    aspectRatio: 3 / 4,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    position: 'relative',
  },
  gridImage: { width: '100%', height: '100%' },
  gridImgFb: { alignItems: 'center', justifyContent: 'center' },
  gridExpired: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 4,
  },
  gridLabelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingTop: 16,
    paddingBottom: 5,
  },
  gridLabel: { color: '#fff', fontSize: 10, fontWeight: '800' },
  previewRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  previewCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  previewImage: { width: '100%', aspectRatio: 3 / 4 },
  previewSelfie: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 92,
    height: 122,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#000',
  },
  previewMeta: { padding: 14, gap: 4 },
  previewClub: { color: colors.textPrimary, fontSize: 15, fontWeight: '900' },
  previewCaption: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  previewClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
