import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, ZoomIn, FadeInDown } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

const { width } = Dimensions.get('window');

export default function MatchRequests() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [matchModal, setMatchModal] = useState<{ matchId: string; name: string; photo?: string } | null>(null);
  const { user } = useAuth();
  const myPhoto = ((user as any)?.photos || [])[0] || (user as any)?.picture || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listMatchRequests();
      setItems(r || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onAccept = async (req: any) => {
    setBusy(req.request_id);
    try {
      const r = await api.acceptMatch(req.request_id);
      setItems((x) => x.filter((it) => it.request_id !== req.request_id));
      setMatchModal({
        matchId: r.match_id,
        name: req.name,
        photo: (req.photos || [])[0],
      });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Action impossible.');
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (req: any) => {
    setBusy(req.request_id);
    try {
      await api.rejectMatch(req.request_id);
      setItems((x) => x.filter((it) => it.request_id !== req.request_id));
    } catch {
      // ignore
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Demandes reçues</Text>
        <TouchableOpacity onPress={() => router.push('/matches')} testID="goto-matches">
          <Text style={styles.headerLink}>Mes matches</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.request_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
          ) : (
            <Text style={styles.empty}>Aucune demande pour l'instant. Continue à swiper 💫</Text>
          )
        }
        renderItem={({ item }) => {
          const photo = (item.photos || [])[0];
          return (
            <View style={styles.card}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.photo} />
              ) : (
                <View style={[styles.photo, styles.photoFb]}>
                  <Ionicons name="person" size={48} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.gradient} />
              <View style={styles.info}>
                <Text style={styles.name}>
                  {item.name}
                  {item.age != null ? `, ${item.age}` : ''}
                </Text>
                {!!item.city && <Text style={styles.city}>{item.city}</Text>}
                {!!item.bio && (
                  <Text style={styles.bio} numberOfLines={2}>
                    {item.bio}
                  </Text>
                )}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPass]}
                    onPress={() => onReject(item)}
                    disabled={busy === item.request_id}
                    testID={`mr-reject-${item.request_id}`}
                    accessibilityLabel={`Refuser la demande de ${item.name || 'cette personne'}`}
                    accessibilityRole="button"
                  >
                    {busy === item.request_id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="close" size={20} color="#fff" />
                        <Text style={styles.btnText}>Refuser</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnLike]}
                    onPress={() => onAccept(item)}
                    disabled={busy === item.request_id}
                    testID={`mr-accept-${item.request_id}`}
                    accessibilityLabel={`Accepter le match avec ${item.name || 'cette personne'}`}
                    accessibilityRole="button"
                  >
                    {busy === item.request_id ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="heart" size={20} color="#fff" />
                        <Text style={styles.btnText}>Accepter</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={!!matchModal} transparent animationType="fade" onRequestClose={() => setMatchModal(null)}>
        <Animated.View entering={FadeIn.duration(300)} style={styles.matchOverlay}>
          <Animated.Text entering={ZoomIn.delay(100).duration(500)} style={styles.matchTitle}>
            MATCH
          </Animated.Text>
          <Animated.View entering={ZoomIn.delay(250).duration(500)} style={styles.avatarsRow}>
            {myPhoto ? (
              <Image source={{ uri: myPhoto }} style={styles.matchAvatar} />
            ) : (
              <View style={[styles.matchAvatar, styles.matchAvatarFb]}>
                <Ionicons name="person" size={48} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.matchHeart}>
              <Ionicons name="heart" size={28} color="#fff" />
            </View>
            {matchModal?.photo ? (
              <Image source={{ uri: matchModal.photo }} style={styles.matchAvatar} />
            ) : (
              <View style={[styles.matchAvatar, styles.matchAvatarFb]}>
                <Ionicons name="person" size={48} color={colors.textTertiary} />
              </View>
            )}
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(450).duration(500)} style={styles.matchHeadline}>
            C'est un <Text style={{ color: colors.primary }}>match</Text> !
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(550).duration(500)} style={styles.matchSub}>
            Vous vous êtes aimés tous les deux. Lance la conversation avec {matchModal?.name}.
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(700).duration(450)} style={{ marginTop: 28, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.matchCta}
              onPress={() => {
                const id = matchModal?.matchId;
                setMatchModal(null);
                if (id) router.push(`/chat/${id}`);
              }}
              testID="match-send-message"
            >
              <Text style={styles.matchCtaText}>Envoyer un message</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.matchSecondary}
              onPress={() => setMatchModal(null)}
              testID="match-continue-swipe"
            >
              <Text style={styles.matchSecondaryText}>Continuer à swiper</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  headerLink: { color: colors.primary, fontWeight: '900', fontSize: 13 },
  card: {
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    height: 360,
  },
  photo: { width: '100%', height: '100%', position: 'absolute' },
  photoFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  info: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  name: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  city: { color: 'rgba(255,255,255,0.8)', marginTop: 2, fontSize: 13 },
  bio: { color: 'rgba(255,255,255,0.9)', marginTop: 6, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.full,
  },
  btnPass: { backgroundColor: '#ef4444' },
  btnLike: { backgroundColor: '#22c55e' },
  btnText: { color: '#fff', fontWeight: '900' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 60, paddingHorizontal: 30 },
  // Match Celebration Modal
  matchOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 6, 22, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  matchTitle: {
    color: colors.primary,
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: 6,
    textShadowColor: 'rgba(255, 56, 196, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
    marginBottom: 36,
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 32,
  },
  matchAvatar: {
    width: width * 0.32,
    height: width * 0.32,
    borderRadius: width * 0.16,
    borderWidth: 4,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
  },
  matchAvatarFb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchHeart: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -14,
    zIndex: 2,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
    elevation: 12,
  },
  matchHeadline: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: -0.5,
  },
  matchSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
  matchCta: {
    width: '100%',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  matchCtaText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  matchSecondary: {
    paddingVertical: 14,
    marginTop: 6,
  },
  matchSecondaryText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '700',
    fontSize: 14,
  },
});
