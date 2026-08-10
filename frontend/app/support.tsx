/**
 * Route publique /support — Page d'accueil Support Night Finder.
 * Sert de page d'accueil pour https://nightfinder.support/ (App Store Connect
 * "Support URL") et reste accessible depuis l'app (Réglages → Aide).
 */
import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const SUPPORT_EMAIL = 'support@nightfinder.app';
const ABUSE_EMAIL = 'abuse@nightfinder.app';

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Comment fonctionne Night Finder ?',
    a: "Night Finder te montre les clubs, soirées et personnes autour de toi. Active ta localisation pour découvrir la vie nocturne à proximité.",
  },
  {
    q: 'Comment matcher avec quelqu\u2019un ?',
    a: "Ouvre la Découverte (onglet Plus), swipe à droite pour liker. Si la personne te like aussi, c'est un match — vous pouvez discuter.",
  },
  {
    q: 'Comment fonctionne la reconnaissance musicale ?',
    a: "Dans « Mes musiques », appuie sur le bouton scanner : l'app écoute ~10 secondes et identifie le morceau joué. L'échantillon audio n'est jamais conservé.",
  },
  {
    q: 'Comment gérer / annuler mon abonnement Premium ?',
    a: "iOS : Réglages → ton nom → Abonnements → Night Finder.\nAndroid : Google Play → Profil → Paiements et abonnements.\nTu peux aussi restaurer tes achats depuis l'écran Premium.",
  },
  {
    q: 'Comment bloquer ou signaler quelqu\u2019un ?',
    a: "Depuis une conversation ou un profil, ouvre le menu ⋯ puis « Bloquer » ou « Signaler ». Notre équipe modère sous 24h.",
  },
  {
    q: 'Comment supprimer mon compte ?',
    a: "Profil → Réglages → Zone danger → « Supprimer mon compte ». La suppression est définitive (données effacées sous 30 jours).",
  },
];

export default function Support() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canGoBack = router.canGoBack?.() ?? false;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="support-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header / brand */}
        <View style={styles.brandRow}>
          {canGoBack ? (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="support-back">
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : null}
          <View style={styles.logo}>
            <Text style={styles.logoText} allowFontScaling={false}>NF</Text>
          </View>
          <Text style={styles.brandName}>NIGHT FINDER</Text>
        </View>

        <Text style={styles.h1}>Support &amp; aide</Text>
        <Text style={styles.sub}>On est là pour t&apos;aider 🤝</Text>

        {/* Contact card */}
        <TouchableOpacity
          style={styles.contactCard}
          activeOpacity={0.85}
          onPress={() =>
            Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Support%20Night%20Finder`).catch(() => {})
          }
          testID="support-email-btn"
        >
          <View style={styles.contactIcon}>
            <Ionicons name="mail" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactTitle}>Nous écrire</Text>
            <Text style={styles.contactSub}>{SUPPORT_EMAIL} · réponse sous 48h ouvrées</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* FAQ */}
        <Text style={styles.sectionTitle}>❓ Questions fréquentes</Text>
        {FAQ.map((item, i) => (
          <View key={i} style={styles.faqCard}>
            <Text style={styles.faqQ}>{item.q}</Text>
            <Text style={styles.faqA}>{item.a}</Text>
          </View>
        ))}

        {/* Report a bug */}
        <Text style={styles.sectionTitle}>🐛 Signaler un bug</Text>
        <View style={styles.faqCard}>
          <Text style={styles.faqA}>
            Décris-nous le problème en précisant : modèle de téléphone, version iOS/Android,
            étapes pour reproduire, et une capture d&apos;écran si possible.
          </Text>
          <TouchableOpacity
            style={styles.inlineBtn}
            onPress={() =>
              Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Bug%20Night%20Finder`).catch(() => {})
            }
            testID="support-bug-btn"
          >
            <Text style={styles.inlineBtnText}>Signaler un bug</Text>
          </TouchableOpacity>
        </View>

        {/* Abuse */}
        <Text style={styles.sectionTitle}>🚨 Signaler un utilisateur</Text>
        <View style={styles.faqCard}>
          <Text style={styles.faqA}>
            Depuis l&apos;app : menu ⋯ sur le profil ou le message → « Signaler ».
            Traitement sous 24h. Tu peux aussi nous écrire à {ABUSE_EMAIL}.
          </Text>
        </View>

        {/* Legal links */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => router.push('/privacy' as any)} testID="support-privacy-link">
            <Text style={styles.legalLink}>Confidentialité</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => router.push('/terms' as any)} testID="support-terms-link">
            <Text style={styles.legalLink}>Conditions d&apos;utilisation</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.footer}>© 2026 Night Finder — Tous droits réservés.</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 60, maxWidth: 760, width: '100%', alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  brandName: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  h1: { color: colors.textPrimary, fontSize: 30, fontWeight: '800', marginBottom: 4 },
  sub: { color: colors.textSecondary, fontSize: 14, marginBottom: 24 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 16,
    minHeight: 48,
  },
  contactIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  contactSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    marginTop: 28,
    marginBottom: 12,
  },
  faqCard: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 10,
  },
  faqQ: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  faqA: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  inlineBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
  },
  inlineBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 36,
  },
  legalLink: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  legalSep: { color: colors.textTertiary, fontSize: 13 },
  footer: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
