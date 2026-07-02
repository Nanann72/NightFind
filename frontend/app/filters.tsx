import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useClubs } from '../lib/clubs';
import { usePremium } from '../lib/premium';
import { HapticButton } from '../components/ui/HapticButton';
import { radius, spacing, shadows, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { useTranslation } from '../lib/i18n';

const MUSIC_GENRES = [
  'techno', 'house', 'electronic', 'hip-hop', 'rnb', 'disco',
  'afro-house', 'latin', 'jazz', 'soul', 'rock', 'indie',
];
const RADIUS_OPTIONS = [5, 10, 25, 50];
const RADIUS_PREMIUM = 200;

export default function Filters() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { filters, setFilters } = useClubs();
  const { isPremium } = usePremium();

  const [music, setMusic] = useState<string | undefined>(filters.music);
  const [radiusKm, setRadiusKm] = useState(filters.radius_km);
  const [maxPrice, setMaxPrice] = useState<string>(
    filters.max_price ? String(filters.max_price) : '',
  );
  const [openNow, setOpenNow] = useState(!!filters.open_now);
  const [vip, setVip] = useState(!!filters.vip);
  const [terrasse, setTerrasse] = useState(!!filters.terrasse);

  const apply = () => {
    setFilters({
      music,
      max_price: maxPrice ? parseFloat(maxPrice) : undefined,
      radius_km: radiusKm,
      open_now: openNow,
      vip,
      terrasse,
    });
    router.back();
  };

  const reset = () => {
    setMusic(undefined);
    setRadiusKm(50);
    setMaxPrice('');
    setOpenNow(false);
    setVip(false);
    setTerrasse(false);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="filters-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="filters-close-btn">
          <Ionicons name="close" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('filters.title')}</Text>
        <TouchableOpacity onPress={reset} testID="filters-reset-btn">
          <Text style={styles.reset}>{t('filters.reset')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        <Section title={t('filters.distance')}>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.pill, radiusKm === r && styles.pillActive]}
                onPress={() => setRadiusKm(r)}
                testID={`radius-${r}`}
              >
                <Text style={[styles.pillText, radiusKm === r && styles.pillTextActive]}>
                  {r} km
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.pill,
                styles.pillPremium,
                radiusKm === RADIUS_PREMIUM && styles.pillActive,
              ]}
              onPress={() => {
                if (isPremium) {
                  setRadiusKm(RADIUS_PREMIUM);
                } else {
                  router.push('/paywall');
                }
              }}
              testID={`radius-${RADIUS_PREMIUM}`}
            >
              <Ionicons
                name={isPremium ? 'flash' : 'lock-closed'}
                size={12}
                color={radiusKm === RADIUS_PREMIUM ? colors.bg : '#F472B6'}
                style={{ marginRight: 4 }}
              />
              <Text
                style={[
                  styles.pillText,
                  styles.pillPremiumText,
                  radiusKm === RADIUS_PREMIUM && styles.pillTextActive,
                ]}
              >
                {RADIUS_PREMIUM} km
              </Text>
            </TouchableOpacity>
          </View>
          {!isPremium ? (
            <Text style={styles.premiumHint}>
              {t('filters.premiumHint')}
            </Text>
          ) : null}
        </Section>

        <Section title={t('filters.musicStyle')}>
          <View style={styles.tagsRow}>
            {MUSIC_GENRES.map((g) => {
              const active = music === g;
              return (
                <TouchableOpacity
                  key={g}
                  style={[styles.tag, active && styles.tagActive]}
                  onPress={() => setMusic(active ? undefined : g)}
                  testID={`music-${g}`}
                >
                  <Text style={[styles.tagText, active && styles.tagTextActive]}>{g}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        <Section title={t('filters.maxPrice')}>
          <View style={styles.priceRow}>
            <TextInput
              keyboardType="numeric"
              value={maxPrice}
              onChangeText={setMaxPrice}
              placeholder={t('filters.pricePh')}
              placeholderTextColor={colors.textTertiary}
              style={styles.priceInput}
              testID="max-price-input"
            />
            <Text style={styles.priceSuffix}>€</Text>
          </View>
        </Section>

        <Section title={t('filters.prefs')}>
          <SwitchRow label={t('filters.openNow')} value={openNow} onChange={setOpenNow} testID="switch-open-now" />
          <SwitchRow label={t('filters.vip')} value={vip} onChange={setVip} testID="switch-vip" />
          <SwitchRow label={t('filters.terrasse')} value={terrasse} onChange={setTerrasse} testID="switch-terrasse" />
        </Section>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom / 2 }]}>
        <HapticButton
          haptic="medium"
          scale={0.97}
          style={[styles.apply, shadows.primaryGlow]}
          onPress={apply}
          testID="filters-apply-btn"
        >
          <Text style={styles.applyText}>{t('filters.apply')}</Text>
        </HapticButton>
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.xl }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surface, true: colors.primary }}
        thumbColor={colors.textPrimary}
        testID={testID}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  reset: { color: colors.tertiary, fontWeight: '700' },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '900',
    marginBottom: 12,
  },
  radiusRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillPremium: {
    borderColor: '#F472B6',
    backgroundColor: 'rgba(244, 114, 182, 0.08)',
  },
  pillPremiumText: { color: '#F472B6' },
  pillActive: { backgroundColor: colors.tertiary, borderColor: colors.tertiary },
  pillText: { color: colors.textPrimary, fontWeight: '700' },
  pillTextActive: { color: colors.bg },
  premiumHint: {
    color: '#A1A1AA',
    fontSize: 12,
    marginTop: 10,
    fontStyle: 'italic',
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tagText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  tagTextActive: { color: colors.bg, fontWeight: '800' },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  priceInput: { flex: 1, color: colors.textPrimary, paddingVertical: 14, fontSize: 15 },
  priceSuffix: { color: colors.textSecondary, fontSize: 16, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchLabel: { color: colors.textPrimary, fontWeight: '600' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    backgroundColor: 'rgba(9,9,11,0.95)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  apply: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  applyText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
