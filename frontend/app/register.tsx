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
import { colors, radius, spacing } from '../lib/theme';

export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefilledMusic, setPrefilledMusic] = useState<string[]>([]);

  useEffect(() => {
    loadOnboarding().then((data) => {
      if (data.name) setName(data.name);
      if (data.music) setPrefilledMusic(data.music);
    });
  }, []);

  const onSubmit = async () => {
    setErr(null);
    if (!name || !email || password.length < 6) {
      setErr('Nom, email et mot de passe (6+ caractères) requis');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      // Push onboarding music prefs to profile
      if (prefilledMusic.length > 0) {
        api.updateProfile({ music_prefs: prefilledMusic }).catch(() => {});
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
        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe (6+ caractères)"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry
            style={styles.input}
            testID="register-password-input"
          />
        </View>

        {err && (
          <Text style={styles.error} testID="register-error">
            {err}
          </Text>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onSubmit}
          disabled={loading}
          testID="register-submit-btn"
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>S'inscrire</Text>
          )}
        </TouchableOpacity>

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
