"""Public HTML pages for App Store submission compliance.

Hosts Privacy Policy + Terms of Service at /privacy and /terms so that
App Store Connect "Privacy Policy URL" requirement is satisfied.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

_BASE_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #09090B;
  color: #F4F4F5;
  line-height: 1.6;
  padding: 40px 20px;
}
.wrapper {
  max-width: 760px;
  margin: 0 auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}
.brand .logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg,#E01A4F,#7C3AED);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: #fff;
  font-size: 18px;
}
.brand h2 { margin: 0; font-size: 18px; letter-spacing: 1px; }
h1 { font-size: 32px; margin: 8px 0 4px; }
.updated { color: #A1A1AA; font-size: 14px; margin-bottom: 24px; }
h2.section { font-size: 20px; color: #FAFAFA; margin-top: 32px; }
p, li { color: #D4D4D8; font-size: 15px; }
a { color: #F472B6; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: none; border-top: 1px solid #27272A; margin: 32px 0; }
.contact {
  background: #18181B;
  border: 1px solid #27272A;
  border-radius: 12px;
  padding: 16px 20px;
  margin-top: 24px;
}
footer {
  margin-top: 48px;
  color: #71717A;
  font-size: 13px;
  text-align: center;
}
"""

_HEADER = """
<div class="brand">
  <div class="logo">NF</div>
  <h2>NIGHT&nbsp;FINDER</h2>
</div>
"""

_FOOTER = """
<footer>
  © 2026 Night Finder — Tous droits réservés.<br>
  <a href="/privacy">Confidentialité</a> · <a href="/terms">Conditions d'utilisation</a>
</footer>
"""


