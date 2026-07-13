import { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  ImageBackground,
  Image,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
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
import * as Location from 'expo-location';
import { saveOnboarding } from '../lib/onboardingStore';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const { width, height } = Dimensions.get('window');

type HapticKind = 'none' | 'light' | 'medium';
type Line = {
  text: string;
  hapticWords?: string[];
  endHaptic?: HapticKind;
  pause: number;
};
type Feature = {
  kind: 'feature';
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string; // hex
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
  cta: string;
};

type Screen =
  | {
      kind: 'conversation' | 'final';
      bg?: string;
      lines: Line[];
      cta: string;
    }
  | { kind: 'selection'; lines: Line[]; cta: string }
  | { kind: 'location'; lines: Line[]; cta: string }
  | { kind: 'notifications'; lines: Line[]; cta: string }
  | { kind: 'swipe-profile'; cta: string; ctaSkip: string }
  | { kind: 'photos'; cta: string; ctaSkip: string }
  | Feature;

const SCREENS: Screen[] = [
  {
    kind: 'conversation',
    bg: 'https://images.unsplash.com/photo-1581417478175-a9ef18f210c2?crop=entropy&cs=srgb&fm=jpg&q=85',
    lines: [
      { text: 'Bienvenue sur Night Finder.', endHaptic: 'medium', pause: 800 },
      {
        text: "L'application qui te connecte aux meilleures soirées.",
        hapticWords: ['meilleures'],
        endHaptic: 'light',
        pause: 1000,
      },
      { text: 'Autour de toi.', endHaptic: 'light', pause: 1200 },
    ],
    cta: 'Continuer',
  },
  {
    kind: 'conversation',
    lines: [
      { text: 'Chaque week-end…', endHaptic: 'none', pause: 700 },
      {
        text: 'Des milliers de personnes cherchent où sortir.',
        hapticWords: ['milliers'],
        endHaptic: 'light',
        pause: 1000,
      },
      {
        text: 'Nous avons simplifié cette recherche.',
        hapticWords: ['simplifié'],
        endHaptic: 'medium',
        pause: 1200,
      },
    ],
    cta: 'Continuer',
  },
  {
    kind: 'conversation',
    lines: [
      { text: 'Découvre instantanément…', endHaptic: 'none', pause: 500 },
      { text: 'Les clubs.', endHaptic: 'light', pause: 300 },
      { text: 'Les rooftops.', endHaptic: 'light', pause: 300 },
      { text: 'Les bars festifs.', endHaptic: 'light', pause: 300 },
      {
        text: 'Et les événements qui comptent vraiment.',
        hapticWords: ['événements'],
        endHaptic: 'medium',
        pause: 1200,
      },
    ],
    cta: 'Continuer',
  },
  {
    kind: 'conversation',
    lines: [
      { text: "Mais ce n'est pas tout.", endHaptic: 'light', pause: 800 },
      {
        text: 'Tu découvriras aussi les styles musicaux diffusés dans chaque lieu.',
        hapticWords: ['styles', 'musicaux'],
        endHaptic: 'medium',
        pause: 1000,
      },
      { text: 'Techno.', endHaptic: 'light', pause: 250 },
      { text: 'House.', endHaptic: 'light', pause: 250 },
      { text: 'Afro.', endHaptic: 'light', pause: 250 },
      { text: 'Rap.', endHaptic: 'light', pause: 250 },
      { text: 'Reggaeton.', endHaptic: 'light', pause: 1000 },
    ],
    cta: 'Continuer',
  },
  {
    kind: 'conversation',
    bg: 'https://images.unsplash.com/photo-1630395822970-acd6a691d97e?crop=entropy&cs=srgb&fm=jpg&q=85',
    lines: [
      { text: 'Imagine…', endHaptic: 'none', pause: 1000 },
      { text: 'Il est 23h.', endHaptic: 'none', pause: 700 },
      {
        text: 'Tu cherches la meilleure ambiance.',
        hapticWords: ['meilleure', 'ambiance'],
        endHaptic: 'light',
        pause: 800,
      },
      {
        text: 'Night Finder la trouve pour toi.',
        hapticWords: ['Night', 'Finder'],
        endHaptic: 'medium',
        pause: 1500,
      },
    ],
    cta: 'Continuer',
  },
  // -------- FEATURE SHOWCASE (6 screens) -------- //
  {
    kind: 'feature',
    bg: 'https://images.unsplash.com/photo-1608501078713-8e445a709b39?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzOTB8MHwxfHNlYXJjaHwxfHxjaXR5JTIwbmlnaHRsaWZlJTIwYWVyaWFsfGVufDB8fHxwdXJwbGV8MTc4MDY1NjAxMnww&ixlib=rb-4.1.0&q=85',
    icon: 'map',
    accent: '#00F0FF',
    eyebrow: '01 · La carte',
    title: 'Toutes les boîtes,\nen un coup d\'œil.',
    subtitle: 'Repère les clubs, rooftops et bars festifs autour de toi sur une carte temps réel.',
    bullets: ['Rayon ajustable', 'Mise à jour en direct', 'Itinéraire en 1 tap'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.pexels.com/photos/19830276/pexels-photo-19830276.jpeg',
    icon: 'flame',
    accent: '#E01A4F',
    eyebrow: '02 · Le swipe',
    title: 'Rencontre les gens\nqui sortent comme toi.',
    subtitle: 'Swipe les profils des autres noctambules. Like, pass, et trouve avec qui tu vas faire la nuit.',
    bullets: ['10 swipes par jour · ∞ en Premium', 'Filtrage par style musical', 'Photos & bio des autres'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.unsplash.com/photo-1571266028243-d220c6a9d3c1?crop=entropy&cs=srgb&fm=jpg&q=85',
    icon: 'location',
    accent: '#F472B6',
    eyebrow: '03 · Swipe en club',
    title: 'Match avec les\ngens présents.',
    subtitle: 'Dans le club ce soir ? Swipe en temps réel avec les autres fêtards sur place dont le profil est public.',
    bullets: ['Profils des gens dans ton club', 'Visibles uniquement si profil public', 'Hit on the dance floor 💃'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.pexels.com/photos/14530804/pexels-photo-14530804.jpeg',
    icon: 'chatbubble-ellipses',
    accent: '#FF3CAC',
    eyebrow: '04 · Match & chat',
    title: 'Match.\nAccepte.\nDiscute.',
    subtitle: 'Quand quelqu\'un te like, tu reçois la demande. Tu acceptes → vous pouvez discuter en direct.',
    bullets: ['Notif quand on te like', 'Toi seul décides qui peut t\'écrire', 'Chat 1-to-1 instantané'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.pexels.com/photos/18704290/pexels-photo-18704290.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
    icon: 'people',
    accent: '#00F0FF',
    eyebrow: '05 · Tes amis',
    title: 'Vois tes amis\nen soirée.',
    subtitle: 'Quand ils sont en club, leur avatar apparaît sur la carte. Tu choisis qui peut te voir.',
    bullets: ['Visible uniquement en boîte', 'Notif quand un ami arrive', 'Ta vie privée, ton contrôle'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.unsplash.com/photo-1574391884720-bbc049ec09ad?crop=entropy&cs=srgb&fm=jpg&q=85',
    icon: 'musical-notes',
    accent: '#A78BFA',
    eyebrow: '06 · Auto-Shazam',
    title: 'Le track qui joue ?\nIdentifié auto.',
    subtitle: 'Dès que tu arrives en club, on identifie automatiquement les morceaux du DJ. Plus jamais "c\'est quoi ce son ?".',
    bullets: ['Détection auto en arrivant', 'Historique de tes soirées', 'Partage les tracks à tes amis'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.unsplash.com/photo-1650631072655-a46f273bf6b1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxOTB8MHwxfHNlYXJjaHwxfHxESiUyMGNvbmNlcnQlMjBsaWdodHN8ZW58MHx8fHB1cnBsZXwxNzgwNjU2MDEyfDA&ixlib=rb-4.1.0&q=85',
    icon: 'calendar',
    accent: '#E01A4F',
    eyebrow: '07 · Tes events',
    title: 'Crée tes soirées,\nrejoins les leurs.',
    subtitle: 'Publique ou privée entre amis. Ajoute en un tap les events qui comptent à ton calendrier.',
    bullets: ['Création réservée Premium', 'DJ sets & guests publics', 'Add to Calendar instantané'],
    cta: 'Suivant',
  },
  {
    kind: 'feature',
    bg: 'https://images.pexels.com/photos/16935900/pexels-photo-16935900.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
    icon: 'star',
    accent: '#FFD93D',
    eyebrow: '08 · Premium',
    title: 'L\'accès\nVIP.',
    subtitle: 'Swipes illimités, création de soirées et accès aux spots cachés. Pour les vrais noctambules.',
    bullets: ['Swipes utilisateurs sans limite', 'Crée tes propres événements', 'Rayon de recherche 200 km'],
    cta: 'Suivant',
  },
  {
    kind: 'selection',
    lines: [
      { text: 'Pour personnaliser ton expérience…', endHaptic: 'none', pause: 700 },
      {
        text: 'Nous avons besoin de connaître tes goûts.',
        endHaptic: 'light',
        pause: 1000,
      },
    ],
    cta: 'Continuer',
  },
  {
    kind: 'location',
    lines: [
      { text: 'Une dernière étape.', endHaptic: 'none', pause: 1000 },
      { text: 'Autorise ta localisation.', endHaptic: 'light', pause: 700 },
      {
        text: 'Pour découvrir les meilleures soirées dans un rayon de 50 km.',
        hapticWords: ['50', 'km'],
        endHaptic: 'medium',
        pause: 1200,
      },
    ],
    cta: 'Autoriser la localisation',
  },
  {
    kind: 'notifications',
    lines: [
      { text: 'Reste connecté à la nuit.', endHaptic: 'light', pause: 800 },
      {
        text: 'Active les notifications pour être averti des soirées qui matchent ton style.',
        hapticWords: ['notifications', 'matchent'],
        endHaptic: 'medium',
        pause: 1200,
      },
    ],
    cta: 'Activer les notifications',
  },
  {
    kind: 'photos',
    cta: 'Continuer',
    ctaSkip: 'Plus tard',
  },
  {
    kind: 'swipe-profile',
    cta: 'Continuer',
    ctaSkip: 'Plus tard',
  },
  {
    kind: 'final',
    bg: 'https://images.unsplash.com/photo-1545128485-c400e7702796?crop=entropy&cs=srgb&fm=jpg&q=85',
    lines: [
      { text: 'Parfait.', endHaptic: 'light', pause: 800 },
      { text: 'Tu es prêt.', endHaptic: 'light', pause: 800 },
      {
        text: "Ta prochaine soirée t'attend déjà.",
        hapticWords: ['prochaine', 'soirée'],
        endHaptic: 'medium',
        pause: 1500,
      },
    ],
    cta: 'Découvrir maintenant',
  },
];

const MUSIC_OPTS = [
  { id: 'techno', label: 'Techno', emoji: '⚡️' },
  { id: 'house', label: 'House', emoji: '🏠' },
  { id: 'afro-house', label: 'Afro', emoji: '🥁' },
  { id: 'hip-hop', label: 'Rap', emoji: '🎤' },
  { id: 'latin', label: 'Reggaeton', emoji: '💃' },
  { id: 'electronic', label: 'EDM', emoji: '🌌' },
];

function vibrate(kind: HapticKind) {
  if (Platform.OS === 'web' || kind === 'none') return;
  const style =
    kind === 'medium'
      ? Haptics.ImpactFeedbackStyle.Medium
      : Haptics.ImpactFeedbackStyle.Light;
  Haptics.impactAsync(style).catch(() => {});
}

function normalize(w: string) {
  return w
    .toLowerCase()
    .replace(/[.,!?…'"`’]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ============== Word-by-word reveal ============== //

function WordLine({
  line,
  onDone,
  big,
  dim,
}: {
  line: Line;
  onDone: () => void;
  big?: boolean;
  dim?: boolean;
}) {
  const words = line.text.split(/(\s+)/).filter((w) => w.length > 0);
  const [count, setCount] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    setCount(0);
    fired.current = false;
    let i = 0;
    const step = () => {
      i += 1;
      // Trigger haptic on key word
      const raw = words[i - 1];
      if (raw && /\S/.test(raw)) {
        const norm = normalize(raw);
        const isKey = line.hapticWords?.some((k) => normalize(k) === norm);
        if (isKey) vibrate('light');
      }
      setCount(i);
      if (i < words.length) {
        const delay = /\s/.test(raw || '') ? 30 : 95 + Math.floor(Math.random() * 25);
        setTimeout(step, delay);
      } else if (!fired.current) {
        fired.current = true;
        if (line.endHaptic && line.endHaptic !== 'none') vibrate(line.endHaptic);
        setTimeout(onDone, line.pause);
      }
    };
    const t = setTimeout(step, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.text]);

  return (
    <Text style={[big ? styles.bigText : styles.lineText, dim && styles.dim]}>
      {words.slice(0, count).map((w, i) =>
        /\s/.test(w) ? (
          <Text key={i}>{w}</Text>
        ) : (
          <Animated.Text
            key={i}
            entering={FadeIn.duration(260)}
            style={[big ? styles.bigText : styles.lineText, dim && styles.dim]}
          >
            {w}
          </Animated.Text>
        ),
      )}
    </Text>
  );
}

// ============== Main screen ============== //

export default function Onboarding() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [screenIdx, setScreenIdx] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [musicSel, setMusicSel] = useState<string[]>([]);
  // Swipe-profile mini config (collected during onboarding, persisted at signup)
  const [spBio, setSpBio] = useState('');
  const [spCity, setSpCity] = useState('');
  const [spInsta, setSpInsta] = useState('');
  // Photo picker (collected during onboarding, persisted to account on signup)
  const [photos, setPhotos] = useState<string[]>([]);
  const screen = SCREENS[screenIdx];
  const isFeature = screen.kind === 'feature';
  const isSwipeProfile = screen.kind === 'swipe-profile';
  const isPhotos = screen.kind === 'photos';
  const lines = (isFeature || isSwipeProfile || isPhotos) ? [] : (screen as any).lines;
  const ready = (isFeature || isSwipeProfile || isPhotos) ? true : lineIdx >= lines.length - 1;

  // Reset line index when entering a screen
  useEffect(() => {
    setLineIdx(0);
  }, [screenIdx]);

  // Track when current line finishes its reveal
  const onLineDone = () => {
    if (lineIdx < lines.length - 1) setLineIdx((i) => i + 1);
  };

  const progress = (screenIdx + 1) / SCREENS.length;

  const next = async () => {
    vibrate('medium');
    if (screenIdx === SCREENS.length - 1) {
      // Going to register, save selections + swipe-profile fields + photos
      await saveOnboarding({
        music: musicSel,
        photos: photos.length > 0 ? photos : undefined,
        bio: spBio.trim() || undefined,
        city: spCity.trim() || undefined,
        instagram: spInsta.trim() || undefined,
        done: true,
      });
      router.replace('/register');
      return;
    }
    setScreenIdx((s) => s + 1);
  };

  const skipSwipeProfile = async () => {
    vibrate('light');
    setScreenIdx((s) => s + 1);
  };

  // Pick a photo from the gallery (handles permission + base64 conversion).
  const pickPhoto = async () => {
    if (photos.length >= 3) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          Alert.alert(
            'Accès aux photos refusé',
            "Va dans les Réglages pour autoriser Night Finder à accéder à ta galerie photo.",
          );
        }
        return;
      }
      vibrate('light');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
        allowsEditing: true,
        aspect: [3, 4],
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) return;
      const mime = asset.mimeType || 'image/jpeg';
      setPhotos((prev) => [...prev, `data:${mime};base64,${asset.base64}`]);
    } catch {
      // ignore
    }
  };

  const removePhoto = (idx: number) => {
    vibrate('light');
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const skip = async () => {
    vibrate('light');
    await saveOnboarding({ music: musicSel });
    router.replace('/login');
  };

  // For selection screen we require at least 1 pick before enabling CTA
  const canContinue =
    screen.kind === 'selection' ? musicSel.length > 0 && ready : ready;

  // Permission screen: pressing CTA also requests permission
  const askLocation = async () => {
    try {
      if (Platform.OS !== 'web') {
        await Location.requestForegroundPermissionsAsync().catch(() => {});
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            () => resolve(),
            { timeout: 5000 },
          ),
        );
      }
    } catch {}
    next();
  };

  const askNotifications = async () => {
    try {
      if (Platform.OS !== 'web') {
        const Notifications = await import('expo-notifications');
        const settings = await Notifications.getPermissionsAsync();
        if (!settings.granted) await Notifications.requestPermissionsAsync();
      }
    } catch {}
    next();
  };

  // Background images for cinematic screens
  const hasBg = !!(screen as any).bg;

  const Content = (
    <Animated.View
      key={screenIdx}
      entering={FadeIn.duration(500)}
      exiting={FadeOut.duration(300)}
      style={styles.contentWrap}
    >
      {/* Feature showcase card */}
      {isFeature && (() => {
        const f = screen as Feature;
        return (
          <Animated.View entering={FadeInDown.duration(600)} style={styles.featureBlock}>
            <Animated.View
              entering={FadeInDown.delay(120).duration(550)}
              style={[styles.featureIcon, { backgroundColor: `${f.accent}26`, borderColor: `${f.accent}80` }]}
            >
              <Ionicons name={f.icon} size={32} color={f.accent} />
            </Animated.View>
            <Animated.Text
              entering={FadeInDown.delay(200).duration(500)}
              style={[styles.featureEyebrow, { color: f.accent }]}
            >
              {f.eyebrow}
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.delay(280).duration(550)}
              style={styles.featureTitle}
            >
              {f.title}
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.delay(360).duration(500)}
              style={styles.featureSubtitle}
            >
              {f.subtitle}
            </Animated.Text>
            <View style={styles.featureBullets}>
              {f.bullets.map((b, i) => (
                <Animated.View
                  key={b}
                  entering={FadeInDown.delay(440 + i * 90).duration(450)}
                  style={styles.featureBulletRow}
                >
                  <View style={[styles.featureBulletDot, { backgroundColor: f.accent }]} />
                  <Text style={styles.featureBulletText}>{b}</Text>
                </Animated.View>
              ))}
            </View>
          </Animated.View>
        );
      })()}

      {/* Existing lines (already revealed) + current revealing line */}
      {!isFeature && (
      <View style={styles.linesBlock}>
        {lines.slice(0, lineIdx + 1).map((l: Line, i: number) => (
          <View key={`${screenIdx}-${i}`} style={styles.lineSlot}>
            {i === lineIdx ? (
              <WordLine
                line={l}
                onDone={onLineDone}
                big={i === 0 || lines.length <= 3}
                dim={i > 1 && lines.length > 3}
              />
            ) : (
              <Animated.View entering={FadeIn.duration(120)}>
                <Text
                  style={[
                    i === 0 || lines.length <= 3 ? styles.bigText : styles.lineText,
                    i > 1 && lines.length > 3 ? styles.dim : null,
                  ]}
                >
                  {l.text}
                </Text>
              </Animated.View>
            )}
          </View>
        ))}
      </View>
      )}

      {/* Selection (music) */}
      {screen.kind === 'selection' && ready && (
        <Animated.View entering={FadeInDown.duration(500)} style={styles.musicGrid}>
          {MUSIC_OPTS.map((m, i) => {
            const active = musicSel.includes(m.id);
            return (
              <Animated.View
                key={m.id}
                entering={FadeInDown.delay(80 + i * 60).duration(380)}
              >
                <TouchableOpacity
                  style={[styles.musicTag, active && styles.musicTagActive]}
                  onPress={() => {
                    vibrate('light');
                    setMusicSel((prev) =>
                      prev.includes(m.id)
                        ? prev.filter((x) => x !== m.id)
                        : [...prev, m.id],
                    );
                  }}
                  testID={`onboarding-music-${m.id}`}
                  activeOpacity={0.85}
                >
                  <Text style={styles.musicEmoji}>{m.emoji}</Text>
                  <Text style={[styles.musicLabel, active && styles.musicLabelActive]}>
                    {m.label}
                  </Text>
                  {active && (
                    <View style={styles.musicCheck}>
                      <Ionicons name="checkmark" size={11} color={colors.bg} />
                    </View>
                  )}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </Animated.View>
      )}

      {/* Photo picker — 3 slots */}
      {screen.kind === 'photos' && (
        <ScrollView
          contentContainerStyle={styles.photosScroll}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(450)} style={styles.spHeaderBlock}>
            <View
              style={[
                styles.featureIcon,
                { backgroundColor: 'rgba(0,240,255,0.18)', borderColor: 'rgba(0,240,255,0.6)' },
              ]}
            >
              <Ionicons name="images" size={32} color={colors.tertiary} />
            </View>
            <Text style={[styles.spEyebrow, { color: colors.tertiary }]}>
              {"07 · Tes photos swipe"}
            </Text>
            <Text style={styles.spTitle}>{"Ajoute jusqu'à\n3 photos."}</Text>
            <Text style={styles.spSubtitle}>
              {"Elles s'afficheront sur ton profil quand on swipe sur toi. Choisis tes meilleures photos en soirée."}
            </Text>
          </Animated.View>
          <View style={styles.photoGrid}>
            {[0, 1, 2].map((slot) => {
              const uri = photos[slot];
              if (uri) {
                return (
                  <Animated.View
                    key={slot}
                    entering={FadeInDown.delay(80 + slot * 60).duration(380)}
                    style={styles.photoTile}
                  >
                    <Image source={{ uri }} style={styles.photoImg} />
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => removePhoto(slot)}
                      testID={`onboarding-photo-remove-${slot}`}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={14} color={colors.bg} />
                    </TouchableOpacity>
                    {slot === 0 && (
                      <View style={styles.photoBadge}>
                        <Text style={styles.photoBadgeText}>Principale</Text>
                      </View>
                    )}
                  </Animated.View>
                );
              }
              return (
                <Animated.View
                  key={slot}
                  entering={FadeInDown.delay(80 + slot * 60).duration(380)}
                >
                  <TouchableOpacity
                    style={styles.photoSlot}
                    onPress={pickPhoto}
                    testID={`onboarding-photo-add-${slot}`}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add" size={28} color={colors.textSecondary} />
                    <Text style={styles.photoSlotText}>Ajouter</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
          <Text style={styles.spHint}>
            💡 Ta première photo sera ta photo principale. Tu pourras les modifier plus tard depuis ton profil.
          </Text>
        </ScrollView>
      )}

      {/* Swipe-profile mini config — collected during onboarding, persisted at signup */}
      {screen.kind === 'swipe-profile' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.spScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.duration(450)} style={styles.spHeaderBlock}>
              <View style={[styles.featureIcon, { backgroundColor: 'rgba(224,26,79,0.18)', borderColor: 'rgba(224,26,79,0.6)' }]}>
                <Ionicons name="person-circle" size={32} color={colors.primary} />
              </View>
              <Text style={styles.spEyebrow}>{"07 · Ton profil swipe"}</Text>
              <Text style={styles.spTitle}>{"Présente-toi\naux autres."}</Text>
              <Text style={styles.spSubtitle}>
                Ces infos apparaîtront sur ton profil quand on swipe sur toi. Tu peux tout compléter plus tard depuis ton profil.
              </Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(120).duration(450)} style={styles.spFieldBlock}>
              <Text style={styles.spLabel}>Bio courte</Text>
              <TextInput
                value={spBio}
                onChangeText={setSpBio}
                placeholder="3 mots qui te définissent en soirée…"
                placeholderTextColor={colors.textTertiary}
                style={styles.spInput}
                multiline
                maxLength={140}
                testID="onboarding-sp-bio"
              />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(180).duration(450)} style={styles.spFieldBlock}>
              <Text style={styles.spLabel}>Ville</Text>
              <TextInput
                value={spCity}
                onChangeText={setSpCity}
                placeholder="Paris, Lyon, Marseille…"
                placeholderTextColor={colors.textTertiary}
                style={styles.spInput}
                maxLength={60}
                testID="onboarding-sp-city"
              />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(240).duration(450)} style={styles.spFieldBlock}>
              <Text style={styles.spLabel}>Instagram (optionnel)</Text>
              <TextInput
                value={spInsta}
                onChangeText={setSpInsta}
                placeholder="@ton_pseudo"
                placeholderTextColor={colors.textTertiary}
                style={styles.spInput}
                autoCapitalize="none"
                maxLength={40}
                testID="onboarding-sp-insta"
              />
            </Animated.View>
            <Text style={styles.spHint}>
              📸 Tes photos de profil pourront être ajoutées juste après ton inscription, depuis Profil → Modifier mon profil swipe.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Location icon */}
      {screen.kind === 'location' && ready && (
        <Animated.View entering={FadeInDown.duration(500)} style={styles.locWrap}>
          <PulsingIcon icon="location" color={colors.tertiary} />
        </Animated.View>
      )}

      {/* Notifications icon */}
      {screen.kind === 'notifications' && ready && (
        <Animated.View entering={FadeInDown.duration(500)} style={styles.locWrap}>
          <PulsingIcon icon="notifications" color={colors.primary} />
        </Animated.View>
      )}

      {/* Final sparkles */}
      {screen.kind === 'final' && ready && (
        <Animated.View entering={FadeInDown.duration(500)} style={styles.locWrap}>
          <PulsingIcon icon="sparkles" color={colors.primary} />
        </Animated.View>
      )}
    </Animated.View>
  );

  return (
    <View style={styles.container} testID="onboarding-screen">
      {/* Background */}
      {hasBg ? (
        <Animated.View
          key={`bg-${screenIdx}`}
          entering={FadeIn.duration(700)}
          exiting={FadeOut.duration(500)}
          style={StyleSheet.absoluteFillObject}
        >
          <ImageBackground
            source={{ uri: (screen as any).bg }}
            style={{ flex: 1 }}
          />
          <View style={styles.bgDim} />
        </Animated.View>
      ) : (
        <Animated.View
          key={`gradient-${screenIdx}`}
          entering={FadeIn.duration(400)}
          style={[StyleSheet.absoluteFillObject, styles.bgGradient]}
        >
          <View style={styles.bgGlowA} />
          <View style={styles.bgGlowB} />
        </Animated.View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>NIGHT FINDER</Text>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <TouchableOpacity onPress={skip} testID="onboarding-skip-btn">
          <Text style={styles.skipText}>Passer</Text>
        </TouchableOpacity>
      </View>

      {Content}

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {(isSwipeProfile || isPhotos) && (
          <TouchableOpacity
            style={styles.spSkipBtn}
            onPress={skipSwipeProfile}
            testID={isPhotos ? 'onboarding-photos-skip' : 'onboarding-sp-skip'}
          >
            <Text style={styles.spSkipText}>
              {isPhotos
                ? 'Plus tard, je les ajouterai depuis mon profil'
                : 'Plus tard, je le ferai depuis mon profil'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.cta, !canContinue && styles.ctaDisabled]}
          onPress={
            screen.kind === 'location'
              ? askLocation
              : screen.kind === 'notifications'
                ? askNotifications
                : next
          }
          disabled={!canContinue}
          activeOpacity={0.9}
          testID="onboarding-continue-btn"
        >
          <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>
            {screen.cta}
          </Text>
          {canContinue && (
            <Ionicons name="arrow-forward" size={18} color={colors.bg} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function PulsingIcon({
  icon,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 1100 }),
      ),
      -1,
    );
  }, [scale]);
  const ring = useSharedValue(1);
  useEffect(() => {
    ring.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 1400, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
  }, [ring]);
  const innerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ring.value }],
    opacity: 2 - ring.value,
  }));
  return (
    <View style={styles.pulseRoot}>
      <Animated.View
        style={[
          styles.pulseRing,
          { borderColor: color, backgroundColor: `${color}1A` },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.pulseInner,
          { backgroundColor: `${color}26`, borderColor: `${color}80` },
          innerStyle,
        ]}
      >
        <Ionicons name={icon} size={38} color={color} />
      </Animated.View>
    </View>
  );
}

