/**
 * 🎉 Partner offer unlocked modal — spring animation, violet halo.
 */
import { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, ZoomIn, FadeInDown } from 'react-native-reanimated';
import { useRouter } from 'expo-router';

const P = {
  bg: 'rgba(5,5,5,0.88)',
  card: '#141414',
  border: 'rgba(255,255,255,0.1)',
  violet: '#8B5CF6',
  violetSoft: 'rgba(139,92,246,0.14)',
  text: '#fff',
  dim: '#A1A1AA',
};

export function PartnerUnlockModal({
  coupon,
  onClose,
}: {
  coupon: any | null;
  onClose: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    if (coupon && Platform.OS !== 'web') {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    }
  }, [coupon]);

  if (!coupon) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(250)} style={styles.backdrop}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={styles.card}>
          <View style={styles.halo} pointerEvents="none" />
          <Text style={styles.emoji} allowFontScaling={false}>🎉</Text>
          <Text style={styles.title}>Offre débloquée !</Text>
          <Text style={styles.text}>
            Vous avez découvert Night Finder grâce à notre bar partenaire.{'\n'}
            Profitez de <Text style={styles.bold}>-{coupon.discount_pct ?? 10} %</Text> de
            réduction chez <Text style={styles.bold}>{coupon.club_name}</Text>.
          </Text>
          <Animated.View entering={FadeInDown.delay(250)} style={styles.codeBox}>
            <Text style={styles.code} allowFontScaling={false}>{coupon.code}</Text>
          </Animated.View>
          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={() => { onClose(); router.push('/advantages'); }}
            testID="unlock-see-advantages"
          >
            <Ionicons name="gift" size={16} color="#fff" />
            <Text style={styles.ctaText}>Voir mes avantages</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.later} testID="unlock-close">
            <Text style={styles.laterText}>Plus tard</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: P.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: P.card, borderRadius: 30,
    borderWidth: 1, borderColor: P.border, padding: 28, alignItems: 'center', overflow: 'hidden',
  },
  halo: {
    position: 'absolute', top: -90, alignSelf: 'center', width: 240, height: 240,
    borderRadius: 120, backgroundColor: 'rgba(139,92,246,0.12)',
  },
  emoji: { fontSize: 48, marginBottom: 10 },
  title: { color: P.text, fontSize: 22, fontWeight: '800' },
  text: { color: P.dim, fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 10 },
  bold: { color: P.text, fontWeight: '700' },
  codeBox: {
    marginTop: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: P.violet,
    backgroundColor: P.violetSoft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 24,
  },
  code: { color: P.text, fontSize: 20, fontWeight: '800', letterSpacing: 3 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: P.violet,
    borderRadius: 999, paddingVertical: 14, paddingHorizontal: 26, marginTop: 22, minHeight: 48,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  later: { marginTop: 12, padding: 6 },
  laterText: { color: P.dim, fontSize: 13, fontWeight: '600' },
});
