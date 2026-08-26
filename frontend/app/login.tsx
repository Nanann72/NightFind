import { useState, useMemo } from 'react';
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
import { HapticButton } from '../components/ui/HapticButton';
import { radius, spacing, shadows, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { useTranslation } from '../lib/i18n';

export default function Login() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { t } = useTranslation();
  const { signIn, signIn2FA } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFA, setTwoFA] = useState(false);
  const [otpCode, setOtpCode] = useState('');
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
      if (twoFA) {
        await signIn2FA(email.trim(), password, otpCode.trim());
      } else {
        const r = await signIn(email.trim(), password);
        if (r?.twoFactorRequired) {
          setTwoFA(true);
          setErr(null);
          setLoading(false);
          return; // le code SMS vient d'être envoyé
        }
      }
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
          <Text style={styles.title}>{t('auth.loginTitle')}</Text>
          <Text style={styles.subtitle}>
            {t('auth.loginSubtitle')}
          </Text>
        </View>

        <View style={styles.field}>
          <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.email')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.input}
            testID="login-email-input"
            accessibilityLabel={t('auth.email')}
          />
        </View>

        <View style={styles.field}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.password')}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={!showPwd}
            autoComplete="password"
            textContentType="password"
            style={styles.input}
            testID="login-password-input"
            accessibilityLabel={t('auth.password')}
          />
          <TouchableOpacity
            onPress={() => setShowPwd((v) => !v)}
            accessibilityLabel={showPwd ? t('auth.hidePassword') : t('auth.showPassword')}
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPwd ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {twoFA && (
          <View style={styles.field}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
            <TextInput
              value={otpCode}
              onChangeText={setOtpCode}
              placeholder="Code SMS (A2F)"
              placeholderTextColor={colors.textTertiary}
              keyboardType="number-pad"
              maxLength={8}
              style={styles.input}
              testID="login-2fa-input"
            />
          </View>
        )}

        <Link href="/forgot-password" asChild>
          <TouchableOpacity
            style={styles.forgot}
            testID="forgot-link"
            accessibilityLabel={t('auth.forgotPassword')}
            accessibilityRole="link"
          >
            <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
          </TouchableOpacity>
        </Link>

        {err && (
          <Text style={styles.error} testID="login-error" accessibilityLiveRegion="polite">
            {err}
          </Text>
        )}

        <HapticButton
          haptic="medium"
          scale={0.97}
          style={[styles.primaryBtn, shadows.primaryGlow]}
          onPress={onSubmit}
          disabled={loading}
          testID="login-submit-btn"
          accessibilityLabel="Se connecter"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryBtnText}>{t('auth.signIn')}</Text>
          )}
        </HapticButton>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>{t('common.or')}</Text>
          <View style={styles.line} />
        </View>

        <SocialAuthButtons />

        <View style={styles.bottom}>
          <Text style={styles.bottomText}>{t('auth.dontHaveAccount')} </Text>
          <Link href="/register" asChild>
            <TouchableOpacity testID="goto-register-link">
              <Text style={styles.bottomLink}>{t('auth.signUp')}</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
