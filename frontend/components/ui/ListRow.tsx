import React from 'react';
import { View, Text, StyleSheet, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../lib/themeContext';
import { radius } from '../../lib/theme';
import { HapticButton } from './HapticButton';

/**
 * iOS 26 grouped settings list — Apple Settings style.
 * <ListGroup title="Compte"> <ListRow .../> ... </ListGroup>
 * Rows get grouped corner radii + inset dividers automatically.
 */

export function ListGroup({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={st.group}>
      {!!title && (
        <Text style={[st.groupTitle, { color: colors.textTertiary }]}>{title.toUpperCase()}</Text>
      )}
      <View style={[st.card, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSubtle }]}>
        {items.map((child, i) => (
          <View key={i}>
            {child}
            {i < items.length - 1 && (
              <View style={[st.divider, { backgroundColor: colors.border }]} />
            )}
          </View>
        ))}
      </View>
      {!!footer && (
        <Text style={[st.groupFooter, { color: colors.textTertiary }]}>{footer}</Text>
      )}
    </View>
  );
}

export function ListRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  sublabel,
  onPress,
  chevron = true,
  toggle,
  onToggle,
  destructive,
  testID,
  rightElement,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBg?: string;
  label: string;
  value?: string;
  sublabel?: string;
  onPress?: () => void;
  chevron?: boolean;
  toggle?: boolean;
  onToggle?: (v: boolean) => void;
  destructive?: boolean;
  testID?: string;
  rightElement?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const labelColor = destructive ? colors.danger : colors.textPrimary;
  const content = (
    <View style={st.row}>
      {icon && (
        <View style={[st.iconBox, { backgroundColor: iconBg || colors.fillSubtle }]}>
          <Ionicons name={icon} size={17} color={iconColor || (destructive ? colors.danger : colors.textSecondary)} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[st.label, { color: labelColor }]} numberOfLines={1}>{label}</Text>
        {!!sublabel && (
          <Text style={[st.sublabel, { color: colors.textTertiary }]} numberOfLines={1}>{sublabel}</Text>
        )}
      </View>
      {!!value && <Text style={[st.value, { color: colors.textTertiary }]} numberOfLines={1}>{value}</Text>}
      {rightElement}
      {toggle !== undefined ? (
        <Switch
          value={toggle}
          onValueChange={onToggle}
          trackColor={{ false: colors.fillStrong, true: colors.primary }}
          thumbColor="#fff"
          {...(Platform.OS === 'ios' ? { ios_backgroundColor: colors.fillStrong } : {})}
        />
      ) : onPress && chevron ? (
        <Ionicons name="chevron-forward" size={17} color={colors.textQuaternary} />
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <HapticButton onPress={onPress} scale={0.99} haptic="selection" testID={testID} accessibilityRole="button" accessibilityLabel={label}>
        {content}
      </HapticButton>
    );
  }
  return <View testID={testID}>{content}</View>;
}

const st = StyleSheet.create({
  group: { marginTop: 24, paddingHorizontal: 16 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 14,
  },
  groupFooter: { fontSize: 12, lineHeight: 16, marginTop: 8, marginHorizontal: 14 },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, fontWeight: '500', letterSpacing: -0.2 },
  sublabel: { fontSize: 12, marginTop: 1 },
  value: { fontSize: 15 },
});
