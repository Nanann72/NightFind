#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Night Finder iOS/Android app. Tester la nouvelle fonctionnalité BeReal-style :
  Quand un utilisateur fait un check-in dans un club, il a 5 minutes pour prendre une photo
  ("moment") qui apparaît sur la map et la page du club. TTL : 24h pour utilisateurs gratuits,
  7 jours pour Premium.

backend:
  - task: "Resend forgot-password (OTP + magic link)"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py, /app/backend/email_service.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          POST /api/auth/forgot-password body {email, mode:"otp"|"link"} → toujours 200.
          Génère un code OTP 6 chiffres (mode=otp) ou un token URL-safe (mode=link).
          Stocke SHA-256 hash + expires_at (30 min) dans collection password_resets.
          Envoie l'email via Resend SDK (from: onboarding@resend.dev par défaut).
          Rate limit : max 3 pending resets par email / 15 min (silencieux).
          POST /api/auth/reset-password body {email, code|token, new_password} → renvoie JWT + user.
          Marque le reset comme used=true et invalide tous les autres pending resets pour cet email.
          NOTE: Le sender de test `onboarding@resend.dev` n'accepte que l'email du propriétaire (erlann.drc72@gmail.com).
          Pour un test réel avec envoi, utiliser cet email. Sinon tester la logique (rate limit, 200 always, reset flow).

  - task: "BeReal moments — POST /api/clubs/{club_id}/moments"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Endpoint upload moment. Vérifie qu'un check-in confirmé existe dans la fenêtre des 5 dernières min. TTL 24h gratuit / 7j premium. Doit refuser 403 si pas de check-in récent et 409 si moment déjà publié pour ce check-in."

  - task: "BeReal moments — GET /api/clubs/{club_id}/moments"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Liste les moments actifs (non expirés) d'un club. Trié par created_at DESC."

  - task: "BeReal moments — GET /api/moments/active-clubs"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Renvoie tous les club_ids avec au moins 1 moment actif, pour afficher un badge ✨ sur la map."

  - task: "BeReal moments — GET /api/moments/window-state"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Renvoie {in_window, club_id, expires_at, seconds_left} pour savoir si l'user est encore dans la fenêtre de 5 min après son check-in."

  - task: "MongoDB indexes for club_moments"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "TTL index sur expires_at + indexes performance (club_id,expires_at) (user_id,created_at) (checkin_id unique) (moment_id unique)."

frontend:
  - task: "Section Moments sur club detail"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/club/[id].tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "ScrollView horizontal des moments. Tap pour ouvrir modal plein écran."

  - task: "Badge ✨ live sur les markers de la map"
    implemented: true
    working: "NA"
    file: "/app/frontend/components/MapImpl.native.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Marker pour clubs avec moments actifs (rafraîchi toutes les 45s)."

  - task: "Capture screen BeReal"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/bereal-capture.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Utilise expo-camera (newly installed). Permission caméra demandée. Timer 5 min affiché. Capture base64, prévisualisation, légende optionnelle, publication."

metadata:
  created_by: "main_agent"
  version: "1.3.0"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

backend_verified_2026_01_audd:
  - task: "GET /api/admin/audd/status (require_admin)"
    working: true
    file: "/app/backend/server.py"
    notes: |
      Returns {configured, token_preview, total_songs, recent_songs}.
      token_preview masked as `abcd…wxyz` when configured (never leaks raw token).
      Non-admin reviewer -> 403. Verified in test_audd_admin.py::TestAuddStatus.
  - task: "POST /api/admin/audd/probe (require_admin, guardrails)"
    working: true
    file: "/app/backend/server.py"
    notes: |
      Verified guardrails WITHOUT calling Audd.io (no quota burn):
        - base64('hi')  → 200 {ok:false, sample_bytes:2, message:'Sample too small…'}
        - invalid b64   → 400
        - 2 MB payload  → 413 (limit 1.5 MB)
        - non-admin     → 403
      All 4 scenarios pass in test_audd_admin.py::TestAuddProbe.

backend_verified_2026_01:
  - task: "GET /api/users/search — advanced filters (age, city, music, premium)"
    working: true
    file: "/app/backend/server.py"
    notes: |
      All 7 scenarios pass. Bug fix applied by testing agent:
      music filter previously crashed with 500 "cannot nest $ under $in" because
      the code passed [{"$regex": t, "$options": "i"}, ...] inside $in — MongoDB
      requires compiled regex objects there. Replaced with re.compile(re.escape(t), IGNORECASE).
      File: /app/backend/server.py around users_search() music branch.
  - task: "GET /api/notifications/unread-count + POST /api/notifications/mark-read"
    working: true
    file: "/app/backend/server.py"
    notes: "Unread count returns int, mark-read zeroes it, list endpoint unaffected."
  - task: "Chat typing indicator + read receipts (POST /typing, GET /peer-state, POST /read)"
    working: true
    file: "/app/backend/server.py"
    notes: "Smoke tested with reviewer's pre-seeded match; 404 also verified for bogus match_id."

