/**
 * LiquidGlassTabBar v2 — iOS 26 inspired floating tab bar
 * -------------------------------------------------------
 *  • Floating capsule with native BlurView (iOS) / fallback (Android/Web)
 *  • Auto-hide on scroll down, reveal on scroll up
 *  • Active-tab pill with spring slide
 *  • Icon morph (outline → filled) on selection + scale bounce
 *  • Haptic feedback on tab change
 *  • Edge-to-edge respect of safe area
 */
import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet, Platform, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useThemeColors } from '../lib/themeContext';
import { useTabBarScroll } from '../lib/tabBarScroll';
import { motion, radius, shadows, typography } from '../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const BAR_HEIGHT = 60;
const BAR_HORIZONTAL_MARGIN = 16;
const BAR_VERTICAL_OFFSET = 8;

// Map route → icon pair (outline / filled)
const ICON_MAP: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  index: { outline: 'sparkles-outline', filled: 'sparkles' },
  map: { outline: 'map-outline', filled: 'map' },
  swipe: { outline: 'heart-outline', filled: 'heart' },
  events: { outline: 'calendar-outline', filled: 'calendar' },
  profile: { outline: 'person-outline', filled: 'person' },
};

function TabIcon({
  name,
  focused,
  color,
}: {
  name: string;
  focused: boolean;
  color: string;
}) {
  const pair = ICON_MAP[name] || { outline: 'square-outline' as any, filled: 'square' as any };
  const scale = useSharedValue(focused ? 1 : 0.9);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 0.9, motion.spring.bouncy);
  }, [focused, scale]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={animStyle}>
      <Ionicons
        name={focused ? pair.filled : pair.outline}
        size={focused ? 26 : 24}
        color={color}
      />
    </Animated.View>
  );
}

export function LiquidGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { tabBarVisible } = useTabBarScroll();

  const barWidth = SCREEN_W - BAR_HORIZONTAL_MARGIN * 2;
  const tabWidth = barWidth / state.routes.length;
  const pillTranslateX = useSharedValue(state.index * tabWidth);

  useEffect(() => {
    pillTranslateX.value = withSpring(state.index * tabWidth, motion.spring.smooth);
  }, [state.index, tabWidth, pillTranslateX]);

  // Animated style for show/hide on scroll
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

  // Pill style
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillTranslateX.value }],
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
              width: tabWidth - 12,
              left: 6,
              backgroundColor: colors.fillStrong,
            },
            pillStyle,
          ]}
        />

        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const { options } = descriptors[route.key];

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

          const color = focused ? colors.textPrimary : colors.textTertiary;
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
              accessibilityLabel={(options as any).tabBarAccessibilityLabel || route.name}
              hitSlop={8}
            >
              <TabIcon name={route.name} focused={focused} color={color} />
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
    zIndex: 2,
  },
});
