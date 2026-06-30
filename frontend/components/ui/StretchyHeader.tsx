import React from 'react';
import { View, StyleSheet, Dimensions, ImageBackground, ImageSourcePropType } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, SharedValue, Extrapolation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients, type ThemeColors, darkColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

const { width } = Dimensions.get('window');
const AnimatedImageBackground = Animated.createAnimatedComponent(ImageBackground);

interface Props {
  scrollY: SharedValue<number>;
  source: ImageSourcePropType;
  height?: number;
  children?: React.ReactNode;
  /** Optional darkening gradient overlay */
  overlay?: boolean;
}

/**
 * <StretchyHeader> — Apple-style elastic header that stretches when overscrolled
 * downward and parallaxes upward on scroll.
 */
export function StretchyHeader({ scrollY, source, height = 320, children, overlay = true }: Props) {
  const animatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [-height, 0, height],
      [-height / 2, 0, height * 0.55],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(scrollY.value, [-height, 0], [2.4, 1], Extrapolation.CLAMP);
    return { transform: [{ translateY }, { scale }] };
  });

  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      <AnimatedImageBackground source={source} style={[styles.img, animatedStyle, { height }]} resizeMode="cover">
        {overlay && (
          <LinearGradient colors={gradients.darkOverlay as any} style={StyleSheet.absoluteFillObject} />
        )}
        {children}
      </AnimatedImageBackground>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { width, overflow: 'hidden' },
  img: { width },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
