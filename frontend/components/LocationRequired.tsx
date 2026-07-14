/**
 * Elegant "location denied" state (App Store Guideline 5.1.1/5.1.5 compliant).
 * Shown by location-dependent features when the permission was refused.
 * Offers "Ouvrir Réglages" (deep-link to app settings) and an optional
 * secondary action so the user is never dead-ended.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

export function LocationRequired({
  onContinueWithout,
}: {
  onContinueWithout?: () => void;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container} testID="location-required-screen">
      <Animated.View entering={FadeInDown.duration(400)} style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="location-outline" size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>Localisation désactivée</Text>
        <Text style={styles.text}>
          La localisation est nécessaire pour utiliser cette fonctionnalité.
        </Text>
        <TouchableOpacity
          style={styles.settingsBtn}
          activeOpacity={0.85}
          onPress={() => Linking.openSettings().catch(() => {})}
          testID="open-settings-btn"
        >
          <Ionicons name="settings-outline" size={17} color="#fff" />
          <Text style={styles.settingsText}>Ouvrir Réglages</Text>
        </TouchableOpacity>
        {onContinueWithout ? (
          <TouchableOpacity
            onPress={onContinueWithout}
            style={styles.secondary}
            testID="continue-without-location"
          >
            <Text style={styles.secondaryText}>Continuer sans localisation</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 28,
    alignItems: 'center',
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  text: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 8,
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 22,
    alignSelf: 'stretch',
    minHeight: 48,
  },
  settingsText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { marginTop: 14, padding: 6 },
  secondaryText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
