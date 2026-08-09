import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { api } from '../lib/api';
import { type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';
import { AppButton } from '../components/ui/AppButton';

type EventInfo = { event_id: string; title: string; starts_at: string; ends_at: string; duration_min: number };

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * BeReal-style event screen. The countdown is ALWAYS computed from the
 * SERVER end time + a server/device clock offset, so every device shows
 * exactly the same remaining time (timezones, clock drift, background,
 * reconnection — all handled by re-syncing on focus/foreground).
 */
export default function MomentEventScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  // serverOffset = serverTime - deviceTime → serverNow = Date.now() + offset
  const offsetRef = useRef(0);

  const sync = useCallback(async () => {
    try {
      const res = await api.momentEventCurrent();
      offsetRef.current = new Date(res.server_time).getTime() - Date.now();
      setEvent(res.event);
    } catch {
      // keep last known state — countdown still runs on last known offset
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    sync();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    // Re-sync when app returns to foreground (lock screen, background, reconnection)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    const resync = setInterval(sync, 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(resync);
      sub.remove();
    };
  }, [sync]);

  const serverNow = now + offsetRef.current;
  const startsAt = event ? new Date(event.starts_at).getTime() : 0;
  const endsAt = event ? new Date(event.ends_at).getTime() : 0;
  const remaining = endsAt - serverNow;
  const untilStart = startsAt - serverNow;

  type Phase = 'none' | 'soon' | 'active' | 'ending' | 'done';
  const phase: Phase = !event
    ? 'none'
    : untilStart > 0
      ? 'soon'
      : remaining <= 0
        ? 'done'
        : remaining <= 3 * 60_000
          ? 'ending'
          : 'active';

  const phaseUi: Record<Phase, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
    none: { label: 'Aucun événement en cours', color: colors.textTertiary, icon: 'moon' },
    soon: { label: 'Ça arrive bientôt', color: colors.info, icon: 'time' },
    active: { label: 'Maintenant !', color: colors.primary, icon: 'flash' },
    ending: { label: 'Plus que quelques minutes', color: colors.warning, icon: 'hourglass' },
    done: { label: 'Événement terminé', color: colors.textTertiary, icon: 'checkmark-circle' },
  };
  const ui = phaseUi[phase];
  const counter = phase === 'soon' ? untilStart : phase === 'active' || phase === 'ending' ? remaining : 0;
  const progress =
    event && (phase === 'active' || phase === 'ending')
      ? Math.min(1, Math.max(0, remaining / (endsAt - startsAt)))
      : 0;

  return (
    <View style={styles.container} testID="moment-event-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient colors={['#2b0a12', '#0f0508', colors.bg]} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="mev-back">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Moment Night Finder</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(10)} style={[styles.bolt, { borderColor: `${ui.color}66`, backgroundColor: `${ui.color}1A` }]}>
          <Ionicons name={ui.icon} size={44} color={ui.color} />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(150)} style={[styles.phase, { color: ui.color }]}>
          {ui.label}
        </Animated.Text>
        {loading ? (
          <Text style={styles.counter}>—:—</Text>
        ) : phase === 'none' ? (
          <Text style={styles.noneText}>
            Reste à l&apos;affût : quand un Moment démarre, tu reçois une notification et tout le monde a le même compte à rebours. ⚡
          </Text>
        ) : (
          <>
            <Text style={styles.counter} testID="mev-counter">
              {phase === 'done' ? '00:00' : fmt(counter)}
            </Text>
            {(phase === 'active' || phase === 'ending') && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: ui.color }]} />
              </View>
            )}
            <Text style={styles.explain}>
              {phase === 'soon'
                ? 'Prépare-toi, le Moment va commencer.'
                : phase === 'done'
                  ? 'Rendez-vous au prochain Moment !'
                  : 'Capture ta soirée en double caméra avant la fin du compte à rebours. Tout le monde poste en même temps.'}
            </Text>
          </>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        {(phase === 'active' || phase === 'ending') && (
          <AppButton
            label="Capturer mon Moment 📸"
            onPress={() => router.push('/(tabs)/map' as any)}
            testID="mev-capture"
          />
        )}
        <Text style={styles.hint}>
          {phase === 'active' || phase === 'ending'
            ? 'Rends-toi sur la fiche du club où tu es (check-in requis) pour poster.'
            : ''}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bolt: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  phase: { fontSize: 17, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  counter: {
    color: '#fff',
    fontSize: 76,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 10,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 18,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  explain: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 22,
  },
  noneText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 16,
  },
  footer: { paddingHorizontal: 24, gap: 10 },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
});
