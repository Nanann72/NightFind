import { useState } from 'react';
import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

export function SocialAuthButtons({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);

  const handleGoogle = async () => {
    setBusy('google');
    try {
      await signInWithGoogle();
      onSuccess?.();
      router.replace('/(tabs)');
    } catch (e: any) {
      if (Platform.OS !== 'web') {
        Alert.alert('Connexion Google', e?.message || 'Impossible de se connecter.');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleApple = async () => {
    setBusy('apple');
    try {
      await signInWithApple();
      onSuccess?.();
      router.replace('/(tabs)');
    } catch (e: any) {
      const msg = e?.message || '';
      if (!msg.includes('canceled') && !msg.includes('cancel')) {
        Alert.alert('Connexion Apple', msg || 'Impossible de se connecter.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.googleBtn}
        onPress={handleGoogle}
        disabled={busy !== null}
        activeOpacity={0.85}
        testID="social-google-btn"
      >
        {busy === 'google' ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={colors.textPrimary} />
            <Text style={styles.googleText}>Continuer avec Google</Text>
          </>
        )}
      </TouchableOpacity>

      {Platform.OS === 'ios' && (
        <TouchableOpacity
          style={styles.appleBtn}
          onPress={handleApple}
          disabled={busy !== null}
          activeOpacity={0.85}
          testID="social-apple-btn"
        >
          {busy === 'apple' ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <>
              <Ionicons name="logo-apple" size={20} color={colors.bg} />
              <Text style={styles.appleText}>Continuer avec Apple</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  googleBtn: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingVertical: 14,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  appleBtn: {
    flexDirection: 'row',
    backgroundColor: colors.textPrimary,
    paddingVertical: 14,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  appleText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
});
