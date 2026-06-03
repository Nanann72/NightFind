import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ImageBackground,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { saveOnboarding } from '../lib/onboardingStore';
import { colors, radius, spacing } from '../lib/theme';

const { width, height } = Dimensions.get('window');

type Step = 'hero' | 'discovery' | 'music' | 'venues' | 'social' | 'location' | 'final';
const ORDER: Step[] = ['hero', 'discovery', 'music', 'venues', 'social', 'location', 'final'];

const MUSIC_OPTS = [
  { id: 'techno', label: 'Techno', emoji: '⚡️' },
  { id: 'house', label: 'House', emoji: '🏠' },
  { id: 'afro-house', label: 'Afro', emoji: '🥁' },
  { id: 'latin', label: 'Reggaeton', emoji: '💃' },
  { id: 'hip-hop', label: 'Rap', emoji: '🎤' },
  { id: 'commercial', label: 'Commercial', emoji: '✨' },
  { id: 'electronic', label: 'EDM', emoji: '🌌' },
];

const VENUE_OPTS = [
  { id: 'club', label: 'Club', emoji: '🪩' },
  { id: 'rooftop', label: 'Rooftop', emoji: '🏙️' },
  { id: 'bar', label: 'Bar festif', emoji: '🍻' },
  { id: 'lounge', label: 'Lounge', emoji: '🕯️' },
  { id: 'festival', label: 'Festival', emoji: '🎪' },
  { id: 'beach_club', label: 'Beach Club', emoji: '🌊' },
];

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const step = ORDER[idx];

  const progress = Math.max(0, Math.min(1, idx / (ORDER.length - 1)));

  const tap = (light = false) => {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync?.(
      light ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
    ).catch(() => {});
  };

  const next = async () => {
    tap();
    if (idx >= ORDER.length - 1) {
      await saveOnboarding({ ...answers, done: true });
      router.replace('/register');
      return;
    }
    setIdx((i) => i + 1);
  };

  const back = () => {
    tap(true);
    if (idx > 0) setIdx((i) => i - 1);
  };

  const skip = async () => {
    tap(true);
    await saveOnboarding(answers);
    router.replace('/login');
  };

  const setMulti = (key: string, id: string) => {
    setAnswers((a) => {
      const list = new Set<string>((a[key] || []) as string[]);
      if (list.has(id)) list.delete(id);
      else list.add(id);
      return { ...a, [key]: Array.from(list) };
    });
    tap(true);
  };

  const canContinue = (() => {
    if (step === 'music') return (answers.music || []).length > 0;
    if (step === 'venues') return (answers.venues || []).length > 0;
    return true;
  })();

  const showFooter = step !== 'hero' && step !== 'final' && step !== 'location';

  return (
    <View style={styles.container} testID="onboarding-screen">
      {step !== 'hero' && step !== 'final' && (
        <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity
            onPress={back}
            style={styles.topBtn}
            testID="onboarding-back-btn"
            disabled={idx === 0}
          >
            <Ionicons
              name="chevron-back"
              size={22}
              color={idx === 0 ? colors.textTertiary : colors.textPrimary}
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
        {step === 'hero' && <HeroScreen onStart={next} onSignIn={skip} insets={insets} />}
        {step === 'discovery' && <DiscoveryScreen />}
        {step === 'music' && (
          <ChipScreen
            title="Découvre les sons du moment."
            sub="Retrouve les styles musicaux diffusés dans les clubs de ta ville."
            options={MUSIC_OPTS}
            value={answers.music || []}
            onToggle={(id) => setMulti('music', id)}
          />
        )}
        {step === 'venues' && (
          <ChipScreen
            title="Construisons ton expérience."
            sub="Quels types d'endroits préfères-tu ?"
            options={VENUE_OPTS}
            value={answers.venues || []}
            onToggle={(id) => setMulti('venues', id)}
          />
        )}
        {step === 'social' && <SocialScreen />}
        {step === 'location' && <LocationScreen onContinue={next} />}
        {step === 'final' && <FinalScreen onContinue={next} insets={insets} />}
      </View>

      {showFooter && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[styles.cta, !canContinue && styles.ctaDisabled]}
            onPress={next}
            disabled={!canContinue}
            activeOpacity={0.85}
            testID="onboarding-continue-btn"
          >
            <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>Continuer</Text>
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

// ============== SCREENS ============== //

function HeroScreen({
  onStart,
  onSignIn,
  insets,
}: {
  onStart: () => void;
  onSignIn: () => void;
  insets: { top: number; bottom: number };
}) {
  // Parallax
  const py = useSharedValue(0);
  useEffect(() => {
    py.value = withRepeat(
      withSequence(
        withTiming(-14, { duration: 4000, easing: Easing.inOut(Easing.quad) }),
        withTiming(14, { duration: 4000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [py]);
  const bgStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: py.value }, { scale: 1.08 }],
  }));

  // Pulsing CTA
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
  }, [pulse]);
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={styles.hero}>
      <Animated.View style={[StyleSheet.absoluteFill, bgStyle]}>
        <ImageBackground
          source={{
            uri: 'https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&q=85',
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>
      <View style={styles.heroDarken} />
      <View style={styles.heroGradTop} />
      <View style={styles.heroGradBottom} />

      {/* Neon glow accents */}
      <View style={styles.glow1} />
      <View style={styles.glow2} />

      <View style={[styles.heroContent, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
        <Animated.View entering={FadeInDown.duration(700)}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>NIGHT FINDER</Text>
          </View>
        </Animated.View>

        <View style={{ flex: 1 }} />

        <Animated.Text entering={FadeInDown.delay(180).duration(700)} style={styles.heroTitle}>
          Découvre ce qui fait{' '}
          <Text style={styles.heroTitleAccent}>vibrer</Text> la nuit.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(350).duration(700)} style={styles.heroSub}>
          Les meilleurs clubs, DJs et événements autour de toi.
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(520).duration(700)} style={{ marginTop: 32 }}>
          <Animated.View style={ctaStyle}>
            <TouchableOpacity
              style={styles.heroCta}
              onPress={onStart}
              testID="onboarding-start-btn"
              activeOpacity={0.9}
            >
              <Text style={styles.heroCtaText}>Commencer</Text>
              <View style={styles.heroCtaArrow}>
                <Ionicons name="arrow-forward" size={18} color={colors.primary} />
              </View>
            </TouchableOpacity>
          </Animated.View>
          <TouchableOpacity onPress={onSignIn} style={styles.heroSignIn} testID="onboarding-signin-btn">
            <Text style={styles.heroSignInText}>
              J'ai déjà un compte ·{' '}
              <Text style={{ fontWeight: '900', color: colors.textPrimary }}>Se connecter</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

function DiscoveryScreen() {
  // Animated markers appearing
  const markers = [
    { x: 0.22, y: 0.18, size: 14, color: colors.primary, d: 200 },
    { x: 0.65, y: 0.25, size: 12, color: colors.tertiary, d: 350 },
    { x: 0.4, y: 0.42, size: 18, color: colors.primary, d: 500 },
    { x: 0.78, y: 0.5, size: 12, color: colors.secondary, d: 650 },
    { x: 0.18, y: 0.6, size: 14, color: colors.tertiary, d: 800 },
    { x: 0.55, y: 0.72, size: 16, color: colors.primary, d: 950 },
    { x: 0.32, y: 0.83, size: 12, color: colors.secondary, d: 1100 },
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.qWrap}>
      <Animated.Text entering={FadeInDown.duration(400)} style={styles.question}>
        Ne rate plus les meilleures soirées.
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(80).duration(400)} style={styles.qSub}>
        Trouve instantanément les événements les plus populaires près de toi.
      </Animated.Text>

      {/* Stylized map */}
      <Animated.View
        entering={FadeIn.delay(150).duration(500)}
        style={styles.mapMock}
      >
        <View style={styles.mapBg} />
        {/* fake roads */}
        <View style={[styles.road, { top: '20%', left: '10%', width: '60%', transform: [{ rotate: '8deg' }] }]} />
        <View style={[styles.road, { top: '55%', left: '5%', width: '85%', transform: [{ rotate: '-4deg' }] }]} />
        <View style={[styles.road, { top: '80%', left: '20%', width: '70%', transform: [{ rotate: '6deg' }] }]} />
        <View style={[styles.road, { top: '10%', left: '50%', width: '4px', height: '80%' }]} />
        <View style={[styles.road, { top: '5%', left: '20%', width: '4px', height: '90%', transform: [{ rotate: '-2deg' }] }]} />

        {markers.map((m, i) => (
          <Animated.View
            key={i}
            entering={FadeInUp.delay(m.d).duration(400)}
            style={[
              styles.marker,
              {
                top: `${m.y * 100}%`,
                left: `${m.x * 100}%`,
                width: m.size * 2,
                height: m.size * 2,
                borderRadius: m.size,
                borderColor: m.color,
                backgroundColor: `${m.color}33`,
              },
            ]}
          >
            <View style={[styles.markerDot, { backgroundColor: m.color, width: m.size / 1.8, height: m.size / 1.8 }]} />
          </Animated.View>
        ))}

        {/* User pin */}
        <Animated.View entering={FadeIn.delay(1300).duration(400)} style={styles.userPin}>
          <View style={styles.userPinRing} />
          <View style={styles.userPinCore} />
        </Animated.View>

        {/* Floating event card */}
        <Animated.View entering={FadeInDown.delay(1500).duration(500)} style={styles.floatEvent}>
          <View style={styles.floatDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.floatTitle}>Concrete · Folamour</Text>
            <Text style={styles.floatSub}>Vendredi · 23h · 1.2 km</Text>
          </View>
        </Animated.View>
      </Animated.View>

      <View style={styles.factsRow}>
        {[
          { i: 'flame' as const, t: '12 events ce soir' },
          { i: 'location' as const, t: 'Rayon 50 km' },
          { i: 'pulse' as const, t: 'Mise à jour live' },
        ].map((f, i) => (
          <Animated.View key={i} entering={FadeInDown.delay(1600 + i * 100).duration(400)} style={styles.factPill}>
            <Ionicons name={f.i} size={12} color={colors.tertiary} />
            <Text style={styles.factText}>{f.t}</Text>
          </Animated.View>
        ))}
      </View>
    </ScrollView>
  );
}

function ChipScreen({
  title,
  sub,
  options,
  value,
  onToggle,
}: {
  title: string;
  sub: string;
  options: { id: string; label: string; emoji: string }[];
  value: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.qWrap}>
      <Animated.Text entering={FadeInDown.duration(400)} style={styles.question}>
        {title}
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(80).duration(400)} style={styles.qSub}>
        {sub}
      </Animated.Text>

      <View style={styles.gridWrap}>
        {options.map((opt, i) => {
          const selected = value.includes(opt.id);
          return (
            <Animated.View
              key={opt.id}
              entering={FadeInDown.delay(120 + i * 60).duration(420)}
              style={styles.gridItem}
            >
              <TouchableOpacity
                style={[styles.tagCard, selected && styles.tagCardActive]}
                onPress={() => onToggle(opt.id)}
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
    </ScrollView>
  );
}

function SocialScreen() {
  const [events, setEvents] = useState(127);
  const [clubs, setClubs] = useState(512);
  const [users, setUsers] = useState(10247);

  useEffect(() => {
    const t = setInterval(() => {
      setEvents((v) => v + Math.floor(Math.random() * 3));
      if (Math.random() > 0.6) setClubs((v) => v + 1);
      setUsers((v) => v + Math.floor(Math.random() * 5));
    }, 1200);
    return () => clearInterval(t);
  }, []);

  const avatars = [
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&q=80',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=120&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&q=80',
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.qWrap}>
      <Animated.Text entering={FadeInDown.duration(400)} style={styles.question}>
        Une communauté qui ne dort jamais.
      </Animated.Text>
      <Animated.Text entering={FadeInDown.delay(80).duration(400)} style={styles.qSub}>
        Rejoins des milliers de fêtards qui découvrent les meilleurs spots chaque semaine.
      </Animated.Text>

      <Animated.View entering={FadeInUp.delay(180).duration(500)} style={styles.statsCard}>
        <View style={styles.statsAvatars}>
          {avatars.map((u, i) => (
            <Image
              key={i}
              source={{ uri: u }}
              style={[styles.stackAvatar, { left: i * 22, zIndex: 4 - i }]}
            />
          ))}
          <View style={[styles.stackAvatar, styles.stackMore, { left: avatars.length * 22 }]}>
            <Text style={styles.stackMoreText}>+9k</Text>
          </View>
        </View>
        <View style={styles.starRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Ionicons key={i} name="star" size={14} color={colors.secondary} />
          ))}
          <Text style={styles.ratingText}>4.9 · App Store</Text>
        </View>
      </Animated.View>

      <View style={styles.liveStatsRow}>
        <LiveStat icon="flash" value={`+${events}`} label="événements aujourd'hui" col={colors.primary} delay={250} />
        <LiveStat icon="business" value={`${clubs}+`} label="clubs référencés" col={colors.tertiary} delay={400} />
      </View>
      <View style={{ marginTop: 12 }}>
        <Animated.View entering={FadeInDown.delay(550).duration(450)} style={styles.bigStat}>
          <View style={[styles.statIcon, { backgroundColor: 'rgba(242,201,76,0.12)', borderColor: 'rgba(242,201,76,0.4)' }]}>
            <Ionicons name="people" size={20} color={colors.secondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bigStatValue}>{users.toLocaleString('fr-FR')}+</Text>
            <Text style={styles.bigStatLabel}>fêtards actifs cette semaine</Text>
          </View>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </Animated.View>
      </View>

      <Animated.View entering={FadeInDown.delay(700).duration(450)} style={styles.testimonial}>
        <View style={styles.testStars}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Ionicons key={i} name="star" size={11} color={colors.secondary} />
          ))}
        </View>
        <Text style={styles.testText}>
          “J'ai découvert 3 spots incroyables en 2 semaines. Plus jamais sans Night Finder.”
        </Text>
        <Text style={styles.testName}>— Léa, 24 · Paris</Text>
      </Animated.View>
    </ScrollView>
  );
}

