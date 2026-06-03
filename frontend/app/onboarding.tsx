import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ImageBackground,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing } from '../lib/theme';

const { width, height } = Dimensions.get('window');

type Step =
  | { type: 'hero' }
  | { type: 'single'; q: string; sub: string; options: Option[]; key: string }
  | { type: 'multi'; q: string; sub: string; options: Option[]; key: string; min?: number }
  | { type: 'permission'; kind: 'location' | 'notifications' }
  | { type: 'loading' }
  | { type: 'final' };

type Option = { id: string; label: string; emoji?: string; icon?: keyof typeof Ionicons.glyphMap };

const STEPS: Step[] = [
  { type: 'hero' },
  {
    type: 'single',
    key: 'goal',
    q: "Qu'est-ce qui t'amène ici ?",
    sub: "On personnalise l'app pour toi.",
    options: [
      { id: 'discover', label: 'Découvrir de nouveaux clubs', emoji: '🪩' },
      { id: 'events', label: 'Suivre les meilleures soirées', emoji: '🎉' },
      { id: 'meet', label: 'Sortir avec des amis', emoji: '🥂' },
      { id: 'explore', label: 'Explorer des nouvelles vibes', emoji: '🎧' },
    ],
  },
  {
    type: 'multi',
    key: 'music',
    q: 'Quelles musiques tu kiffes ?',
    sub: 'Sélectionne tes styles préférés.',
    min: 1,
    options: [
      { id: 'techno', label: 'Techno', emoji: '⚡️' },
      { id: 'house', label: 'House', emoji: '🏠' },
      { id: 'hip-hop', label: 'Hip-Hop', emoji: '🎤' },
      { id: 'rnb', label: 'RnB', emoji: '💜' },
      { id: 'afro-house', label: 'Afro', emoji: '🥁' },
      { id: 'latin', label: 'Latin', emoji: '💃' },
      { id: 'disco', label: 'Disco', emoji: '🕺' },
      { id: 'electronic', label: 'Électro', emoji: '🌌' },
    ],
  },
  {
    type: 'single',
    key: 'frequency',
    q: 'À quelle fréquence tu sors ?',
    sub: "Sois honnête, c'est entre nous.",
    options: [
      { id: 'rarely', label: 'De temps en temps', emoji: '🌙' },
      { id: 'weekend', label: 'Tous les week-ends', emoji: '✨' },
      { id: 'often', label: 'Plusieurs fois par semaine', emoji: '🔥' },
      { id: 'every', label: 'Je suis toujours dehors', emoji: '🚀' },
    ],
  },
  {
    type: 'multi',
    key: 'vibes',
    q: "Qu'est-ce qui compte pour toi ?",
    sub: "Plusieurs choix possibles.",
    options: [
      { id: 'vip', label: 'VIP', emoji: '💎' },
      { id: 'terrasse', label: 'Terrasse', emoji: '🌿' },
      { id: 'live_music', label: 'Live music', emoji: '🎸' },
      { id: 'intimate', label: 'Intimiste', emoji: '🕯️' },
      { id: 'cocktail_bar', label: 'Cocktails', emoji: '🍸' },
      { id: 'iconic_location', label: 'Lieux iconiques', emoji: '🏛️' },
      { id: 'waterfront', label: 'Au bord de l\'eau', emoji: '🌊' },
      { id: 'rooftop', label: 'Rooftop', emoji: '🏙️' },
    ],
  },
  { type: 'loading' },
  { type: 'permission', kind: 'location' },
  { type: 'final' },
];

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const step = STEPS[stepIdx];

  const progress = stepIdx / (STEPS.length - 1);

  const tap = (light = false) => {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync?.(
      light ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
    ).catch(() => {});
  };

  const next = () => {
    tap();
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else router.replace('/register');
  };
  const back = () => {
    tap(true);
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };
  const skip = () => {
    tap(true);
    router.replace('/login');
  };

  const canContinue = (() => {
    if (step.type === 'hero' || step.type === 'loading' || step.type === 'permission' || step.type === 'final') return true;
    if (step.type === 'single') return !!answers[step.key];
    if (step.type === 'multi') {
      const sel = (answers[step.key] || []) as string[];
      return sel.length >= (step.min || 0);
    }
    return true;
  })();

  return (
    <View style={styles.container} testID="onboarding-screen">
      {/* Progress + top bar */}
      {step.type !== 'hero' && step.type !== 'final' && step.type !== 'loading' && (
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            onPress={back}
            style={styles.topBtn}
            testID="onboarding-back-btn"
            disabled={stepIdx === 0}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={stepIdx === 0 ? colors.textTertiary : colors.textPrimary}
            />
          </TouchableOpacity>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <TouchableOpacity onPress={skip} testID="onboarding-skip-btn">
            <Text style={styles.skipText}>Passer</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.content}>
        {step.type === 'hero' && <HeroScreen onStart={next} insets={insets} onSignIn={skip} />}

        {step.type === 'single' && (
          <SingleSelect
            step={step}
            value={answers[step.key]}
            onChange={(v) => {
              tap();
              setAnswers((a) => ({ ...a, [step.key]: v }));
            }}
          />
        )}

        {step.type === 'multi' && (
          <MultiSelect
            step={step}
            value={answers[step.key] || []}
            onChange={(v) => {
              tap(true);
              setAnswers((a) => ({ ...a, [step.key]: v }));
            }}
          />
        )}

        {step.type === 'loading' && (
          <LoadingScreen onDone={next} />
        )}

        {step.type === 'permission' && (
          <PermissionScreen onAllow={next} onSkip={next} />
        )}

        {step.type === 'final' && (
          <FinalScreen onContinue={next} />
        )}
      </View>

      {/* Bottom CTA */}
      {step.type !== 'hero' && step.type !== 'loading' && step.type !== 'permission' && step.type !== 'final' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[styles.cta, !canContinue && styles.ctaDisabled]}
            onPress={next}
            disabled={!canContinue}
            testID="onboarding-continue-btn"
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>
              Continuer
            </Text>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={canContinue ? colors.bg : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function HeroScreen({
  onStart,
  onSignIn,
  insets,
}: {
  onStart: () => void;
  onSignIn: () => void;
  insets: { top: number; bottom: number };
}) {
  return (
    <ImageBackground
      source={{
        uri: 'https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&q=85',
      }}
      style={styles.hero}
    >
      <View style={styles.heroOverlay} />
      <View style={styles.heroBottomGradient} />

      <View style={[styles.heroContent, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
        <Animated.View entering={FadeInDown.duration(700)}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>NIGHT FINDER</Text>
          </View>
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeInDown.delay(200).duration(700)}>
          <Text style={styles.heroTitle}>
            Trouve la <Text style={styles.heroTitleAccent}>nuit</Text> qui te ressemble.
          </Text>
          <Text style={styles.heroSub}>
            Les meilleurs clubs, bars et soirées de la ville, sélectionnés pour toi.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(400).duration(700)} style={{ marginTop: 32 }}>
          <TouchableOpacity
            style={styles.heroCta}
            onPress={onStart}
            testID="onboarding-start-btn"
            activeOpacity={0.9}
          >
            <Text style={styles.heroCtaText}>Démarrer</Text>
            <View style={styles.heroCtaArrow}>
              <Ionicons name="arrow-forward" size={18} color={colors.primary} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSignIn} style={styles.heroSignIn} testID="onboarding-signin-btn">
            <Text style={styles.heroSignInText}>
              J'ai déjà un compte · <Text style={{ fontWeight: '800' }}>Se connecter</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </ImageBackground>
  );
}

function SingleSelect({
  step,
  value,
  onChange,
}: {
  step: Extract<Step, { type: 'single' }>;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.qWrap}>
      <Animated.Text entering={FadeInDown.duration(400)} style={styles.question}>
        {step.q}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(80).duration(400)} style={styles.qSub}>
        {step.sub}
      </Animated.Text>

      <View style={styles.optionsList}>
        {step.options.map((opt, i) => {
          const selected = value === opt.id;
          return (
            <Animated.View
              key={opt.id}
              entering={FadeInDown.delay(120 + i * 70).duration(450)}
            >
              <TouchableOpacity
                style={[styles.optionRow, selected && styles.optionRowActive]}
                onPress={() => onChange(opt.id)}
                activeOpacity={0.9}
                testID={`onboarding-option-${opt.id}`}
              >
                {opt.emoji && <Text style={styles.optionEmoji}>{opt.emoji}</Text>}
                <Text style={[styles.optionLabel, selected && styles.optionLabelActive]}>
                  {opt.label}
                </Text>
                <View style={[styles.radio, selected && styles.radioActive]}>
                  {selected && <Ionicons name="checkmark" size={14} color={colors.bg} />}
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

function MultiSelect({
  step,
  value,
  onChange,
}: {
  step: Extract<Step, { type: 'multi' }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange(Array.from(set));
  };

  return (
    <View style={styles.qWrap}>
      <Animated.Text entering={FadeInDown.duration(400)} style={styles.question}>
        {step.q}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(80).duration(400)} style={styles.qSub}>
        {step.sub}
      </Animated.Text>

      <View style={styles.gridWrap}>
        {step.options.map((opt, i) => {
          const selected = value.includes(opt.id);
          return (
            <Animated.View
              key={opt.id}
              entering={FadeInDown.delay(120 + i * 50).duration(420)}
              style={styles.gridItem}
            >
              <TouchableOpacity
                style={[styles.tagCard, selected && styles.tagCardActive]}
                onPress={() => toggle(opt.id)}
                activeOpacity={0.85}
                testID={`onboarding-option-${opt.id}`}
              >
                <Text style={styles.tagEmoji}>{opt.emoji}</Text>
                <Text style={[styles.tagLabel, selected && styles.tagLabelActive]}>
                  {opt.label}
                </Text>
                {selected && (
                  <View style={styles.tagCheck}>
                    <Ionicons name="checkmark" size={12} color={colors.bg} />
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

function LoadingScreen({ onDone }: { onDone: () => void }) {
  const items = [
    'Analyse de tes préférences',
    'Recherche des meilleurs spots',
    'Personnalisation de ta sélection',
    'Configuration de Night Finder',
  ];
  const [checked, setChecked] = useState<number>(-1);

  useEffect(() => {
    let i = 0;
    const tick = () => {
      if (i < items.length) {
        setChecked(i);
        i += 1;
        setTimeout(tick, 650);
      } else {
        setTimeout(onDone, 600);
      }
    };
    tick();
  }, []); // eslint-disable-line

  const rotate = useSharedValue(0);
  useEffect(() => {
    rotate.value = withRepeat(
      withTiming(360, { duration: 1800, easing: Easing.linear }),
      -1,
    );
  }, [rotate]);
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }],
  }));

  return (
    <View style={styles.loadingWrap}>
      <Animated.View style={[styles.spinner, spin]}>
        <View style={styles.spinnerDot} />
      </Animated.View>
      <Text style={styles.loadingTitle}>On prépare ton Night Finder…</Text>
      <View style={styles.loadingList}>
        {items.map((label, i) => (
          <View key={i} style={styles.loadingRow}>
            <View
              style={[
                styles.loadingDot,
                i <= checked && styles.loadingDotActive,
              ]}
            >
              {i <= checked && (
                <Ionicons name="checkmark" size={11} color={colors.bg} />
              )}
            </View>
            <Text
              style={[
                styles.loadingItem,
                i <= checked && styles.loadingItemActive,
              ]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PermissionScreen({ onAllow, onSkip }: { onAllow: () => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.permWrap, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.permIconWrap}>
        <Animated.View
          entering={FadeIn.duration(400)}
          style={styles.permIconRing}
        />
        <View style={styles.permIcon}>
          <Ionicons name="location" size={36} color={colors.tertiary} />
        </View>
      </View>
      <Text style={styles.permTitle}>On trouve ce qui est près de toi</Text>
      <Text style={styles.permSub}>
        Active la localisation pour voir les clubs, bars et events à moins de 50
        km. Tu peux la désactiver à tout moment.
      </Text>

      <View style={styles.permBenefits}>
        {[
          { i: 'navigate' as const, t: 'Distances précises en temps réel' },
          { i: 'sparkles' as const, t: 'Recommandations selon ta zone' },
          { i: 'notifications' as const, t: 'Alertes événements proches' },
        ].map((b, idx) => (
          <Animated.View
            key={idx}
            entering={FadeInDown.delay(150 + idx * 100).duration(400)}
            style={styles.permRow}
          >
            <View style={styles.permRowIcon}>
              <Ionicons name={b.i} size={14} color={colors.tertiary} />
            </View>
            <Text style={styles.permRowText}>{b.t}</Text>
          </Animated.View>
        ))}
      </View>

      <View style={{ flex: 1 }} />

      <TouchableOpacity
        style={styles.permPrimary}
        onPress={onAllow}
        activeOpacity={0.9}
        testID="onboarding-allow-location-btn"
      >
        <Text style={styles.permPrimaryText}>Activer la localisation</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.permSecondary}
        onPress={onSkip}
        testID="onboarding-skip-location-btn"
      >
        <Text style={styles.permSecondaryText}>Plus tard</Text>
      </TouchableOpacity>
    </View>
  );
}

function FinalScreen({ onContinue }: { onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.15, { duration: 350, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 200 }),
    );
  }, [scale]);
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={[styles.finalWrap, { paddingBottom: insets.bottom + 16 }]}>
      <Animated.View style={[styles.finalCheck, checkStyle]}>
        <Ionicons name="checkmark" size={48} color={colors.bg} />
      </Animated.View>
      <Animated.Text
        entering={FadeInDown.delay(250).duration(500)}
        style={styles.finalTitle}
      >
        Ton Night Finder est prêt
      </Animated.Text>
      <Animated.Text
        entering={FadeInDown.delay(350).duration(500)}
        style={styles.finalSub}
      >
        Plus que quelques secondes — crée ton compte pour sauvegarder tes
        favoris et débloquer toutes les recommandations.
      </Animated.Text>

      <View style={{ flex: 1 }} />

      <Animated.View
        entering={FadeInDown.delay(500).duration(500)}
        style={{ width: '100%' }}
      >
        <TouchableOpacity
          style={styles.permPrimary}
          onPress={onContinue}
          activeOpacity={0.9}
          testID="onboarding-final-btn"
        >
          <Text style={styles.permPrimaryText}>Créer mon compte</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: 12,
    paddingBottom: 16,
  },
  topBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  skipText: { color: colors.textSecondary, fontWeight: '700' },

  content: { flex: 1 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    backgroundColor: 'rgba(9,9,11,0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cta: {
    flexDirection: 'row',
    paddingVertical: 18,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaDisabled: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  ctaText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  ctaTextDisabled: { color: colors.textTertiary },

  // Hero
  hero: { flex: 1, width },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.4)',
  },
  heroBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.55,
    backgroundColor: 'transparent',
    // gradient simulation via shadow
  },
  heroContent: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  brandText: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 4, fontSize: 12 },
  heroTitle: {
    color: colors.textPrimary,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.2,
    lineHeight: 48,
  },
  heroTitleAccent: { color: colors.primary, fontStyle: 'italic' },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 14,
    lineHeight: 22,
    maxWidth: width - 80,
  },
  heroCta: {
    flexDirection: 'row',
    backgroundColor: colors.textPrimary,
    paddingLeft: 24,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  heroCtaText: { color: colors.bg, fontWeight: '900', fontSize: 17, paddingVertical: 12 },
  heroCtaArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSignIn: { marginTop: 18, alignItems: 'center' },
  heroSignInText: { color: colors.textSecondary, fontSize: 13 },

  // Questions
  qWrap: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 12 },
  question: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 38,
  },
  qSub: { color: colors.textSecondary, marginTop: 8, fontSize: 15 },

  // Single select rows
  optionsList: { marginTop: 28, gap: 12 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.primary,
  },
  optionEmoji: { fontSize: 22 },
  optionLabel: { flex: 1, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  optionLabelActive: { color: colors.textPrimary },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },

  // Grid (multi)
  gridWrap: {
    marginTop: 28,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: { width: (width - spacing.xl * 2 - 12) / 2 },
  tagCard: {
    paddingVertical: 22,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  tagCardActive: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.primary,
  },
  tagEmoji: { fontSize: 28 },
  tagLabel: { color: colors.textSecondary, fontWeight: '700' },
  tagLabelActive: { color: colors.textPrimary },
  tagCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Loading
  loadingWrap: { flex: 1, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  spinner: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: colors.border,
    borderTopColor: colors.primary,
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  loadingTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 28,
    textAlign: 'center',
  },
  loadingList: { gap: 14, width: '100%' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  loadingItem: { color: colors.textTertiary, fontWeight: '600', fontSize: 15 },
  loadingItemActive: { color: colors.textPrimary },

  // Permission
  permWrap: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 20 },
  permIconWrap: { alignSelf: 'center', marginVertical: 12, position: 'relative' },
  permIconRing: {
    position: 'absolute',
    top: -16,
    left: -16,
    right: -16,
    bottom: -16,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.15)',
  },
  permIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(0,240,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permTitle: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 28,
  },
  permSub: {
    color: colors.textSecondary,
    fontSize: 15,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
    alignSelf: 'center',
  },
  permBenefits: { marginTop: 28, gap: 12 },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  permRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,240,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permRowText: { color: colors.textPrimary, fontWeight: '600' },
  permPrimary: {
    paddingVertical: 18,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    marginBottom: 10,
  },
  permPrimaryText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  permSecondary: { paddingVertical: 14, alignItems: 'center' },
  permSecondaryText: { color: colors.textSecondary, fontWeight: '700' },

  // Final
  finalWrap: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 60, alignItems: 'center' },
  finalCheck: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 30,
    elevation: 12,
  },
  finalTitle: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginTop: 30,
    textAlign: 'center',
  },
  finalSub: {
    color: colors.textSecondary,
    fontSize: 15,
    marginTop: 12,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
});
