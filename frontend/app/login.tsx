import { useState } from 'react';
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
  Alert,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { SocialAuthButtons } from '../components/SocialAuthButtons';
import { colors, radius, spacing } from '../lib/theme';

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!email || !password) {
      setErr('Email et mot de passe requis');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e.message || 'Connexion impossible');
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
        testID="login-screen"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>NIGHT FINDER</Text>
          <Text style={styles.title}>Bon retour parmi nous</Text>
          <Text style={styles.subtitle}>
            Connectez-vous pour retrouver vos clubs favoris.
          </Text>
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
            testID="login-email-input"
          />
        </View>

        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Mot de passe"
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!showPwd}
            style={styles.input}
            testID="login-password-input"
          />
          <TouchableOpacity onPress={() => setShowPwd((v) => !v)}>
            <Ionicons
              name={showPwd ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <Link href="/forgot-password" asChild>
          <TouchableOpacity style={styles.forgot} testID="forgot-link">
            <Text style={styles.forgotText}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </Link>

        {err && (
          <Text style={styles.error} testID="login-error">
            {err}
          </Text>
        )}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={onSubmit}
          disabled={loading}
          testID="login-submit-btn"
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>Se connecter</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>OU</Text>
          <View style={styles.line} />
        </View>

        <SocialAuthButtons />

        <View style={styles.bottom}>
          <Text style={styles.bottomText}>Pas encore de compte ? </Text>
          <Link href="/register" asChild>
            <TouchableOpacity testID="goto-register-link">
              <Text style={styles.bottomLink}>S'inscrire</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingTop: 80, paddingBottom: 40 },
  header: { marginBottom: spacing.xl },
  brand: {
    color: colors.primary,
    fontWeight: '900',
    letterSpacing: 4,
    fontSize: 13,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 8,
  },
  subtitle: { color: colors.textSecondary, fontSize: 15 },
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
  forgot: { alignSelf: 'flex-end', marginBottom: spacing.lg },
  forgotText: { color: colors.tertiary, fontWeight: '600', fontSize: 13 },
  error: {
    color: colors.danger,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: spacing.lg,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: {
    color: colors.textTertiary,
    fontSize: 12,
    letterSpacing: 2,
  },
  googleBtn: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  bottomText: { color: colors.textSecondary },
  bottomLink: { color: colors.primary, fontWeight: '700' },
});
