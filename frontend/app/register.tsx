import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { loadOnboarding, clearOnboarding } from '../lib/onboardingStore';
import { SocialAuthButtons } from '../components/SocialAuthButtons';
import { MaskedDOBInput } from '../components/MaskedDOBInput';
import { HapticButton } from '../components/ui/HapticButton';
import { colors, radius, spacing, shadows } from '../lib/theme';

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState(''); // YYYY-MM-DD
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefilledMusic, setPrefilledMusic] = useState<string[]>([]);
  const [prefilledSwipe, setPrefilledSwipe] = useState<{
    photos?: string[]; bio?: string; city?: string; instagram?: string; dob?: string;
  }>({});

  useEffect(() => {
    loadOnboarding().then((data) => {
      if (data.name) setName(data.name);
      if (data.music) setPrefilledMusic(data.music);
      // Pre-fill DOB from onboarding if collected there
      if (data.dob) setDob(data.dob);
      setPrefilledSwipe({
        photos: data.photos,
        bio: data.bio,
        city: data.city,
        instagram: data.instagram,
        dob: data.dob,
      });
    });
  }, []);

  const onSubmit = async () => {
    setErr(null);
    if (!name.trim() || !email.trim()) {
      setErr('Nom et email requis');
      return;
    }
    if (password.length < 8) {
      setErr('Mot de passe trop court (8 caractères minimum)');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      setErr('Choisis ta date de naissance');
      return;
    }
    // Client-side 18+ check (server also validates)
    const dt = new Date(dob);
    const today = new Date();
    const age = today.getFullYear() - dt.getFullYear() - (
      today.getMonth() < dt.getMonth() ||
      (today.getMonth() === dt.getMonth() && today.getDate() < dt.getDate()) ? 1 : 0
    );
    if (age < 18) {
      setErr('Tu dois avoir 18 ans ou plus pour utiliser Night Finder');
      return;
    }
    if (!acceptTerms) {
      setErr("Tu dois accepter les CGU et la Politique de confidentialité");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim(), dob);
      // Push onboarding music prefs to profile
      if (prefilledMusic.length > 0) {
        api.updateProfile({ music_prefs: prefilledMusic }).catch(() => {});
      }
      // Push onboarding swipe profile fields (photos/bio/city/instagram) collected during intro
      const swipeFields: any = {};
      if (prefilledSwipe.photos && prefilledSwipe.photos.length > 0) swipeFields.photos = prefilledSwipe.photos;
      if (prefilledSwipe.bio) swipeFields.bio = prefilledSwipe.bio;
      if (prefilledSwipe.city) swipeFields.city = prefilledSwipe.city;
      if (prefilledSwipe.instagram) swipeFields.instagram = prefilledSwipe.instagram;
      if (Object.keys(swipeFields).length > 0) {
        api.updateSwipeFields(swipeFields).catch(() => {});
      }
      await clearOnboarding();
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || "Inscription impossible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        testID="register-screen"
      >
        <TouchableOpacity
          style={styles.back}
          onPress={() => router.back()}
          testID="register-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.subtitle}>
          Trouvez les meilleures soirées autour de vous.
        </Text>

        <View style={styles.field}>
          <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nom"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            testID="register-name-input"
          />
        </View>
        <View style={styles.field}>
          <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
            testID="register-email-input"
          />
        </View>
        <View style={{ marginBottom: spacing.md }}>
          <MaskedDOBInput
            value={dob}
            onChange={setDob}
            testID="register-dob-input"
            placeholder="JJ/MM/AAAA"
          />
        </View>
        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe (8+ caractères)"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={styles.input}
            testID="register-password-input"
          />
        </View>

        <TouchableOpacity
          style={styles.termsRow}
          onPress={() => setAcceptTerms((v) => !v)}
          activeOpacity={0.7}
          testID="register-accept-terms"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptTerms }}
        >
          <View style={[styles.checkbox, acceptTerms && styles.checkboxChecked]}>
            {acceptTerms && <Ionicons name="checkmark" size={14} color={colors.bg} />}
          </View>
          <Text style={styles.termsText}>
            J'accepte les{' '}
            <Text
              style={styles.termsLink}
              onPress={() => router.push({ pathname: '/legal', params: { doc: 'cgu' } })}
            >
              Conditions Générales d'Utilisation
            </Text>{' '}
            et la{' '}
            <Text
              style={styles.termsLink}
              onPress={() => router.push({ pathname: '/legal', params: { doc: 'privacy' } })}
            >
              Politique de Confidentialité
            </Text>
            .
          </Text>
        </TouchableOpacity>

        {err && (
          <Text style={styles.error} testID="register-error">
            {err}
          </Text>
        )}

        <HapticButton
          haptic="medium"
          scale={0.97}
          style={[styles.primaryBtn, shadows.primaryGlow, (!acceptTerms || loading) && { opacity: 0.5 }]}
          onPress={onSubmit}
          disabled={loading || !acceptTerms}
          testID="register-submit-btn"
        >
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>S&apos;inscrire</Text>
          )}
        </HapticButton>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OU</Text>
          <View style={styles.dividerLine} />
        </View>

        <SocialAuthButtons />

        <View style={styles.bottom}>
          <Text style={styles.bottomText}>Déjà inscrit ? </Text>
          <Link href="/login" asChild>
            <TouchableOpacity testID="goto-login-link">
              <Text style={styles.bottomLink}>Se connecter</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingTop: 64, paddingBottom: 40 },
  back: { marginBottom: spacing.lg },
  title: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: spacing.xl,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 16,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    marginVertical: spacing.md,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: spacing.md,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  termsText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  termsLink: { color: colors.primary, fontWeight: '800', textDecorationLine: 'underline' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textTertiary, fontSize: 12, letterSpacing: 2 },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  bottomText: { color: colors.textSecondary },
  bottomLink: { color: colors.primary, fontWeight: '700' },
});
