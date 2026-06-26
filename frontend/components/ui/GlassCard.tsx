import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useThemeColors } from '../../lib/themeContext';
import { radius, shadows } from '../../lib/theme';

interface Props {
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  elevated?: boolean;
  children?: React.ReactNode;
}

/**
 * <GlassCard> — Native iOS-style frosted glass surface.
 * Uses BlurView on iOS/Android, falls back to solid tinted bg on web.
 */
export function GlassCard({
  intensity = 40,
  tint,
  borderRadius = radius.xl,
  style,
  contentStyle,
  elevated = false,
  children,
}: Props) {
  const colors = useThemeColors();
  const resolvedTint = tint || (colors.statusBarStyle === 'light' ? 'dark' : 'light');

  return (
    <View
      style={[
        {
          borderRadius,
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: Platform.OS === 'web' ? colors.glass : 'transparent',
        },
        elevated && shadows.lg,
        style,
      ]}
    >
      {Platform.OS !== 'web' ? (
        <BlurView
          intensity={intensity}
          tint={resolvedTint}
          style={[StyleSheet.absoluteFillObject, { borderRadius }]}
        />
      ) : null}
      <View style={contentStyle}>{children}</View>
    </View>
  );
}
