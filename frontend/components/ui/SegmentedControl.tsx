import React from 'react';
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '../../lib/themeContext';
import { radius, spacing, typography, motion } from '../../lib/theme';

interface Segment {
  key: string;
  label: string;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
}

/**
 * <SegmentedControl> — UIKit-style segmented control with sliding pill.
 */
export function SegmentedControl({ segments, value, onChange }: Props) {
  const colors = useThemeColors();
  const [width, setWidth] = React.useState(0);
  const segCount = segments.length;
  const idx = Math.max(0, segments.findIndex((s) => s.key === value));
  const segWidth = width > 0 ? (width - 4) / segCount : 0;
  const translateX = useSharedValue(0);

  React.useEffect(() => {
    translateX.value = withSpring(idx * segWidth, motion.spring.smooth);
  }, [idx, segWidth, translateX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.fill }]} onLayout={onLayout}>
      {segWidth > 0 && (
        <Animated.View
          style={[
            styles.pill,
            { width: segWidth, backgroundColor: colors.surfaceElevated },
            pillStyle,
          ]}
        />
      )}
      {segments.map((s) => {
        const active = s.key === value;
        return (
          <Pressable
            key={s.key}
            onPress={() => {
              if (s.key !== value) {
                try { Haptics.selectionAsync(); } catch {}
                onChange(s.key);
              }
            }}
            style={styles.btn}
          >
            <Text
              style={[
                typography.subheadMedium,
                { color: active ? colors.textPrimary : colors.textSecondary },
              ]}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 2,
    position: 'relative',
  },
  pill: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    borderRadius: radius.md - 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
