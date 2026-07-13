import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, type ThemeColors, darkColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const APP_NAME = 'Night Finder';
const COMPANY = '[Nom de la société — à compléter]';
const ADDRESS = '[Adresse du siège social — à compléter]';
const EMAIL = 'contact@nightfinder.app';
const SIRET = '[Numéro SIRET — à compléter]';
const PUBLICATION_DIR = '[Directeur de publication — à compléter]';
const HOST = 'Emergent Cloud (Kubernetes)';
const LAST_UPDATE = '5 juin 2026';

const CGU = `Les présentes Conditions Générales d'Utilisation (« CGU ») régissent l'utilisation de l'application mobile ${APP_NAME} éditée par ${COMPANY}.

ARTICLE 1 — OBJET
L'application ${APP_NAME} permet aux utilisateurs de découvrir des bars, boîtes de nuit, clubs et événements festifs à proximité, de sauvegarder leurs favoris, de partager leurs soirées et d'accéder à des fonctionnalités d'agenda, géolocalisation et reconnaissance musicale.

ARTICLE 2 — ACCEPTATION
L'inscription et l'utilisation de l'application impliquent l'acceptation pleine et entière des présentes CGU. L'utilisateur déclare avoir au moins 18 ans (ou la majorité légale dans son pays de résidence).

ARTICLE 3 — COMPTE UTILISATEUR
La création d'un compte requiert une adresse email valide et un mot de passe. L'utilisateur peut également se connecter via Apple Sign-In ou Google Sign-In. L'utilisateur est responsable de la confidentialité de ses identifiants. L'utilisateur peut supprimer son compte à tout moment depuis l'application (Profil → Supprimer mon compte), avec effacement complet de ses données sous 30 jours maximum.

ARTICLE 4 — ABONNEMENT PREMIUM
${APP_NAME} propose un abonnement Premium :
- Mensuel : 4,99 € / mois — renouvellement automatique chaque mois
- Annuel : 79,99 € / an (économie de 33 % vs mensuel) — renouvellement automatique chaque année
Le paiement est prélevé via l'App Store (iOS) ou Google Play (Android). Le renouvellement est automatique sauf désactivation au moins 24 heures avant la fin de la période en cours. L'utilisateur peut gérer son abonnement directement depuis les paramètres de son store (Réglages → Apple ID → Abonnements sur iOS).

ARTICLE 5 — DROIT DE RÉTRACTATION
Conformément à l'article L.221-28 du Code de la consommation, l'utilisateur renonce expressément à son droit de rétractation dès le début de l'exécution du service numérique fourni par ${APP_NAME}.

ARTICLE 6 — DONNÉES & GÉOLOCALISATION
L'application utilise la géolocalisation (en avant-plan et arrière-plan, sur consentement explicite) pour proposer les établissements à proximité et déclencher des notifications de "check-in" lorsque l'utilisateur entre dans un lieu identifié.

ARTICLE 7 — RECONNAISSANCE MUSICALE
Sur consentement, ${APP_NAME} peut enregistrer de courts échantillons audio (5 secondes) pour identifier les morceaux joués dans les établissements visités. Les échantillons sont envoyés à un service tiers (Audd.io) pour reconnaissance puis supprimés. Seul le titre identifié est conservé dans le profil utilisateur.

ARTICLE 8 — CONTENU UTILISATEUR & MODÉRATION
L'application contient des fonctionnalités sociales (swipe profils, chat, événements). Tout contenu illicite, harcelant, haineux, ou inapproprié est strictement interdit. ${APP_NAME} dispose d'un système de signalement et de blocage : tout utilisateur peut signaler un profil abusif depuis le menu "⋯" et bloquer définitivement une personne. Les signalements sont examinés sous 24h ; les comptes en infraction sont suspendus ou supprimés sans préavis. L'utilisateur s'engage à respecter les autres et à ne diffuser aucun contenu illicite.

ARTICLE 9 — PROPRIÉTÉ INTELLECTUELLE
Tous les éléments graphiques, textuels et logiciels de l'application sont la propriété exclusive de ${COMPANY}. Toute reproduction est interdite sans autorisation écrite préalable.

ARTICLE 10 — RESPONSABILITÉ
${COMPANY} ne saurait être tenue responsable des informations publiées par les utilisateurs ou les établissements partenaires. Les utilisateurs s'engagent à se comporter de manière responsable et à respecter la législation en vigueur lors de leurs sorties.

ARTICLE 11 — RÉSILIATION
${COMPANY} se réserve le droit de suspendre ou résilier le compte d'un utilisateur en cas de non-respect des présentes CGU, sans préavis ni indemnité.

ARTICLE 12 — MODIFICATION DES CGU
${COMPANY} peut modifier les CGU à tout moment. Les utilisateurs sont informés via l'application. La poursuite de l'utilisation vaut acceptation.

ARTICLE 13 — DROIT APPLICABLE
Les présentes CGU sont soumises au droit français. Tout litige sera de la compétence exclusive des tribunaux de [Ville du siège — à compléter].

Dernière mise à jour : ${LAST_UPDATE}`;

