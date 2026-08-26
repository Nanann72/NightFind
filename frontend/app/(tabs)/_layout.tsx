import { Tabs } from 'expo-router';
import { GeofenceCheckIn } from '../../components/GeofenceCheckIn';
import { LiquidGlassTabBar } from '../../components/LiquidGlassTabBar';
import { CreateFab } from '../../components/CreateFab';
import { EngagementPulse } from '../../components/EngagementPulse';
import { useTranslation } from '../../lib/i18n';

/**
 * Tabs layout — iOS 26 floating capsule tab bar.
 * Visible tabs: Accueil · Carte · Plus · Chats · Profil.
 * `swipe` and `events` remain valid routes but are hidden from the bar
 * (reachable from the "Plus" hub and deep links).
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <>
      <GeofenceCheckIn />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
        }}
        tabBar={(props) => <LiquidGlassTabBar {...props} />}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t('tabs.home'), tabBarButtonTestID: 'tab-discover' } as any}
        />
        <Tabs.Screen
          name="map"
          options={{ title: t('tabs.map'), tabBarButtonTestID: 'tab-map' } as any}
        />
        <Tabs.Screen
          name="swipe"
          options={{ title: 'Découvrir', tabBarButtonTestID: 'tab-swipe' } as any}
        />
        <Tabs.Screen
          name="chats"
          options={{ title: t('tabs.chats'), tabBarButtonTestID: 'tab-chats' } as any}
        />
        <Tabs.Screen
          name="profile"
          options={{ title: t('tabs.profile'), tabBarButtonTestID: 'tab-profile' } as any}
        />
        {/* Hidden routes — kept for navigation but not in the bar */}
        <Tabs.Screen name="plus" options={{ title: t('tabs.plus') }} />
        <Tabs.Screen name="events" options={{ title: 'Events' }} />
      </Tabs>
      <CreateFab />
      <EngagementPulse />
    </>
  );
}
