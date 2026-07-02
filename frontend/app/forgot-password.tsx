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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { useTranslation } from '../lib/i18n';

type Mode = 'otp' | 'link';

export default function ForgotPassword() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { t } = useTranslation();

  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<Mode>('otp');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase(), mode);
    } catch {
      // still show success (privacy)
    } finally {
      setSent(true);
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
        testID="forgot-password-screen"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="forgot-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.title}>{t('forgot.title')}</Text>
        <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

        {sent ? (
          <Animated.View entering={FadeInDown.springify()} style={styles.success} testID="forgot-success">
            <View style={styles.successIcon}>
              <Ionicons name="mail-outline" size={30} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>
              {mode === 'otp' ? t('forgot.otpSentTitle') : t('forgot.linkSentTitle')}
            </Text>
            <Text style={styles.successText}>
              {mode === 'otp'
                ? t('forgot.otpSentBody', { email: email.trim() })
                : t('forgot.linkSentBody', { email: email.trim() })}
            </Text>

            {mode === 'otp' && (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() =>
                  router.push({ pathname: '/reset-password', params: { email: email.trim() } })
                }
                testID="have-code-btn"
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>{t('forgot.haveCode')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={() => router.replace('/login')}
              testID="back-to-login-btn"
            >
              <Text style={styles.ghostBtnText}>{t('forgot.goToLogin')}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <>
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
                style={styles.input}
                testID="forgot-email-input"
              />
            </View>

            <View style={styles.segmentGroup}>
              <TouchableOpacity
                style={[styles.segment, mode === 'otp' && styles.segmentActive]}
                onPress={() => setMode('otp')}
                testID="mode-otp"
                activeOpacity={0.8}
              >
                <Ionicons
                  name="keypad-outline"
                  size={20}
                  color={mode === 'otp' ? colors.primary : colors.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.segmentLabel, mode === 'otp' && styles.segmentLabelActive]}>
                    {t('forgot.modeOtp')}
                  </Text>
                  <Text style={styles.segmentHint}>{t('forgot.modeOtpHint')}</Text>
                </View>
                {mode === 'otp' && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segment, mode === 'link' && styles.segmentActive]}
                onPress={() => setMode('link')}
                testID="mode-link"
                activeOpacity={0.8}
              >
                <Ionicons
                  name="link-outline"
                  size={20}
                  color={mode === 'link' ? colors.primary : colors.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.segmentLabel, mode === 'link' && styles.segmentLabelActive]}>
                    {t('forgot.modeLink')}
                  </Text>
                  <Text style={styles.segmentHint}>{t('forgot.modeLinkHint')}</Text>
                </View>
                {mode === 'link' && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, (!email.trim() || loading) && { opacity: 0.5 }]}
              onPress={onSubmit}
              disabled={loading || !email.trim()}
              testID="forgot-submit-btn"
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {loading ? t('forgot.sendingBtn') : t('forgot.sendBtn')}
                </Text>
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
      marginBottom: spacing.lg,
    },
    input: {
      flex: 1,
      color: colors.textPrimary,
      paddingVertical: 16,
      fontSize: 15,
    },
    segmentGroup: {
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    segment: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    segmentActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    segmentLabel: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    segmentLabelActive: {
      color: colors.textPrimary,
    },
    segmentHint: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: radius.full,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    primaryBtnText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
    ghostBtn: {
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    ghostBtnText: {
      color: colors.textSecondary,
      fontWeight: '600',
      fontSize: 14,
    },
    success: {
      alignItems: 'center',
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    successIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primarySoft,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    successTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
    successText: {
      color: colors.textSecondary,
      textAlign: 'center',
      fontSize: 15,
      lineHeight: 22,
      marginBottom: spacing.sm,
    },
  });
