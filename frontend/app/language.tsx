import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../lib/themeContext';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useTranslation, SUPPORTED_LANGS, type LangCode } from '../lib/i18n';

export default function LanguagePicker() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { t, lang, setLang } = useTranslation();

  const onPick = async (code: LangCode) => {
    if (code === lang) {
      router.back();
      return;
    }
    await setLang(code);
    // For RTL <-> LTR transitions on native, the layout needs a reload.
    if (Platform.OS !== 'web' && (code === 'ar' || lang === 'ar')) {
      Alert.alert(
        '🔄',
        'Une relance peut être nécessaire pour appliquer la disposition RTL.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          testID="language-back"
        >
          <Ionicons name="chevron-back" size={28} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.language')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 32 }}>
        <Text style={styles.sub}>{t('language.sub')}</Text>
        <View style={styles.group}>
          {SUPPORTED_LANGS.map((l) => {
            const active = l.code === lang;
            return (
              <TouchableOpacity
                key={l.code}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => onPick(l.code as LangCode)}
                testID={`lang-${l.code}`}
              >
                <Text style={styles.flag}>{l.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{l.native}</Text>
                  <Text style={styles.sub2}>{l.label}</Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.textPrimary, flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  sub: { color: colors.textSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 13 },
  group: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  flag: { fontSize: 28 },
  label: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  sub2: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});

// Module-level fallback
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _styles = makeStyles(darkColors);
