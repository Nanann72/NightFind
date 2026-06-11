import React, { useEffect } from 'react';
import { ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { ClubsProvider } from '../lib/clubs';
import { PremiumProvider } from '../lib/premium';
import { attachNotificationActionListeners } from '../lib/notificationsSetup';
import { colors } from '../lib/theme';

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

export default function RootLayout() {
  useEffect(() => {
    const detach = attachNotificationActionListeners();
    return () => {
      try {
        detach?.();
      } catch {}
    };
  }, []);

  return (
    <RootErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PremiumProvider>
            <ClubsProvider>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                  animation: 'fade',
                }}
              >
                <Stack.Screen
                  name="paywall"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
              </Stack>
            </ClubsProvider>
          </PremiumProvider>
        </AuthProvider>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    </RootErrorBoundary>
  );
}
