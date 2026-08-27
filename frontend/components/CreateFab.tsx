/**
 * Night Finder 3.0 — bouton « + » flottant global (au-dessus de la tab bar).
 * Ouvre un bottom sheet : Publier un Moment · Créer une sortie · Partager un lieu.
 * Aucune page intermédiaire : chaque action route directement.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '../lib/themeContext';

const ACTIONS = [
  { icon: 'camera' as const, label: 'Publier un Moment', sub: 'Photo recto/verso façon BeReal', route: '/moment-capture' },
  { icon: 'sparkles' as const, label: 'Créer une sortie', sub: 'Organise une soirée avec tes amis', route: '/(tabs)/events' },
  { icon: 'location' as const, label: 'Partager un lieu', sub: 'Montre où ça bouge ce soir', route: '/(tabs)/map' },
];

export function CreateFab() {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  // Masqué sur Swipe (boutons d'action) et Soirées (bouton + local existant)
  if (pathname?.includes('swipe') || pathname?.includes('events')) return null;

  const toggle = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setOpen((o) => !o);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 92, backgroundColor: colors.primary }]}
        onPress={toggle}
        activeOpacity={0.85}
        testID="create-fab"
      >
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.root}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.surfaceElevated, paddingBottom: insets.bottom + 20 }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.title, { color: colors.textPrimary }]}>Créer</Text>
            {ACTIONS.map((a) => (
              <TouchableOpacity
                key={a.route}
                style={styles.row}
                onPress={() => {
                  setOpen(false);
                  router.push(a.route as any);
                }}
                testID={`create-${a.icon}`}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}1A` }]}>
                  <Ionicons name={a.icon} size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.textPrimary }]}>{a.label}</Text>
                  <Text style={[styles.sub, { color: colors.textSecondary }]}>{a.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '900', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, minHeight: 56 },
  iconWrap: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15.5, fontWeight: '800' },
  sub: { fontSize: 12.5, marginTop: 2 },
});
