import { Tabs } from 'expo-router';
import { GeofenceCheckIn } from '../../components/GeofenceCheckIn';
import { LiquidGlassTabBar } from '../../components/LiquidGlassTabBar';

/**
 * Tabs layout — iOS 26 "Liquid Glass" floating tab bar.
 * The bar itself is rendered by `LiquidGlassTabBar` (custom tabBar component),
 * which renders icons only (no labels) inside a frosted capsule.
 * We pass the icon name via the `tabBarIconName` option (custom field consumed
 * by the LiquidGlassTabBar component).
 */
export default function TabsLayout() {
  return (
    <>
      <GeofenceCheckIn />
      <Tabs
        screenOptions={{
          headerShown: false,
          // Hide the default label-rendering since we display icon-only.
          tabBarShowLabel: false,
        }}
        tabBar={(props) => <LiquidGlassTabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Discover',
            tabBarButtonTestID: 'tab-discover',
            tabBarIconName: 'sparkles-outline',
          } as any}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarButtonTestID: 'tab-map',
            tabBarIconName: 'map-outline',
          } as any}
        />
        <Tabs.Screen
          name="swipe"
          options={{
            title: 'Swipe',
            tabBarButtonTestID: 'tab-swipe',
            tabBarIconName: 'heart-outline',
          } as any}
        />
        <Tabs.Screen
          name="events"
          options={{
            title: 'Events',
            tabBarButtonTestID: 'tab-events',
            tabBarIconName: 'calendar-outline',
          } as any}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarButtonTestID: 'tab-profile',
            tabBarIconName: 'person-outline',
          } as any}
        />
      </Tabs>
    </>
  );
}
