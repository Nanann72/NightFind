import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GeofenceCheckIn } from '../../components/GeofenceCheckIn';
import { LiquidGlassTabBar } from '../../components/LiquidGlassTabBar';

export default function TabsLayout() {
  return (
    <>
      <GeofenceCheckIn />
      <Tabs
        // Use our custom iOS 26 Liquid Glass floating tab bar.
        tabBar={(props) => <LiquidGlassTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            // Custom prop consumed by LiquidGlassTabBar to render Ionicons.
            // (Cast to any to bypass strict typing on tabBarOptions.)
            ...({ tabBarIconName: 'sparkles-outline' } as any),
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
            ...({ tabBarIconName: 'map-outline' } as any),
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
            ...({ tabBarIconName: 'heart-outline' } as any),
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
            ...({ tabBarIconName: 'calendar-outline' } as any),
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
            ...({ tabBarIconName: 'person-outline' } as any),
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