agent_communication:
  - agent: "main"
    message: |
      NOUVEAU (juin 2026) — Tester les nouvelles fonctionnalités :

      BACKEND :
      1. GET /api/users/search?q=chlo → doit renvoyer une liste (comme avant).
      2. GET /api/users/search?min_age=18&max_age=25 (sans q) → doit maintenant fonctionner et renvoyer des users âge 18-25.
      3. GET /api/users/search?city=paris (sans q) → doit renvoyer des users à Paris (case-insensitive).
      4. GET /api/users/search?music=techno,house → doit renvoyer users avec au moins un genre correspondant.
      5. GET /api/users/search?premium_only=true → doit renvoyer uniquement is_premium=true.
      6. GET /api/users/search sans aucun param → doit renvoyer {users:[], count:0}.
      7. GET /api/notifications/unread-count → renvoie {unread: <int>}. Après POST /api/notifications/mark-read
         puis re-appel, doit renvoyer {unread: 0}.
      8. Auth: apple.reviewer@nightfinder.app / Reviewer2026!

      FRONTEND (optionnel, native only pour la caméra) :
      - Ouvrir écran /search, taper le bouton filtres (icône options), sélectionner un âge et une ville → la liste doit se mettre à jour.
      - Ouvrir écran /notifications → à la sortie, le badge sur l'icône notifications de Discover doit disparaître (poll toutes les 45s).
      - Ouvrir un chat existant → indicateur "en train d'écrire" et 3 points animés doivent s'afficher quand le peer écrit.
      - Après lecture du peer, un texte "Vu à HH:MM" doit apparaître sous le dernier message envoyé.

