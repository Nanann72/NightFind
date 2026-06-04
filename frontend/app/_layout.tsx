import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../lib/auth';
import { ClubsProvider } from '../lib/clubs';
import { attachNotificationActionListeners } from '../lib/notificationsSetup';
import { colors } from '../lib/theme';

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
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ClubsProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'fade',
              }}
            />
          </ClubsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