function LiveStat({
  icon,
  value,
  label,
  col,
  delay,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  col: string;
  delay: number;
}) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(450)} style={styles.smallStat}>
      <View style={[styles.statIcon, { backgroundColor: `${col}1A`, borderColor: `${col}66` }]}>
        <Ionicons name={icon} size={16} color={col} />
      </View>
      <Text style={styles.smallStatValue}>{value}</Text>
      <Text style={styles.smallStatLabel}>{label}</Text>
    </Animated.View>
  );
}

function LocationScreen({ onContinue }: { onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 1400, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
  }, [pulse]);
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 2 - pulse.value,
  }));

  const ask = async () => {
    setBusy(true);
    try {
      if (Platform.OS !== 'web') {
        await Location.requestForegroundPermissionsAsync().catch(() => {});
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 5000 });
        });
      }
    } finally {
      setBusy(false);
      onContinue();
    }
  };

  return (
    <View style={[styles.permWrap, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.permIconWrap}>
        <Animated.View style={[styles.permPulse, ringStyle]} />
        <View
          style={[
            styles.permIcon,
            { backgroundColor: 'rgba(0,240,255,0.12)', borderColor: 'rgba(0,240,255,0.4)' },
          ]}
        >
          <Ionicons name="location" size={36} color={colors.tertiary} />
        </View>
      </View>
      <Text style={styles.permTitle}>Voir ce qui se passe autour de toi.</Text>
      <Text style={styles.permSub}>
        Active la localisation pour découvrir les événements dans un rayon de 50 km.
      </Text>

      <View style={styles.permBenefits}>
        {[
          { i: 'navigate' as const, t: 'Distances précises en temps réel' },
          { i: 'sparkles' as const, t: 'Recommandations selon ta zone' },
          { i: 'flame' as const, t: 'Alertes pour les events proches' },
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
        onPress={ask}
        disabled={busy}
        activeOpacity={0.9}
        testID="onboarding-allow-location-btn"
      >
        <Text style={styles.permPrimaryText}>Autoriser la localisation</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.permSecondary}
        onPress={onContinue}
        testID="onboarding-skip-location-btn"
      >
        <Text style={styles.permSecondaryText}>Plus tard</Text>
      </TouchableOpacity>
    </View>
  );
}

function FinalScreen({ onContinue, insets }: { onContinue: () => void; insets: { top: number; bottom: number } }) {
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.2, { duration: 350, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 200 }),
    );
  }, [scale]);
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [shimmer]);

  return (
    <ImageBackground
      source={{
        uri: 'https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&q=85',
      }}
      style={{ flex: 1 }}
    >
      <View style={styles.heroDarken} />
      <View style={styles.heroGradBottom} />
      <View style={[styles.finalWrap, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}>
        <Animated.View style={[styles.finalCheck, checkStyle]}>
          <Ionicons name="sparkles" size={42} color={colors.bg} />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(250).duration(500)} style={styles.finalTitle}>
          Ta prochaine soirée t'attend.
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(380).duration(500)} style={styles.finalSub}>
          Commence à explorer les meilleurs événements dès maintenant.
        </Animated.Text>

        <View style={{ flex: 1 }} />

        <Animated.View entering={FadeInDown.delay(550).duration(500)} style={{ width: '100%' }}>
          <TouchableOpacity
            style={styles.finalCta}
            onPress={onContinue}
            activeOpacity={0.9}
            testID="onboarding-final-btn"
          >
            <Text style={styles.finalCtaText}>Découvrir les événements</Text>
            <Ionicons name="arrow-forward" size={20} color={colors.bg} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </ImageBackground>
  );
}

