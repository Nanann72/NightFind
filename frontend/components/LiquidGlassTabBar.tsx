/**
 * LiquidGlassTabBar v3 — iOS 26 floating capsule tab bar
 * ------------------------------------------------------
 *  • Floating glass capsule (BlurView iOS / fallback elsewhere)
 *  • 5 tabs with icon + label: Accueil · Carte · Plus · Chats · Profil
 *  • Active pill (violet soft) with spring slide
 *  • Icon morph outline→filled + subtle scale
 *  • Haptics, auto-hide on scroll, safe area respected
 *  • Hidden routes (swipe, events) stay navigable but never shown
 */
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useThemeColors } from '../lib/themeContext';
import { useTabBarScroll } from '../lib/tabBarScroll';
import { useUnreadMessages } from '../lib/useUnreadMessages';
import { motion, radius, shadows } from '../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const BAR_HEIGHT = 64;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_VERTICAL_OFFSET = 8;

/** Routes that exist inside (tabs) but must not appear in the bar */
const HIDDEN_TABS = new Set(['plus', 'events']);

const ICON_MAP: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  index: { outline: 'home-outline', filled: 'home' },
  map: { outline: 'map-outline', filled: 'map' },
  swipe: { outline: 'heart-outline', filled: 'heart' },
  plus: { outline: 'grid-outline', filled: 'grid' },
  chats: { outline: 'chatbubble-outline', filled: 'chatbubble' },
  profile: { outline: 'person-outline', filled: 'person' },
};

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const pair = ICON_MAP[name] || { outline: 'square-outline' as any, filled: 'square' as any };
  const scale = useSharedValue(focused ? 1 : 0.92);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 0.92, motion.spring.bouncy);
  }, [focused, scale]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={animStyle}>
      <Ionicons name={focused ? pair.filled : pair.outline} size={23} color={color} />
    </Animated.View>
  );
}

export function LiquidGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { tabBarVisible } = useTabBarScroll();
  const { unread: unreadChats } = useUnreadMessages();

  const visibleRoutes = state.routes.filter((r) => !HIDDEN_TABS.has(r.name));
  const barWidth = SCREEN_W - BAR_HORIZONTAL_MARGIN * 2;
  const tabWidth = barWidth / Math.max(visibleRoutes.length, 1);
  const activeKey = state.routes[state.index]?.key;
  const activeVisibleIndex = visibleRoutes.findIndex((r) => r.key === activeKey);

  const pillTranslateX = useSharedValue(Math.max(activeVisibleIndex, 0) * tabWidth);
  const pillOpacity = useSharedValue(activeVisibleIndex >= 0 ? 1 : 0);

  useEffect(() => {
    if (activeVisibleIndex >= 0) {
      pillTranslateX.value = withSpring(activeVisibleIndex * tabWidth, motion.spring.smooth);
      pillOpacity.value = withTiming(1, { duration: 160 });
    } else {
      pillOpacity.value = withTiming(0, { duration: 160 });
    }
  }, [activeVisibleIndex, tabWidth, pillTranslateX, pillOpacity]);

  const containerStyle = useAnimatedStyle(() => {
    const ty = interpolate(
      tabBarVisible.value,
      [0, 1],
      [BAR_HEIGHT + insets.bottom + BAR_VERTICAL_OFFSET + 20, 0],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(tabBarVisible.value, [0, 0.5, 1], [0, 0.6, 1], Extrapolation.CLAMP);
    return { transform: [{ translateY: ty }], opacity };
  });

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillTranslateX.value }],
    opacity: pillOpacity.value,
  }));

  const tint = colors.statusBarStyle === 'light' ? 'dark' : 'light';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8) + BAR_VERTICAL_OFFSET,
          paddingHorizontal: BAR_HORIZONTAL_MARGIN,
        },
        containerStyle,
      ]}
    >
      <View
        style={[
          styles.bar,
          {
            backgroundColor: Platform.OS === 'web' ? colors.tabBarBg : 'transparent',
            borderColor: colors.tabBarBorder,
          },
          shadows.lg,
        ]}
      >
        {Platform.OS !== 'web' && (
          <BlurView
            intensity={Platform.OS === 'ios' ? 70 : 50}
            tint={tint}
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFillObject}
          />
        )}

        {/* Sliding active pill */}
        <Animated.View
          style={[
            styles.pill,
            {
              width: tabWidth - 10,
              left: 5,
              backgroundColor: colors.primarySoft,
            },
            pillStyle,
          ]}
        />

        {visibleRoutes.map((route) => {
          const focused = route.key === activeKey;
          const { options } = descriptors[route.key];
          const label = (options.title as string) || route.name;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              if (Platform.OS !== 'web') {
                try { Haptics.selectionAsync(); } catch {}
              }
              navigation.navigate(route.name as never);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
            if (Platform.OS !== 'web') {
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
            }
          };

          const color = focused ? colors.primary : colors.textTertiary;
          const testID = (options as any).tabBarButtonTestID || `tab-${route.name}`;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tab}
              testID={testID}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={(options as any).tabBarAccessibilityLabel || label}
              hitSlop={8}
            >
              <View>
                <TabIcon name={route.name} focused={focused} color={color} />
                {route.name === 'chats' && unreadChats > 0 && (
                  <View style={[styles.tabBadge, { backgroundColor: colors.primary }]} testID="chats-tab-badge">
                    <Text style={styles.tabBadgeText} allowFontScaling={false}>
                      {unreadChats > 9 ? '9+' : String(unreadChats)}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[styles.label, { color }]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: radius.pill,
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    zIndex: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  tabBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
});
