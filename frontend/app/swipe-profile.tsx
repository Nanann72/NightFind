import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Linking,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MaskedDOBInput } from '../components/MaskedDOBInput';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function SwipeProfileEdit() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const u = (user || {}) as any;

  const [dob, setDob] = useState<string>(u.dob || '');
  const [bio, setBio] = useState<string>(u.bio || '');
  const [city, setCity] = useState<string>(u.city || '');
  const [instagram, setInstagram] = useState<string>(u.instagram || '');
  const [photos, setPhotos] = useState<string[]>(Array.isArray(u.photos) ? u.photos : []);
  const [saving, setSaving] = useState(false);
  const [savingState, setSavingState] = useState<'idle' | 'moderating' | 'saving'>('idle');
  const [completion, setCompletion] = useState<number | null>(null);

  useEffect(() => {
    api.profileCompletion()
      .then((r) => setCompletion(r.percent))
      .catch(() => {});
  }, []);

  // Detect which photos are brand-new vs already on the account
  const initialPhotosRef = useRef<string[]>([]);
  useEffect(() => {
    if (user) {
      initialPhotosRef.current = Array.isArray((user as any).photos) ? (user as any).photos : [];
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setDob((user as any).dob || '');
    setBio((user as any).bio || '');
    setCity((user as any).city || '');
    setInstagram((user as any).instagram || '');
    setPhotos(Array.isArray((user as any).photos) ? (user as any).photos : []);
  }, [user]);

  const pickPhoto = async () => {
    if (photos.length >= 3) {
      Alert.alert('Maximum atteint', '3 photos maximum.');
      return;
    }
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Accès refusé',
          'Active l\'accès aux photos dans Réglages > Night Finder.',
        );
        return;
      }
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.55,
      base64: true,
    });
    if (r.canceled || !r.assets?.[0]?.base64) return;
    const dataUri = `data:image/jpeg;base64,${r.assets[0].base64}`;
    setPhotos((p) => [...p, dataUri]);
  };

  const removePhoto = (idx: number) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
  };

  const [gender, setGender] = useState<string>((u as any).gender || '');
  const [prefGender, setPrefGender] = useState<string>((u as any).pref_gender || 'tous');
  const [prefAgeMin, setPrefAgeMin] = useState<number>((u as any).pref_age_min || 18);
  const [prefAgeMax, setPrefAgeMax] = useState<number>((u as any).pref_age_max || 99);
  const [prefDist, setPrefDist] = useState<number>((u as any).pref_distance_km || 0);
  const [verified, setVerified] = useState<boolean>(!!(u as any).verified);
  const [verifying, setVerifying] = useState(false);

  const startVerification = async () => {
    if (verifying) return;
    if (!photos.length) {
      Alert.alert('Photos requises', "Ajoute d'abord au moins une photo à ton profil.");
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (perm.canAskAgain === false) {
        Alert.alert('Caméra désactivée', 'Autorise la caméra dans les réglages pour te vérifier.', [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
        ]);
      }
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      base64: true,
      quality: 0.7,
      allowsEditing: false,
    });
    const b64 = shot.assets?.[0]?.base64;
    if (shot.canceled || !b64) return;
    setVerifying(true);
    try {
      const r = await api.verifyFace(`data:image/jpeg;base64,${b64}`);
      if (r.verified) {
        setVerified(true);
        Alert.alert('Profil vérifié ✅', "C'est bien toi ! Le badge bleu apparaît maintenant sur ton profil.");
      } else {
        Alert.alert('Vérification échouée', r.reason || 'Le selfie ne correspond pas assez à tes photos. Réessaie avec un bon éclairage, visage bien visible.');
      }
    } catch (e: any) {
      Alert.alert('Oups', e?.message || 'Réessaie plus tard.');
    } finally {
      setVerifying(false);
    }
  };

  const save = async () => {
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert('Date invalide', 'Vérifie le jour/mois/année (JJ/MM/AAAA).');
      return;
    }
    setSaving(true);
    // If user added new photos that are not yet in initialPhotosRef, the
    // backend will run AI moderation (5-8s per photo). Surface this clearly.
    const initialSet = new Set(initialPhotosRef.current || []);
    const newPhotosCount = photos.filter((p) => !initialSet.has(p)).length;
    setSavingState(newPhotosCount > 0 ? 'moderating' : 'saving');
    try {
      await api.updateSwipeFields({
        dob: dob || undefined,
        bio,
        city,
        instagram,
        photos,
        gender: gender || undefined,
        pref_gender: prefGender,
        pref_age_min: prefAgeMin,
        pref_age_max: prefAgeMax,
        pref_distance_km: prefDist,
      });
      await refresh();
      router.back();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
      setSavingState('idle');
    }
  };

  const newPhotosCount = useMemo(() => {
    const initialSet = new Set(initialPhotosRef.current || []);
    return photos.filter((p) => !initialSet.has(p)).length;
  }, [photos]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mon profil swipe</Text>
        <TouchableOpacity onPress={save} disabled={saving} testID="sf-save">
          {saving ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.headerSave}>Enregistrer</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        {/* ── Complétez votre profil (Tinder-like) ── */}
        {completion != null && completion < 100 && (
          <View style={styles.completionBanner} testID="sf-completion-banner">
            <View style={styles.completionTop}>
              <Ionicons name="alert-circle" size={18} color={colors.primary} />
              <Text style={styles.completionTitle}>Complète ton profil</Text>
              <Text style={styles.completionPct}>{completion}%</Text>
            </View>
            <View style={styles.completionBarBg}>
              <View style={[styles.completionBarFill, { width: `${completion}%` }]} />
            </View>
          </View>
        )}

        <Text style={styles.label}>Mes photos</Text>
        {photos.length < 3 && (
          <Text style={styles.photosHint}>
            Ajoute {3 - photos.length} autre{3 - photos.length > 1 ? 's' : ''} photo{3 - photos.length > 1 ? 's' : ''} et augmente tes chances d&apos;être liké·e.
          </Text>
        )}
        <View style={styles.photosRow}>
          {photos.map((p, i) => (
            <View key={i} style={styles.photoCell}>
              <Image source={{ uri: p }} style={styles.photoImg} />
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removePhoto(i)}
                testID={`sf-remove-photo-${i}`}
              >
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
              {i === 0 && (
                <View style={styles.mainBadge}>
                  <Text style={styles.mainBadgeText} allowFontScaling={false}>Principale</Text>
                </View>
              )}
            </View>
          ))}
          {Array.from({ length: Math.max(0, 3 - photos.length) }).map((_, i) => (
            <TouchableOpacity
              key={`add-${i}`}
              style={styles.photoAdd}
              onPress={pickPhoto}
              testID={i === 0 ? 'sf-add-photo' : `sf-add-photo-${i}`}
            >
              <View style={styles.photoAddPlus}>
                <Ionicons name="add" size={20} color="#fff" />
              </View>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.helper}>La première photo est ta photo principale.</Text>

        <Text style={styles.label}>Date de naissance *</Text>
        <MaskedDOBInput
          value={dob}
          onChange={setDob}
          testID="sf-dob"
          placeholder="JJ/MM/AAAA"
        />
        <Text style={styles.helper}>Tu dois avoir 18 ans minimum pour swiper.</Text>

        {/* Vérification du profil par IA */}
        <Text style={styles.label}>Vérification du profil</Text>
        {verified ? (
          <View style={styles.verifiedRow} testID="verified-badge-row">
            <Ionicons name="checkmark-circle" size={22} color="#3B82F6" />
            <Text style={styles.verifiedText}>Profil vérifié — badge visible sur ta carte swipe</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.verifyBtn}
            onPress={startVerification}
            disabled={verifying}
            testID="verify-face-btn"
          >
            {verifying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="shield-checkmark" size={17} color="#fff" />
            )}
            <Text style={styles.verifyBtnText}>
              {verifying ? 'Analyse IA en cours…' : 'Vérifier mon profil (selfie)'}
            </Text>
          </TouchableOpacity>
        )}
        {!verified && (
          <Text style={styles.helper}>
            Prends un selfie — notre IA le compare à tes photos pour confirmer que c&apos;est bien toi.
            Badge bleu ✓ à la clé.
          </Text>
        )}

        {/* Préférences de découverte (Tinder-like) */}
        <Text style={styles.label}>Je suis</Text>
        <View style={styles.chipsRow}>
          {[['femme', 'Femme'], ['homme', 'Homme'], ['autre', 'Autre']].map(([v, l]) => (
            <TouchableOpacity
              key={v}
              style={[styles.chip, gender === v && styles.chipActive]}
              onPress={() => setGender(gender === v ? '' : v)}
              testID={`sf-gender-${v}`}
            >
              <Text style={[styles.chipText, gender === v && styles.chipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Je veux voir</Text>
        <View style={styles.chipsRow}>
          {[['femmes', 'Femmes'], ['hommes', 'Hommes'], ['tous', 'Tout le monde']].map(([v, l]) => (
            <TouchableOpacity
              key={v}
              style={[styles.chip, prefGender === v && styles.chipActive]}
              onPress={() => setPrefGender(v)}
              testID={`sf-pref-${v}`}
            >
              <Text style={[styles.chipText, prefGender === v && styles.chipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Tranche d&apos;âge : {prefAgeMin} – {prefAgeMax === 99 ? '99+' : prefAgeMax} ans</Text>
        <View style={styles.chipsRow}>
          {[[18, 25], [18, 30], [21, 35], [25, 40], [30, 50], [18, 99]].map(([mn, mx]) => (
            <TouchableOpacity
              key={`${mn}-${mx}`}
              style={[styles.chip, prefAgeMin === mn && prefAgeMax === mx && styles.chipActive]}
              onPress={() => { setPrefAgeMin(mn); setPrefAgeMax(mx); }}
              testID={`sf-age-${mn}-${mx}`}
            >
              <Text style={[styles.chipText, prefAgeMin === mn && prefAgeMax === mx && styles.chipTextActive]}>
                {mn}-{mx === 99 ? '99+' : mx}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Distance maximum</Text>
        <View style={styles.chipsRow}>
          {[[5, '5 km'], [10, '10 km'], [25, '25 km'], [50, '50 km'], [100, '100 km'], [0, 'Illimité']].map(([v, l]) => (
            <TouchableOpacity
              key={String(v)}
              style={[styles.chip, prefDist === v && styles.chipActive]}
              onPress={() => setPrefDist(v as number)}
              testID={`sf-dist-${v}`}
            >
              <Text style={[styles.chipText, prefDist === v && styles.chipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Ville</Text>
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder="Paris, Lyon, Marseille..."
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          testID="sf-city"
        />

        <Text style={styles.label}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Parle de toi en quelques mots..."
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, styles.area]}
          multiline
          maxLength={500}
          testID="sf-bio"
        />
        <Text style={styles.helper}>{bio.length} / 500</Text>

        <Text style={styles.label}>Instagram</Text>
        <TextInput
          value={instagram}
          onChangeText={setInstagram}
          placeholder="@ton.handle (sans le @)"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          testID="sf-instagram"
        />
      </ScrollView>

      {/* Moderation in-progress overlay */}
      <Modal visible={saving} transparent animationType="fade">
        <View style={styles.modOverlay}>
          <View style={styles.modCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            {savingState === 'moderating' ? (
              <>
                <Text style={styles.modTitle}>Modération IA en cours…</Text>
                <Text style={styles.modSub}>
                  {`Notre IA vérifie ${newPhotosCount === 1 ? 'ta nouvelle photo' : `tes ${newPhotosCount} nouvelles photos`} pour s'assurer qu'elles respectent les règles (5–8 sec).`}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.modTitle}>Enregistrement…</Text>
                <Text style={styles.modSub}>On met à jour ton profil swipe.</Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  headerSave: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  label: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 22,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  helper: { color: colors.textTertiary, fontSize: 11, marginTop: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    minHeight: 38, justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },
  chipTextActive: { color: '#fff' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifiedText: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3B82F6', borderRadius: 999, paddingVertical: 13,
    minHeight: 46,
  },
  verifyBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  area: { minHeight: 100, textAlignVertical: 'top' },
  photosRow: { flexDirection: 'row', gap: 10 },
  photoCell: {
    width: 100,
    height: 140,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  modOverlay: {
    flex: 1,
    backgroundColor: 'rgba(7,5,18,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modCard: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: 28,
    alignItems: 'center',
    gap: 14,
    maxWidth: 340,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
  },
  modSub: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: {
    width: 100,
    height: 140,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
    paddingRight: 0,
  },
  photoAddPlus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  photosHint: { color: colors.primary, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  mainBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  mainBadgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  completionBanner: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  completionTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  completionTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  completionPct: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  completionBarBg: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  completionBarFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
