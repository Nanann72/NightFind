import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api, FeedMoment, StoryHighlight, MomentComment } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const timeAgo = (iso: string): string => {
  const d = new Date(iso);
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
};

export default function MomentFeed() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [feed, setFeed] = useState<FeedMoment[]>([]);
  const [highlights, setHighlights] = useState<StoryHighlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openComments, setOpenComments] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [f, h] = await Promise.all([
        api.momentsFeed(30),
        api.momentsHighlights(),
      ]);
      setFeed(f.moments);
      setHighlights(h.highlights);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLike = async (m: FeedMoment) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Optimistic update
    setFeed((prev) => prev.map((x) => x.moment_id === m.moment_id
      ? { ...x, liked_by_me: !x.liked_by_me, likes_count: x.likes_count + (x.liked_by_me ? -1 : 1) }
      : x
    ));
    try {
      if (m.liked_by_me) await api.unlikeMoment(m.moment_id);
      else await api.likeMoment(m.moment_id);
    } catch {
      // rollback
      setFeed((prev) => prev.map((x) => x.moment_id === m.moment_id
        ? { ...x, liked_by_me: m.liked_by_me, likes_count: m.likes_count } : x
      ));
    }
  };

  const renderHighlight = ({ item: h }: { item: StoryHighlight }) => (
    <TouchableOpacity
      style={styles.hlItem}
      onPress={() => Alert.alert(h.user_name, `${h.moments_count} moment${h.moments_count > 1 ? 's' : ''} actif${h.moments_count > 1 ? 's' : ''}`)}
      testID={`highlight-${h.user_id}`}
      activeOpacity={0.85}
    >
      <View style={[styles.hlRing, h.is_self && styles.hlRingSelf]}>
        <View style={styles.hlInner}>
          {h.user_picture ? (
            <Image source={{ uri: h.user_picture }} style={styles.hlAvatar} />
          ) : (
            <View style={[styles.hlAvatar, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: colors.primary, fontSize: 22, fontWeight: '900' }}>
                {(h.user_name?.[0] ?? '?').toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.hlName} numberOfLines={1}>
        {h.is_self ? 'Toi' : h.user_name}
      </Text>
    </TouchableOpacity>
  );

  const renderMoment = ({ item: m }: { item: FeedMoment }) => (
    <Animated.View entering={FadeIn.duration(300)} style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        {m.user_picture ? (
          <Image source={{ uri: m.user_picture }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: colors.primary, fontWeight: '900' }}>{(m.user_name[0] ?? '?').toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{m.user_name}</Text>
          {m.club_name && <Text style={styles.headerClub} numberOfLines={1}>📍 {m.club_name}</Text>}
        </View>
        <Text style={styles.headerTime}>{timeAgo(m.created_at)}</Text>
      </View>

      {/* Photo (+ selfie overlay) */}
      <View style={styles.photoWrap}>
        <Image source={{ uri: m.image }} style={styles.photo} resizeMode="cover" />
        {m.selfie && (
          <Image source={{ uri: m.selfie }} style={styles.selfieOverlay} resizeMode="cover" />
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity onPress={() => toggleLike(m)} style={styles.actionBtn} testID={`like-${m.moment_id}`}>
          <Ionicons
            name={m.liked_by_me ? 'heart' : 'heart-outline'}
            size={26}
            color={m.liked_by_me ? colors.primary : colors.textPrimary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOpenComments(openComments === m.moment_id ? null : m.moment_id)}
          style={styles.actionBtn}
          testID={`comment-btn-${m.moment_id}`}
        >
          <Ionicons name="chatbubble-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Counts + caption */}
      <View style={styles.captionArea}>
        {m.likes_count > 0 && (
          <Text style={styles.likesCount}>{m.likes_count} j&apos;aime{m.likes_count > 1 ? 's' : ''}</Text>
        )}
        {m.caption ? (
          <Text style={styles.caption}>
            <Text style={styles.captionName}>{m.user_name}</Text>{' '}
            {m.caption}
          </Text>
        ) : null}
        {m.comments_count > 0 && (
          <TouchableOpacity onPress={() => setOpenComments(openComments === m.moment_id ? null : m.moment_id)}>
            <Text style={styles.viewComments}>Voir les {m.comments_count} commentaire{m.comments_count > 1 ? 's' : ''}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Comments inline block */}
      {openComments === m.moment_id && (
        <CommentsBlock momentId={m.moment_id} colors={colors} momentOwnerId={m.user_id} onCountChange={(n) => {
          setFeed((prev) => prev.map((x) => x.moment_id === m.moment_id ? { ...x, comments_count: n } : x));
        }} />
      )}
    </Animated.View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="feed-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Live</Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
          <Ionicons name="refresh" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(m) => m.moment_id}
          renderItem={renderMoment}
          ListHeaderComponent={
            highlights.length > 0 ? (
              <Animated.View entering={FadeInDown.duration(400)} style={styles.hlBar}>
                <FlatList
                  horizontal
                  data={highlights}
                  keyExtractor={(h) => h.user_id}
                  renderItem={renderHighlight}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 10 }}
                />
              </Animated.View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            !loading ? (
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Ionicons name="camera-outline" size={40} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Aucun moment live pour le moment</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function CommentsBlock({
  momentId,
  colors,
  momentOwnerId,
  onCountChange,
}: {
  momentId: string;
  colors: ThemeColors;
  momentOwnerId?: string;
  onCountChange?: (n: number) => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<MomentComment[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const s = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.momentComments(momentId);
        setComments(res.comments);
      } catch {}
      setLoading(false);
    })();
  }, [momentId]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const c = await api.addMomentComment(momentId, t);
      setComments((prev) => {
        const next = [...prev, c];
        onCountChange?.(next.length);
        return next;
      });
      setText('');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Échec');
    } finally { setSending(false); }
  };

  const remove = async (c: MomentComment) => {
    Alert.alert('Supprimer ce commentaire ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try {
          await api.deleteMomentComment(momentId, c.comment_id);
          setComments((prev) => {
            const next = prev.filter((x) => x.comment_id !== c.comment_id);
            onCountChange?.(next.length);
            return next;
          });
        } catch {}
      } },
    ]);
  };

  return (
    <View style={s.commentsWrap}>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} />
      ) : comments.length === 0 ? (
        <Text style={s.noComments}>Aucun commentaire</Text>
      ) : (
        comments.map((c) => (
          <TouchableOpacity
            key={c.comment_id}
            onLongPress={() =>
              (c.user_id === user?.user_id || momentOwnerId === user?.user_id) && remove(c)
            }
            style={s.commentRow}
            activeOpacity={0.8}
          >
            <Text style={s.commentName}>{c.user_name}</Text>
            <Text style={s.commentText}> {c.text}</Text>
          </TouchableOpacity>
        ))
      )}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.commentInputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ajouter un commentaire…"
            placeholderTextColor={colors.textTertiary}
            style={s.commentInput}
            maxLength={280}
            testID={`comment-input-${momentId}`}
          />
          <TouchableOpacity onPress={send} disabled={!text.trim() || sending} testID={`comment-send-${momentId}`}>
            <Text style={[s.postBtn, (!text.trim() || sending) && { opacity: 0.4 }]}>Publier</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingBottom: 8, gap: 6,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5, flex: 1 },
  hlBar: {
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingVertical: 12,
  },
  hlItem: { width: 74, alignItems: 'center', gap: 6 },
  hlRing: {
    width: 66, height: 66, borderRadius: 33,
    padding: 3,
    backgroundColor: colors.primary,
  },
  hlRingSelf: { backgroundColor: colors.tertiary ?? '#00D9FF' },
  hlInner: {
    flex: 1, borderRadius: 30,
    padding: 2, backgroundColor: colors.bg,
  },
  hlAvatar: { flex: 1, borderRadius: 28 },
  hlName: { color: colors.textPrimary, fontSize: 11, maxWidth: 74, fontWeight: '600' },
  card: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: 8,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 10, gap: 10,
  },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerName: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  headerClub: { color: colors.textSecondary, fontSize: 11 },
  headerTime: { color: colors.textSecondary, fontSize: 12 },
  photoWrap: { position: 'relative', width: '100%', aspectRatio: 1 },
  photo: { width: '100%', height: '100%', backgroundColor: colors.surface },
  selfieOverlay: {
    position: 'absolute', top: 12, left: 12,
    width: '28%', aspectRatio: 3 / 4, borderRadius: 12,
    borderWidth: 2, borderColor: '#fff',
    backgroundColor: colors.surface,
  },
  actionsRow: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 8, gap: 6 },
  actionBtn: { padding: 6 },
  captionArea: { paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: 12, gap: 4 },
  likesCount: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  caption: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  captionName: { fontWeight: '800' },
  viewComments: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  commentsWrap: {
    paddingHorizontal: spacing.md, paddingBottom: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
    marginTop: 4, paddingTop: 8, gap: 6,
  },
  noComments: { color: colors.textSecondary, fontSize: 12, fontStyle: 'italic', textAlign: 'center' },
  commentRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 3, flexWrap: 'wrap' },
  commentName: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  commentText: { color: colors.textPrimary, fontSize: 13, flex: 1 },
  commentInputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 6, borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: 8,
  },
  commentInput: {
    flex: 1, color: colors.textPrimary, fontSize: 13,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  postBtn: { color: colors.primary, fontWeight: '900', fontSize: 13 },
});