PRIVACY_HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Politique de confidentialité — Night Finder</title>
<style>{_BASE_CSS}</style>
</head>
<body>
<div class="wrapper">
  {_HEADER}
  <h1>Politique de confidentialité</h1>
  <div class="updated">Dernière mise à jour : 7 juin 2026</div>

  <p>
    Cette politique décrit comment <strong>Night Finder</strong> collecte, utilise et
    protège tes données personnelles lorsque tu utilises notre application mobile.
    Nous prenons ta vie privée au sérieux et respectons le Règlement Général sur la
    Protection des Données (RGPD) ainsi que les directives Apple App Store et Google Play.
  </p>

  <h2 class="section">1. Données que nous collectons</h2>
  <ul>
    <li><strong>Données de compte</strong> : email, prénom, date de naissance, mot de passe (hashé bcrypt).</li>
    <li><strong>Profil</strong> : photos, bio, préférences musicales, ville, clubs favoris.</li>
    <li><strong>Localisation</strong> : géolocalisation précise pour afficher les clubs et soirées à proximité,
        et localisation en arrière-plan (optionnelle) pour détecter ton arrivée en club.</li>
    <li><strong>Messages</strong> : contenu des conversations entre utilisateurs matchés.</li>
    <li><strong>Contacts</strong> : hash chiffré des numéros pour retrouver tes amis sur l'app (les numéros bruts
        ne sont jamais stockés).</li>
    <li><strong>Audio</strong> : échantillon de 5 secondes pour identification musicale via Audd.io ; jamais conservé.</li>
    <li><strong>Données techniques</strong> : ID appareil, jetons push, logs de plantage (anonymisés).</li>
  </ul>

  <h2 class="section">2. Pourquoi nous collectons ces données</h2>
  <ul>
    <li>Te permettre de créer un compte et te connecter.</li>
    <li>Afficher les clubs, bars et événements près de toi.</li>
    <li>Te proposer des matches via la fonction Swipe.</li>
    <li>Te permettre de discuter avec d'autres utilisateurs.</li>
    <li>T'envoyer des notifications push pertinentes (matches, événements).</li>
    <li>Modérer les contenus illégaux via IA (photos nudité/violence).</li>
  </ul>

  <h2 class="section">3. Partage des données</h2>
  <p>
    Nous ne vendons <strong>jamais</strong> tes données. Elles peuvent être partagées uniquement avec :
  </p>
  <ul>
    <li><strong>Apple/Google</strong> pour les paiements in-app et les notifications push.</li>
    <li><strong>Google Maps API</strong> pour afficher les clubs sur la carte.</li>
    <li><strong>Audd.io</strong> pour l'identification de musique.</li>
    <li><strong>Google Gemini</strong> pour la modération de photos par IA.</li>
    <li><strong>RevenueCat</strong> pour gérer les abonnements Premium.</li>
    <li>Autorités légales si la loi l'exige.</li>
  </ul>

  <h2 class="section">4. Tes droits (RGPD)</h2>
  <p>Tu as à tout moment le droit de :</p>
  <ul>
    <li><strong>Accéder</strong> à tes données (export depuis Profil → Mon compte).</li>
    <li><strong>Rectifier</strong> tes informations (modification du profil dans l'app).</li>
    <li><strong>Supprimer</strong> ton compte (Profil → Supprimer mon compte, irréversible).</li>
    <li><strong>Bloquer/signaler</strong> un autre utilisateur depuis le chat ou le swipe.</li>
    <li>Te <strong>désinscrire</strong> des notifications (réglages iOS/Android).</li>
  </ul>

  <h2 class="section">5. Sécurité</h2>
  <p>
    Les données sont chiffrées en transit (HTTPS/TLS) et au repos (MongoDB). Les mots de passe
    sont hashés avec bcrypt (salt unique). Aucune donnée sensible (carte bancaire) n'est stockée
    sur nos serveurs — les paiements sont gérés exclusivement par Apple/Google.
  </p>

  <h2 class="section">6. Conservation</h2>
  <p>
    Tes données sont conservées tant que ton compte est actif. À la suppression du compte, toutes
    les données personnelles sont effacées sous 30 jours, à l'exception de celles requises par la loi
    (logs de transactions financières : 7 ans).
  </p>

  <h2 class="section">7. Mineurs</h2>
  <p>
    Night Finder est réservé aux personnes de <strong>18 ans et plus</strong>. Nous vérifions l'âge
    à l'inscription via la date de naissance. Si nous découvrons qu'un compte appartient à un mineur,
    il est supprimé immédiatement.
  </p>

  <h2 class="section">8. Modifications</h2>
  <p>
    Cette politique peut être mise à jour. Les utilisateurs sont notifiés in-app en cas de changement
    substantiel.
  </p>

  <div class="contact">
    <strong>Contact</strong><br>
    Pour toute question : <a href="mailto:support@nightfinder.app">support@nightfinder.app</a><br>
    Responsable du traitement : Erlann Deroche
  </div>

  {_FOOTER}
</div>
</body>
</html>"""


TERMS_HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conditions d'utilisation — Night Finder</title>
<style>{_BASE_CSS}</style>
</head>
<body>
<div class="wrapper">
  {_HEADER}
  <h1>Conditions d'utilisation</h1>
  <div class="updated">Dernière mise à jour : 7 juin 2026</div>

  <p>
    En utilisant <strong>Night Finder</strong>, tu acceptes les présentes conditions. Lis-les attentivement.
  </p>

  <h2 class="section">1. Accès au service</h2>
  <p>
    Night Finder est réservé aux <strong>personnes majeures (18 ans et plus)</strong>. Tu garantis
    fournir des informations exactes lors de l'inscription. Tout compte avec de fausses informations
    peut être suspendu.
  </p>

  <h2 class="section">2. Règles de conduite</h2>
  <p>Tu t'engages à NE PAS :</p>
  <ul>
    <li>Publier de contenu violent, sexuel explicite, illégal, harcelant ou trompeur.</li>
    <li>Usurper l'identité d'une autre personne.</li>
    <li>Utiliser l'app à des fins commerciales sans autorisation.</li>
    <li>Tenter de pirater, scraper ou contourner les protections techniques.</li>
    <li>Spammer, manipuler les fonctions de match ou de chat.</li>
  </ul>
  <p>
    Toute violation peut entraîner la suspension ou suppression immédiate du compte, sans préavis ni remboursement.
  </p>

  <h2 class="section">3. Tolérance zéro pour contenu inapproprié</h2>
  <p>
    Conformément aux exigences Apple, nous appliquons une politique <strong>zéro tolérance</strong>
    envers les contenus inacceptables. Chaque photo est analysée par IA (Google Gemini) avant publication.
    Les utilisateurs peuvent <strong>bloquer</strong> et <strong>signaler</strong> tout abus à tout moment.
    Les signalements sont traités sous 24 heures.
  </p>

  <h2 class="section">4. Abonnement Premium</h2>
  <p>
    Night Finder propose un abonnement Premium via achat in-app (Apple/Google). Le renouvellement
    est automatique sauf désactivation dans les réglages de ton compte App Store/Google Play, au moins
    24 heures avant la fin de la période. Pas de remboursement pour les périodes déjà entamées.
  </p>

  <h2 class="section">5. Contenu généré par les utilisateurs</h2>
  <p>
    Tu conserves tous les droits sur les contenus que tu publies (photos, messages, bio). En les publiant,
    tu accordes à Night Finder une licence mondiale, non exclusive et gratuite pour les afficher dans
    le cadre du service.
  </p>

  <h2 class="section">6. Responsabilité</h2>
  <p>
    Night Finder met en relation des utilisateurs mais n'est <strong>pas responsable</strong> des
    interactions hors application, ni de la véracité des profils. Reste prudent lors des rencontres
    en personne : choisis un lieu public, préviens un proche.
  </p>

  <h2 class="section">7. Résiliation</h2>
  <p>
    Tu peux supprimer ton compte à tout moment depuis l'app (Profil → Mon compte → Supprimer mon compte).
    La suppression est <strong>définitive et irréversible</strong>.
  </p>

  <h2 class="section">8. Droit applicable</h2>
  <p>
    Les présentes conditions sont régies par le droit français. Tout litige relève des tribunaux
    compétents en France.
  </p>

  <div class="contact">
    <strong>Contact</strong><br>
    <a href="mailto:support@nightfinder.app">support@nightfinder.app</a><br>
    Éditeur : Erlann Deroche
  </div>

  {_FOOTER}
</div>
</body>
</html>"""


SUPPORT_HTML = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Support — Night Finder</title>
<style>{_BASE_CSS}</style>
</head>
<body>
<div class="wrapper">
  {_HEADER}
  <h1>Support &amp; aide</h1>
  <div class="updated">On est là pour t'aider 🤝</div>

  <p>
    Tu rencontres un bug ? Tu as une question sur ton abonnement Premium ?
    Tu veux signaler un problème ? Voici comment nous joindre.
  </p>

  <h2 class="section">📧 Contact email</h2>
  <p>
    Écris-nous à <a href="mailto:support@nightfinder.app">support@nightfinder.app</a>.
    Nous répondons sous 48h ouvrées.
  </p>

  <h2 class="section">🐛 Signaler un bug</h2>
  <p>
    Décris-nous le problème en précisant :
  </p>
  <ul>
    <li>Modèle de téléphone (iPhone 15, etc.)</li>
    <li>Version iOS / Android</li>
    <li>Étapes pour reproduire le bug</li>
    <li>Capture d'écran si possible</li>
  </ul>

  <h2 class="section">💳 Abonnement Premium</h2>
  <p>
    Pour gérer / annuler ton abonnement :
  </p>
  <ul>
    <li><strong>iOS</strong> : Réglages → ton nom → Abonnements → Night Finder</li>
    <li><strong>Android</strong> : Google Play → Profil → Paiements et abonnements</li>
  </ul>

  <h2 class="section">🚨 Signaler un utilisateur</h2>
  <p>
    Depuis l'app : appui long sur le profil ou le message offensant → "Signaler".
    Les signalements sont traités sous 24h. Tu peux aussi nous écrire directement
    à <a href="mailto:abuse@nightfinder.app">abuse@nightfinder.app</a>.
  </p>

  <h2 class="section">🗑️ Supprimer mon compte</h2>
  <p>
    Profil → Mon compte → Supprimer mon compte. La suppression est immédiate et irréversible.
  </p>

  {_FOOTER}
</div>
</body>
</html>"""


@router.get("/privacy", response_class=HTMLResponse)
async def privacy_page() -> str:
    return PRIVACY_HTML


@router.get("/terms", response_class=HTMLResponse)
async def terms_page() -> str:
    return TERMS_HTML


@router.get("/support", response_class=HTMLResponse)
async def support_page() -> str:
    return SUPPORT_HTML
