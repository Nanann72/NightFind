import React from 'react';
import { Text, ActivityIndicator, StyleSheet, ViewStyle, StyleProp, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../lib/themeContext';
import { radius } from '../../lib/theme';
import { HapticButton } from './HapticButton';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'lg' | 'md' | 'sm';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** <AppButton> — The single button of the design system (pressed scale + loading). */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading,
  disabled,
  style,
  testID,
}: Props) {
  const colors = useThemeColors();
  const bg =
    variant === 'primary' ? colors.primary
    : variant === 'destructive' ? colors.danger
    : variant === 'secondary' ? colors.fill
    : 'transparent';
  const fg =
    variant === 'primary' || variant === 'destructive' ? '#FFFFFF' : colors.textPrimary;
  const heights: Record<Size, number> = { lg: 52, md: 46, sm: 38 };
  const fontSizes: Record<Size, number> = { lg: 16, md: 15, sm: 13 };
  return (
    <HapticButton
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        st.btn,
        {
          backgroundColor: bg,
          minHeight: heights[size],
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.borderStrong,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <View style={st.inner}>
          {icon && <Ionicons name={icon} size={fontSizes[size] + 2} color={fg} />}
          <Text style={[st.label, { color: fg, fontSize: fontSizes[size] }]}>{label}</Text>
        </View>
      )}
    </HapticButton>
  );
}

const st = StyleSheet.create({
  btn: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '700', letterSpacing: -0.2 },
});
