import { useState, useMemo, useEffect, useRef } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { useTranslation } from '../lib/i18n';

/**
 * Reset password screen.
 *
 * Route params:
 *   - email:  the email that was submitted on the forgot-password screen (required for OTP flow)
 *   - token:  present when arriving from a magic-link deep link (auto-uses this token)
 */
export default function ResetPassword() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { t } = useTranslation();
  const { setSession } = useAuth();
  const params = useLocalSearchParams<{ email?: string; token?: string }>();

  const isLinkMode = !!params.token;
  const [email, setEmail] = useState(params.email ? String(params.email) : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Auto-focus the code field for OTP flow
    if (!isLinkMode) {
      const timer = setTimeout(() => codeInputRef.current?.focus(), 350);
      return () => clearTimeout(timer);
    }
  }, [isLinkMode]);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 6 &&
    (isLinkMode ? true : code.trim().length === 6);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const payload: { email: string; code?: string; token?: string; new_password: string } = {
        email: email.trim().toLowerCase(),
        new_password: password,
      };
      if (isLinkMode) payload.token = String(params.token);
      else payload.code = code.trim();

      const res = await api.resetPassword(payload);
      await setSession(res.token, res.user);
      setSuccess(true);
      // Head to the app after a short beat
      setTimeout(() => router.replace('/(tabs)'), 900);
    } catch (e: any) {
      setError(e?.message || t('forgot.errInvalidCode'));
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
        testID="reset-password-screen"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="reset-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        {success ? (
          <Animated.View entering={FadeInDown.springify()} style={styles.success}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={34} color={colors.primary} />
            </View>
            <Text style={styles.title}>{t('forgot.successTitle')}</Text>
            <Text style={styles.subtitle}>{t('forgot.successBody')}</Text>
          </Animated.View>
        ) : (
          <>
            <Text style={styles.title}>{t('forgot.title')}</Text>
            <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

            <View style={styles.field}>
              <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t('forgot.email')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!params.email}
                style={styles.input}
                testID="reset-email-input"
              />
            </View>

            {!isLinkMode && (
              <View style={styles.field}>
                <Ionicons name="keypad-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  ref={codeInputRef}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('forgot.codePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.input, styles.codeInput]}
                  testID="reset-code-input"
                />
              </View>
            )}

            <View style={styles.field}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t('forgot.newPasswordPlaceholder')}
                placeholderTextColor={colors.textTertiary}
                secureTextEntry
                autoCapitalize="none"
                style={styles.input}
                testID="reset-password-input"
              />
            </View>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.primaryBtn, (!canSubmit || loading) && { opacity: 0.5 }]}
              onPress={onSubmit}
              disabled={loading || !canSubmit}
              testID="reset-submit-btn"
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.primaryBtnText}>{t('forgot.confirmBtn')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    scroll: { padding: spacing.xl, paddingTop: 64 },
    back: { marginBottom: spacing.lg, width: 40, height: 40, justifyContent: 'center' },
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
      lineHeight: 22,
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
    codeInput: {
      fontVariant: ['tabular-nums'],
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: 8,
    },
    error: {
      color: colors.danger ?? '#FF3B30',
      fontSize: 13,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.full,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    primaryBtnText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
    success: {
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.xl * 2,
    },
    successIcon: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primarySoft,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
  });
