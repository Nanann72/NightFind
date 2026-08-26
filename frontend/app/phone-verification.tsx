/**
 * Vérification du numéro de téléphone (Twilio Verify) + activation A2F.
 */
import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export default function PhoneVerification() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();

  const [phone, setPhone] = useState<string>(((user as any)?.phone as string) || '+33');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<boolean>(!!(user as any)?.phone_verified);
  const [twoFA, setTwoFA] = useState<boolean>(!!(user as any)?.two_factor_enabled);

  const sendCode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.sendPhoneOtp(phone.trim().replace(/\s/g, ''));
      setSent(true);
      Alert.alert('Code envoyé 📲', 'Regarde tes SMS et saisis le code reçu.');
    } catch (e: any) {
      Alert.alert('Envoi impossible', e?.message || 'Réessaie.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.verifyPhoneOtp(phone.trim().replace(/\s/g, ''), code.trim());
      setVerified(true);
      refresh?.();
      Alert.alert('Numéro vérifié ✅', 'Tu peux maintenant activer la double authentification.');
    } catch (e: any) {
      Alert.alert('Code invalide', e?.message || 'Vérifie le code et réessaie.');
    } finally {
      setBusy(false);
    }
  };

  const toggle2FA = async (v: boolean) => {
    setTwoFA(v);
    try {
      await api.setTwoFactor(v);
      refresh?.();
    } catch (e: any) {
      setTwoFA(!v);
      Alert.alert('Oups', e?.message || 'Réessaie.');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="phone-verification-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="phone-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Téléphone & A2F 🔐</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {verified ? 'Numéro vérifié ✅' : 'Vérifie ton numéro'}
          </Text>
          <Text style={styles.cardText}>
            {verified
              ? 'Ton numéro est confirmé — tu peux activer la double authentification ci-dessous.'
              : 'Format international requis (ex : +33612345678). Un code te sera envoyé par SMS.'}
          </Text>
          {!verified && (
            <>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+33612345678"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
                style={styles.input}
                testID="phone-input"
              />
              {sent && (
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="Code SMS"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  maxLength={8}
                  style={styles.input}
                  testID="phone-code-input"
                />
              )}
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={sent ? confirm : sendCode}
                disabled={busy}
                testID="phone-submit-btn"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {sent ? 'Confirmer le code' : 'Envoyer le code SMS'}
                  </Text>
                )}
              </TouchableOpacity>
              {sent && (
                <TouchableOpacity onPress={sendCode} style={styles.linkBtn} testID="phone-resend-btn">
                  <Text style={styles.linkText}>Renvoyer un code</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.cardTitle}>Double authentification (A2F)</Text>
              <Text style={styles.cardText}>
                À chaque connexion, un code SMS sera demandé en plus du mot de passe.
              </Text>
            </View>
            <Switch
              value={twoFA}
              onValueChange={toggle2FA}
              disabled={!verified}
              trackColor={{ true: colors.primary, false: colors.border }}
              testID="twofa-switch"
            />
          </View>
          {!verified && (
            <Text style={styles.helper}>Vérifie d&apos;abord ton numéro pour activer l&apos;A2F.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: 12,
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  scroll: { padding: spacing.lg, gap: 14 },
  card: {
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.xl, padding: 18,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  cardText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 12 },
  input: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    paddingHorizontal: 16, paddingVertical: 13, color: colors.textPrimary, fontSize: 16,
    fontWeight: '700', marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14,
    alignItems: 'center', minHeight: 48, justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  linkBtn: { marginTop: 12, alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  linkText: { color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  rowBetween: { flexDirection: 'row', alignItems: 'center' },
  helper: { color: colors.textTertiary, fontSize: 12, marginTop: 8 },
});
