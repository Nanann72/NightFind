import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GeofenceCheckIn } from '../../components/GeofenceCheckIn';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  return (
    <>
      <GeofenceCheckIn />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.tertiary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: 'rgba(255,255,255,0.06)',
            borderTopWidth: 0.5,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            tabBarButtonTestID: 'tab-discover',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="sparkles-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarButtonTestID: 'tab-map',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="map-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="swipe"
          options={{
            title: 'Swipe',
            tabBarButtonTestID: 'tab-swipe',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: 'Events',
            tabBarButtonTestID: 'tab-events',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarButtonTestID: 'tab-profile',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="person-outline" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
