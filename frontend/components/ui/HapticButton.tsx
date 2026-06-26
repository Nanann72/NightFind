import React, { useCallback } from 'react';
import { Pressable, PressableProps, Platform, ViewStyle, StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { motion } from '../../lib/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticStyle = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' | 'selection' | 'success' | 'warning' | 'error' | 'none';

interface Props extends Omit<PressableProps, 'style'> {
  haptic?: HapticStyle;
  scale?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /** Press-in spring config override */
  springConfig?: { damping: number; mass: number; stiffness: number };
  disabled?: boolean;
}

/**
 * <HapticButton> — Press-scale animation + haptic feedback on tap.
 * Designed to be the universal touchable primitive across the app.
 */
export function HapticButton({
  haptic = 'light',
  scale = 0.96,
  style,
  children,
  springConfig = motion.spring.snappy,
  disabled,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Props) {
  const pressed = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressed.value }],
  }));

  const triggerHaptic = useCallback(() => {
    if (Platform.OS === 'web' || haptic === 'none') return;
    try {
      switch (haptic) {
        case 'light': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
        case 'medium': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
        case 'heavy': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
        case 'soft': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft); break;
        case 'rigid': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid); break;
        case 'selection': Haptics.selectionAsync(); break;
        case 'success': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
        case 'warning': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
        case 'error': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
      }
    } catch {}
  }, [haptic]);

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withSpring(scale, springConfig);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(1, springConfig);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        triggerHaptic();
        onPress?.(e);
      }}
      style={[animatedStyle, style, disabled && { opacity: 0.5 }]}
    >
      {children}
    </AnimatedPressable>
  );
}
