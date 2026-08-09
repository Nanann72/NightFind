import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';
import { useThemeColors } from '../../lib/themeContext';
import { radius, shadows, layer } from '../../lib/theme';

type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

type ToastItem = { id: number; variant: ToastVariant; title: string; message?: string };

interface ToastApi {
  show: (variant: ToastVariant, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastVariant, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  warning: 'warning',
  info: 'information-circle',
  loading: 'hourglass',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const show = useCallback((variant: ToastVariant, title: string, message?: string) => {
    if (timer.current) clearTimeout(timer.current);
    idRef.current += 1;
    setToast({ id: idRef.current, variant, title, message });
    if (Platform.OS !== 'web') {
      try {
        if (variant === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else if (variant === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        else if (variant === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
    }
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (t, m) => show('success', t, m),
    error: (t, m) => show('error', t, m),
    warning: (t, m) => show('warning', t, m),
    info: (t, m) => show('info', t, m),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && <ToastView key={toast.id} toast={toast} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast }: { toast: ToastItem }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const tint =
    toast.variant === 'success' ? colors.success
    : toast.variant === 'error' ? colors.danger
    : toast.variant === 'warning' ? colors.warning
    : colors.info;
  return (
    <Animated.View
      entering={SlideInUp.springify().damping(18)}
      exiting={FadeOutUp.duration(180)}
      style={[st.wrap, { top: insets.top + 8, zIndex: layer.toast }]}
      pointerEvents="none"
    >
      <View
        style={[
          st.card,
          shadows.lg,
          { backgroundColor: colors.glassStrong, borderColor: colors.border },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        testID={`toast-${toast.variant}`}
      >
        <View style={[st.iconWrap, { backgroundColor: `${tint}22` }]}>
          <Ionicons name={ICONS[toast.variant]} size={18} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[st.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {toast.title}
          </Text>
          {!!toast.message && (
            <Text style={[st.msg, { color: colors.textSecondary }]} numberOfLines={2}>
              {toast.message}
            </Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    const noop = () => {};
    return { show: noop, success: noop, error: noop, warning: noop, info: noop };
  }
  return ctx;
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: '100%',
    maxWidth: 480,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14, fontWeight: '700' },
  msg: { fontSize: 12, marginTop: 1, lineHeight: 16 },
});
