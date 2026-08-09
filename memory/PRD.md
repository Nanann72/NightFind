# Night Finder — Product Requirements

## Vision
Mobile app (iOS & Android, Expo Router) for discovering the best nightclubs, festive bars and events around the user. Inspired by Tinder swipe, Resy and Airbnb premium discovery UX. Dark, neon-accented design.

## Stack
- **Frontend**: React Native + Expo SDK 54, expo-router (file-based navigation), react-native-reanimated, react-native-gesture-handler, react-native-maps (native only), @expo/vector-icons (Ionicons), expo-blur (glassmorphism), expo-haptics
- **Backend**: FastAPI + MongoDB (Motor), bcrypt, PyJWT, httpx
- **Auth**: dual — Emergent Google Auth + email/password (JWT)
- **Geo**: expo-location with web `navigator.geolocation` fallback. Paris (Châtelet) used when permission denied.
- **Maps**: react-native-maps using `PROVIDER_DEFAULT` (Apple Maps on iOS, Google Maps Android — architecture ready to add a Google Maps API key later). Web shows a list fallback with marker styling.
- **Notifications**: expo-notifications local reminders for reservations (2h before event). FCM migration path documented in `/app/frontend/lib/notifications.ts`.

## Implemented features
1. Onboarding (3 slides, paginated)
2. Auth: Login, Register, Forgot password, Google Sign-In
3. Discover feed — search, quick filters (All / Open / VIP / Terrasse), pull to refresh, distance badges
4. Map — full screen MapView (native), dark custom style, custom markers, callouts, bottom selected card, recenter button. Web fallback list view.
5. Swipe deck — Tinder style with reanimated gesture, LIKE/NOPE overlays, action buttons (skip/info/like), records swipe + auto-fav on like
6. Events — list of upcoming parties with DJ, date, price, reservation + scheduled local reminder
7. Club detail — hero, gradient overlay, music chips, ratings, hours, features, upcoming events, directions (opens native maps app), favorite CTA
8. Favorites list
9. Notifications list (event / promo / nearby)
10. Filters bottom screen — radius, music genre, max price, open now, VIP, terrasse
11. Profile — avatar, stats, music preferences, signout

