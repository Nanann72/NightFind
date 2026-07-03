import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { api, FeedMoment } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const STORY_DURATION_MS = 5000;
const { width: WIN_W, height: WIN_H } = Dimensions.get('window');

const timeAgo = (iso: string): string => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
};

/**
 * Instagram-style fullscreen story viewer.
 *
 * Route: /story-viewer?user_id=xxx&user_name=Chloé
 *
 * Behaviour:
 *  - Fetches all active moments for the target user (24h/7d premium)
 *  - Progress bar animates for STORY_DURATION_MS per story
 *  - Tap RIGHT side → next story
 *  - Tap LEFT side → previous story
 *  - Long-press → pause animation
 *  - Swipe DOWN → close
 *  - Auto-advance ends → closes viewer
 */
export default function StoryViewer() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const params = useLocalSearchParams<{ user_id?: string; user_name?: string }>();

  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const progress = useSharedValue(0);
  const idxRef = useRef(0);

  useEffect(() => { idxRef.current = idx; }, [idx]);

  useEffect(() => {
    if (!params.user_id) {
      router.back();
      return;
    }
    (async () => {
      try {
        const res = await api.momentsFeed(20, undefined, String(params.user_id));
        // Reverse order: oldest first for chronological story flow
        setMoments(res.moments.slice().reverse());
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [params.user_id, router]);

  // Animate progress + advance
  useEffect(() => {
    if (loading || moments.length === 0 || paused) {
      cancelAnimation(progress);
      return;
    }
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: STORY_DURATION_MS, easing: Easing.linear },
      (finished) => {
        if (finished) {
          runOnJS(advance)();
        }
      },
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, moments.length, loading, paused]);

  const advance = () => {
    const next = idxRef.current + 1;
    if (next >= moments.length) {
      router.back();
      return;
    }
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync().catch(() => {});
    }
    setIdx(next);
  };

  const previous = () => {
    if (idxRef.current === 0) return;
    setIdx(idxRef.current - 1);
  };

  const close = () => router.back();

  // Left/right tap zones
  const tapLeft = Gesture.Tap().onEnd(() => runOnJS(previous)());
  const tapRight = Gesture.Tap().onEnd(() => runOnJS(advance)());
  const longPress = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => runOnJS(setPaused)(true))
    .onEnd(() => runOnJS(setPaused)(false));

  // Swipe down to close
  const swipeDown = Gesture.Pan()
    .onEnd((e) => {
      if (e.translationY > 100) runOnJS(close)();
    });

  const composed = Gesture.Simultaneous(swipeDown, longPress);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (moments.length === 0) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: '#fff', marginBottom: 24 }}>Aucun moment actif</Text>
        <TouchableOpacity onPress={close} style={{ padding: 12 }}>
          <Ionicons name="close" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  const current = moments[idx];
  const userName = current.user_name || params.user_name || 'Utilisateur';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <GestureDetector gesture={composed}>
        <View style={styles.root} testID="story-viewer">
          {/* Photo */}
          <View style={styles.imageWrap}>
            <Image
              source={{ uri: current.image }}
              style={styles.image}
              resizeMode="cover"
            />
            {current.selfie && (
              <Image
                source={{ uri: current.selfie }}
                style={styles.selfieOverlay}
              />
            )}
          </View>

          {/* Progress bars (one per story) */}
          <View style={styles.progressRow}>
            {moments.map((_, i) => (
              <View key={i} style={styles.progressTrack}>
                {i < idx ? (
                  <View style={[styles.progressFill, { width: '100%' }]} />
                ) : i === idx ? (
                  <Animated.View style={[styles.progressFill, progressStyle]} />
                ) : null}
              </View>
            ))}
          </View>

          {/* Top header */}
          <View style={styles.headerRow}>
            {current.user_picture ? (
              <Image source={{ uri: current.user_picture }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatar, styles.headerAvatarPh]}>
                <Text style={styles.headerAvatarInitial}>{userName[0]?.toUpperCase() || '?'}</Text>
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.headerName}>{userName}</Text>
              <Text style={styles.headerMeta}>
                {current.club_name ? `📍 ${current.club_name} · ` : ''}{timeAgo(current.created_at)}
              </Text>
            </View>
            <TouchableOpacity onPress={close} style={styles.closeBtn} testID="story-close">
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Caption */}
          {current.caption ? (
            <View style={styles.captionBar}>
              <Text style={styles.captionText}>{current.caption}</Text>
            </View>
          ) : null}

          {/* Left / right tap zones */}
          <View style={styles.tapZones}>
            <GestureDetector gesture={tapLeft}>
              <View style={styles.tapLeft} />
            </GestureDetector>
            <GestureDetector gesture={tapRight}>
              <View style={styles.tapRight} />
            </GestureDetector>
          </View>

          {/* Pause hint */}
          {paused && (
            <View style={styles.pausePill}>
              <Ionicons name="pause" size={14} color="#fff" />
              <Text style={styles.pauseText}>En pause</Text>
            </View>
          )}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  loading: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  imageWrap: { flex: 1 },
  image: { width: WIN_W, height: WIN_H, backgroundColor: '#000' },
  selfieOverlay: {
    position: 'absolute',
    top: 68, left: 12,
    width: WIN_W * 0.26, aspectRatio: 3 / 4,
    borderRadius: 12,
    borderWidth: 2, borderColor: '#fff',
    backgroundColor: '#000',
  },
  progressRow: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 48 : 20,
    left: 8, right: 8,
    flexDirection: 'row', gap: 4,
  },
  progressTrack: {
    flex: 1, height: 2.5, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff' },
  headerRow: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 34,
    left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarPh: { backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  headerAvatarInitial: { color: '#fff', fontWeight: '900', fontSize: 16 },
  headerName: { color: '#fff', fontWeight: '800', fontSize: 14 },
  headerMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  captionBar: {
    position: 'absolute',
    bottom: 40, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  captionText: { color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20 },
  tapZones: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    // Leave the header/progress area untouched
    top: 100, bottom: 60,
  },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  pausePill: {
    position: 'absolute',
    top: '48%',
    alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full,
  },
  pauseText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
