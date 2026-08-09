import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useThemeColors } from '../lib/themeContext';
import { AppButton } from './ui/AppButton';
import { registerForPush } from '../lib/push';

const PRIMER_KEY = 'nf_push_primer_shown';
const NUDGE_KEY = 'nf_push_nudge_at';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Premium pre-permission screen ("Restez informé") shown ONCE before the
 * native iOS/Android push prompt. Also handles the weekly "denied" nudge
 * that deep-links to the system Settings.
 */
export function PushPrimerModal({ userId }: { userId?: string | null }) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<null | 'primer' | 'settings'>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        const perms = await Notifications.getPermissionsAsync();
        if (cancelled) return;
        if (perms.granted) {
          // Already authorized — silent (re)registration, tokens can rotate
          registerForPush(userId).catch(() => {});
          return;
        }
        if (perms.canAskAgain) {
          const shown = await AsyncStorage.getItem(PRIMER_KEY);
          if (!shown && !cancelled) setTimeout(() => setMode('primer'), 1800);
        } else {
          // Denied permanently — gentle weekly nudge towards Settings
          const last = await AsyncStorage.getItem(NUDGE_KEY);
          if ((!last || Date.now() - Number(last) > WEEK_MS) && !cancelled) {
            setTimeout(() => setMode('settings'), 2500);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dismiss = useCallback(async () => {
    setMode(null);
    try {
      await AsyncStorage.setItem(PRIMER_KEY, '1');
      await AsyncStorage.setItem(NUDGE_KEY, String(Date.now()));
    } catch {}
  }, []);

  const enable = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem(PRIMER_KEY, '1');
      await registerForPush(userId, { interactive: true });
    } catch {}
    setBusy(false);
    setMode(null);
  }, [userId]);

  const openSettings = useCallback(async () => {
    try {
      await AsyncStorage.setItem(NUDGE_KEY, String(Date.now()));
    } catch {}
    setMode(null);
    Linking.openSettings().catch(() => {});
  }, []);

  if (!mode) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={st.overlay}>
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          style={[st.card, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
          testID="push-primer-modal"
        >
          <Animated.View
            entering={ZoomIn.delay(150).springify().damping(9)}
            style={[st.bell, { backgroundColor: colors.primarySoft, borderColor: `${colors.primary}55` }]}
          >
            <Ionicons name="notifications" size={34} color={colors.primary} />
          </Animated.View>
          <Text style={[st.title, { color: colors.textPrimary }]}>Restez informé</Text>
          <Text style={[st.sub, { color: colors.textSecondary }]}>
            {mode === 'primer'
              ? 'Reçois une notification quand quelqu\'un te like, t\'envoie un message ou quand un Moment démarre — même quand l\'app est fermée.'
              : 'Les notifications sont désactivées. Active-les dans les Réglages pour ne pas manquer tes matchs et messages.'}
          </Text>
          <View style={st.perks}>
            {[
              { icon: 'heart' as const, label: 'Matchs et Super Likes' },
              { icon: 'chatbubble' as const, label: 'Messages reçus' },
              { icon: 'flash' as const, label: 'Moments Night Finder ⚡' },
            ].map((p) => (
              <View key={p.label} style={st.perkRow}>
                <Ionicons name={p.icon} size={15} color={colors.primary} />
                <Text style={[st.perkText, { color: colors.textPrimary }]}>{p.label}</Text>
              </View>
            ))}
          </View>
          {mode === 'primer' ? (
            <AppButton
              label="Activer les notifications"
              onPress={enable}
              loading={busy}
              testID="push-primer-enable"
              style={{ alignSelf: 'stretch' }}
            />
          ) : (
            <AppButton
              label="Ouvrir les Réglages"
              icon="settings-outline"
              onPress={openSettings}
              testID="push-primer-settings"
              style={{ alignSelf: 'stretch' }}
            />
          )}
          <AppButton
            label="Plus tard"
            variant="ghost"
            size="md"
            onPress={dismiss}
            testID="push-primer-later"
            style={{ alignSelf: 'stretch', marginTop: 10, borderWidth: 0 }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    borderWidth: 1,
    padding: 26,
    alignItems: 'center',
  },
  bell: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 23, fontWeight: '900', letterSpacing: -0.4, marginBottom: 8 },
  sub: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  perks: { alignSelf: 'stretch', gap: 10, marginBottom: 20 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  perkText: { fontSize: 14, fontWeight: '600' },
});
