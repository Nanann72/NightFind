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
  Switch,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Sortable from 'react-native-sortables';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePremium } from '../lib/premium';
import { MaskedDOBInput } from '../components/MaskedDOBInput';
import { MUSIC_GENRES } from '../lib/musicGenres';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const MISSING_LABELS: Record<string, string> = {
  'Ajoute une photo': 'Photo',
  'Ajoute 3 photos': '3 photos',
  'Écris une bio': 'Bio',
  'Renseigne ta date de naissance': 'Date de naissance',
  'Indique ta ville': 'Ville',
  'Ajoute tes goûts musicaux': 'Musique',
  'Lie ton Instagram': 'Instagram',
  'Ajoute tes clubs favoris': 'Clubs favoris',
};

const MAX_PHOTOS = 6;

const INTEREST_OPTIONS = [
  '🍣 Sushi', '👨‍🍳 Cuisine', '✈️ Voyages', '🏋️ Sport', '⚽ Foot', '🎬 Cinéma',
  '📺 Séries', '🎮 Gaming', '👗 Mode', '📷 Photo', '🎨 Art', '💃 Danse',
  '🎪 Festivals', '🍹 Cocktails', '☕ Café', '🥾 Rando', '🏍️ Moto', '🐶 Animaux',
  '🖋️ Tatouages', '🎤 Concerts', '🎙️ Karaoké', '🎱 Billard', '🛍️ Shopping', '🏖️ Plage',
];

