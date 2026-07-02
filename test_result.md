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
  version: "1.2.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Resend forgot-password (OTP + magic link)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

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