agent_communication:
  - agent: "main"
    message: |
      NOUVEAU (juillet 2026) — Tester le flow Resend forgot/reset password :
      1. POST /api/auth/forgot-password body {email:"apple.reviewer@nightfinder.app","mode":"otp"} → doit renvoyer {ok:true, mode:"otp", message:...}. STATUS 200.
      2. Même appel avec email inexistant "ghost@nowhere.app" → doit renvoyer 200 (pas de leak).
      3. Vérifier rate limit : 4 appels rapides sur le même email → tous renvoient 200 mais le 4e ne doit PAS créer d'entrée en DB.
      4. Récupérer/insérer un reset connu en DB (le sender de test Resend limite l'envoi réel à erlann.drc72@gmail.com — inspecter password_resets collection pour obtenir un token_hash valide et tester avec un code connu qu'on insère manuellement).
      5. POST /api/auth/reset-password body {email, code:"123456", new_password:"newpass1"} avec un mauvais code → 400 "Code invalide ou expiré".
      6. Insérer manuellement un reset avec code connu → reset-password doit renvoyer {ok:true, token:"...", user:{...}} et user["password_hash"] doit être mis à jour (login avec new_password fonctionne).
      7. Re-utiliser le même code → 400 (used=true).
      8. Mode "link" : POST forgot-password avec mode:"link" → response mode:"link". Insérer un token connu et faire reset-password avec {token:"..."} → OK.

  - agent: "main"
    message: |
      Tests à effectuer (backend prioritaire — frontend BeReal requiert build native, pas testable via web preview) :
      1. Auth comme Apple reviewer (apple.reviewer@nightfinder.app / Reviewer2026!).
      2. Faire un check-in confirmé sur un club existant : POST /api/checkins {club_id, confirmed:true}.
      3. Vérifier GET /api/moments/window-state retourne in_window=true, club_id, seconds_left.
      4. Upload un moment : POST /api/clubs/{club_id}/moments {image:"data:image/jpeg;base64,...", caption:"test"}.
         Vérifier la réponse contient moment_id, expires_at (24h pour user non-premium).
      5. Re-upload pour même check-in → doit renvoyer 409.
      6. GET /api/clubs/{club_id}/moments → doit lister le moment (sans le champ "image" ne sera pas... attendre, le GET liste retourne le champ image. Ok le POST le retire seulement de la réponse).
         Note: GET /api/clubs/{club_id}/moments retourne `image` (la base64 complète) car le frontend en a besoin.
      7. GET /api/moments/active-clubs → doit contenir le club_id avec count>=1.
      8. Test 403 : Sans check-in récent, POST /api/clubs/X/moments doit renvoyer 403.
      9. Vérifier TTL : si user est premium (le reviewer l'est), expires_at doit être ~7j après now (premium=7j).

  - agent: "main"
    message: |
      PHASE 2 — Revendication de bar (Bar Vérifié) TERMINÉE et TESTÉE (iteration_29.json PASS).
      Backend : POST /api/bars/claim, GET /api/me/bar-claims, GET /api/admin/bar-claims(+/{id}, /approve, /reject).
      Frontend : /claim-bar (formulaire + upload docs base64), /admin-claims (onglets + détail + approve/reject),
      section Réglages "Vous êtes propriétaire ?", badge "Vérifié" sur club/[id].
      Données de test nettoyées après tests — comptes démo Apple intacts.

  - agent: "main"
    message: |
      PHASES 3/4/5 TERMINÉES et TESTÉES (iteration_30.json — 10/10 PASS, zéro bug).
      Phase 3 : mise en avant payante Stripe (19,99€/7j, 49,99€/30j), remboursement auto si refus,
      section "À la une ⭐" accueil + badge Sponsorisé + tri prioritaire dans /api/clubs.
      Phase 4 : /admin-promotions (valider/refuser), /api/admin/overview, révocation badge Vérifié.
      Phase 5 : /owner-dashboard (stats vues/favoris/check-ins/musiques, édition infos/photos/horaires,
      menu affiché sur la fiche club, événements propriétaire).
      STRIPE_API_KEY ajoutée à backend/.env. Données de test nettoyées.

  - agent: "main"
    message: |
      REVENDICATION AUTOMATISÉE + BASCULE REVENUECAT TERMINÉES (iteration_31.json — 11/11 PASS).
      A) Robot IA (Gemini vision, mode strict) valide/refuse les claims automatiquement, emails Resend
      (réception/approbation avec QR + code -10%/refus), code -10% individuel par bar vérifié,
      validation des coupons invités depuis le dashboard propriétaire.
      B) Mise en avant : Stripe supprimé → RevenueCat IAP (demande gratuite → validation admin →
      paiement Apple promo_bar_7d/30d → activation auto via webhook RC). promotion-status.tsx supprimé.
      Fixes : imports manquants search.tsx (MUSIC_GENRES) et MapImpl.native.tsx (LocationRequired).

  - agent: "main"
    message: |
      NIGHT FINDER 3.0 — Phases 3/4/7/9/11 testées (iteration_42.json — backend 7/7 PASS, frontend PASS).
      Nouveaux endpoints : GET /api/matches/unread-count, champ unread dans GET /api/matches.
      Frontend : FAB + (CreateFab), chips accueil (Pour toi/Ce soir/Techno/VIP/Terrasse), badges non-lus
      (tab bar + par conversation), InAppNotificationBanner (root layout), onboarding 1 intro + 3 features.
      Fix post-test : triggerUnreadMessagesRefresh() au focus de chats.tsx (badge tab instantané).
      Bottom sheet carte (MapImpl.native.tsx) = natif uniquement, à valider sur téléphone.

  - agent: "main"
    message: |
      ITÉRATION 43 (pop-ups engagement + mockup 3.0) — TESTÉE PASS (iteration_43.json, backend 6/6 + frontend).
      /api/activity/pulse + /api/activity/live, EngagementPulse.tsx (bannières périodiques),
      accueil marque+compteurs live 👥+Voir, chats recherche+onglets+demandes inline+heure,
      swipe deck-counter X/Y, carte native chips+itinéraire (non testé web — à valider sur device).
      Test file: /app/backend/tests/test_activity_pulse.py. Demande Sofia (démo Apple) préservée.

  - agent: "main"
    message: |
      RÉPONSE INVITATION SOIRÉE — auto-testée E2E PASS (curl + Playwright, pas de testing_agent nécessaire).
      POST /api/messages/{id}/invite-response (yes/no, 403 expéditeur, 409 double), message invite avec
      payload invite (club_id/club_name/address), carte chat avec boutons J'y serai/Pas dispo + statut +
      message auto. Messages de test supprimés — démo Apple reviewer préservée.

  - agent: "main"
    message: |
      VIP Stripe payment (pending_payment→webhook→confirmed, testé curl E2E), moments vidéo (object
      storage upload/stream testés, capture native only), commentaires déjà existants. Smoke frontend OK.
      Clé Stripe LIVE active — paiements réels. Test media med_cbe78cc5da conservé dans db.media (inoffensif).
