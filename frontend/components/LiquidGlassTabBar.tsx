import React from 'react';
import {
  View,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

/**
 * iOS 26 "Liquid Glass" floating tab bar.
 *
 * - Frosted glass capsule, detached from the bottom edge
 * - Active tab gets a soft pill highlight behind its icon
 * - No text labels (icon-only, native iOS 26 look)
 * - Works on iOS (BlurView), Android (translucent solid fallback)
 */
export function LiquidGlassTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomGap = Math.max(insets.bottom - 4, 14);

  return (
    <View
      style={[styles.outer, { paddingBottom: bottomGap }]}
      pointerEvents="box-none"
    >
      <View style={styles.capsuleShadow} pointerEvents="box-none">
        <View style={styles.capsuleWrap}>
          {Platform.OS === 'ios' ? (
            <BlurView
              tint="dark"
              intensity={70}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: 'rgba(20,20,22,0.88)' },
              ]}
            />
          )}
          <View style={styles.capsuleTint} />
          <View style={styles.capsuleBorder} pointerEvents="none" />
          <View style={styles.row}>
            {state.routes.map((route, index) => {
              const { options } = descriptors[route.key];
              const isFocused = state.index === index;

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name as never);
                }
              };

              const onLongPress = () => {
                navigation.emit({
                  type: 'tabLongPress',
                  target: route.key,
                });
              };

              const iconName = (options as any).tabBarIconName as
                | keyof typeof Ionicons.glyphMap
                | undefined;
              const label = (options.title as string) || route.name;

              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={isFocused ? { selected: true } : {}}
                  accessibilityLabel={label}
                  testID={(options as any).tabBarButtonTestID}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  style={styles.itemPressable}
                  hitSlop={6}
                >
                  <View
                    style={[
                      styles.itemInner,
                      isFocused && styles.itemInnerActive,
                    ]}
                  >
                    <Ionicons
                      name={
                        (isFocused
                          ? iconName?.replace(/-outline$/, '')
                          : iconName) || 'ellipse-outline'
                      }
                      size={24}
                      color={isFocused ? '#fff' : 'rgba(255,255,255,0.55)'}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  capsuleShadow: {
    // Soft drop shadow to lift the capsule off content (iOS only).
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
      android: {
        elevation: 14,
      },
    }),
    borderRadius: 36,
  },
  capsuleWrap: {
    borderRadius: 36,
    overflow: 'hidden',
    // Slight inner tint baked into the wrapper for cross-platform parity.
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(20,20,22,0.92)',
  },
  capsuleTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,12,14,0.55)',
  },
  capsuleBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 36,
    borderWidth: 0.6,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  itemPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInner: {
    width: 54,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInnerActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    // Subtle highlight border on the active pill.
    borderWidth: 0.6,
    borderColor: 'rgba(255,255,255,0.18)',
  },
});