export default function SwipeProfileEdit() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const { isPremium } = usePremium();
  const u = (user || {}) as any;

  const [dob, setDob] = useState<string>(u.dob || '');
  const [bio, setBio] = useState<string>(u.bio || '');
  const [city, setCity] = useState<string>(u.city || '');
  const [instagram, setInstagram] = useState<string>(u.instagram || '');
  const [photos, setPhotos] = useState<string[]>(Array.isArray(u.photos) ? u.photos : []);
  const [interests, setInterests] = useState<string[]>(Array.isArray(u.interests) ? u.interests : []);
  const [job, setJob] = useState<string>(u.job || '');
  const [education, setEducation] = useState<string>(u.education || '');
  const [heightCm, setHeightCm] = useState<string>(u.height_cm ? String(u.height_cm) : '');
  const [smartPhotos, setSmartPhotos] = useState<boolean>(!!u.smart_photos);
  const [hideAge, setHideAge] = useState<boolean>(!!u.hide_age);
  const [hideDistance, setHideDistance] = useState<boolean>(!!u.hide_distance);
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingState, setSavingState] = useState<'idle' | 'moderating' | 'saving'>('idle');
  const [completion, setCompletion] = useState<number | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  // Navigation vers les sections + aperçu photo + goûts musicaux
  const scrollRef = useRef<ScrollView>(null);
  const cityRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const igRef = useRef<TextInput>(null);
  const sectionY = useRef<Record<string, number>>({});
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicSel, setMusicSel] = useState<string[]>(Array.isArray(u.music_prefs) ? u.music_prefs : []);
  const [musicSaving, setMusicSaving] = useState(false);

  const refreshCompletion = () => {
    api.profileCompletion()
      .then((r) => {
        setCompletion(r.percent);
        setMissing(r.missing || []);
      })
      .catch(() => {});
  };

  const scrollToSection = (key: string, ref?: React.RefObject<TextInput | null>) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY.current[key] || 0) - 70), animated: true });
    if (ref) setTimeout(() => ref.current?.focus(), 380);
  };

  const normalizeGenres = (arr: string[]) =>
    Array.from(new Set(arr.map((m) => MUSIC_GENRES.find((o) => o.id === m || o.label === m)?.id || m)));
  const genreLabel = (m: string) => MUSIC_GENRES.find((o) => o.id === m || o.label === m)?.label || m;

  const saveMusic = async () => {
    if (musicSaving) return;
    setMusicSaving(true);
    try {
      await api.updateProfile({ music_prefs: musicSel } as any);
      await refresh();
      refreshCompletion();
      setMusicOpen(false);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Enregistrement impossible');
    } finally {
      setMusicSaving(false);
    }
  };

  const handleMissing = (label: string) => {
    switch (label) {
      case 'Ajoute une photo':
      case 'Ajoute 3 photos':
        scrollToSection('photos');
        pickPhoto();
        break;
      case 'Écris une bio':
        scrollToSection('bio', bioRef);
        break;
      case 'Renseigne ta date de naissance':
        scrollToSection('dob');
        break;
      case 'Indique ta ville':
        scrollToSection('city', cityRef);
        break;
      case 'Ajoute tes goûts musicaux':
        setMusicSel(normalizeGenres(Array.isArray((user as any)?.music_prefs) ? (user as any).music_prefs : []));
        setMusicOpen(true);
        break;
      case 'Lie ton Instagram':
        scrollToSection('instagram', igRef);
        break;
      case 'Ajoute tes clubs favoris':
        router.push('/(tabs)' as any);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    api.profileCompletion()
      .then((r) => {
        setCompletion(r.percent);
        setMissing(r.missing || []);
      })
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
    setInterests(Array.isArray((user as any).interests) ? (user as any).interests : []);
    setJob((user as any).job || '');
    setEducation((user as any).education || '');
    setHeightCm((user as any).height_cm ? String((user as any).height_cm) : '');
    setSmartPhotos(!!(user as any).smart_photos);
    setHideAge(!!(user as any).hide_age);
    setHideDistance(!!(user as any).hide_distance);
  }, [user]);

  const pickPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Maximum atteint', `${MAX_PHOTOS} photos maximum.`);
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
        interests,
        job,
        education,
        height_cm: heightCm ? parseInt(heightCm, 10) || 0 : 0,
        smart_photos: smartPhotos,
        ...(isPremium ? { hide_age: hideAge, hide_distance: hideDistance } : {}),
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

      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}>
        {/* ── Héro Tinder-like : avatar + nom + badge ── */}
        <View style={styles.hero}>
          {photos[0] ? (
            <Image source={{ uri: photos[0] }} style={styles.heroAvatar} />
          ) : (
            <View style={[styles.heroAvatar, styles.heroAvatarFb]}>
              <Ionicons name="person" size={30} color={colors.textTertiary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.heroName} numberOfLines={1}>
                {((u.name as string) || 'Toi').split(' ')[0]}
              </Text>
              {verified && <Ionicons name="checkmark-circle" size={20} color="#3B82F6" />}
            </View>
            {completion != null && (
              <Text style={styles.heroSub}>Profil complété à {completion}%</Text>
            )}
            <TouchableOpacity
              onPress={() => setPreviewOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}
              testID="sf-preview-btn"
            >
              <Text style={styles.heroPreview}>Aperçu</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Complétez votre profil (pill Tinder) ── */}
        {completion != null && completion < 100 && (
          <TouchableOpacity
            style={styles.completionPillBanner}
            testID="sf-completion-banner"
            onPress={() => missing[0] && handleMissing(missing[0])}
            activeOpacity={0.8}
          >
            <Ionicons name="alert-circle" size={18} color={colors.primary} />
            <Text style={styles.completionPillText}>Complète ton profil</Text>
            <Text style={styles.completionPct}>{completion}%</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* ── Chips des infos manquantes ── */}
        {missing.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.missingRow}
            style={{ marginBottom: 20 }}
          >
            {missing.map((m) => (
              <TouchableOpacity
                key={m}
                style={styles.missingChip}
                onPress={() => handleMissing(m)}
                testID={`sf-missing-${MISSING_LABELS[m] || m}`}
                activeOpacity={0.75}
              >
                <Text style={styles.missingChipText} allowFontScaling={false}>
                  {MISSING_LABELS[m] || m}
                </Text>
                <Ionicons name="add" size={15} color={colors.textPrimary} />
                <View style={styles.missingDot} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <Text
          style={styles.photosTitle}
          onLayout={(e) => { sectionY.current.photos = e.nativeEvent.layout.y; }}
        >
          Mes photos {photos.length < 3 ? '❗' : ''}
        </Text>
        {photos.length < MAX_PHOTOS && (
          <Text style={styles.photosHint}>
            Ajoute {MAX_PHOTOS - photos.length} autre{MAX_PHOTOS - photos.length > 1 ? 's' : ''} photo{MAX_PHOTOS - photos.length > 1 ? 's' : ''} et augmente tes chances d&apos;être liké·e.
          </Text>
        )}
        {photos.length > 0 && (
          <Sortable.Grid
            columns={3}
            rowGap={10}
            columnGap={10}
            data={photos}
            keyExtractor={(item) => item.slice(-32)}
            onDragEnd={({ data }) => setPhotos([...data])}
            hapticsEnabled={Platform.OS !== 'web'}
            renderItem={({ item, index }) => (
              <View style={styles.photoCell}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { setPreviewUri(item); setPreviewIdx(index); }}
                  testID={`sf-photo-preview-${index}`}
                  style={{ width: '100%', height: '100%' }}
                >
                  <Image source={{ uri: item }} style={styles.photoImg} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => removePhoto(index)}
                  testID={`sf-remove-photo-${index}`}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </TouchableOpacity>
                {index === 0 && (
                  <View style={styles.mainBadge}>
                    <Text style={styles.mainBadgeText} allowFontScaling={false}>Principale</Text>
                  </View>
                )}
              </View>
            )}
          />
        )}
        <View style={[styles.photosRow, photos.length > 0 && { marginTop: 10 }]}>
          {Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }).map((_, i) => (
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
        <Text style={styles.helper}>
          Maintiens une photo et glisse-la pour changer l&apos;ordre — la première est ta photo principale.
        </Text>

        {/* ── Mes passions (Tinder-like) ── */}
        <Text style={styles.label}>Mes passions</Text>
        <TouchableOpacity
          style={styles.musicRow}
          onPress={() => setInterestsOpen(true)}
          testID="sf-interests-row"
          activeOpacity={0.8}
        >
          <Ionicons name="heart-circle" size={18} color={colors.primary} />
          <Text style={styles.musicRowText} numberOfLines={1}>
            {interests.length > 0
              ? `${interests.slice(0, 3).map((i) => i.replace(/^[^\s]+\s/, '')).join(', ')}${interests.length > 3 ? ` +${interests.length - 3}` : ''}`
              : 'Ajoute tes passions (Sushi, Voyages…)'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* ── Infos Tinder-like : Taf / Études / Taille ── */}
        <Text style={styles.label}>Taf</Text>
        <TextInput
          value={job}
          onChangeText={setJob}
          placeholder="Ton métier (ex : Barman, Étudiant…)"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          maxLength={60}
          testID="sf-job"
        />

        <Text style={styles.label}>Niveau d&apos;études</Text>
        <TextInput
          value={education}
          onChangeText={setEducation}
          placeholder="Ex : BTS, Licence, Master…"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          maxLength={60}
          testID="sf-education"
        />

        <Text style={styles.label}>Taille (cm)</Text>
        <TextInput
          value={heightCm}
          onChangeText={(t) => setHeightCm(t.replace(/[^0-9]/g, '').slice(0, 3))}
          placeholder="Ex : 180"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          keyboardType="number-pad"
          testID="sf-height"
        />

        <Text
          style={styles.label}
          onLayout={(e) => { sectionY.current.dob = e.nativeEvent.layout.y; }}
        >
          Date de naissance *
        </Text>
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

        <Text
          style={styles.label}
          onLayout={(e) => { sectionY.current.city = e.nativeEvent.layout.y; }}
        >
          Ville
        </Text>
        <TextInput
          ref={cityRef}
          value={city}
          onChangeText={setCity}
          placeholder="Paris, Lyon, Marseille..."
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          testID="sf-city"
        />

        <Text
          style={styles.label}
          onLayout={(e) => { sectionY.current.bio = e.nativeEvent.layout.y; }}
        >
          Bio
        </Text>
        <TextInput
          ref={bioRef}
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

        <Text
          style={styles.label}
          onLayout={(e) => { sectionY.current.instagram = e.nativeEvent.layout.y; }}
        >
          Instagram
        </Text>
        <TextInput
          ref={igRef}
          value={instagram}
          onChangeText={setInstagram}
          placeholder="@ton.handle (sans le @)"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          testID="sf-instagram"
        />

        <Text style={styles.label}>Goûts musicaux</Text>
        <TouchableOpacity
          style={styles.musicRow}
          onPress={() => {
            setMusicSel(normalizeGenres(Array.isArray((user as any)?.music_prefs) ? (user as any).music_prefs : []));
            setMusicOpen(true);
          }}
          testID="sf-music-row"
          activeOpacity={0.8}
        >
          <Ionicons name="musical-notes" size={18} color={colors.primary} />
          <Text style={styles.musicRowText} numberOfLines={1}>
            {(((user as any)?.music_prefs || []) as string[]).length > 0
              ? normalizeGenres((user as any).music_prefs as string[]).map(genreLabel).join(' · ')
              : 'Choisis tes styles préférés'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* ── Réglages profil (Tinder-like) ── */}
        <Text style={styles.label}>Réglages profil</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingText}>Smart Photos</Text>
            <Switch
              value={smartPhotos}
              onValueChange={setSmartPhotos}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              testID="sf-smart-photos"
            />
          </View>
          <Text style={styles.settingHint}>
            Smart Photos teste tes photos et affiche en premier celle qui te fait le plus liker.
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 4 }}>
            <Text style={styles.settingSection}>Gère ta visibilité</Text>
            <View style={styles.premiumChip}>
              <Text style={styles.premiumChipText} allowFontScaling={false}>Premium ✨</Text>
            </View>
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingText}>Masquer mon âge</Text>
            <Switch
              value={hideAge}
              onValueChange={(v) => {
                if (!isPremium) { router.push('/paywall' as any); return; }
                setHideAge(v);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              testID="sf-hide-age"
            />
          </View>
          <View style={styles.settingRow}>
            <Text style={styles.settingText}>Masquer ma distance</Text>
            <Switch
              value={hideDistance}
              onValueChange={(v) => {
                if (!isPremium) { router.push('/paywall' as any); return; }
                setHideDistance(v);
              }}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              testID="sf-hide-distance"
            />
          </View>
        </View>
      </ScrollView>

      {/* Sélection des passions */}
      <Modal visible={interestsOpen} transparent animationType="slide" onRequestClose={() => setInterestsOpen(false)}>
        <View style={styles.musicOverlay}>
          <View style={[styles.musicSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.musicSheetHeader}>
              <Text style={styles.musicSheetTitle}>Tes passions ❤️</Text>
              <TouchableOpacity onPress={() => setInterestsOpen(false)} hitSlop={10} testID="sf-interests-close">
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={styles.chipsRow}>
              {INTEREST_OPTIONS.map((opt) => {
                const on = interests.includes(opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() =>
                      setInterests((prev) =>
                        on ? prev.filter((x) => x !== opt) : prev.length < 10 ? [...prev, opt] : prev,
                      )
                    }
                    testID={`sf-interest-${opt.replace(/^[^\s]+\s/, '')}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.musicSaveBtn}
              onPress={() => setInterestsOpen(false)}
              testID="sf-interests-done"
            >
              <Text style={styles.musicSaveText}>OK ({interests.length}/10)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Aperçu de ma carte swipe */}
      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)}>
        <View style={styles.prevContainer}>
          {photos[0] ? (
            <Image source={{ uri: photos[0] }} style={StyleSheet.absoluteFillObject as any} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="person" size={64} color={colors.textTertiary} />
            </View>
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)']} style={styles.prevGradient} />
          <TouchableOpacity
            style={[styles.previewClose, { top: insets.top + 14 }]}
            onPress={() => setPreviewOpen(false)}
            testID="sf-preview-close-card"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.prevBadge, { top: insets.top + 18 }]}>
            <Text style={styles.prevBadgeText} allowFontScaling={false}>👀 Aperçu — ce que les autres voient</Text>
          </View>
          <View style={[styles.prevInfo, { paddingBottom: insets.bottom + 28 }]}>
            <Text style={styles.prevName}>
              {((u.name as string) || 'Toi').split(' ')[0]}
              {!hideAge && dob ? `, ${Math.max(0, new Date().getFullYear() - parseInt(dob.slice(0, 4), 10) - (new Date() < new Date(new Date().getFullYear(), parseInt(dob.slice(5, 7), 10) - 1, parseInt(dob.slice(8, 10), 10)) ? 1 : 0))}` : ''}
              {verified ? '  ' : ''}
              {verified ? <Ionicons name="checkmark-circle" size={22} color="#3B82F6" /> : null}
            </Text>
            {!!city && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <Ionicons name="location" size={14} color="rgba(255,255,255,0.85)" />
                <Text style={styles.prevCity}>{city}</Text>
              </View>
            )}
            {interests.length > 0 && (
              <View style={styles.prevChips}>
                {interests.slice(0, 5).map((i) => (
                  <View key={i} style={styles.prevChip}>
                    <Text style={styles.prevChipText} allowFontScaling={false}>{i}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!bio && <Text style={styles.prevBio} numberOfLines={3}>{bio}</Text>}
          </View>
        </View>
      </Modal>

      {/* Aperçu photo plein écran */}
      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => { setPreviewUri(null); setPreviewIdx(null); }}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={styles.previewBackdrop} activeOpacity={1} onPress={() => { setPreviewUri(null); setPreviewIdx(null); }} />
          {previewUri && <Image source={{ uri: previewUri }} style={styles.previewImg} resizeMode="contain" />}
          <TouchableOpacity
            style={[styles.previewClose, { top: insets.top + 14 }]}
            onPress={() => { setPreviewUri(null); setPreviewIdx(null); }}
            testID="sf-preview-close"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {previewIdx != null && previewIdx > 0 && (
            <TouchableOpacity
              style={[styles.makeMainBtn, { bottom: insets.bottom + 30 }]}
              onPress={() => {
                setPhotos((prev) => {
                  const next = [...prev];
                  const [ph] = next.splice(previewIdx, 1);
                  next.unshift(ph);
                  return next;
                });
                setPreviewUri(null);
                setPreviewIdx(null);
              }}
              testID="sf-make-main"
            >
              <Ionicons name="star" size={16} color="#fff" />
              <Text style={styles.makeMainText}>Définir comme photo principale</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      {/* Sélection des goûts musicaux */}
      <Modal visible={musicOpen} transparent animationType="slide" onRequestClose={() => setMusicOpen(false)}>
        <View style={styles.musicOverlay}>
          <View style={[styles.musicSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.musicSheetHeader}>
              <Text style={styles.musicSheetTitle}>Tes goûts musicaux 🎧</Text>
              <TouchableOpacity onPress={() => setMusicOpen(false)} hitSlop={10} testID="sf-music-close">
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.chipsRow}>
              {MUSIC_GENRES.map((g) => {
                const on = musicSel.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.chip, on && styles.chipActive]}
                    onPress={() => setMusicSel((prev) => (on ? prev.filter((x) => x !== g.id) : [...prev, g.id]))}
                    testID={`sf-music-${g.id}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextActive]}>
                      {g.emoji} {g.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.musicSaveBtn, musicSel.length === 0 && { opacity: 0.5 }]}
              onPress={saveMusic}
              disabled={musicSaving}
              testID="sf-music-save"
            >
              {musicSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.musicSaveText}>Enregistrer ({musicSel.length})</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  photosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoCell: {
    width: '100%',
    height: 140,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  musicRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderStrong,
    paddingHorizontal: 16, paddingVertical: 14, minHeight: 48,
  },
  musicRowText: { color: colors.textPrimary, fontSize: 14.5, fontWeight: '600', flex: 1 },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  previewBackdrop: { ...StyleSheet.absoluteFillObject },
  previewImg: { width: '92%', height: '78%' },
  makeMainBtn: {
    position: 'absolute', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 13, minHeight: 46,
  },
  makeMainText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  previewClose: {
    position: 'absolute', right: 16, width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center',
  },
  musicOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  musicSheet: {
    backgroundColor: colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
  },
  musicSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  musicSheetTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  musicSaveBtn: {
    backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', marginTop: 18, minHeight: 48, justifyContent: 'center',
  },
  musicSaveText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  heroPreview: { color: colors.primary, fontSize: 13.5, fontWeight: '800' },
  settingsCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 44,
  },
  settingText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  settingHint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  settingSection: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  premiumChip: {
    backgroundColor: colors.primary, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  premiumChipText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  prevContainer: { flex: 1, backgroundColor: '#000' },
  prevGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 340 },
  prevBadge: {
    position: 'absolute', alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  prevBadgeText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  prevInfo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg },
  prevName: { color: '#fff', fontSize: 32, fontWeight: '900' },
  prevCity: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  prevChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  prevChip: {
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  prevChipText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  prevBio: { color: 'rgba(255,255,255,0.9)', fontSize: 14, lineHeight: 19, marginTop: 10 },
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
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  heroAvatar: { width: 64, height: 64, borderRadius: 18 },
  heroAvatarFb: { backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  heroName: { color: colors.textPrimary, fontSize: 26, fontWeight: '900' },
  heroSub: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  completionPillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 26,
    paddingVertical: 13,
    marginBottom: 14,
  },
  completionPillText: { color: colors.textPrimary, fontSize: 15.5, fontWeight: '800' },
  missingRow: { gap: 8, paddingRight: 20 },
  missingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  missingChipText: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  missingDot: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  photosTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', marginBottom: 4 },
  completionBarBg: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  completionBarFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
