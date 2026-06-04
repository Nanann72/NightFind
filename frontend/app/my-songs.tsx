import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

type ClubGroup = {
  club_id: string;
  club_name: string;
  songs: {
    song_id: string;
    title: string;
    artist?: string | null;
    detected_at?: string;
    source?: string;
  }[];
};

export default function MySongs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ClubGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listProfileSongs();
      setData(res.clubs);
      setTotal(res.total);
      // expand the first one by default
      if (res.clubs.length) {
        setExpanded({ [res.clubs[0].club_id]: true });
      }
    } catch {
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = (songId: string) => {
    Alert.alert('Supprimer ce morceau ?', '', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteProfileSong(songId);
            load();
          } catch {}
        },
      },
    ]);
  };

  const formatWhen = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="my-songs-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="songs-back-btn">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Mes musiques</Text>
          <Text style={styles.subtitle}>{total} morceaux capturés</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
        }
      >
        {loading && data.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : data.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>Aucun morceau encore</Text>
            <Text style={styles.emptyText}>
              Confirme ta présence dans un club pour activer la reconnaissance musicale en direct.
            </Text>
          </View>
        ) : (
          data.map((group) => {
            const isOpen = !!expanded[group.club_id];
            return (
              <View key={group.club_id} style={styles.clubBlock}>
                <TouchableOpacity
                  style={styles.clubHeader}
                  onPress={() =>
                    setExpanded((p) => ({ ...p, [group.club_id]: !p[group.club_id] }))
                  }
                  activeOpacity={0.8}
                  testID={`songs-club-${group.club_id}`}
                >
                  <View style={styles.clubIconWrap}>
                    <Ionicons name="musical-notes" size={18} color={colors.tertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clubName}>{group.club_name}</Text>
                    <Text style={styles.clubCount}>
                      {group.songs.length} morceau{group.songs.length > 1 ? 'x' : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.songsList}>
                    {group.songs.map((s) => (
                      <TouchableOpacity
                        key={s.song_id}
                        style={styles.songRow}
                        onLongPress={() => handleDelete(s.song_id)}
                        testID={`song-${s.song_id}`}
                      >
                        <View style={styles.songIcon}>
                          <Ionicons name="play" size={12} color={colors.bg} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.songTitle} numberOfLines={1}>
                            {s.title}
                          </Text>
                          <Text style={styles.songArtist} numberOfLines={1}>
                            {s.artist || 'Artiste inconnu'} · {formatWhen(s.detected_at)}
                          </Text>
                        </View>
                        {s.source === 'auto' ? (
                          <View style={styles.autoBadge}>
                            <Ionicons name="radio" size={9} color={colors.tertiary} />
                            <Text style={styles.autoText}>AUTO</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
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
    paddingVertical: 12,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: colors.textTertiary, fontSize: 12, marginTop: 2, textAlign: 'center' },

  clubBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    overflow: 'hidden',
  },
  clubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  clubIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(34,211,238,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubName: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  clubCount: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  songsList: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  songIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  songArtist: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  autoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,211,238,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  autoText: { color: colors.tertiary, fontSize: 9, fontWeight: '900', letterSpacing: 1 },

  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: spacing.xl },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
