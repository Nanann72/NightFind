/**
 * Hub "Likes" — Tinder-like.
 *  Onglets : ❤ Likes reçus · ⭐ Super Likes · 💬 Demandes de messages.
 *  Non-premium : photos floutées + CTA Premium (comme Tinder Gold).
 *  Premium : like back / passer directement depuis la grille.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

type Tab = 'likes' | 'superlikes' | 'requests';

function photoUri(p?: string | null): string | null {
  if (!p || typeof p !== 'string' || p.trim().length < 16) return null;
  return p.startsWith('http') || p.startsWith('data:') ? p : `data:image/jpeg;base64,${p}`;
}

export default function LikesHub() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('likes');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.likesHub();
      setData(d);
    } catch {
      /* offline banner handles it */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const likeBack = async (p: any) => {
    if (busyId) return;
    setBusyId(p.user_id);
    try {
      const res: any = await api.swipeLike(p.user_id);
      if (res?.match) {
        Alert.alert("C'est un match ! 🎉", `Toi et ${p.name} vous êtes likés — envoie-lui un message !`);
      }
      load();
    } catch (e: any) {
      Alert.alert('Oups', e?.message || 'Réessaie.');
    } finally {
      setBusyId(null);
    }
  };

  const pass = async (p: any) => {
    if (busyId) return;
    setBusyId(p.user_id);
    try {
      await api.swipePass(p.user_id);
      load();
    } catch {
      /* noop */
    } finally {
      setBusyId(null);
    }
  };

  const respondRequest = async (p: any, accept: boolean) => {
    if (busyId) return;
    setBusyId(p.user_id);
    try {
      if (accept) {
        const r: any = await api.acceptMatch(p.request_id || p.user_id);
        if (r?.match_id) router.push(`/chat/${r.match_id}` as any);
      } else {
        await api.rejectMatch(p.request_id || p.user_id);
      }
      load();
    } catch (e: any) {
      Alert.alert('Oups', e?.message || 'Réessaie.');
    } finally {
      setBusyId(null);
    }
  };

  const isPremium = !!data?.is_premium;
  const list: any[] =
    tab === 'likes' ? data?.likes ?? [] : tab === 'superlikes' ? data?.superlikes ?? [] : data?.requests ?? [];

  const renderCard = ({ item: p }: { item: any }) => {
    const uri = photoUri(p.photos?.[0]);
    const locked = !isPremium && tab !== 'requests';
    return (
      <View style={styles.card} testID={`hub-card-${p.user_id}`}>
        {uri ? (
          <Image source={{ uri }} style={styles.cardImg} blurRadius={locked ? 24 : 0} />
        ) : (
          <View style={[styles.cardImg, styles.cardImgFb]}>
            <Text style={styles.cardInitial}>{(p.name?.[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
        {locked ? (
          <View style={styles.lockOverlay}>
            <Ionicons name="lock-closed" size={22} color="#fff" />
          </View>
        ) : (
          <>
            <View style={styles.cardGradient} />
            <View style={styles.cardInfo}>
              <Text style={styles.cardName} numberOfLines={1}>
                {p.name}{p.age ? `, ${p.age}` : ''}
              </Text>
              {p.superlike || tab === 'superlikes' ? (
                <Text style={styles.superTag}>⭐ Super Like</Text>
              ) : null}
              {tab === 'requests' && p.message ? (
                <Text style={styles.reqMsg} numberOfLines={2}>« {p.message} »</Text>
              ) : null}
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={[styles.roundBtn, styles.passBtn]}
                onPress={() => (tab === 'requests' ? respondRequest(p, false) : pass(p))}
                disabled={busyId === p.user_id}
                testID={`hub-pass-${p.user_id}`}
              >
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roundBtn, styles.likeBtn]}
                onPress={() => (tab === 'requests' ? respondRequest(p, true) : likeBack(p))}
                disabled={busyId === p.user_id}
                testID={`hub-like-${p.user_id}`}
              >
                {busyId === p.user_id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name={tab === 'requests' ? 'chatbubble' : 'heart'} size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );
  };

  const TabBtn = ({ id, label, count }: { id: Tab; label: string; count: number }) => (
    <TouchableOpacity
      style={[styles.tabBtn, tab === id && styles.tabBtnActive]}
      onPress={() => setTab(id)}
      testID={`hub-tab-${id}`}
    >
      <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>
        {label}{count > 0 ? ` · ${count}` : ''}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="likes-hub-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="hub-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Likes ❤️</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.tabsRow}>
        <TabBtn id="likes" label="Likes" count={data?.likes_count ?? 0} />
        <TabBtn id="superlikes" label="⭐ Super" count={data?.superlikes_count ?? 0} />
        <TabBtn id="requests" label="💬 Demandes" count={data?.requests?.length ?? 0} />
      </View>

      {!isPremium && tab !== 'requests' && (data?.likes_count ?? 0) + (data?.superlikes_count ?? 0) > 0 && (
        <TouchableOpacity
          style={styles.premiumCta}
          onPress={() => router.push('/paywall' as any)}
          testID="hub-premium-cta"
        >
          <Ionicons name="diamond" size={16} color="#FFD700" />
          <Text style={styles.premiumCtaText}>
            {data?.likes_count ?? 0} personnes t&apos;ont liké — passe Premium pour les découvrir
          </Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.user_id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: spacing.lg, gap: 12, paddingBottom: 60 }}
          renderItem={renderCard}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>
                {tab === 'likes' ? '💘' : tab === 'superlikes' ? '⭐' : '💬'}
              </Text>
              <Text style={styles.emptyTitle}>
                {tab === 'requests' ? 'Aucune demande pour le moment' : 'Personne pour le moment'}
              </Text>
              <Text style={styles.emptyText}>
                Continue de swiper — plus tu es actif, plus ton profil est mis en avant 🚀
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, marginTop: 4 },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    minHeight: 38, justifyContent: 'center',
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  premiumCta: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: spacing.lg, marginTop: 12,
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: '#FFD70055',
    borderRadius: radius.lg, padding: 12, minHeight: 44,
  },
  premiumCtaText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700', flex: 1 },
  card: {
    flex: 1, aspectRatio: 0.72, borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: colors.surfaceElevated, position: 'relative',
  },
  cardImg: { width: '100%', height: '100%' },
  cardImgFb: { alignItems: 'center', justifyContent: 'center' },
  cardInitial: { color: colors.primary, fontSize: 42, fontWeight: '900' },
  cardGradient: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cardInfo: { position: 'absolute', left: 10, right: 10, bottom: 52 },
  cardName: { color: '#fff', fontWeight: '900', fontSize: 15 },
  superTag: { color: '#7dd3fc', fontSize: 11.5, fontWeight: '800', marginTop: 2 },
  reqMsg: { color: '#E4E4E7', fontSize: 11, marginTop: 3 },
  cardActions: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 14,
  },
  roundBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
  },
  passBtn: { backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: '#ffffff44' },
  likeBtn: { backgroundColor: colors.primary },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 46 },
  emptyTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, marginTop: 12 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },
});
