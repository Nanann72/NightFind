/**
 * Retour Stripe — vérifie le statut du paiement de mise en avant.
 * Poll le backend (source de vérité = API Stripe) jusqu'à confirmation.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const MAX_POLLS = 8;

export default function PromotionStatus() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session_id, cancelled } = useLocalSearchParams<{ session_id?: string; cancelled?: string }>();
  const [state, setState] = useState<'checking' | 'paid' | 'pending' | 'cancelled' | 'error'>(
    cancelled ? 'cancelled' : 'checking',
  );
  const polls = useRef(0);

  useEffect(() => {
    if (cancelled || !session_id) return;
    let stop = false;
    const poll = async () => {
      while (!stop && polls.current < MAX_POLLS) {
        polls.current += 1;
        try {
          const p = await api.promoStatus(String(session_id));
          if (p.payment_status === 'paid') { setState('paid'); return; }
        } catch {
          setState('error');
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!stop) setState('pending');
    };
    poll();
    return () => { stop = true; };
  }, [session_id, cancelled]);

  const META: Record<string, { icon: any; color: string; title: string; text: string }> = {
    checking: {
      icon: 'sync', color: colors.primary, title: 'Vérification du paiement…',
      text: 'Un instant, on confirme ton paiement auprès de Stripe.',
    },
    paid: {
      icon: 'checkmark-circle', color: '#22C55E', title: 'Paiement confirmé 🎉',
      text: "Ta demande de mise en avant est transmise à notre équipe. Tu recevras une notification dès qu'elle sera validée (sous 24h).",
    },
    pending: {
      icon: 'time', color: '#F59E0B', title: 'Paiement en cours',
      text: "Le paiement n'est pas encore confirmé. Si tu as bien payé, il sera validé automatiquement d'ici quelques minutes.",
    },
    cancelled: {
      icon: 'close-circle', color: '#EF4444', title: 'Paiement annulé',
      text: "Aucun montant n'a été débité. Tu peux réessayer quand tu veux.",
    },
    error: {
      icon: 'alert-circle', color: '#EF4444', title: 'Vérification impossible',
      text: 'Réessaie depuis la page « Mise en avant » de ton établissement.',
    },
  };
  const m = META[state];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.card} testID={`promo-status-${state}`}>
        {state === 'checking' ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <Ionicons name={m.icon} size={64} color={m.color} />
        )}
        <Text style={styles.title}>{m.title}</Text>
        <Text style={styles.text}>{m.text}</Text>
        {state !== 'checking' && (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => router.replace('/promote-bar' as any)}
            testID="back-to-promote"
          >
            <Text style={styles.btnText}>Retour à la mise en avant</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl,
      alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: colors.border,
      width: '100%', maxWidth: 420,
    },
    title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    text: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    btn: {
      backgroundColor: colors.primary, borderRadius: 999,
      paddingHorizontal: 24, paddingVertical: 14, marginTop: spacing.sm,
    },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
