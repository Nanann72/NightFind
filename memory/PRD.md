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
