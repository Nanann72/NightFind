import React from 'react';
import { View, StyleSheet, Dimensions, ImageBackground, ImageSourcePropType } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, SharedValue, Extrapolation } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { gradients } from '../../lib/theme';

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

const styles = StyleSheet.create({
  wrap: { width, overflow: 'hidden' },
  img: { width },
});
