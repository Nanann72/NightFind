/**
 * Night Finder 3.0 — Phase 9 : bannière de notification in-app.
 * Poll le compteur non-lu ; quand il augmente, affiche la dernière notif
 * dans une bannière animée qui glisse depuis le haut (tap → /notifications).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useThemeColors } from '../lib/themeContext';

const HIDDEN_Y = -180;

export function InAppNotificationBanner() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [notif, setNotif] = useState<any | null>(null);
  const prevCount = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ty = useSharedValue(HIDDEN_Y);

  const hide = () => {
    ty.value = withTiming(HIDDEN_Y, { duration: 220 });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setTimeout(() => setNotif(null), 260);
  };

  const show = (n: any) => {
    setNotif(n);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    ty.value = withSpring(0, { damping: 18, stiffness: 180 });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, 4500);
  };

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const r = await api.notificationsUnread();
        const n = r?.unread ?? 0;
        if (mounted && prevCount.current !== null && n > prevCount.current) {
          const list = await api.listNotifications();
          const latest = (list || [])[0];
          if (mounted && latest?.title) show(latest);
        }
        prevCount.current = n;
      } catch {
        // silent (offline / logged out)
      }
    };
    check();
    const id = setInterval(check, 25_000);
    return () => {
      mounted = false;
      clearInterval(id);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  if (!notif) return null;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 8 }, animStyle]}
      pointerEvents="box-none"
    >
      <Pressable
        style={[styles.banner, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
        onPress={() => {
          hide();
          router.push('/notifications');
        }}
        testID="inapp-notif-banner"
      >
        <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}22` }]}>
          <Ionicons name="notifications" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {notif.title}
          </Text>
          {!!notif.body && (
            <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={1}>
              {notif.body}
            </Text>
          )}
        </View>
        <Pressable onPress={hide} hitSlop={10} style={styles.close}>
          <Ionicons name="close" size={16} color={colors.textTertiary} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 999, elevation: 999 },
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
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '800' },
  body: { fontSize: 12.5, marginTop: 1 },
  close: { padding: 4 },
});
