import React from 'react';
import { View, Text, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '../../lib/themeContext';
import { radius } from '../../lib/theme';
import { HapticButton } from './HapticButton';

interface Props {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  ctaLabel?: string;
  onCta?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** <EmptyState> — Elegant premium empty state (icon bubble + title + CTA). */
export function EmptyState({ icon = 'sparkles', title, message, ctaLabel, onCta, style, testID }: Props) {
  const colors = useThemeColors();
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[st.wrap, style]} testID={testID}>
      <View style={[st.bubble, { backgroundColor: colors.primarySoft, borderColor: `${colors.primary}44` }]}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={[st.title, { color: colors.textPrimary }]}>{title}</Text>
      {!!message && <Text style={[st.msg, { color: colors.textSecondary }]}>{message}</Text>}
      {!!ctaLabel && onCta && (
        <HapticButton onPress={onCta} style={[st.cta, { backgroundColor: colors.primary }]}>
          <Text style={st.ctaText}>{ctaLabel}</Text>
        </HapticButton>
      )}
    </Animated.View>
  );
}

/** <ErrorState> — Human-readable error + retry, never a stack trace. */
export function ErrorState({
  title = 'Oups, un problème',
  message = "Impossible de charger le contenu. Vérifie ta connexion et réessaie.",
  onRetry,
  style,
  testID,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[st.wrap, style]} testID={testID}>
      <View style={[st.bubble, { backgroundColor: `${colors.danger}1E`, borderColor: `${colors.danger}44` }]}>
        <Ionicons name="cloud-offline" size={30} color={colors.danger} />
      </View>
      <Text style={[st.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[st.msg, { color: colors.textSecondary }]}>{message}</Text>
      {onRetry && (
        <HapticButton onPress={onRetry} style={[st.cta, { backgroundColor: colors.primary }]} testID="error-retry">
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={st.ctaText}>Réessayer</Text>
        </HapticButton>
      )}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 32 },
  bubble: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  msg: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, maxWidth: 300 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: radius.pill,
    minHeight: 44,
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
