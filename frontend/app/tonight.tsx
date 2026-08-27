/**
 * Mode Soirée — « Ce soir je sors » 🎉
 * Un geste → club recommandé (selon tes goûts musicaux + note + affluence),
 * itinéraire en 1 tap, et invitation de tes amis (matchs) en un envoi groupé.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, TonightClub } from '../lib/api';
import { useLocation } from '../lib/useLocation';
import { SafeImage } from '../components/SafeImage';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

type Friend = { match_id: string; user_id: string; name: string; photo?: string | null };

export default function TonightScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loc = useLocation();

  const [loading, setLoading] = useState(true);
  const [clubs, setClubs] = useState<TonightClub[]>([]);
  const [clubIdx, setClubIdx] = useState(0);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const club = clubs[clubIdx];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = loc.permission === 'granted' ? loc.coords : undefined;
      const r = await api.tonightPlan(c?.lat, c?.lng);
      const all = [r.club, ...(r.alternatives || [])].filter(Boolean) as TonightClub[];
      setClubs(all);
      setClubIdx(0);
      setFriends(r.friends || []);
    } catch {
      setClubs([]);
    } finally {
      setLoading(false);
    }
  }, [loc.permission, loc.coords.lat, loc.coords.lng]);

  useEffect(() => {
    if (!loc.loading) load();
  }, [loc.loading, load]);

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const shuffle = () => {
    haptic();
    setClubIdx((i) => (clubs.length > 0 ? (i + 1) % clubs.length : 0));
  };

  const toggleFriend = (matchId: string) => {
    haptic();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };

  const sendInvites = async () => {
    if (!club || selected.size === 0 || sending) return;
    setSending(true);
    const text = `🎉 Ce soir je sors au ${club.name} ! Tu viens ?\n📍 ${club.address || ''}`.trim();
    try {
      await Promise.all(
        [...selected].map((mid) =>
          api.sendMessage(mid, text, undefined, {
            club_id: club.club_id,
            club_name: club.name,
            address: club.address || '',
          }).catch(() => null),
        ),
      );
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const openItinerary = () => {
    if (!club?.lat || !club?.lng) return;
    haptic();
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${club.lat},${club.lng}`,
    ).catch(() => {});
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="tonight-screen">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} testID="tonight-close" hitSlop={8}>
          <Ionicons name="chevron-down" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ce soir je sors 🎉</Text>
          <Text style={styles.subtitle}>Ton plan de soirée en un geste</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      ) : !club ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{"Aucun lieu trouvé autour de toi pour l'instant."}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          {/* ── Club recommandé ── */}
          <View style={styles.heroCard}>
            <SafeImage uri={club.photo || undefined} width={640} style={styles.heroImage} />
            <View style={styles.heroOverlay} />
            <View style={styles.heroLive}>
              <Ionicons name="people" size={12} color="#fff" />
              <Text style={styles.heroLiveText} allowFontScaling={false}>{club.live} personnes ici</Text>
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.heroName} numberOfLines={1}>{club.name}</Text>
              <Text style={styles.heroMeta} numberOfLines={1}>
                ⭐ {Number(club.rating || 0).toFixed(1)}
                {club.distance_km != null ? ` · ${club.distance_km} km` : ''}
                {club.music_styles?.length ? ` · ${club.music_styles.slice(0, 2).join(' / ')}` : ''}
              </Text>
            </View>
          </View>

          {/* Actions club */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={openItinerary} testID="tonight-itinerary">
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Itinéraire</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push(`/club/${club.club_id}` as any)}
              testID="tonight-see-club"
            >
              <Text style={styles.secondaryBtnText}>Voir le club</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shuffleBtn} onPress={shuffle} testID="tonight-shuffle" hitSlop={6}>
              <Ionicons name="shuffle" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {clubs.length > 1 && (
            <Text style={styles.shuffleHint}>
              Suggestion {clubIdx + 1}/{clubs.length} — appuie sur 🔀 pour changer
            </Text>
          )}

          {/* ── Amis à inviter ── */}
          <Text style={styles.sectionTitle}>Invite tes amis</Text>
          {friends.length === 0 ? (
            <View style={styles.noFriends}>
              <Text style={styles.noFriendsText}>
                Pas encore de matchs à inviter. Va faire des rencontres !
              </Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/(tabs)/swipe' as any)}
                testID="tonight-goto-swipe"
              >
                <Text style={styles.secondaryBtnText}>Découvrir du monde</Text>
              </TouchableOpacity>
            </View>
          ) : (
            friends.map((f) => {
              const isSel = selected.has(f.match_id);
              return (
                <TouchableOpacity
                  key={f.match_id}
                  style={styles.friendRow}
                  onPress={() => toggleFriend(f.match_id)}
                  activeOpacity={0.8}
                  testID={`tonight-friend-${f.match_id}`}
                >
                  {f.photo ? (
                    <Image source={{ uri: f.photo }} style={styles.friendAvatar} />
                  ) : (
                    <View style={[styles.friendAvatar, styles.friendFb]}>
                      <Ionicons name="person" size={20} color={colors.textTertiary} />
                    </View>
                  )}
                  <Text style={styles.friendName} numberOfLines={1}>{f.name}</Text>
                  <Ionicons
                    name={isSel ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={isSel ? colors.primary : colors.textTertiary}
                  />
                </TouchableOpacity>
              );
            })
          )}

          {/* CTA envoi */}
          {friends.length > 0 && (
            sent ? (
              <View style={styles.sentWrap}>
                <Text style={styles.sentText}>Invitations envoyées ✅</Text>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => router.replace('/(tabs)/chats' as any)}
                  testID="tonight-open-chats"
                >
                  <Text style={styles.secondaryBtnText}>Ouvrir les messages</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.sendBtn, (selected.size === 0 || sending) && styles.sendBtnDisabled]}
                onPress={sendInvites}
                disabled={selected.size === 0 || sending}
                testID="tonight-send-invites"
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color="#fff" />
                    <Text style={styles.sendBtnText}>
                {"Envoyer l'invitation"}{selected.size > 0 ? ` (${selected.size})` : ''}
              </Text>
                  </>
                )}
              </TouchableOpacity>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  emptyWrap: { alignItems: 'center', marginTop: 80, paddingHorizontal: 30 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  heroCard: {
    height: 220,
    borderRadius: radius.xl ?? 22,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,5,5,0.30)' },
  heroLive: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  heroLiveText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  heroBody: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  heroName: { color: '#fff', fontSize: 21, fontWeight: '900' },
  heroMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600', marginTop: 3 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 18,
    height: 46,
  },
  primaryBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 46,
  },
  secondaryBtnText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  shuffleBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  shuffleHint: { color: colors.textTertiary, fontSize: 12, marginTop: 8 },
  sectionTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', marginTop: 24, marginBottom: 10 },
  noFriends: { alignItems: 'flex-start', gap: 12 },
  noFriendsText: { color: colors.textSecondary, lineHeight: 20 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    minHeight: 56,
  },
  friendAvatar: { width: 46, height: 46, borderRadius: 23 },
  friendFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  friendName: { flex: 1, color: colors.textPrimary, fontSize: 15.5, fontWeight: '700' },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 52,
    marginTop: 16,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  sentWrap: { alignItems: 'flex-start', gap: 12, marginTop: 16 },
  sentText: { color: colors.textPrimary, fontSize: 15.5, fontWeight: '800' },
});
