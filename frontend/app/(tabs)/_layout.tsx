import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { ClubsProvider } from '../../lib/clubs';

export default function TabsLayout() {
  return (
    <ClubsProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: true,
          tabBarActiveTintColor: colors.tertiary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: {
            position: 'absolute',
            borderTopWidth: 0,
            backgroundColor:
              Platform.OS === 'android'
                ? 'rgba(9,9,11,0.92)'
                : 'transparent',
            elevation: 0,
            height: 78,
            paddingTop: 8,
            paddingBottom: 18,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.4,
          },
          tabBarBackground: () =>
            Platform.OS === 'ios' || Platform.OS === 'web' ? (
              <BlurView
                tint="dark"
                intensity={60}
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'rgba(9,9,11,0.6)' },
                ]}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: 'rgba(9,9,11,0.92)' },
                ]}
              />
            ),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles-outline" color={color} size={size} />
            ),
            tabBarButtonTestID: 'tab-discover',
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="map-outline" color={color} size={size} />
            ),
            tabBarButtonTestID: 'tab-map',
          }}
        />
        <Tabs.Screen
          name="swipe"
          options={{
            title: 'Swipe',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" color={color} size={size} />
            ),
            tabBarButtonTestID: 'tab-swipe',
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: 'Events',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" color={color} size={size} />
            ),
            tabBarButtonTestID: 'tab-events',
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" color={color} size={size} />
            ),
            tabBarButtonTestID: 'tab-profile',
          }}
        />
      </Tabs>
    </ClubsProvider>
  );
}
