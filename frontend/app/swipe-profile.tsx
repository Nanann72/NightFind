import { useState, useEffect } from 'react';
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
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
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
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ');
      return;
    }
    setSaving(true);
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
    }
  };

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
        <TextInput
          value={dob}
          onChangeText={setDob}
          placeholder="AAAA-MM-JJ"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoCapitalize="none"
          testID="sf-dob"
        />

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
