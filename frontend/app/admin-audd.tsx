import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

type AuddStatus = Awaited<ReturnType<typeof api.adminAuddStatus>>;
type AuddProbe = Awaited<ReturnType<typeof api.adminAuddProbe>>;

const SAMPLE_MS = 12000; // 12s — Audd recommended for club noise

export default function AdminAuddDiagnostic() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [status, setStatus] = useState<AuddStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<AuddProbe | null>(null);
  const [recordProgress, setRecordProgress] = useState(0);

  // Non-admin safety
  useEffect(() => {
    if (user && !user.is_admin) router.replace('/(tabs)');
  }, [user, router]);

  const loadStatus = async () => {
    setLoadingStatus(true);
    try {
      const s = await api.adminAuddStatus();
      setStatus(s);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de charger le statut');
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const runProbe = async () => {
    if (Platform.OS === 'web') {
      Alert.alert(
        'Non disponible',
        "Le test micro nécessite l'app native (iOS/Android). Utilise Expo Go ou un build de développement pour tester.",
      );
      return;
    }
    setProbing(true);
    setProbe(null);
    setRecordProgress(0);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ExpoAudio = require('expo-audio');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AudioModule = require('expo-audio/build/AudioModule').default;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const FileSystem = require('expo-file-system');

      const permission = await ExpoAudio.requestRecordingPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert('Micro refusé', 'Autorise le micro dans les Réglages puis réessaie.');
        setProbing(false);
        return;
      }
      await ExpoAudio.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      const RecorderClass =
        AudioModule?.AudioRecorder ||
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-audio').AudioRecorder;
      const recorder = new RecorderClass(ExpoAudio.RecordingPresets.HIGH_QUALITY);
      await recorder.prepareToRecordAsync();
      recorder.record();

      // Progress
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const pct = Math.min(1, (Date.now() - startedAt) / SAMPLE_MS);
        setRecordProgress(pct);
      }, 100);

      await new Promise((r) => setTimeout(r, SAMPLE_MS));
      clearInterval(timer);
      setRecordProgress(1);
      await recorder.stop();
      const uri: string | null = recorder.uri;
      if (!uri) throw new Error("Impossible d'enregistrer l'audio");

      let base64 = '';
      if (FileSystem?.File) {
        const file = new FileSystem.File(uri);
        base64 = await file.base64();
      } else if (typeof FileSystem?.readAsStringAsync === 'function') {
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });
      }
      if (!base64) throw new Error('Fichier audio vide');

      const res = await api.adminAuddProbe(base64);
      setProbe(res);
      // Refresh recent list after probe (not persisted here, but keep the list fresh)
      loadStatus();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Échec du test');
    } finally {
      setProbing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="audd-back">
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Diagnostic Audd.io</Text>
          <Text style={styles.subtitle}>Test de reconnaissance musicale</Text>
        </View>
        <TouchableOpacity onPress={loadStatus} style={styles.iconBtn} testID="audd-refresh">
          <Ionicons name="refresh" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Config */}
        <Text style={styles.section}>Configuration</Text>
        {loadingStatus ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : status ? (
          <View style={styles.card}>
            <Row
              label="Token API"
              value={status.configured ? status.token_preview || '••••' : 'Absent'}
              ok={status.configured}
              colors={colors}
            />
            <Row
              label="Chansons reconnues (total)"
              value={String(status.total_songs)}
              colors={colors}
            />
            {!status.configured && (
              <Text style={styles.warn}>
                Ajoute la variable AUDD_API_TOKEN dans /app/backend/.env puis redémarre le backend.
              </Text>
            )}
          </View>
        ) : null}

        {/* Probe */}
        <Text style={styles.section}>Test live micro</Text>
        <View style={styles.card}>
          <Text style={styles.info}>
            Cette action va enregistrer {SAMPLE_MS / 1000}s d&apos;audio via le micro,
            l&apos;envoyer à Audd.io et te renvoyer la réponse BRUTE. Elle ne
            persiste rien dans ton profil.
          </Text>

          {probing && (
            <View style={{ marginTop: 12 }}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.round(recordProgress * 100)}%` }]} />
              </View>
              <Text style={styles.progressText}>
                Enregistrement… {Math.round(recordProgress * (SAMPLE_MS / 1000))}s / {SAMPLE_MS / 1000}s
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={runProbe}
            disabled={probing || !status?.configured}
            style={[
              styles.probeBtn,
              (probing || !status?.configured) && { opacity: 0.5 },
            ]}
            activeOpacity={0.85}
            testID="audd-probe-btn"
          >
            {probing ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.probeBtnText}>Enregistrement en cours…</Text>
              </>
            ) : (
              <>
                <Ionicons name="mic" size={22} color="#fff" />
                <Text style={styles.probeBtnText}>Lancer un test de {SAMPLE_MS / 1000}s</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === 'web' && (
            <Text style={styles.warn}>
              ⚠️ Le test micro n&apos;est pas disponible sur le web preview. Utilise l&apos;app iOS/Android.
            </Text>
          )}
        </View>

        {/* Probe result */}
        {probe && (
          <Animated.View entering={FadeInDown.springify().damping(18)}>
            <Text style={styles.section}>Résultat du test</Text>
            <View
              style={[
                styles.card,
                {
                  borderColor: probe.recognised
                    ? '#34C759'
                    : probe.error
                    ? colors.danger
                    : colors.border,
                  borderWidth: 2,
                },
              ]}
            >
              <View style={styles.resultHeader}>
                <Ionicons
                  name={probe.recognised ? 'checkmark-circle' : probe.error ? 'close-circle' : 'help-circle'}
                  size={28}
                  color={probe.recognised ? '#34C759' : probe.error ? colors.danger : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.resultTitle,
                    { color: probe.recognised ? '#34C759' : probe.error ? colors.danger : colors.textPrimary },
                  ]}
                >
                  {probe.recognised
                    ? 'Musique reconnue ✓'
                    : probe.error
                    ? 'Erreur Audd.io'
                    : 'Aucune correspondance'}
                </Text>
              </View>

              {probe.summary && (
                <View style={{ marginTop: 10, gap: 4 }}>
                  <Text style={styles.trackTitle}>{probe.summary.title || 'Sans titre'}</Text>
                  {probe.summary.artist ? (
                    <Text style={styles.trackArtist}>{probe.summary.artist}</Text>
                  ) : null}
                  {probe.summary.album ? (
                    <Text style={styles.trackMeta}>Album : {probe.summary.album}</Text>
                  ) : null}
                  {probe.summary.release_date ? (
                    <Text style={styles.trackMeta}>Sortie : {probe.summary.release_date}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {probe.summary.spotify_url ? (
                      <LinkBtn
                        label="Spotify"
                        icon="musical-note"
                        color="#1DB954"
                        url={probe.summary.spotify_url}
                        colors={colors}
                      />
                    ) : null}
                    {probe.summary.apple_music_url ? (
                      <LinkBtn
                        label="Apple Music"
                        icon="musical-notes"
                        color="#FA243C"
                        url={probe.summary.apple_music_url}
                        colors={colors}
                      />
                    ) : null}
                  </View>
                </View>
              )}

              {probe.error && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.errCode}>Code {probe.error.error_code}</Text>
                  <Text style={styles.errMsg}>{probe.error.error_message}</Text>
                </View>
              )}

              {probe.message && !probe.error && !probe.summary && (
                <Text style={styles.warn}>{probe.message}</Text>
              )}

              {/* Stats */}
              <View style={styles.statsGrid}>
                <StatCell label="Taille" value={fmtBytes(probe.sample_bytes)} colors={colors} />
                <StatCell
                  label="Latence"
                  value={probe.elapsed_ms != null ? `${probe.elapsed_ms}ms` : '—'}
                  colors={colors}
                />
                <StatCell
                  label="HTTP"
                  value={probe.http_status != null ? String(probe.http_status) : '—'}
                  colors={colors}
                />
                <StatCell
                  label="Statut"
                  value={probe.audd_status || (probe.recognised ? 'success' : '—')}
                  colors={colors}
                />
              </View>
            </View>
          </Animated.View>
        )}

        {/* Recent recognitions */}
        <Text style={styles.section}>Dernières reconnaissances (base)</Text>
        {status && status.recent_songs.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.info}>Aucune chanson reconnue pour le moment.</Text>
          </View>
        ) : (
          status?.recent_songs.map((s, i) => (
            <Animated.View
              key={s.song_id}
              entering={FadeIn.delay(i * 40)}
              style={styles.songRow}
            >
              <Ionicons name="musical-note" size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.songTitle} numberOfLines={1}>
                  {s.title || 'Sans titre'}
                  {s.artist ? ` — ${s.artist}` : ''}
                </Text>
                <Text style={styles.songMeta} numberOfLines={1}>
                  {s.club_name || 'Scan manuel'} · {fmtDate(s.detected_at)}
                </Text>
              </View>
            </Animated.View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ------------------ helpers & subcomponents ------------------

function fmtBytes(n: number): string {
  if (!n) return '0';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(2)} Mo`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function Row({
  label,
  value,
  ok,
  colors,
}: {
  label: string;
  value: string;
  ok?: boolean;
  colors: ThemeColors;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {ok !== undefined && (
          <Ionicons
            name={ok ? 'checkmark-circle' : 'close-circle'}
            size={14}
            color={ok ? '#34C759' : colors.danger}
          />
        )}
        <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{value}</Text>
      </View>
    </View>
  );
}

function StatCell({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ThemeColors;
}) {
  return (
    <View style={{ flex: 1, minWidth: '46%', alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function LinkBtn({
  label,
  icon,
  color,
  url,
  colors,
}: {
  label: string;
  icon: any;
  color: string;
  url: string;
  colors: ThemeColors;
}) {
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url).catch(() => {})}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: color + '22',
        borderWidth: 1,
        borderColor: color + '55',
      }}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: 10,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: colors.textSecondary, fontSize: 12 },
    scroll: { padding: spacing.md, paddingBottom: 60 },
    section: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    info: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    warn: {
      color: colors.danger,
      fontSize: 12,
      marginTop: 8,
      lineHeight: 16,
    },
    progressBar: {
      height: 8,
      backgroundColor: colors.surfaceElevated,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
    },
    progressText: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 6,
      textAlign: 'center',
    },
    probeBtn: {
      marginTop: 14,
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    probeBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    resultHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    resultTitle: { fontSize: 16, fontWeight: '800' },
    trackTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
    trackArtist: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
    trackMeta: { color: colors.textTertiary, fontSize: 12 },
    errCode: { color: colors.danger, fontSize: 12, fontWeight: '800' },
    errMsg: { color: colors.textPrimary, fontSize: 13, marginTop: 2 },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    songRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    songTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    songMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  });
