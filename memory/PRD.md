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
