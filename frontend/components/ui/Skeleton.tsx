import React, { useEffect } from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { useThemeColors } from '../../lib/themeContext';
import { radius } from '../../lib/theme';

interface Props {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * <Skeleton> — Native-style shimmering placeholder.
 * Use to mask loading content with smooth opacity pulse.
 */
export function Skeleton({ width = '100%', height = 16, borderRadius: br = radius.sm, style }: Props) {
  const colors = useThemeColors();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width: width as any, height: height as any, borderRadius: br, backgroundColor: colors.fill },
        animatedStyle,
        style,
      ]}
    />
  );
}