// ============== STYLES ============== //

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  bgGradient: { backgroundColor: colors.bg },
  bgGlowA: {
    position: 'absolute',
    top: -140,
    right: -160,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: colors.primary,
    opacity: 0.18,
  },
  bgGlowB: {
    position: 'absolute',
    bottom: -160,
    left: -160,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: colors.tertiary,
    opacity: 0.14,
  },
  bgDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,9,11,0.7)',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    gap: 12,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  brandText: { color: colors.textPrimary, fontWeight: '900', letterSpacing: 3, fontSize: 10 },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  skipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13 },

  contentWrap: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  linesBlock: { gap: 14, paddingVertical: 16 },

  // Feature showcase
  featureBlock: {
    gap: 14,
    paddingVertical: 16,
  },
  featureIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: 8,
  },
  featureEyebrow: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  featureTitle: {
    color: colors.textPrimary,
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
    letterSpacing: -1.5,
    marginBottom: 12,
  },
  featureSubtitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    opacity: 0.85,
    marginBottom: 16,
  },
  featureBullets: { gap: 10, marginTop: 4 },
  featureBulletRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureBulletDot: { width: 7, height: 7, borderRadius: 4 },
  featureBulletText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14, opacity: 0.92 },

  lineSlot: {},
  bigText: {
    color: colors.textPrimary,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: -1,
  },
  lineText: {
    color: colors.textPrimary,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  dim: { color: colors.textSecondary, fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },

  // Music selection
  musicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 24,
  },
  musicTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(24,24,27,0.85)',
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    position: 'relative',
  },
  musicTagActive: { backgroundColor: 'rgba(224,26,79,0.15)', borderColor: colors.primary },
  musicEmoji: { fontSize: 17 },
  musicLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
  musicLabelActive: { color: colors.textPrimary },
  musicCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },

  // Location & final pulse
  locWrap: { alignItems: 'center', marginTop: 32 },
  pulseRoot: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
  },
  pulseInner: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
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
  ctaDisabled: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.border },
  ctaText: { color: colors.bg, fontSize: 17, fontWeight: '800' },
  ctaTextDisabled: { color: colors.textTertiary },

  // Swipe-profile mini config
  spScroll: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 20 },
  spHeaderBlock: { gap: 8, marginBottom: 14 },
  spEyebrow: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  spTitle: {
    color: colors.textPrimary,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  spSubtitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    opacity: 0.85,
    marginTop: 4,
    marginBottom: 4,
  },
  spFieldBlock: { gap: 6, marginTop: 10 },
  spLabel: { color: colors.textSecondary, fontWeight: '700', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  spInput: {
    backgroundColor: 'rgba(24,24,27,0.85)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 46,
    textAlignVertical: 'top',
  },
  spHint: { color: colors.textTertiary, fontSize: 12, lineHeight: 17, marginTop: 14, marginBottom: 8 },
  spSkipBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  spSkipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' },

  // Photo picker
  photosScroll: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 20 },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  photoSlot: {
    width: (width - spacing.xl * 2 - 20) / 3,
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(24,24,27,0.85)',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoSlotText: { color: colors.textTertiary, fontWeight: '700', fontSize: 11 },
  photoTile: {
    width: (width - spacing.xl * 2 - 20) / 3,
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: 'rgba(9,9,11,0.75)',
  },
  photoBadgeText: { color: colors.textPrimary, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
