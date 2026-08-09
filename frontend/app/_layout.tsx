import React, { useEffect } from 'react';
import { ScrollView, Text, AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { ClubsProvider } from '../lib/clubs';
import { PremiumProvider } from '../lib/premium';
import { ThemeProvider, useTheme } from '../lib/themeContext';
import { ToastProvider } from '../components/ui/Toast';
import { TabBarScrollProvider } from '../lib/tabBarScroll';
import { attachNotificationActionListeners } from '../lib/notificationsSetup';
import { syncBadge } from '../lib/badge';
import { OfflineBanner } from '../components/OfflineBanner';
import { initI18n } from '../lib/i18n';
import { colors } from '../lib/theme';

// Defensive splash handling for iOS Release builds:
// if the native splash never hides (e.g. due to a silent error during root
// mount), the user is stuck on a black screen. We force-hide it on first
// effect and again on a safety timeout.
try {
  SplashScreen.preventAutoHideAsync().catch(() => {});
} catch {}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView
          style={{ flex: 1, backgroundColor: '#7f1d1d' }}
          contentContainerStyle={{ padding: 32, paddingTop: 80 }}
          testID="root-error-screen"
        >
          <Text selectable style={{ color: '#fff', fontSize: 13, fontFamily: 'Courier' }}>
            {`NIGHT FINDER — RENDER ERROR\n\n${this.state.error.stack || this.state.error.message}`}
          </Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

function ThemedRootContent() {
  const { resolvedScheme, colors: themeColors } = useTheme();
  return (
    <>
      <StatusBar style={resolvedScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: themeColors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen
          name="paywall"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        {/* Detail screens use native iOS slide-from-right with edge swipe back */}
        <Stack.Screen
          name="chat/[matchId]"
          options={{
            animation: 'slide_from_right',
            animationDuration: 280,
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        />
        <Stack.Screen
          name="club/[id]"
          options={{
            animation: 'slide_from_right',
            animationDuration: 280,
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            animation: 'slide_from_right',
            animationDuration: 260,
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        />
      </Stack>
      <OfflineBanner />
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    // Initialize i18n (detects device language on first launch).
    initI18n().catch(() => {});
    // Force-hide the native splash as soon as JS root mounts so we never
    // get stuck on a black splash screen if a downstream provider stalls.
    SplashScreen.hideAsync().catch(() => {});
    // Safety net: in case hideAsync silently rejects, kill the splash hard.
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 2000);

    const detach = attachNotificationActionListeners();
    // Sync the iOS/Android app-icon badge with the unread count whenever
    // the app comes back to the foreground.
    syncBadge();
    const badgeSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncBadge();
    });
    return () => {
      clearTimeout(t);
      badgeSub.remove();
      try {
        detach?.();
      } catch {}
    };
  }, []);

  return (
    <RootErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <PremiumProvider>
                <ClubsProvider>
                  <TabBarScrollProvider>
                    <ToastProvider>
                      <ThemedRootContent />
                    </ToastProvider>
                  </TabBarScrollProvider>
                </ClubsProvider>
              </PremiumProvider>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
  );
}