## Seed data
- 12 Paris venues (Rex, L'Arc, Concrete, Silencio, La Machine du Moulin Rouge, Wanderlust, Djoon, Faust, Matignon, Le Syndicat, Le Comptoir Général, Pachamama)
- 8 upcoming events with star DJs (DJ Snake, Folamour, Amelie Lens, Charlotte de Witte, Peggy Gou, DJ Tennis, Boris Brejcha, Hugel)
- 3 sample notifications

## API endpoints
- POST `/api/auth/register`, `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/session` (Google), POST `/api/auth/logout`
- GET `/api/auth/me`, PUT `/api/profile`
- GET `/api/clubs` (lat/lng/radius_km/music/max_price/open_now/vip/terrasse/search), GET `/api/clubs/{id}`
- GET `/api/events`, POST `/api/events/{id}/reserve`
- GET/POST/DELETE `/api/favorites`, POST `/api/swipes`, GET `/api/swipes/history`
- GET `/api/notifications`

## App Store readiness
- App name: Night Finder, slug: night-finder, bundleIdentifier: com.nightfinder.app
- iOS Info.plist: location + notification usage descriptions in French
- Android permissions: ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, RECEIVE_BOOT_COMPLETED, VIBRATE
- Splash + adaptive icon configured with brand background #09090B
- Notifications color tinted #E01A4F

## Smart enhancement (built-in)
Each reservation schedules a **personalized local push 2h before the event**, drastically increasing event attendance ("event recall" feature seen in Resy/Eventbrite). This unlocks engagement and retention without backend cost (no FCM yet).

---

## 🔴 RÉSOLUTION CRASH ÉCRAN NOIR TESTFLIGHT (11 juin 2026)

### Cause racine identifiée (builds 1.0.12 → 1.0.21 en écran noir, 1.0.11 OK)
1. **`yarn.lock` jamais commité dans git** → chaque build EAS ré-résolvait les dépendances à la dernière version du registre npm (builds non déterministes).
2. **Le 4 juin (14h58), `yarn add react-native-purchases` a ré-résolu les dépendances d'expo-router** et créé des DOUBLONS imbriqués de react-navigation : top-level (native 7.1.14, core 7.12.1, bottom-tabs 7.4.2…) + nested sous expo-router (native 7.2.2, core 7.17.2, bottom-tabs 7.15.11…). Deux moteurs de navigation dans le même bundle = écran noir au démarrage en release. Le dernier build OK (1.0.11) datait d'AVANT le 4 juin ; tous les suivants embarquaient les doublons.
3. **Aggravation** : sans lockfile, une résolution fraîche tirait `expo-asset@56.x` (SDK 56, via la range `*` d'expo-audio) dans une app SDK 54 → incompatibilité native garantie.
4. **3056 fichiers `.metro-cache/` commités dans git** (METRO_CACHE_ROOT pointe dans le projet) → caches périmés embarqués dans les builds EAS (explique les "anciennes clés .env" dans le build du 7 juin).
5. Les reverts de code des builds 113-121 ne pouvaient PAS corriger : le problème était dans node_modules/yarn.lock, jamais versionnés.

### Correctif appliqué (testé : web preview OK, export bundle iOS prod OK, régression navigation OK — iteration_8.json)
- Versions épinglées exactes dans package.json : @react-navigation/native 7.1.14, bottom-tabs 7.4.2, native-stack 7.3.21, elements 2.5.2.
- Bloc `resolutions` (yarn) forçant : core 7.12.1, routers 7.4.1, expo-asset 12.0.13, expo-constants 18.0.13 + les 4 ci-dessus → UNE seule version de chaque paquet dans tout l'arbre (doublons imbriqués éliminés).
- `.metro-cache/` retiré de l'index git + ajouté au .gitignore + purgé du disque.
- `yarn.lock` propre (zéro doublon critique vérifié) **ajouté au suivi git** → builds EAS déterministes.

### ⚠️ Prochain build TestFlight
- L'utilisateur n'a PLUS de crédits EAS ce mois-ci. NE PAS déclencher de build avant retour des crédits ou validation du support.
- Au prochain build : vérifier le démarrage, puis le paywall RevenueCat (prix 4,99€/79,99€ avec compte Sandbox).
- Si le support Emergent envoie les logs de crash natifs : on s'attend à des symboles react-navigation/expo-asset confirmant le diagnostic.

## 🛠 FIX DÉPLOIEMENT (11 juin 2026 — build 125)
- **Bloqueur EAS tarball** : fichier parasite au nom binaire corrompu (`\001\220\370@@\320\3039@8`) dans /app/frontend → supprimé du disque + de git. Erreur était : "ENOENT lstat" pendant l'upload du tarball EAS.
- N+1 queries corrigées : `/api/matches` (aggregation $group/$first) et `/api/friends/list` (batch $in).
- CORS configurable : `CORS_ORIGINS` lu depuis backend/.env (défaut "*").
- Deployment agent : statut **PASS** final. 53/53 pytest OK.

## 🎯 CAUSE RACINE CONFIRMÉE PAR LOG DE CRASH NATIF (11 juin 2026)
Le log Xcode (build 105, fourni par le support) montre Thread 8 crashé dans :
`Configuration.APIKeyValidationResult.checkForSimulatedStoreAPIKeyInRelease (Configuration.swift:533)` — **le SDK RevenueCat appelle fatalError() volontairement quand il est configuré avec une clé Test Store (`test_...`) dans un build RELEASE**.
Chaîne complète : ancienne clé iOS `test_` → crash design du SDK → l'utilisateur a mis la clé `appl_` dans .env → MAIS le cache Metro périmé commité dans git servait toujours l'ancienne valeur `test_` incrustée → builds 113-121 crashaient encore.
Correctifs (tous appliqués) :
1. Cache Metro purgé de git/disque (la clé `appl_` sera désormais incrustée) — fait le 11 juin.
2. Garde-fou dans `lib/purchases.ts` : en build release (!__DEV__), le SDK n'est configuré QUE si la clé a le bon préfixe (`appl_` iOS / `goog_` Android) → sinon mode mock gracieux. Protège aussi Android (toujours sur clé `test_`).
3. yarn.lock déterministe + react-navigation dédupliqué (hygiène, fait le 11 juin).
⚠️ Avant le 1er build Android Play Store : remplacer EXPO_PUBLIC_RC_ANDROID_KEY par la vraie clé `goog_...`.

## 🍎 REJET APP REVIEW (11 juin 2026, build 118) — Plan de correction
1. **Guideline 2.1(a) "blank screen"** = écran noir RevenueCat → DÉJÀ CORRIGÉ dans le code (garde-fou purchases.ts + cache Metro purgé). Nouveau build requis.
2. **Guideline 2.3.6 Age Rating** → ACTION USER dans ASC : App Information > Age Rating > "Mature or Suggestive Themes" = "Frequent" (classement 17+/18+).
3. **Guideline 3.1.2(c) Abonnements** → Paywall in-app DÉJÀ conforme (titre, durée, prix, liens CGU/privacy). ACTIONS USER dans ASC :
   - Champ "Privacy Policy URL" : https://fan-culture-app.emergent.host/api/legal/privacy
   - CGU (EULA standard Apple) : ajouter dans la description App Store le lien https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
   - (Alias backend ajoutés le 11 juin : /api/legal/privacy, /api/legal/terms, /api/legal/support — testés 200 OK)

## 🩺 SYSTÈME DE DIAGNOSTIC ÉCRAN NOIR (11 juin 2026, soir — pour build 129+)
Build 128 : plus de crash (fix RevenueCat OK) mais écran 100% noir PERSISTANT, app reste ouverte = échec de rendu JS silencieux. Cause exacte inconnue → diagnostic embarqué :
1. **`frontend/index.js`** (nouveau point d'entrée, `main` changé dans package.json) : try/catch autour de `require('expo-router/entry')` → si échec au chargement du module, affiche "NIGHT FINDER — BOOT ERROR" + stack trace sur fond rouge au lieu du noir.
2. **`RootErrorBoundary`** dans `app/_layout.tsx` : affiche "NIGHT FINDER — RENDER ERROR" + stack si erreur de rendu React.
3. **Splash réparé** : app.json référençait `splash-icon.png` (INEXISTANT depuis le 8 mai) → remplacé par `splash-image.png` (existant). Le splash n'est plus un écran noir vide.
4. **METRO_CACHE_ROOT déplacé vers /tmp/metro-cache** (.env) : le cache (160 Mo régénéré !) ne sera plus JAMAIS embarqué dans les zips de déploiement.
Vérifié : export bundle iOS prod OK (contient les 2 filets), app OK en preview.
👉 Au prochain build : si écran ROUGE avec texte = envoyer photo du texte (cause exacte) ; si app démarre = résolu ; si encore noir pur = le JS ne démarre pas du tout (problème natif profond → support Emergent avec cette info).

## 🎨 REDESIGN PREMIUM iOS 26 (juillet 2026)
- **Design System v3** : accent VIOLET unique #8B5CF6 (remplace le rose #E01A4F), fond #050505, surfaces #0F0F0F / cartes #141414, coins 24-30px (radius.xl=24, xxl=30), gradients violets. Tout dans `lib/theme.ts` (tokens propagés à tous les écrans via ThemeContext).
- **TabBar v3** (`components/LiquidGlassTabBar.tsx`) : capsule flottante verre, 5 onglets avec labels : Accueil · Carte · Plus · Chats · Profil. Routes `swipe` et `events` masquées de la barre (HIDDEN_TABS) mais toujours navigables.
- **Nouveau Home** (`(tabs)/index.tsx`) : Bonsoir {prénom} 👋, recherche, bannière "Explorer la carte", chips, sections horizontales Clubs proches / Tendance ce soir / Personnes près de toi (API /users/nearby) / Moments (API /moments/feed), liste Tous les clubs.
- **Hub "Plus"** (`(tabs)/plus.tsx`) : Découverte, Moments, Sorties, Recherche + Amis/Favoris/Mes musiques/Demandes + bannière Premium.
- **Onglet Chats** (`(tabs)/chats.tsx`) : liste conversations style iMessage. `/matches` redirige vers `/(tabs)/chats`.
- **Nouveau Paywall** (`paywall.tsx`) : fond noir #050505, halo violet animé (respiration), 4 avantages, CTA blanc "Essayer Premium", prix sous le CTA, restaurer + liens légaux. Logique RevenueCat INCHANGÉE.
- i18n : nouvelles clés `tabs.*`, `plusHub.*`, `home.*` (greeting, readyTonight, exploreMap, nearbyClubs, trending, peopleNearby, moments, allClubs, seeAll) dans fr.ts + en.ts (fallback fr pour les autres langues).
- Testé frontend complet (iteration_24.json) : PASS — zéro trace de l'ancien rose, aucune régression navigation.
- ⏳ EN ATTENTE (décision utilisateur) : migration RevenueCat → Stripe demandée mais reportée ("on verra pour RevenueCat après"). ⚠️ Rappel : Stripe in-app pour abonnements numériques = rejet App Store (Guideline 3.1.1).

## 🔍 AUDIT COMPLET + CORRECTIFS (juillet 2026)
### Bugs corrigés
1. **Audio AudD "Audio too large (1.5MB)"** : enregistrement passait en quasi-PCM sur iOS (preset HIGH_QUALITY stéréo). Fix : options custom mono AAC 64kbps 44.1kHz (`buildRecognitionRecordingOptions` dans `lib/audioRecognition.ts`), durées 10s/12s retry, garde-fou taille client, limite backend 1.5MB→5MB (2 endpoints).
2. **⚠️ TOKEN AUDD INVALIDE (erreur 900)** : l'abonnement/trial audd.io est INACTIF → AUCUNE reconnaissance possible tant que l'utilisateur ne réactive pas sur dashboard.audd.io. Backend mappe désormais les erreurs 900/901 en messages français clairs.
3. **Crash TDZ notifications.tsx** : `colors` utilisé au niveau module avant déclaration (ligne 417) → ReferenceError potentiel (écran noir). Fix : `darkColors` direct dans COLOURS.
4. **profile.tsx** : `api.getMatches()` inexistant → stats matchs toujours 0. Fix : `api.listMatches()`.
5. **Événements tous expirés** (36 events datés juin 2026) → écran Sorties vide. Fix : script `backend/refresh_events.py` (re-date les events passés sur 30 jours). API `/events` renvoie désormais `club_name/club_photo: null` cohérents pour les events utilisateurs.
6. **usePremium** : fallback serveur `user.is_premium` (les premium accordés côté backend sont reconnus même sans entitlement RevenueCat visible).
7. **my-songs.tsx** : `loc.location` inexistant → détection du club le plus proche ne marchait jamais. Fix : `loc.coords`/`loc.permission`.
8. **TypeScript 0 erreur** (hors résolution plateforme MapImpl) : types User enrichis (photos, bio, city, dob, likes_received_count), statusBarStyle union, onboarding typé.
### UI ajoutée
- Overlay d'écoute élégant (ScanningOverlay, anneaux pulsés violets) pendant le scan + message "Aucune musique reconnue. Essaie de rapprocher ton téléphone de la source sonore."
- Paramètres : carte profil iOS (avatar/nom/email/badge PREMIUM), "Gérer mon abonnement" (lien store natif), "Contacter le support", "Signaler un problème".
### Seeds/scripts
- `backend/seed_moments.py` : 3 moments bots (Léa/Maxime/Chloé, photos Unsplash, users bots créés, expire 7j).
- `backend/refresh_events.py` : re-date les événements passés.
- Tests backend : 207/207 PASS (tests obsolètes mis à jour : dob obligatoire, ≥12 clubs, /events auth, probe 5MB).
### Audit frontend (iteration_25.json) : 14/14 flux OK
Auth (login/register/forgot), swipe, chats, moments, clubs, recherche+filtres, carte (fallback web), Plus hub, paramètres, notifications, my-songs.

## 🎵 DÉPLACEMENT DE MUSIQUES + RETOUR SWIPE (juillet 2026)
- **Backend** : `PATCH /api/profile/songs/{song_id}/club` body `{club_id}` — ré-attache un morceau à un autre club (valide club existant, 404 sinon).
- **Frontend api.ts** : `api.moveSong(song_id, club_id)`.
- **my-songs.tsx** : tap sur un morceau → bottom-sheet modal (recherche + liste des clubs, club actuel désactivé "Actuel", testIDs: move-club-search, move-to-{club_id}, move-cancel). Long-press = supprimer (inchangé). Icône swap-horizontal sur chaque rangée.
- **swipe.tsx** : bouton retour rond (swipe-back-btn) dans le header (+ états profil-incomplet et deck-vide via backBtnFloating). `router.canGoBack() ? back : replace('/(tabs)/plus')`.
- Testé : iteration_26.json — PASS complet, état reviewer restauré (morceau dans Club Rex).

## 🍎 CONFORMITÉ APP STORE — corrections post-rejet (juillet 2026)
1. **UIBackgroundModes "location" SUPPRIMÉ** (app.json) + suppression NSLocationAlways* + plugin expo-location réduit à when-in-use uniquement (Guideline 2.5.4).
2. **Background location supprimé du code** : backgroundLocation.ts réécrit foreground-only (startBackgroundLocation = requestForegroundPermissionsAsync seulement, stopBackgroundLocation garde le cleanup de la tâche legacy). Tâche TaskManager retirée de notificationsSetup.ts. cacheClubsForBackground + chaîne morte supprimées (clubs.tsx nettoyé). Geofence = polling foreground dans GeofenceCheckIn.tsx (inchangé).
3. **Flux localisation onboarding conforme (5.1.1/5.1.5)** : texte "Night Finder utilise ta position pour afficher les clubs, événements et utilisateurs proches de toi", CTA "Continuer" → popup native immédiate, bouton "Passer" MASQUÉ sur l'écran localisation uniquement.
4. **Écran refus élégant** : components/LocationRequired.tsx ("La localisation est nécessaire..." + bouton "Ouvrir Réglages" via Linking.openSettings + "Continuer sans localisation") intégré dans MapImpl.native quand permission denied.
5. **Support URL** : pages publiques déjà servies par legal_pages.py → /api/legal/support (enrichie d'une section FAQ 6 questions), /api/legal/privacy, /api/legal/terms — toutes 200 OK. ⚠️ ACTION UTILISATEUR : dans App Store Connect, remplacer https://nightfinder.app/support par https://<domaine-deployé>/api/legal/support (ou configurer le DNS de nightfinder.app).
6. **Logs StoreKit/RevenueCat détaillés** : purchases.ts trace [purchases] configure/getOfferings/purchase/restore avec codes d'erreur + Purchases.setLogLevel(DEBUG).
7. Nettoyage : double app.include_router(api_router) supprimé (server.py), libellés "arrière-plan" retirés (settings i18n "Détection en club", GeofenceCheckIn), NSMicrophoneUsageDescription corrigé ("échantillon court").
- Tests : backend 207/207 PASS, frontend régression iteration_27 PASS (onboarding, tabs, paywall+liens légaux, settings, my-songs).
- Rappel RevenueCat : l'erreur d'achat vue par Apple = abonnements pas encore approuvés/attachés à la version. Cocher les 2 abonnements dans la section "Achats intégrés" de la nouvelle version lors de la soumission.

## 🏙️ CLUBS + GENRES MUSICAUX (juillet 2026)
- **480 clubs Google Places** pré-importés dans `db.places` via `backend/seed_city_clubs.py` (20 grandes villes FR : Paris, Marseille, Lyon, Toulouse, Nice, Nantes, Montpellier, Strasbourg, Bordeaux, Lille, Rennes, Reims, Toulon, Grenoble, Dijon, Angers, Le Mans, Aix, La Rochelle, Cannes — ~18-20 clubs/ville). Réutilise le pipeline places_service (schéma standard, photos, dédup, cache TTL). Relançable à volonté.
- **Genres musicaux unifiés** : nouveau module partagé `frontend/lib/musicGenres.ts` (18 genres avec emoji : techno, house, afro-house, électro, edm, minimal, hip-hop/rap, rnb, latin, reggaeton, disco, funk, soul, jazz, pop, rock, indie, lounge — IDs alignés sur les music_styles des clubs). Consommé par : filters.tsx (filtres clubs), search.tsx (recherche de personnes — corrige l'incohérence 'r&b'/'afro' vs 'rnb'/'afro-house'), settings.tsx (préférences musicales), onboarding.tsx (12 premiers genres).
- Vérifié : capture écran filtres OK (18 chips emoji), lint clean.

## 👥🎧 STAT ABONNÉS + LIENS STREAMING (juillet 2026)
- **Profil** : stat "Photos" remplacée par "Abonnés" (nombre d'amis via api.listFriends().friends.length, testID stat-followers) dans (tabs)/profile.tsx.
- **Backend** : /api/profile/songs expose désormais spotify/deezer/apple_music (stockés à la reconnaissance Audd).
- **my-songs.tsx** : 2 boutons ronds par morceau — Spotify (#1ED760, FontAwesome5 'spotify') et Deezer (violet, FontAwesome5 'deezer') → Linking.openURL vers le lien direct, fallback URL de recherche (open.spotify.com/search / deezer.com/search) si lien absent. Helper openStream. Tap ligne = déplacer (modal), long-press = supprimer (inchangés).
- Vérifié : screenshot OK (stat Abonnés + boutons visibles), lint clean, backend serialization testée.

## 🏙️ MAX CLUBS + DEEP LINKS STREAMING (juillet 2026)
- **BUG CORRIGÉ — clubs invisibles** : /api/clubs ne renvoyait que les ~20 résultats de la recherche Google live + seeds, en ignorant db.places. Ajout d'un merge de TOUS les clubs stockés (db.places, dédup par club_id+nom, mêmes filtres music/prix/vip/terrasse/search, champs internes retirés). Paris r20 : 82 clubs, Lyon r15 : 123 clubs.
- **Import massif** : seed_city_clubs.py étendu — 45 villes (40 FR + Ibiza, Barcelone, Bruxelles, Genève, St-Tropez, Deauville, Biarritz...) × grille 5 points (centre + 4 offsets 9km, rayon 7km) → **db.places : 480 → 3517 clubs**.
- **Spotify/Deezer ouvrent l'APP** : openStream utilise les deep links (spotify:track:{id} / spotify:search:, deezer://www.deezer.com/track/{id} / /search/) avec canOpenURL + tentative directe, fallback site web si app absente. app.json : LSApplicationQueriesSchemes ["spotify","deezer"] ajouté (iOS). ⚠️ Deep links testables uniquement sur device réel avec les apps installées.
- Tests : 207/207 backend PASS après modif list_clubs. Home vérifié (39+ cartes en web).

## ✅ PHASE 2 — REVENDICATION DE BAR / BAR VÉRIFIÉ (juillet 2026)
- **Backend** (server.py section "REVENDICATION DE BAR — Bar Vérifié (Phase 2)", collection `db.bar_claims`) :
  - `POST /api/bars/claim` (user) : {club_id, owner_name, email, phone, role(proprietaire|gerant|manager), id_document, kbis_document (data URI base64)}. Validations : rôle, champs obligatoires, club existant, club pas déjà vérifié (409), pas de doublon pending (409).
  - `GET /api/me/bar-claims` : demandes du user (sans les documents base64).
  - `GET /api/admin/bar-claims?status=` + `GET /api/admin/bar-claims/{id}` (avec documents) — require_admin.
  - `POST /api/admin/bar-claims/{id}/approve` : claim approved + club (places ET clubs) reçoit {verified:true, owner_user_id, verified_at} + user {is_bar_owner:true, owned_club_id} + auto-reject des autres demandes pending du même club + notification "Établissement vérifié ✅" + log admin_actions.
  - `POST /api/admin/bar-claims/{id}/reject` body {reason} : rejected + notification avec motif.
  - `/auth/me` expose désormais `is_bar_owner` et `owned_club_id`.
- **Frontend** :
  - `app/claim-bar.tsx` : formulaire (recherche club, nom/email/tél, chips rôle, upload pièce d'identité + Kbis via ImagePicker base64 quality 0.5) + section "Mes demandes" avec statuts (pending orange / approved vert / rejected rouge + motif) + bouton "Nouvelle demande".
  - `app/admin-claims.tsx` : onglets En attente(compteur)/Approuvées/Refusées, modal détail (infos demandeur + images documents), Approuver (Alert confirm) / Refuser (input motif inline).
  - Réglages : section "Vous êtes propriétaire ?" → row-claim-bar → /claim-bar.
  - /admin : section "Bars Vérifiés" → admin-claims-btn → /admin-claims.
  - `club/[id].tsx` : badge bleu "Vérifié" (#1D9BF0, checkmark-circle) à côté du nom si club.verified.
  - api.ts : type BarClaim + submitBarClaim/myBarClaims/adminListBarClaims/adminBarClaimDetail/adminApproveBarClaim/adminRejectBarClaim ; Club.verified?.
- Tests : 18 checks backend curl PASS + testing_agent frontend iteration_29.json PASS (8 scénarios). Données de test nettoyées (comptes démo Apple intacts).
- Reste à faire (roadmap partenaire) : Phase 3 mise en avant payante (Stripe/Apple Pay), Phase 4 gestion admin complète, Phase 5 tableau de bord propriétaire (infos/menus/événements/stats).

## ✅ PHASES 3/4/5 — MISE EN AVANT PAYANTE + ADMIN + DASHBOARD PROPRIÉTAIRE (juillet 2026)
### Phase 3 — Mise en avant payante (Stripe)
- Tarifs (server-side only, jamais depuis le client) : 19,99€/7j et 49,99€/30j. Paiement AVANT validation admin, remboursement Stripe automatique si refus.
- Backend (server.py section "MISE EN AVANT PAYANTE — Stripe (Phase 3)", collection `db.promotions`) :
  - `POST /api/owner/promotions/checkout` {plan, origin_url} (owner vérifié only, 409 si promo active/pending) → session Stripe Checkout (SDK stripe direct, clé STRIPE_API_KEY dans backend/.env = sk_test_emergent → api_base proxy emergent).
  - ⚠️ Le proxy emergent fait du ROUND-ROBIN sur plusieurs comptes Stripe → helper `_stripe_call(fn, attempts=12)` retry sur "No such ..." pour retrieve/refund. Avec une vraie clé Stripe (prod), premier essai OK.
  - `GET /api/owner/promotions` + `GET /api/owner/promotions/status/{session_id}` (poll, `_sync_promo_payment` = re-vérif du statut auprès de Stripe = source de vérité). NOTE: StripeObject → accès par index `sess["payment_status"]`, PAS .get().
  - `POST /api/webhooks/stripe` : simple TRIGGER — re-vérifie via l'API, ne fait jamais confiance au payload (pas de webhook secret avec le proxy).
  - `POST /api/admin/promotions/{id}/approve` → status active, starts/ends_at, club.promoted=true+promoted_until, notification. `/reject` {reason} → remboursement auto via `stripe.Refund.create(payment_intent=...)` (refund_failed géré gracieusement + message admin "à traiter manuellement"), notification.
  - `GET /api/promotions/featured` (public) + `/api/clubs` : clubs promus flag `promoted:true` et triés EN PREMIER (helper `_active_promo_club_ids` avec lazy-expiry `_expire_promotions`).
- Frontend : `promote-bar.tsx` (formules + paiement via window.location.href en web / WebBrowser.openBrowserAsync en natif + liste de mes promos), `promotion-status.tsx` (retour Stripe, poll 8×2,5s, états paid/pending/cancelled), `admin-promotions.tsx` (onglets À valider/Actives/Refusées, activer/refuser+motif inline). Accueil : section "À la une ⭐" (api.featuredPromotions) + chip "Sponsorisé" sur MiniClubCard. club/[id] : badge orange "Sponsorisé".
### Phase 4 — Gestion admin
- `GET /api/admin/overview` {pending_claims, pending_promotions, active_promotions, verified_bars}.
- `POST /api/admin/verified-bars/{club_id}/revoke` : retire verified/owner/promoted + is_bar_owner du user + expire les promos + notification. Bouton "Révoquer le badge Vérifié" dans le détail d'une claim approuvée (admin-claims.tsx).
- admin.tsx : nouvelle section "Mises en avant payantes" → /admin-promotions.
### Phase 5 — Tableau de bord propriétaire
- Backend : `GET/PATCH /api/owner/club` (description, avg_price, music_styles, photos≤6, hours), `PUT /api/owner/club/menu` {items[{name,price,category}]≤50} (affiché sur la fiche club section "Carte & Menu"), `POST /api/owner/events` + `DELETE /api/owner/events/{id}` (bypass premium, created_by_owner:true), `GET /api/owner/stats` {views, favorites, checkins, songs, active_promotion}. Vues comptées via $inc sur `db.club_stats` dans GET /api/clubs/{id}.
- Frontend : `owner-dashboard.tsx` (stats cards, édition infos + genres MUSIC_GENRES + photos ImagePicker + horaires par jour avec Switch, éditeur de menu, création/suppression événements via modal). Réglages : rows "Mon établissement" + "Mettre en avant ⭐" si user.is_bar_owner (exposé par /auth/me).
- Tests : backend curl complet PASS + testing_agent iteration_30.json — 10/10 flux PASS, zéro bug. Données nettoyées, Club Rex restauré.
- ⚠️ POUR LA PROD : l'utilisateur devra remplacer STRIPE_API_KEY par sa vraie clé Stripe (le refund/retrieve fonctionneront alors sans retry).

## ✅ REVENDICATION AUTOMATISÉE (ROBOT IA) + CODE -10% PAR BAR + BASCULE STRIPE→REVENUECAT (juillet 2026)
### A. Revendication automatisée
- `/app/backend/claim_verification.py` : robot IA (Gemini gemini-3-flash-preview via EMERGENT_LLM_KEY, LlmChat+ImageContent) analyse pièce d'identité + Kbis en MODE STRICT (id_valid, id_name_matches, kbis_valid, kbis_establishment_matches). Fail-safe : erreur infra → approve=None → examen manuel.
- Flux à la soumission (POST /api/bars/claim) : email 1 "Demande reçue" (docs + délai : quelques minutes en auto, 24h max si manuel) + tâche background `_run_ai_verification` → approve=True → `_approve_claim_internal(reviewer='ai_bot')` ; approve=False & confiance ≥0.7 → auto-refus motivé + email ; sinon → pending manuel. Verdict stocké dans claim.ai_verdict (affiché dans admin-claims section 🤖).
- `_approve_claim_internal` (partagé IA/admin) : badge Vérifié + owner + **code -10% individuel du bar** (`club.partner_code`, généré unique via `_gen_unique_bar_code`) + auto-rejet autres claims + notif + email 2 "🎉 Vérifié" avec code, image QR (`/api/partner/qr?code=X`) et lien parrainage. Reject admin → email 3 motivé.
- Codes -10% par bar : `/partner/info`, `/partner/claim`, `/partner/r`, `/partner/qr?code=` supportent les codes singleton (bar officiel NFUTG7X, Péniche Marcounet) ET les codes par bar (lookup `_find_club_by_partner_code`, verified only). Coupon invité 30j.
- Owner : `GET /api/owner/partner` {partner_code (auto-généré si legacy), qr_url, landing_url, stats{issued,used}} + `POST /api/owner/coupons/redeem` {code} (son club only, 409 déjà utilisé, 410 expiré). UI : owner-dashboard section "Mon code -10% invités 🎟️" (QR, code, copier lien via expo-clipboard, input validation coupon).
- Emails Resend (email_service.py) : send_claim_received / send_claim_approved (QR inline) / send_claim_rejected. ⚠️ Sandbox Resend : envois OK uniquement vers erlann.drc72@gmail.com tant que le domaine n'est pas vérifié (resend.com/domains) — échec gracieux sinon.
- Révocation admin : unset partner_code aussi.
### B. Mise en avant : Stripe SUPPRIMÉ → RevenueCat IAP (choix user : validation admin D'ABORD, paiement ENSUITE, zéro remboursement)
- Nouveaux statuts promo : requested → approved_awaiting_payment → active | rejected | expired. Champ product_id (promobar7d 19,99€ / promobar30d 49,99€ — PROMO_PLANS server-side).
- Endpoints : `POST /api/owner/promotions/request` {plan} (gratuit, 409 si en cours), `POST /api/admin/promotions/{id}/approve` (→ approved_awaiting_payment + notif "procède au paiement"), `/reject` (avant paiement, aucun remboursement), activation par webhook RevenueCat : `_apply_rc_event` intercepte product_id ∈ PROMO_PRODUCTS sur NON_RENEWING_PURCHASE/INITIAL_PURCHASE/PURCHASE_REDEEMED → `_handle_promo_purchase_event` → `_activate_promotion` (ne touche PAS au premium). Fallback client : `POST /api/owner/promotions/{id}/confirm-purchase` (idempotent).
- SUPPRIMÉ : tout le code Stripe (checkout, _stripe_call, webhook stripe, refunds), STRIPE_API_KEY retiré de .env, écran promotion-status.tsx supprimé, api.ts createPromoCheckout/promoStatus supprimés.
- Frontend : promote-bar.tsx réécrit (Demander gratuit → statut → bouton "Payer X€ et activer" via `purchasePromoProduct` (purchases.ts, Purchases.getProducts+purchaseStoreProduct, natif only — web affiche alerte "Paiement sur iPhone") → confirmPromoPurchase). admin-promotions.tsx : 4 onglets (À valider/Paiement/Actives/Refusées).
- ⚠️ ACTIONS UTILISATEUR pour la prod : créer 2 achats intégrés CONSOMMABLES dans App Store Connect (`promobar7d` 19,99€, `promobar30d` 49,99€), les ajouter comme Products dans RevenueCat (pas besoin d'offering/entitlement), webhook RC déjà configuré (/api/webhooks/revenuecat). Testable UNIQUEMENT sur build natif iOS.
### Fixes en passant
- search.tsx : import MUSIC_GENRES manquant (crash écran recherche) ; MapImpl.native.tsx : import LocationRequired manquant (crash carte native si permission refusée).
- Tests : backend curl complet PASS (robot IA auto-approve avec docs synthétiques PIL + auto-reject, webhook RC, coupons) + testing_agent iteration_31.json 11/11 PASS zéro bug. Données nettoyées, Club Rex restauré.

## ✅ IMPORT MASSIF DE BARS/BOÎTES (juillet 2026)
- `/app/backend/import_clubs_bulk.py` : import Google Places sur ~250 villes françaises (3 sets de types : night_club/dance_hall, bar/pub, karaoke/wine_bar ; fan-out 5 centres pour les grandes villes). Réutilise _map_place_to_club de places_service. Upsert $setOnInsert par club_id (gp_*), stockage PERMANENT dans db.places (pas de TTL).
- Résultat : db.places 3 520 → **9 942** établissements (+6 383, 1 033 appels API). Le Mans couvert (Lockdown, Le Guest's, etc. — 112 clubs dans un rayon de 20 km).
- list_clubs : cap de lecture db.places 5000 → 20000 ; la recherche matche désormais nom + description + **adresse** (multi-mots, ex. "bar le mans").
- Relancer l'import : `cd /app/backend && python3 import_clubs_bulk.py` (ou `--city "Nom"`).

## ✅ PROFILS UTILISATEURS DÉTAILLÉS (juin 2026 — fork)
- Splash "NF" vérifié (screenshot OK) — juste les lettres NF avec glow, sans cercle ni texte.
- Backend : `GET /api/users/{user_id}/profile` (server.py, avant /users/search) — profil public d'un autre utilisateur : identité (_profile_for_swipe + picture + is_premium + member_since), stats {friends, checkins (confirmed), moments, likes_received}, moments[] (24 derniers, image base64 + club_name + active), friendship {status: none|pending_out|pending_in|accepted, friendship_id}, is_me. 404 si inexistant/banni/bloqué (via _blocked_user_ids).
- Frontend : NOUVEL écran `/app/frontend/app/user/[id].tsx` — avatar, nom+âge, ville, badge premium, rangée stats, bouton ami contextuel (Ajouter/Demande envoyée/Accepter/Amis✓ avec retrait), BIO, Instagram (lien), MUSIQUE (chips), PHOTOS (strip horizontal), grille MOMENTS 3 colonnes (overlay expiré + nom club) + modal preview, UserActionsMenu (bloquer/signaler). État "Profil introuvable" + Retour.
- Navigation ajoutée : friends.tsx (lignes tappables → /user/{id}), chat/[matchId].tsx (header testID chat-header-profile → profil du correspondant), search.tsx (résultat → /user/{id} au lieu de story-viewer).
- api.ts : `getUserProfile(userId)`.
- Tests : iteration_35.json — backend 5/5 pytest PASS (shape, 404, flow amitié complet + cleanup vérifié), frontend 100% PASS. Comptes démo Apple intacts.

## ✅ SWIPE TINDER-STYLE COMPLET + REFONTE PREMIUM RUBY (juin 2026 — fork)
### A. Fonctionnalités swipe (Tinder à 99%)
- Backend server.py : POST /api/swipe/superlike (quota 1/j gratuit, 5/j premium — FREE_SUPERLIKES_PER_DAY/PREMIUM_SUPERLIKES_PER_DAY, 429 si épuisé), POST /api/swipe/rewind (premium only 402, 409 si le like a déjà matché, sinon supprime swipe+match_request et retourne le profil), POST /api/swipe/boost (premium only, boost_until=+30min, 1/j via last_boost_at, 409 si actif). /swipe/quota étendu (superlikes_limit/remaining, boost_active/until). MATCH INSTANTANÉ dans _user_swipe : si demande inverse pending → accept + création match + retour {matched:true, match_id, peer}. Deck : tri superliked_you d'abord puis boostés, flag superliked_you sur les profils.
- Frontend swipe.tsx RÉÉCRIT : pile de cartes (2 derrière, scale/translateY animés), gesture haut=super like, tampons J'AIME/NOPE/SUPER LIKE, barre 5 boutons (rewind or, nope, super like bleu+badge compteur, like, boost or) EN POSITION ABSOLUE au-dessus de la tab bar (bottom insets+96, CARD_H capé par hauteur écran), modal plein écran "C'EST UN MATCH !" (avatars SlideIn + cœur + sparkles + CTA message/continuer), modal premium-feature (rewind/boost non-premium → paywall), badge "T'a super-liké", pill "Boost actif", bouton détails → /user/{id}.
- Users test: swipetest.a/b/c@nightfinder.app / TestSwipe2026! (A premium, A-B matchés).
### B. Refonte design premium (design_guidelines.json — Glass/Luxe Ruby)
- theme.ts : marque VIOLET #8B5CF6 → RUBY #E11D48 (hover #F43F5E, pressed #BE123C), tertiary #FDA4AF, surfaces zinc (#09090B/#131316/#18181B/#27272A), gradients ruby. TOUS les violets hardcodés purgés (swipe, onboarding, paywall, my-songs, plus, index, PartnerUnlockModal).
- Nouveaux composants DS /components/ui/ : Toast.tsx (ToastProvider+useToast monté dans _layout, variants success/error/warning/info, haptics), States.tsx (EmptyState/ErrorState avec Réessayer), ListRow.tsx (ListGroup+ListRow style réglages Apple), AppButton.tsx (variants primary/secondary/ghost/destructive + loading). Exportés dans ui/index.ts.
- settings.tsx : style Apple groupé (cartes inset arrondies surfaceElevated, headers uppercase, dividers subtils, switches trackColor primary). Light mode vérifié OK.
- Accueil : skeletons (home-skeleton, 3 cartes) + EmptyState avec CTA Rafraîchir. Profil : skeleton grille moments.
- Tests : iteration_36.json — backend 5/5 PASS ; bug critique overlap boutons/tab-bar CORRIGÉ (vérifié par clic screenshot) ; violet paywall/partner modal corrigé ; gradient match modal → ruby nuit (#2b0a12).

## ✅ AUDIT AFFICHAGE COMPLET + FIXES (iter 37, juin 2026)
- Audit testing agent iteration_37 : swipe OK, profil public OK, réglages OK, thème OK sur la plupart des écrans.
- FIX i18n : app désormais FRANÇAIS PAR DÉFAUT (plus de détection de langue device qui causait le mixage FR/EN). STORAGE_KEY passé à 'nf_lang_v2' (reset des anciennes détections auto). Le choix explicite dans /language reste respecté. detectFromDevice supprimé.
- FIX accueil : titre "Bonsoir {name} 👋" ne tronque plus (fontSize 24 + adjustsFontSizeToFit minimumFontScale 0.72).
- Settings light mode : FAUX POSITIF du testeur — vérifié blanc par screenshot (le testeur mesurait le div racine du Stack, pas l'écran).
- MODAL MATCH vérifié E2E frontend : badge superliked-you → like → modal C'EST UN MATCH → "Envoyer un message" navigue vers /chat/{match_id}. Sparkle 💜→❤️.
- Users test swipe : swipetest.a/.b/.c/.d@nightfinder.app / TestSwipe2026! (A premium; A-B matchés; C-D matchés).
