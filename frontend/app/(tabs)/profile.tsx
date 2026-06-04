import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../lib/auth';
import { useClubs } from '../../lib/clubs';
import { api } from '../../lib/api';
import { usePremium } from '../../lib/premium';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../../lib/backgroundLocation';
import { storage } from '../../lib/storage';
import { colors, radius, spacing } from '../../lib/theme';

const BG_PREF_KEY = 'nf_bg_location_enabled';

const MUSIC_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: 'techno', label: 'Techno', emoji: '⚡️' },
  { id: 'house', label: 'House', emoji: '🏠' },
  { id: 'hip-hop', label: 'Hip-Hop', emoji: '🎤' },
  { id: 'rnb', label: 'RnB', emoji: '💜' },
  { id: 'afro-house', label: 'Afro', emoji: '🥁' },
  { id: 'latin', label: 'Latin', emoji: '💃' },
  { id: 'disco', label: 'Disco', emoji: '🕺' },
  { id: 'electronic', label: 'Électro', emoji: '🌌' },
  { id: 'jazz', label: 'Jazz', emoji: '🎷' },
  { id: 'soul', label: 'Soul', emoji: '🎶' },
];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const { favorites, clubs } = useClubs();
  const { isPremium, devMode, devReset, customerInfo } = usePremium();
  const [editingName, setEditingName] = useState(false);
  const [editingMusic, setEditingMusic] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingMusic, setSavingMusic] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name || '');
  const [musicDraft, setMusicDraft] = useState<string[]>(user?.music_prefs || []);
  const [bgLocation, setBgLocation] = useState(false);
  const [togglingBg, setTogglingBg] = useState(false);

  useEffect(() => {
    setNameDraft(user?.name || '');
    setMusicDraft(user?.music_prefs || []);
  }, [user?.name, user?.music_prefs]);

  useEffect(() => {
    (async () => {
      const v = await storage.get(BG_PREF_KEY);
      setBgLocation(v === '1');
    })();
  }, []);

  const toggleBg = async (value: boolean) => {
    setTogglingBg(true);
    try {
      if (value) {
        const res = await startBackgroundLocation();
        if (res.ok) {
          setBgLocation(true);
          await storage.set(BG_PREF_KEY, '1');
          if (res.mode === 'foreground') {
            Alert.alert(
              'Activé en mode foreground',
              "L'arrière-plan nécessite un build natif. Pour l'instant, la détection fonctionne quand l'app est ouverte.\n\n💡 Clique sur 'Publish' depuis Emergent pour générer le build iOS et activer le mode arrière-plan complet.",
            );
          }
          return;
        }
        // ok === false
        if (res.reason === 'web') {
          Alert.alert(
            'Disponible sur mobile uniquement',
            "Cette fonctionnalité nécessite un téléphone (iOS ou Android). Ouvre l'app sur ton mobile via Expo Go ou un build natif.",
          );
        } else if (res.reason === 'foreground_denied') {
          Alert.alert(
            'Permission de localisation refusée',
            'Active la localisation pour Night Finder dans les réglages iOS/Android.',
            [
              { text: 'Plus tard', style: 'cancel' },
              { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert('Erreur', "Impossible d'activer la détection. Réessaie plus tard.");
        }
        setBgLocation(false);
        await storage.set(BG_PREF_KEY, '0');
      } else {
        await stopBackgroundLocation();
        setBgLocation(false);
        await storage.set(BG_PREF_KEY, '0');
      }
    } finally {
      setTogglingBg(false);
    }
  };

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@]/)
    .filter(Boolean)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const favCount = favorites.size;

  const saveName = async () => {
    if (!nameDraft.trim()) return;
    setSavingName(true);
    try {
      await api.updateProfile({ name: nameDraft.trim() });
      await refresh();
      setEditingName(false);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de sauvegarder.');
    } finally {
      setSavingName(false);
    }
  };

  const saveMusic = async () => {
    setSavingMusic(true);
    try {
      await api.updateProfile({ music_prefs: musicDraft });
      await refresh();
      setEditingMusic(false);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de sauvegarder.');
    } finally {
      setSavingMusic(false);
    }
  };

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

  const userPrefs = user?.music_prefs || [];

  return (
    <>
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
          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => {
              setNameDraft(user?.name || '');
              setEditingName(true);
            }}
            testID="edit-name-btn"
          >
            <Text style={styles.name}>{user?.name || 'Invité'}</Text>
            <Ionicons name="pencil" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.email}>{user?.email || ''}</Text>
        </View>

        <View style={styles.statsRow}>
          <Stat label="Favoris" value={favCount} testID="stat-favorites" />
          <Stat label="Clubs" value={clubs.length} testID="stat-clubs" />
          <Stat label="Préférences" value={userPrefs.length} testID="stat-prefs" />
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
          <Row
            icon="calendar"
            label="Soirées à venir"
            onPress={() => router.push('/(tabs)/events')}
            testID="row-events"
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Préférences musicales</Text>
            <TouchableOpacity
              onPress={() => {
                setMusicDraft(userPrefs);
                setEditingMusic(true);
              }}
              testID="edit-music-btn"
            >
              <Text style={styles.sectionAction}>Modifier</Text>
            </TouchableOpacity>
          </View>
          {userPrefs.length === 0 ? (
            <TouchableOpacity
              style={styles.prefsEmpty}
              onPress={() => {
                setMusicDraft([]);
                setEditingMusic(true);
              }}
              testID="add-music-prefs-btn"
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.tertiary} />
              <Text style={styles.prefsEmptyText}>
                Ajoute tes styles préférés pour des recommandations
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.tags}>
              {userPrefs.map((m) => {
                const opt = MUSIC_OPTIONS.find((o) => o.id === m);
                return (
                  <View key={m} style={styles.tag}>
                    <Text style={styles.tagEmoji}>{opt?.emoji || '🎵'}</Text>
                    <Text style={styles.tagText}>{opt?.label || m}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.premiumCard, isPremium && styles.premiumCardActive]}
            onPress={() => router.push('/paywall')}
            testID="premium-card"
          >
            <View style={styles.premiumIconWrap}>
              <Ionicons
                name={isPremium ? 'diamond' : 'diamond-outline'}
                size={26}
                color={isPremium ? '#FFD700' : colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>
                {isPremium ? 'Night Finder Premium' : 'Passer en Premium'}
              </Text>
              <Text style={styles.premiumSub}>
                {isPremium
                  ? `Actif${devMode ? ' (DEV)' : ''} • Swipes illimités, rayon 200km`
                  : 'Swipes illimités • Rayon 200km • Sans pub'}
              </Text>
            </View>
            {isPremium ? (
              <View style={styles.premiumBadge}>
                <Text style={styles.premiumBadgeText}>ACTIF</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            )}
          </TouchableOpacity>
          {isPremium && devMode ? (
            <TouchableOpacity
              style={styles.devResetBtn}
              onPress={() => {
                Alert.alert(
                  'Reset Premium (DEV)',
                  'Désactiver le Premium simulé pour retester le paywall ?',
                  [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Reset', style: 'destructive', onPress: () => devReset() },
                  ],
                );
              }}
              testID="dev-reset-premium"
            >
              <Text style={styles.devResetText}>⚙️ Reset Premium (DEV)</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.songsLink}
            onPress={() => router.push('/my-songs')}
            testID="my-songs-link"
          >
            <View style={styles.songsIconWrap}>
              <Ionicons name="musical-notes" size={20} color={colors.tertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Mes musiques par club</Text>
              <Text style={styles.bgRowSub}>Toutes les pépites entendues en soirée</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Détection en arrière-plan</Text>
          <View style={styles.bgRow}>
            <View style={styles.rowIcon}>
              <Ionicons name="radio" size={18} color={colors.tertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Notifie-moi à l'arrivée</Text>
              <Text style={styles.bgRowSub}>
                Détecte si tu rentres dans un club et te propose de confirmer ta soirée.
              </Text>
            </View>
            {togglingBg ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={bgLocation}
                onValueChange={toggleBg}
                trackColor={{ false: colors.border, true: 'rgba(224,26,79,0.5)' }}
                thumbColor={bgLocation ? colors.primary : colors.textTertiary}
                testID="bg-location-switch"
              />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Légal</Text>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'cgu' } })}
            testID="link-cgu"
          >
            <Text style={styles.legalIcon}>📜</Text>
            <Text style={styles.legalLabel}>Conditions Générales d'Utilisation</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}
            testID="link-privacy"
          >
            <Text style={styles.legalIcon}>🔒</Text>
            <Text style={styles.legalLabel}>Politique de Confidentialité</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.legalRow}
            onPress={() => router.push({ pathname: '/legal', params: { doc: 'legal' } })}
            testID="link-legal"
          >
            <Text style={styles.legalIcon}>⚖️</Text>
            <Text style={styles.legalLabel}>Mentions Légales</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>À propos</Text>
          <Row
            icon="information-circle"
            label="Comment ça marche"
            onPress={() =>
              Alert.alert(
                'Night Finder',
                "1. Réponds à quelques questions, 2. On scanne ta ville, 3. Swipe et ajoute en favoris, 4. Reçois des rappels avant chaque soirée.",
              )
            }
            testID="row-how"
          />
          <Row
            icon="shield-checkmark"
            label="Confidentialité"
            onPress={() =>
              Alert.alert(
                'Confidentialité',
                'Tes préférences musicales et favoris ne sont visibles que par toi. Localisation jamais partagée avec des tiers.',
              )
            }
            testID="row-privacy"
          />
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

      {/* Edit Name Modal */}
      <Modal
        visible={editingName}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingName(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setEditingName(false)}
          />
          <View style={styles.modalCard} testID="edit-name-modal">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Ton prénom</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              autoFocus
              autoCapitalize="words"
              placeholder="Prénom"
              placeholderTextColor={colors.textTertiary}
              style={styles.modalInput}
              testID="edit-name-input"
            />
            <TouchableOpacity
              style={styles.modalCta}
              onPress={saveName}
              disabled={savingName || !nameDraft.trim()}
              testID="save-name-btn"
            >
              {savingName ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.modalCtaText}>Enregistrer</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Music Prefs Modal */}
      <Modal
        visible={editingMusic}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingMusic(false)}
      >
        <View style={styles.modalRoot}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setEditingMusic(false)}
          />
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 24 }]} testID="edit-music-modal">
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Tes styles préférés</Text>
            <Text style={styles.modalSub}>
              On utilise ça pour t'envoyer les meilleures recommandations.
            </Text>
            <View style={styles.musicGrid}>
              {MUSIC_OPTIONS.map((m) => {
                const active = musicDraft.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.musicTag, active && styles.musicTagActive]}
                    onPress={() => {
                      const set = new Set(musicDraft);
                      if (set.has(m.id)) set.delete(m.id);
                      else set.add(m.id);
                      setMusicDraft(Array.from(set));
                    }}
                    activeOpacity={0.85}
                    testID={`music-tag-${m.id}`}
                  >
                    <Text style={styles.musicEmoji}>{m.emoji}</Text>
                    <Text style={[styles.musicLabel, active && styles.musicLabelActive]}>
                      {m.label}
                    </Text>
                    {active && (
                      <View style={styles.musicCheck}>
                        <Ionicons name="checkmark" size={11} color={colors.bg} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={styles.modalCta}
              onPress={saveMusic}
              disabled={savingMusic}
              testID="save-music-btn"
            >
              {savingMusic ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.modalCtaText}>
                  Enregistrer ({musicDraft.length})
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
  avatarFallback: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
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
  nameRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  name: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  email: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  statsRow: { flexDirection: 'row', marginHorizontal: spacing.lg, marginTop: spacing.xl, gap: 12 },
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
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
  },
  sectionAction: { color: colors.tertiary, fontSize: 12, fontWeight: '800' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagEmoji: { fontSize: 14 },
  tagText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  prefsEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  prefsEmptyText: { color: colors.textSecondary, flex: 1, fontWeight: '600' },
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
  bgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bgRowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(224,26,79,0.10)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(224,26,79,0.5)',
  },
  premiumCardActive: {
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderColor: 'rgba(255,215,0,0.5)',
  },
  premiumIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  premiumSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  premiumBadge: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  premiumBadgeText: { color: '#0a0a0a', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  devResetBtn: { marginTop: 8, alignSelf: 'flex-start' },
  devResetText: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  songsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  songsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  legalIcon: { fontSize: 18 },
  legalLabel: { color: colors.textPrimary, flex: 1, fontSize: 13, fontWeight: '600' },
  version: { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg, fontSize: 11 },

  // Modal
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 16,
  },
  modalTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  modalSub: { color: colors.textSecondary, marginTop: 6, marginBottom: 16, fontSize: 14 },
  modalInput: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
  },
  modalCta: {
    marginTop: 18,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  modalCtaText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
  musicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  musicTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    position: 'relative',
  },
  musicTagActive: { backgroundColor: 'rgba(224,26,79,0.12)', borderColor: colors.primary },
  musicEmoji: { fontSize: 14 },
  musicLabel: { color: colors.textSecondary, fontWeight: '700' },
  musicLabelActive: { color: colors.textPrimary },
  musicCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
});
