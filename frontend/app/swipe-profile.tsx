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
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MaskedDOBInput } from '../components/MaskedDOBInput';
import { colors, radius, spacing } from '../lib/theme';

export default function SwipeProfileEdit() {
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
        <Text style={styles.label}>Photos (max 3) *</Text>
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
            </View>
          ))}
          {photos.length < 3 && (
            <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto} testID="sf-add-photo">
              <Ionicons name="add" size={36} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
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

const styles = StyleSheet.create({
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
    justifyContent: 'center',
  },
});
