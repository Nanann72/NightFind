import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Linking,
  Alert,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { usePremium } from '../lib/premium';
import { api } from '../lib/api';
import { storage } from '../lib/storage';
import { useTheme } from '../lib/themeContext';
import { useTranslation, SUPPORTED_LANGS } from '../lib/i18n';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
} from '../lib/backgroundLocation';
import { radius, spacing, typography } from '../lib/theme';

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

type IoniconName = keyof typeof Ionicons.glyphMap;

export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const { isPremium, devMode, devReset } = usePremium();
  const { mode, setMode, colors } = useTheme();
  const { t, lang } = useTranslation();

  const [search, setSearch] = useState('');

  // Edit modals state
  const [editingName, setEditingName] = useState(false);
  const [editingMusic, setEditingMusic] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingMusic, setSavingMusic] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name || '');
  const [musicDraft, setMusicDraft] = useState<string[]>(user?.music_prefs || []);
  const [usernameDraft, setUsernameDraft] = useState((user as any)?.username || '');

  // Privacy
  const [bgLocation, setBgLocation] = useState(false);
  const [togglingBg, setTogglingBg] = useState(false);
  const [visibility, setVisibility] = useState<'clubs_only' | 'hidden'>(
    ((user as any)?.visibility === 'hidden' ? 'hidden' : 'clubs_only') as any,
  );
  const [savingVis, setSavingVis] = useState(false);

  useEffect(() => {
    setNameDraft(user?.name || '');
    setMusicDraft(user?.music_prefs || []);
    setUsernameDraft((user as any)?.username || '');
    setVisibility(((user as any)?.visibility === 'hidden' ? 'hidden' : 'clubs_only') as any);
  }, [user?.name, user?.music_prefs, (user as any)?.username, (user as any)?.visibility]);

  useEffect(() => {
    (async () => {
      const v = await storage.get(BG_PREF_KEY);
      setBgLocation(v === '1');
    })();
  }, []);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ===== Actions =====
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
  const saveUsername = async () => {
    const v = usernameDraft.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(v)) {
      Alert.alert('Username invalide', '3 à 20 caractères : a-z, 0-9, _ uniquement.');
      return;
    }
    setSavingUsername(true);
    try {
      await api.setUsername(v);
      await refresh();
      setEditingUsername(false);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de sauvegarder le username.');
    } finally {
      setSavingUsername(false);
    }
  };
  const toggleVisibility = async (val: boolean) => {
    const next = val ? 'clubs_only' : 'hidden';
    setSavingVis(true);
    try {
      await api.setVisibility(next);
      setVisibility(next);
      await refresh();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de mettre à jour.');
    } finally {
      setSavingVis(false);
    }
  };
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
              "L'arrière-plan nécessite un build natif. Pour l'instant, la détection fonctionne quand l'app est ouverte.",
            );
          }
          return;
        }
        if (res.reason === 'web') {
          Alert.alert('Disponible sur mobile uniquement', "Cette fonctionnalité nécessite un téléphone.");
        } else if (res.reason === 'foreground_denied') {
          Alert.alert(
            'Permission refusée',
            'Active la localisation pour Night Finder dans les réglages.',
            [
              { text: 'Plus tard', style: 'cancel' },
              { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert('Erreur', "Impossible d'activer la détection.");
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
  const exportData = async () => {
    try {
      const data = await api.exportMyData();
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `night-finder-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      try {
        const FS = await import('expo-file-system');
        const Sharing = await import('expo-sharing');
        const fileUri = `${(FS as any).cacheDirectory || (FS as any).documentDirectory}night-finder-export-${Date.now()}.json`;
        await (FS as any).writeAsStringAsync(fileUri, json, { encoding: 'utf8' });
        if (await (Sharing as any).isAvailableAsync()) {
          await (Sharing as any).shareAsync(fileUri, { mimeType: 'application/json' });
        } else {
          Alert.alert('Export prêt', `Fichier enregistré dans : ${fileUri}`);
        }
      } catch {
        Alert.alert('Export terminé', 'Tes données ont été récupérées.');
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || "Impossible d'exporter tes données.");
    }
  };
  const confirmDelete = () => {
    Alert.alert(
      'Supprimer mon compte ?',
      'Cette action est IRRÉVERSIBLE. Toutes tes données seront définitivement effacées sous 30 jours maximum.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Continuer',
          style: 'destructive',
          onPress: () => {
            const isEmailAuth = !!(user as any)?.email && !((user as any)?.auth_provider && (user as any)?.auth_provider !== 'email');
            if (isEmailAuth) {
              if (Platform.OS === 'web' && typeof window !== 'undefined') {
                const pwd = (window as any).prompt('Confirme ton mot de passe :');
                if (pwd) runDelete(pwd);
                return;
              }
              Alert.prompt(
                'Confirmation',
                'Saisis ton mot de passe pour supprimer définitivement ton compte.',
                [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Supprimer', style: 'destructive', onPress: (pwd?: string) => runDelete(pwd || '') },
                ],
                'secure-text',
              );
            } else {
              Alert.alert('Suppression définitive', 'Confirme : ton compte sera supprimé.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Supprimer', style: 'destructive', onPress: () => runDelete() },
              ]);
            }
          },
        },
      ],
    );
  };
  const runDelete = async (password?: string) => {
    try {
      await api.deleteMyAccount('DELETE', password);
      await signOut();
      Alert.alert('Compte supprimé', 'Tes données ont été effacées. À bientôt 👋');
      router.replace('/login');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Suppression impossible.');
    }
  };

  // ===== Search filter =====
  const q = search.trim().toLowerCase();
  const match = (label: string) => !q || label.toLowerCase().includes(q);

  const userPrefs = user?.music_prefs || [];
  const musicSummary = userPrefs.length === 0
    ? 'Ajoute tes styles préférés'
    : userPrefs.map((m) => MUSIC_OPTIONS.find((o) => o.id === m)?.label || m).join(' · ');
  const appearanceLabel = mode === 'system' ? t('settings.appearanceSystem') : mode === 'light' ? t('settings.appearanceLight') : t('settings.appearanceDark');

  // ===== Row builder =====
  const renderRow = (
    icon: IoniconName,
    label: string,
    onPress?: () => void,
    opts: { subtext?: string; right?: React.ReactNode; danger?: boolean; testID?: string } = {},
  ) => {
    if (!match(label) && !match(opts.subtext || '')) return null;
    return (
      <TouchableOpacity
        key={label}
        style={styles.row}
        onPress={onPress}
        disabled={!onPress}
        activeOpacity={0.7}
        testID={opts.testID}
      >
        <View style={[styles.rowIcon, opts.danger && { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
          <Ionicons name={icon} size={20} color={opts.danger ? colors.danger : colors.textPrimary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, opts.danger && { color: colors.danger }]}>{label}</Text>
          {opts.subtext ? <Text style={styles.rowSub} numberOfLines={1}>{opts.subtext}</Text> : null}
        </View>
        {opts.right !== undefined ? (
          opts.right
        ) : onPress ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        ) : null}
      </TouchableOpacity>
    );
  };

  const SectionHeader = ({ title }: { title: string }) => {
    if (q && !title.toLowerCase().includes(q)) {
      // Show only if section has at least 1 matching child — we render anyway, children filter themselves.
    }
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>{title}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          testID="settings-back"
        >
          <Ionicons name="chevron-back" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
        keyboardShouldPersistTaps="handled"
        testID="settings-scroll"
      >
        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('common.search')}
            placeholderTextColor={colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            testID="settings-search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {/* SECTION — Votre compte */}
        <SectionHeader title={t('settings.sectionAccount')} />
        <View style={styles.group}>
          {renderRow('person-circle-outline', t('settings.accountSpace'), () => setEditingUsername(true), {
            subtext: (user as any)?.username ? `@${(user as any).username} · ${user?.email || ''}` : (user?.email || 'Username, profil, sécurité'),
            testID: 'row-account-space',
          })}
          {renderRow('pencil-outline', t('settings.editName'), () => setEditingName(true), {
            subtext: user?.name || '—',
            testID: 'row-edit-name',
          })}
          {renderRow('flame-outline', t('settings.swipeProfile'), () => router.push('/swipe-profile' as any), {
            subtext: 'Photos, bio, ville, Insta',
            testID: 'row-swipe-profile',
          })}
        </View>

        {/* SECTION — Utilisation personnelle de Night Finder */}
        <SectionHeader title={t('settings.sectionUsage')} />
        <View style={styles.group}>
          {renderRow('heart-outline', t('settings.favorites'), () => router.push('/favorites' as any), { testID: 'row-favorites' })}
          {renderRow('people-outline', t('settings.friends'), () => router.push('/friends' as any), { testID: 'row-friends' })}
          {renderRow('heart-circle-outline', t('settings.matchesAndRequests'), () => router.push('/matches' as any), { testID: 'row-matches' })}
          {renderRow('musical-notes-outline', t('settings.songsByClub'), () => router.push('/my-songs' as any), { testID: 'row-songs' })}
          {renderRow('calendar-outline', t('settings.upcomingEvents'), () => router.push('/(tabs)/events' as any), { testID: 'row-events' })}
          {renderRow('notifications-outline', t('settings.notifications'), () => router.push('/notifications' as any), { testID: 'row-notifications' })}
        </View>

        {/* SECTION — Premium */}
        <SectionHeader title={t('settings.sectionPremium')} />
        <View style={styles.group}>
          {renderRow(
            isPremium ? 'diamond' : 'diamond-outline',
            isPremium ? 'Night Finder Premium' : 'Passer en Premium',
            () => router.push('/paywall'),
            {
              subtext: isPremium
                ? `Actif${devMode ? ' (DEV)' : ''} • Swipes illimités, rayon 200km`
                : 'Swipes illimités • Rayon 200km • Sans pub',
              testID: 'row-premium',
            },
          )}
          {isPremium && devMode && __DEV__
            ? renderRow('refresh-outline', 'Reset Premium (DEV)', () => {
                Alert.alert('Reset Premium (DEV)', 'Désactiver le Premium simulé ?', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: () => devReset() },
                ]);
              }, { testID: 'row-reset-premium' })
            : null}
        </View>

        {/* SECTION — Préférences */}
        <SectionHeader title={t('settings.sectionPreferences')} />
        <View style={styles.group}>
          {renderRow('musical-note-outline', t('settings.musicPrefs'), () => setEditingMusic(true), {
            subtext: musicSummary,
            testID: 'row-music',
          })}
          {renderRow('options-outline', t('settings.discoveryFilters'), () => router.push('/filters' as any), { testID: 'row-filters' })}
          {renderRow('contrast-outline', t('settings.appearance'), () => {
            const next = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
            setMode(next);
          }, {
            subtext: appearanceLabel,
            right: (
              <View style={styles.modePicker}>
                {(['system', 'dark', 'light'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.modePill, mode === m && styles.modePillActive]}
                    onPress={() => setMode(m)}
                    activeOpacity={0.7}
                    testID={`mode-${m}`}
                  >
                    <Ionicons
                      name={m === 'system' ? 'phone-portrait-outline' : m === 'dark' ? 'moon' : 'sunny'}
                      size={14}
                      color={mode === m ? colors.bg : colors.textSecondary}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            ),
            testID: 'row-appearance',
          })}
        </View>

        {/* SECTION — Confidentialité */}
        <SectionHeader title={t('settings.sectionPrivacy')} />
        <View style={styles.group}>
          {renderRow(visibility === 'clubs_only' ? 'eye-outline' : 'eye-off-outline', t('settings.visibility'), undefined, {
            subtext:
              visibility === 'clubs_only'
                ? 'Tes amis te voient sur la carte (uniquement en boîte)'
                : 'Personne ne voit où tu sors',
            right: savingVis ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={visibility === 'clubs_only'}
                onValueChange={toggleVisibility}
                trackColor={{ false: colors.border, true: 'rgba(224,26,79,0.5)' }}
                thumbColor={visibility === 'clubs_only' ? colors.primary : colors.textTertiary}
                testID="switch-visibility"
              />
            ),
            testID: 'row-visibility',
          })}
          {renderRow('radio-outline', t('settings.bgDetection'), undefined, {
            subtext: 'On te propose de confirmer ta soirée en arrivant au club',
            right: togglingBg ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={bgLocation}
                onValueChange={toggleBg}
                trackColor={{ false: colors.border, true: 'rgba(224,26,79,0.5)' }}
                thumbColor={bgLocation ? colors.primary : colors.textTertiary}
                testID="switch-bg-location"
              />
            ),
            testID: 'row-bg-location',
          })}
          {renderRow('ban-outline', t('settings.blockedUsers'), () => router.push('/blocked-users' as any), {
            testID: 'row-blocked',
          })}
          {renderRow('key-outline', t('settings.changePassword'), () => router.push('/forgot-password' as any), {
            subtext: 'On t\'enverra un lien de réinitialisation par email',
            testID: 'row-change-password',
          })}
          {renderRow('language-outline', t('settings.language'), () => router.push('/language' as any),
          {
            subtext: SUPPORTED_LANGS.find((s) => s.code === lang)?.native || 'Français',
            testID: 'row-language',
          })}
          {renderRow('trash-bin-outline', t('settings.clearCache'), () => {
            Alert.alert(
              'Effacer le cache local ?',
              'Cela libère de l\'espace mais nécessite de recharger les clubs et photos. Tes données restent intactes.',
              [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Effacer',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await storage.set('nf_clubs_cache', '');
                      Alert.alert('Cache effacé', 'Recharge l\'écran Découvrir pour récupérer les clubs.');
                    } catch {
                      Alert.alert('Erreur', 'Impossible d\'effacer le cache.');
                    }
                  },
                },
              ],
            );
          }, { testID: 'row-clear-cache' })}
        </View>

        {/* SECTION — Aide */}
        <SectionHeader title={t('settings.sectionHelp')} />
        <View style={styles.group}>
          {renderRow('information-circle-outline', t('settings.howItWorks'), () =>
            Alert.alert(
              'Night Finder',
              '1. Réponds à quelques questions, 2. On scanne ta ville, 3. Swipe et ajoute en favoris, 4. Reçois des rappels avant chaque soirée.',
            ),
          { testID: 'row-how' })}
          {renderRow('shield-checkmark-outline', t('settings.privacyInfo'), () =>
            Alert.alert(
              'Confidentialité',
              'Tes préférences musicales et favoris ne sont visibles que par toi. Localisation jamais partagée avec des tiers.',
            ),
          { testID: 'row-privacy-info' })}
        </View>

        {/* SECTION — Légal */}
        <SectionHeader title={t('settings.sectionAbout')} />
        <View style={styles.group}>
          {renderRow('document-text-outline', t('settings.cgu'), () =>
            router.push({ pathname: '/legal', params: { doc: 'cgu' } } as any),
          { testID: 'row-cgu' })}
          {renderRow('lock-closed-outline', t('settings.privacyPolicy'), () =>
            router.push({ pathname: '/legal', params: { doc: 'privacy' } } as any),
          { testID: 'row-legal-privacy' })}
          {renderRow('library-outline', t('settings.legalNotice'), () =>
            router.push({ pathname: '/legal', params: { doc: 'legal' } } as any),
          { testID: 'row-mentions' })}
        </View>

        {/* SECTION — Tes données */}
        <SectionHeader title={t('settings.sectionData')} />
        <View style={styles.group}>
          {renderRow('download-outline', t('settings.exportData'), exportData, { testID: 'row-export' })}
          {renderRow('trash-outline', t('settings.deleteAccount'), confirmDelete, {
            danger: true,
            testID: 'row-delete-account',
          })}
        </View>

        {/* SECTION — Connexion */}
        <SectionHeader title={t('settings.sectionSignout')} />
        <View style={styles.group}>
          {renderRow('log-out-outline', t('settings.signOut'), handleSignOut, { danger: true, testID: 'row-signout' })}
        </View>

        <Text style={styles.version}>{t('settings.version')}</Text>
      </ScrollView>

      {/* === Modals === */}
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
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEditingName(false)} />
          <View style={styles.modalCard}>
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
              {savingName ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.modalCtaText}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editingUsername}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingUsername(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEditingUsername(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Ton @username</Text>
            <Text style={styles.modalSub}>3 à 20 caractères, en minuscules. Lettres, chiffres et underscore.</Text>
            <View style={styles.usernameInputWrap}>
              <Text style={styles.usernameAt}>@</Text>
              <TextInput
                value={usernameDraft}
                onChangeText={(t) => setUsernameDraft(t.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="ton_username"
                placeholderTextColor={colors.textTertiary}
                style={styles.usernameInput}
                maxLength={20}
                testID="edit-username-input"
              />
            </View>
            <TouchableOpacity
              style={styles.modalCta}
              onPress={saveUsername}
              disabled={savingUsername || usernameDraft.trim().length < 3}
              testID="save-username-btn"
            >
              {savingUsername ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.modalCtaText}>Enregistrer</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={editingMusic}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingMusic(false)}
      >
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEditingMusic(false)} />
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Tes styles préférés</Text>
            <Text style={styles.modalSub}>{"On utilise ça pour t'envoyer les meilleures recommandations."}</Text>
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
                    <Text style={[styles.musicLabel, active && styles.musicLabelActive]}>{m.label}</Text>
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
                <Text style={styles.modalCtaText}>Enregistrer ({musicDraft.length})</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.bg,
    },
    headerBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      ...typography.headline,
      color: colors.textPrimary,
      flex: 1,
      textAlign: 'center',
    },

    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      backgroundColor: colors.fill,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    },
    searchInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 16,
      paddingVertical: 4,
    },

    sectionHeader: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: 8,
    },
    sectionHeaderText: {
      ...typography.subheadMedium,
      color: colors.textPrimary,
      fontWeight: '700',
      letterSpacing: -0.2,
    },

    group: {
      backgroundColor: colors.surface,
      marginHorizontal: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      borderBottomColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
      backgroundColor: colors.surface,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.fill,
    },
    rowLabel: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '500',
      letterSpacing: -0.2,
    },
    rowSub: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 2,
    },

    modePicker: {
      flexDirection: 'row',
      backgroundColor: colors.fill,
      borderRadius: 999,
      padding: 2,
      gap: 2,
    },
    modePill: {
      width: 32,
      height: 28,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modePillActive: { backgroundColor: colors.textPrimary },

    version: {
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: spacing.xl,
      fontSize: 11,
    },

    // Modals
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
    usernameInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      marginTop: 14,
      paddingHorizontal: 14,
    },
    usernameAt: { color: colors.primary, fontSize: 22, fontWeight: '900', marginRight: 4 },
    usernameInput: {
      flex: 1,
      color: colors.textPrimary,
      paddingVertical: 16,
      fontSize: 18,
      fontWeight: '700',
    },
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
    },
    musicTagActive: { backgroundColor: 'rgba(224,26,79,0.12)', borderColor: colors.primary },
    musicEmoji: { fontSize: 14 },
    musicLabel: { color: colors.textSecondary, fontWeight: '700' },
    musicLabelActive: { color: colors.textPrimary },
  });
