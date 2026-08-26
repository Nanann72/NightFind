/**
 * Night Finder 3.0 — pop-ups d'engagement.
 * Affiche périodiquement une bannière animée (« Ça bouge au X », « Léa vient
 * de rejoindre », « 240 personnes sortent ce soir ») pour créer du mouvement
 * et garder l'utilisateur dans l'app. Tap → navigation contextuelle.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useLocation } from '../lib/useLocation';
import { useThemeColors } from '../lib/themeContext';

type Pulse = { type: string; emoji: string; title: string; body: string; image?: string | null; route?: string };

const HIDDEN_Y = -180;
const FIRST_DELAY = 12_000;
const MIN_GAP = 35_000;
const MAX_GAP = 70_000;

export function EngagementPulse() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const loc = useLocation();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const ty = useSharedValue(HIDDEN_Y);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  coordsRef.current = loc.permission === 'granted' ? loc.coords : null;

  const hide = () => {
    ty.value = withTiming(HIDDEN_Y, { duration: 220 });
    setTimeout(() => setPulse(null), 260);
  };

  useEffect(() => {
    let mounted = true;

    const show = (p: Pulse) => {
      if (!mounted) return;
      setPulse(p);
      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      ty.value = withSpring(0, { damping: 17, stiffness: 170 });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        ty.value = withTiming(HIDDEN_Y, { duration: 220 });
        setTimeout(() => mounted && setPulse(null), 260);
      }, 5000);
    };

    const tick = async () => {
      try {
        const c = coordsRef.current;
        const p = await api.activityPulse(c?.lat, c?.lng);
        if (p?.title) show(p);
      } catch {
        // silent (offline / logged out)
      }
      schedule();
    };

    const schedule = () => {
      const gap = MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
      timer.current = setTimeout(tick, gap);
    };

    timer.current = setTimeout(tick, FIRST_DELAY);
    return () => {
      mounted = false;
      if (timer.current) clearTimeout(timer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  if (!pulse) return null;

  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 8 }, animStyle]} pointerEvents="box-none">
      <Pressable
        style={[styles.banner, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
        onPress={() => {
          hide();
          if (pulse.route) router.push(pulse.route as any);
        }}
        testID="engagement-pulse-banner"
      >
        {pulse.image ? (
          <Image source={{ uri: pulse.image }} style={styles.avatar} />
        ) : (
          <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}22` }]}>
            <Text style={styles.emoji} allowFontScaling={false}>{pulse.emoji}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {pulse.title}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={1}>
            {pulse.body}
          </Text>
        </View>
        <Pressable onPress={hide} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 998, elevation: 998 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  title: { fontSize: 14, fontWeight: '800' },
  body: { fontSize: 12.5, marginTop: 1 },
  close: { padding: 4 },
});