// ============== STYLES ============== //

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: 12,
    paddingBottom: 16,
  },
  topBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surface, overflow: 'hidden' },
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
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 10,
  },
  ctaDisabled: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, shadowOpacity: 0 },
  ctaText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  ctaTextDisabled: { color: colors.textTertiary },

  // Hero
  hero: { flex: 1, width, overflow: 'hidden' },
  heroDarken: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.55)' },
  heroGradTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    backgroundColor: 'rgba(9,9,11,0.85)',
    opacity: 0.6,
  },
  heroGradBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 360,
    backgroundColor: 'rgba(9,9,11,0.9)',
    opacity: 0.9,
  },
  glow1: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.primary,
    opacity: 0.18,
  },
  glow2: {
    position: 'absolute',
    bottom: -100,
    left: -100,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: colors.tertiary,
    opacity: 0.12,
  },
  heroContent: { flex: 1, paddingHorizontal: spacing.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  brandText: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 4, fontSize: 12 },
  heroTitle: { color: colors.textPrimary, fontSize: 42, fontWeight: '900', letterSpacing: -1.2, lineHeight: 46 },
  heroTitleAccent: { color: colors.primary, fontStyle: 'italic' },
  heroSub: { color: colors.textSecondary, fontSize: 16, marginTop: 14, lineHeight: 22, maxWidth: width - 80 },
  heroCta: {
    flexDirection: 'row',
    backgroundColor: colors.textPrimary,
    paddingLeft: 28,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    shadowColor: colors.textPrimary,
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
  },
  heroCtaText: { color: colors.bg, fontWeight: '900', fontSize: 18, paddingVertical: 14 },
  heroCtaArrow: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  heroSignIn: { marginTop: 18, alignItems: 'center' },
  heroSignInText: { color: colors.textSecondary, fontSize: 13 },

  // Question
  qWrap: { paddingHorizontal: spacing.xl, paddingTop: 12, paddingBottom: 32 },
  question: { color: colors.textPrimary, fontSize: 30, fontWeight: '900', letterSpacing: -1, lineHeight: 36 },
  qSub: { color: colors.textSecondary, marginTop: 8, fontSize: 15, lineHeight: 21 },

  // Discovery map mock
  mapMock: {
    marginTop: 28,
    height: 360,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    position: 'relative',
  },
  mapBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0c0c10' },
  road: { position: 'absolute', height: 2, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 1 },
  marker: {
    position: 'absolute',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -10,
    marginTop: -10,
  },
  markerDot: { borderRadius: 999 },
  userPin: {
    position: 'absolute',
    top: '48%',
    left: '48%',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userPinRing: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  userPinCore: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.textPrimary, borderWidth: 2, borderColor: colors.bg },
  floatEvent: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(24,24,27,0.92)',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  floatDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  floatTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 13 },
  floatSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  factsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  factPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(0,240,255,0.25)',
  },
  factText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },

  // Chip grid
  gridWrap: { marginTop: 28, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridItem: { width: (width - spacing.xl * 2 - 12) / 2 },
  tagCard: {
    paddingVertical: 22,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  tagCardActive: { backgroundColor: 'rgba(224,26,79,0.1)', borderColor: colors.primary },
  tagEmoji: { fontSize: 30 },
  tagLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
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

  // Social
  statsCard: {
    marginTop: 24,
    padding: 22,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  statsAvatars: { height: 48, width: 168, marginBottom: 14 },
  stackAvatar: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.surface,
    top: 2,
  },
  stackMore: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stackMoreText: { color: colors.bg, fontWeight: '900', fontSize: 12 },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { color: colors.textSecondary, fontWeight: '700', marginLeft: 6 },
  liveStatsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  smallStat: {
    flex: 1,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 10 },
  smallStatValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  smallStatLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  bigStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bigStatValue: { color: colors.textPrimary, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  bigStatLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveText: { color: '#EF4444', fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  testimonial: {
    marginTop: 16,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  testStars: { flexDirection: 'row', gap: 2, marginBottom: 6 },
  testText: { color: colors.textPrimary, fontStyle: 'italic', fontSize: 14, lineHeight: 20 },
  testName: { color: colors.textTertiary, fontSize: 12, fontWeight: '700', marginTop: 6 },

  // Permission
  permWrap: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 20 },
  permIconWrap: { alignSelf: 'center', marginVertical: 12, position: 'relative', alignItems: 'center', justifyContent: 'center', width: 160, height: 160 },
  permPulse: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: colors.tertiary,
  },
  permIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  permTitle: { color: colors.textPrimary, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center', marginTop: 24 },
  permSub: { color: colors.textSecondary, fontSize: 15, marginTop: 10, textAlign: 'center', lineHeight: 22, maxWidth: 320, alignSelf: 'center' },
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
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 8,
  },
  permPrimaryText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  permSecondary: { paddingVertical: 14, alignItems: 'center' },
  permSecondaryText: { color: colors.textSecondary, fontWeight: '700' },

  // Final
  finalWrap: { flex: 1, paddingHorizontal: spacing.xl, alignItems: 'center' },
  finalCheck: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.6,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 40,
    elevation: 16,
  },
  finalTitle: { color: colors.textPrimary, fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 36, textAlign: 'center' },
  finalSub: { color: colors.textSecondary, fontSize: 16, marginTop: 14, lineHeight: 24, textAlign: 'center', maxWidth: 340 },
  finalCta: {
    flexDirection: 'row',
    paddingVertical: 18,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    elevation: 12,
  },
  finalCtaText: { color: colors.bg, fontSize: 17, fontWeight: '900' },
});