const PRIVACY = `${COMPANY} (« nous ») accorde une grande importance à la protection des données personnelles de ses utilisateurs.

1. RESPONSABLE DU TRAITEMENT
${COMPANY} — ${ADDRESS}
Contact DPO : ${EMAIL}

2. DONNÉES COLLECTÉES
• Identité : nom, email, photo de profil (via Apple/Google Sign-In)
• Localisation : coordonnées GPS (foreground & background sur consentement)
• Préférences : styles musicaux favoris, favoris clubs
• Données d'usage : swipes, check-ins, musiques identifiées
• Données techniques : modèle d'appareil, OS, version d'app, identifiants publicitaires anonymes
• Données de paiement : gérées par Apple/Google/RevenueCat, jamais stockées par ${APP_NAME}

3. FINALITÉS
• Fournir les fonctionnalités du service
• Personnaliser les recommandations
• Détecter automatiquement votre arrivée dans un club (consentement explicite)
• Reconnaître les morceaux joués (consentement explicite, échantillons supprimés après traitement)
• Améliorer le service (statistiques agrégées et anonymisées)
• Gérer la facturation (via RevenueCat / App Store / Google Play)

4. BASE LÉGALE
• Exécution du contrat (CGU)
• Consentement (géolocalisation arrière-plan, reconnaissance musicale, marketing)
• Intérêt légitime (sécurité, prévention de la fraude)

5. DURÉE DE CONSERVATION
• Compte actif : tant que vous utilisez l'application
• Compte inactif : suppression après 3 ans d'inactivité
• Données d'usage anonymisées : durée illimitée

6. DESTINATAIRES
• Personnel autorisé de ${COMPANY}
• Sous-traitants (Google Places API, Audd.io, RevenueCat, hébergeur ${HOST})
• Autorités sur réquisition légale

7. TRANSFERTS HORS UE
Certaines données peuvent être traitées par des prestataires aux États-Unis (Audd.io, Google, RevenueCat). Des clauses contractuelles types (SCC) sont mises en place conformément au RGPD.

8. VOS DROITS RGPD
Vous disposez des droits suivants :
• Accès, rectification, effacement de vos données
• Portabilité
• Opposition au traitement
• Limitation du traitement
• Retrait du consentement à tout moment
Pour exercer vos droits : ${EMAIL}
Vous pouvez également déposer une réclamation auprès de la CNIL (cnil.fr).

9. COOKIES & TRACKING
L'application ne dépose pas de cookies. Aucun tracking publicitaire tiers (Facebook Pixel, Google Analytics) n'est utilisé sans votre consentement explicite.

10. SÉCURITÉ
Vos données sont chiffrées en transit (HTTPS/TLS) et au repos. Les mots de passe sont hashés avec bcrypt. Les tokens d'authentification sont stockés dans le keychain sécurisé du device.

Dernière mise à jour : ${LAST_UPDATE}`;

const LEGAL = `1. ÉDITEUR DE L'APPLICATION
${COMPANY}
Adresse : ${ADDRESS}
Email : ${EMAIL}
SIRET : ${SIRET}
Directeur de publication : ${PUBLICATION_DIR}

2. HÉBERGEMENT
L'application est hébergée par ${HOST}.

3. PROPRIÉTÉ INTELLECTUELLE
La marque ${APP_NAME}, son logo, son design et l'ensemble du contenu de l'application sont protégés par le droit d'auteur et le droit des marques. Toute reproduction sans autorisation expresse est interdite.

4. CRÉDITS PHOTOS
Certaines photos d'établissements proviennent de Google Places (sous licence Google), Unsplash et Pexels (licences libres). Les autres photos sont la propriété exclusive de ${APP_NAME} ou de ses partenaires.

5. SERVICES TIERS UTILISÉS
• Google Places API (Google LLC)
• Audd.io (recognition audio)
• RevenueCat (gestion abonnements)
• Apple Sign-In (Apple Inc.)
• Google Sign-In (Google LLC)

6. CONTACT
Pour toute question : ${EMAIL}

Dernière mise à jour : ${LAST_UPDATE}`;

const DOCS: Record<string, { title: string; body: string }> = {
  cgu: { title: "Conditions Générales d'Utilisation", body: CGU },
  privacy: { title: 'Politique de Confidentialité', body: PRIVACY },
  legal: { title: 'Mentions Légales', body: LEGAL },
};

export default function LegalDoc() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ doc?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const docKey = (params.doc as string) || 'cgu';
  const doc = DOCS[docKey] || DOCS.cgu;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="legal-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="legal-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{doc.title}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.body}>{doc.body}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '900', flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  scroll: { padding: spacing.lg, paddingBottom: 80 },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, ...({ whiteSpace: 'pre-wrap' } as any) },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);
