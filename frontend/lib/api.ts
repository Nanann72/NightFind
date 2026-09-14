import { getToken } from './storage';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export type LiveStats = {
  active_users: number;
  moments_tonight: number;
  checkins_tonight: number;
  matches_tonight: number;
  generated_at: string;
};


export type Club = {
  club_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  description: string;
  music_styles: string[];
  avg_price: number;
  rating: number;
  features: string[];
  hours: Record<string, { open: boolean; from?: string; to?: string }>;
  photos: string[];
  distance_km?: number | null;
  user_rating?: number | null;
  user_rating_count?: number;
  top_rated?: boolean;
  events?: NFEvent[];
  verified?: boolean;
  promoted?: boolean;
  menu?: MenuItem[];
  primary_type?: string;
  types?: string[];
};

export type MenuItem = {
  name: string;
  price: number;
  category?: string;
};

export type VipTable = {
  table_id: string;
  name: string;
  x: number;
  y: number;
  capacity: number;
  price: number;
  booked?: boolean;
};

export type TonightClub = {
  club_id: string;
  name: string;
  photo?: string | null;
  address?: string;
  rating?: number;
  music_styles: string[];
  distance_km?: number | null;
  lat?: number;
  lng?: number;
  live: number;
};

export type Promotion = {
  promo_id: string;
  user_id: string;
  club_id: string;
  club_name?: string | null;
  club_photo?: string | null;
  plan: '7d' | '30d';
  plan_label: string;
  days: number;
  amount: number;
  currency: string;
  product_id: string;
  status: 'requested' | 'approved_awaiting_payment' | 'active' | 'rejected' | 'expired';
  rejection_reason?: string | null;
  created_at: string;
  starts_at?: string | null;
  ends_at?: string | null;
  paid_at?: string | null;
};

export type BarClaim = {
  claim_id: string;
  user_id: string;
  user_email?: string;
  club_id: string;
  club_name?: string | null;
  club_photo?: string | null;
  club_address?: string | null;
  owner_name: string;
  email: string;
  phone: string;
  role: 'proprietaire' | 'gerant' | 'manager';
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  id_document?: string;
  kbis_document?: string;
  ai_verdict?: {
    approve: boolean | null;
    confidence: number;
    notes: string;
    checks?: Record<string, boolean>;
    fail_open?: boolean;
  } | null;
};

export type NFEvent = {
  event_id: string;
  club_id: string;
  title: string;
  description: string;
  dj: string;
  date: string;
  entry_price: number;
  photo?: string;
  club_name?: string;
  club_photo?: string;
};

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  music_prefs: string[];
  created_at: string;
  username?: string | null;
  visibility?: 'always' | 'clubs_only' | 'hidden';
  photos?: string[];
  bio?: string;
  city?: string;
  dob?: string;
  likes_received_count?: number;
  is_premium?: boolean;
  premium_expires_at?: string | null;
  is_admin?: boolean;
  is_bar_owner?: boolean;
  owned_club_id?: string | null;
};

export type MomentComment = {
  comment_id: string;
  moment_id: string;
  user_id: string;
  user_name: string;
  user_picture?: string | null;
  text: string;
  created_at: string;
};

export type FeedMoment = {
  moment_id: string;
  user_id: string;
  user_name: string;
  user_picture?: string | null;
  club_id: string;
  club_name?: string | null;
  image: string;
  selfie?: string | null;
  caption?: string | null;
  created_at: string;
  expires_at: string;
  likes_count: number;
  comments_count: number;
  liked_by_me: boolean;
  is_following?: boolean;
};

export type StoryHighlight = {
  user_id: string;
  user_name: string;
  user_picture?: string | null;
  moment_id: string;
  moments_count: number;
  is_self: boolean;
};

export type NearbyUser = {
  user_id: string;
  name: string;
  picture?: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  is_premium: boolean;
  is_bot: boolean;
  age?: number | null;
};

export type SearchUser = {
  user_id: string;
  name: string;
  picture?: string | null;
  city?: string | null;
  bio?: string;
  age?: number | null;
  is_premium: boolean;
  is_bot: boolean;
  music?: string[];
};

export type AdminUser = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  city?: string | null;
  is_admin: boolean;
  is_premium: boolean;
  premium_expires_at?: string | null;
  is_bot: boolean;
  is_banned: boolean;
  banned_until?: string | null;
  ban_reason?: string | null;
  created_at?: string | null;
};

export type ActiveFriend = {
  user_id: string;
  username?: string | null;
  name?: string | null;
  picture?: string | null;
  club_id: string;
  club_name?: string | null;
  lat: number;
  lng: number;
  checked_in_at?: string;
};

// ── Network status (offline detection) ─────────────────────────────
type NetListener = (offline: boolean) => void;
const netListeners: NetListener[] = [];
let _offline = false;

function setOffline(v: boolean) {
  if (_offline === v) return;
  _offline = v;
  netListeners.forEach((l) => {
    try { l(v); } catch {}
  });
}

export function onNetworkStatus(listener: NetListener): () => void {
  netListeners.push(listener);
  listener(_offline);
  return () => {
    const i = netListeners.indexOf(listener);
    if (i >= 0) netListeners.splice(i, 1);
  };
}

export async function pingBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/stats/live`, { method: 'GET' });
    if (res.ok) setOffline(false);
    return res.ok;
  } catch {
    return false;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${BASE_URL}/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (e) {
    // Network-level failure (no connection) — flag offline, keep UI alive
    setOffline(true);
    throw e;
  }
  setOffline(false);
  if (!res.ok) {
    // Lire le corps UNE seule fois (sinon "Already read"), puis tenter JSON
    let detail = '';
    try {
      const raw = await res.text();
      try {
        const j = JSON.parse(raw);
        detail = j.detail || JSON.stringify(j);
      } catch {
        detail = raw.slice(0, 200);
      }
    } catch {
      detail = '';
    }
    const err: any = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Admin (require_admin on backend)
  adminSeedBots: (count = 20) =>
    request<{ ok: boolean; created: number; sample_names: string[] }>(
      `/admin/seed-bots?count=${count}`,
      { method: 'POST' },
    ),
  adminDeleteBots: () =>
    request<{ ok: boolean; deleted: Record<string, number> }>('/admin/bots', {
      method: 'DELETE',
    }),
  adminBotStats: () =>
    request<{ total_bots: number; premium_bots: number; bots_with_location: number }>(
      '/admin/bots/stats',
    ),
  // Users nearby (for the map + bots visualisation)
  usersNearby: (lat: number, lng: number, radiusKm = 10) =>
    request<{ users: NearbyUser[]; count: number }>(
      `/users/nearby?lat=${lat}&lng=${lng}&radius_km=${radiusKm}`,
    ),
  usersSearch: (q: string, limit = 20, filters?: { minAge?: number; maxAge?: number; city?: string; music?: string; premiumOnly?: boolean }) => {
    const p = new URLSearchParams({ q, limit: String(limit) });
    if (filters?.minAge) p.set('min_age', String(filters.minAge));
    if (filters?.maxAge) p.set('max_age', String(filters.maxAge));
    if (filters?.city) p.set('city', filters.city);
    if (filters?.music) p.set('music', filters.music);
    if (filters?.premiumOnly) p.set('premium_only', 'true');
    return request<{ users: SearchUser[]; count: number }>(`/users/search?${p.toString()}`);
  },
  notificationsUnread: () =>
    request<{ unread: number }>('/notifications/unread-count'),
  matchesUnread: () =>
    request<{ unread: number }>('/matches/unread-count'),
  activityLive: (ids: string[]) =>
    request<{ counts: Record<string, number> }>(`/activity/live?club_ids=${ids.join(',')}`),
  activityPulse: (lat?: number, lng?: number) =>
    request<{ type: string; emoji: string; title: string; body: string; image?: string | null; route?: string }>(
      `/activity/pulse${lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : ''}`,
    ),
  tonightPlan: (lat?: number, lng?: number) =>
    request<{
      club: TonightClub | null;
      alternatives: TonightClub[];
      friends: { match_id: string; user_id: string; name: string; photo?: string | null }[];
    }>(`/tonight/plan${lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : ''}`),
  momentEventCurrent: () =>
    request<{ event: { event_id: string; title: string; starts_at: string; ends_at: string; duration_min: number } | null; server_time: string }>('/moment-events/current'),
  adminTriggerMomentEvent: (duration_min = 10) =>
    request<{ ok: boolean; event: any; notified: number; total_users: number }>('/admin/moment-events/trigger', {
      method: 'POST',
      body: JSON.stringify({ duration_min }),
    }),
  statsLive: () => request<LiveStats>('/stats/live'),
  notificationsMarkRead: () =>
    request<{ ok: boolean; updated: number }>('/notifications/mark-read', { method: 'POST' }),
  // Admin — user moderation
  adminSearchUsers: (q = '', limit = 50) =>
    request<{ users: AdminUser[]; count: number }>(
      `/admin/users?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  adminBanUser: (userId: string, durationHours: number | null, reason: string) =>
    request<{ ok: boolean; banned_until: string | null }>(
      `/admin/users/${userId}/ban`,
      {
        method: 'POST',
        body: JSON.stringify({ duration_hours: durationHours, reason }),
      },
    ),
  adminUnbanUser: (userId: string) =>
    request<{ ok: boolean }>(`/admin/users/${userId}/unban`, { method: 'POST' }),
  adminSetPremium: (userId: string, durationDays: number | null, remove = false) =>
    request<{ ok: boolean; is_premium: boolean; premium_expires_at: string | null }>(
      `/admin/users/${userId}/premium`,
      {
        method: 'POST',
        body: JSON.stringify({ duration_days: durationDays, remove }),
      },
    ),
  // Admin — Audd.io diagnostic
  adminAuddStatus: () =>
    request<{
      configured: boolean;
      token_preview: string;
      total_songs: number;
      recent_songs: Array<{
        song_id: string;
        user_id: string;
        club_name?: string | null;
        title?: string | null;
        artist?: string | null;
        detected_at?: string | null;
      }>;
    }>('/admin/audd/status'),
  adminAuddProbe: (audio_base64: string) =>
    request<{
      ok: boolean;
      http_status?: number;
      audd_status?: string;
      recognised: boolean;
      sample_bytes: number;
      elapsed_ms?: number;
      summary?: {
        title?: string | null;
        artist?: string | null;
        album?: string | null;
        release_date?: string | null;
        spotify_url?: string | null;
        apple_music_url?: string | null;
      } | null;
      error?: { error_code?: number; error_message?: string } | null;
      raw?: any;
      message?: string;
    }>('/admin/audd/probe', {
      method: 'POST',
      body: JSON.stringify({ audio_base64 }),
    }),
  // Auth
  register: (email: string, password: string, name: string, dob: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, dob }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User; two_factor_required?: boolean; phone_hint?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  login2FA: (email: string, password: string, code: string) =>
    request<{ token: string; user: User }>('/auth/login-2fa', {
      method: 'POST',
      body: JSON.stringify({ email, password, code }),
    }),
  sendPhoneOtp: (phone: string) =>
    request<{ ok: boolean }>('/phone/send-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyPhoneOtp: (phone: string, code: string) =>
    request<{ ok: boolean; phone_verified: boolean }>('/phone/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  setTwoFactor: (enabled: boolean) =>
    request<{ ok: boolean; two_factor_enabled: boolean }>('/me/two-factor', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  forgotPassword: (email: string, mode: 'otp' | 'link' = 'otp') =>
    request<{ ok: boolean; mode: 'otp' | 'link'; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email, mode }),
    }),
  resetPassword: (payload: { email: string; code?: string; token?: string; new_password: string }) =>
    request<{ ok: boolean; token: string; user: User }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  googleSession: (session_token: string) =>
    request<{ token: string; user: User }>('/auth/session', {
      method: 'POST',
      body: JSON.stringify({ session_token }),
    }),
  googleOAuth: (access_token: string) =>
    request<{ token: string; user: User }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ access_token }),
    }),
  appleSignIn: (identity_token: string, email?: string, name?: string) =>
    request<{ token: string; user: User }>('/auth/apple', {
      method: 'POST',
      body: JSON.stringify({ identity_token, email, name }),
    }),
  me: () => request<User>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  updateProfile: (data: Partial<Pick<User, 'name' | 'picture' | 'music_prefs'>>) =>
    request<User>('/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // Clubs
  listClubs: (params: {
    lat?: number;
    lng?: number;
    radius_km?: number;
    music?: string;
    max_price?: number;
    open_now?: boolean;
    vip?: boolean;
    terrasse?: boolean;
    search?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    return request<Club[]>(`/clubs?${qs.toString()}`);
  },
  getClub: (id: string) => request<Club>(`/clubs/${id}`),

  // Events
  listEvents: () => request<NFEvent[]>('/events?upcoming_only=true'),
  createEvent: (body: {
    title: string;
    location_name: string;
    location_address?: string;
    visibility?: 'public' | 'friends_only';
    description?: string;
    dj?: string;
    date: string;
    entry_price?: number;
    photo?: string | null;
  }) =>
    request<NFEvent>('/events', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  findFriendsByContacts: (emails: string[]) =>
    request<Array<any>>('/friends/find-by-contacts', {
      method: 'POST',
      body: JSON.stringify({ emails }),
    }),

  // ----- User-to-user Swipe (Tinder-like) ----- //
  swipeDeck: (sameClub: boolean = false) =>
    request<Array<any>>(`/swipe/deck${sameClub ? '?same_club=true' : ''}`),
  swipeQuota: () =>
    request<{ used_today: number; limit: number | null; is_premium: boolean; remaining: number | null }>(
      '/swipe/quota',
    ),
  swipeLike: (target_user_id: string) =>
    request<{ ok: boolean; already_swiped?: boolean; matched?: boolean; match_id?: string; peer?: { user_id: string; name: string; photo?: string | null } }>('/swipe/like', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  swipePass: (target_user_id: string) =>
    request<{ ok: boolean; already_swiped?: boolean }>('/swipe/pass', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  swipeSuperlike: (target_user_id: string) =>
    request<{ ok: boolean; already_swiped?: boolean; matched?: boolean; match_id?: string; peer?: { user_id: string; name: string; photo?: string | null } }>('/swipe/superlike', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  swipeRewind: () =>
    request<{ ok: boolean; action: string; profile: any }>('/swipe/rewind', { method: 'POST' }),
  swipeBoost: () =>
    request<{ ok: boolean; boost_until: string; duration_min: number }>('/swipe/boost', { method: 'POST' }),
  updateSwipeFields: (body: {
    dob?: string;
    bio?: string;
    city?: string;
    instagram?: string;
    photos?: string[];
    fav_clubs?: string[];
    gender?: string;
    pref_gender?: string;
    pref_age_min?: number;
    pref_age_max?: number;
    pref_distance_km?: number;
  }) =>
    request<{ ok: boolean; updated: string[] }>('/profile/swipe-fields', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Match requests + chat
  listMatchRequests: () => request<any[]>('/match-requests'),
  profileCompletion: () =>
    request<{ percent: number; missing: string[] }>('/me/profile-completion'),
  likesHub: () =>
    request<{
      is_premium: boolean;
      likes: any[];
      superlikes: any[];
      requests: any[];
      likes_count: number;
      superlikes_count: number;
    }>('/swipe/likes-hub'),
  acceptMatch: (request_id: string) =>
    request<{ ok: boolean; match_id: string }>('/match-requests/accept', {
      method: 'POST',
      body: JSON.stringify({ request_id }),
    }),
  rejectMatch: (request_id: string) =>
    request<{ ok: boolean }>('/match-requests/reject', {
      method: 'POST',
      body: JSON.stringify({ request_id }),
    }),
  listMatches: () => request<any[]>('/matches'),
  listMessages: (match_id: string, since?: string) =>
    request<any[]>(`/matches/${match_id}/messages${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  sendMessage: (
    match_id: string,
    text: string,
    gif_url?: string,
    invite?: { club_id: string; club_name: string; address?: string },
  ) =>
    request<any>(`/matches/${match_id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, gif_url, invite }),
    }),
  inviteResponse: (message_id: string, response: 'yes' | 'no') =>
    request<{ ok: boolean; invite_response: string; reply: any }>(
      `/messages/${message_id}/invite-response`,
      { method: 'POST', body: JSON.stringify({ response }) },
    ),
  gifSearch: (q: string, pos = '') =>
    request<{ results: { id: string; preview_url: string; url: string }[]; next: string }>(
      `/gifs/search?q=${encodeURIComponent(q)}${pos ? `&pos=${encodeURIComponent(pos)}` : ''}`,
    ),
  verifyFace: (selfie: string) =>
    request<{ ok: boolean; verified: boolean; confidence?: number; reason: string }>('/verify/face', {
      method: 'POST',
      body: JSON.stringify({ selfie }),
    }),
  setChatTheme: (theme: string) =>
    request<{ ok: boolean; theme: string }>('/me/chat-theme', {
      method: 'PUT',
      body: JSON.stringify({ theme }),
    }),
  editMessage: (message_id: string, text: string) =>
    request<{ ok: boolean; text: string; edited_at: string }>(`/messages/${message_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),
  deleteMessage: (message_id: string) =>
    request<{ ok: boolean }>(`/messages/${message_id}`, { method: 'DELETE' }),
  setTyping: (match_id: string) =>
    request<{ ok: boolean }>(`/matches/${match_id}/typing`, { method: 'POST' }),
  markChatRead: (match_id: string) =>
    request<{ ok: boolean; marked: number }>(`/matches/${match_id}/read`, { method: 'POST' }),
  getChatPeerState: (match_id: string) =>
    request<{ peer_user_id: string; is_typing: boolean; peer_last_read_at: string | null }>(
      `/matches/${match_id}/peer-state`,
    ),
  reserveEvent: (id: string) =>
    request<{ reservation_id: string; status: string }>(
      `/events/${id}/reserve`,
      { method: 'POST' },
    ),

  // Favorites
  getFavorites: () => request<Club[]>('/favorites'),
  addFavorite: (id: string) =>
    request<{ ok: boolean }>(`/favorites/${id}`, { method: 'POST' }),
  removeFavorite: (id: string) =>
    request<{ ok: boolean }>(`/favorites/${id}`, { method: 'DELETE' }),

  // Swipes
  recordSwipe: (club_id: string, action: 'like' | 'skip') =>
    request<{ ok: boolean }>('/swipes', {
      method: 'POST',
      body: JSON.stringify({ club_id, action }),
    }),
  swipeHistory: () => request<any[]>('/swipes/history'),

  // Check-ins — when the user confirms they're at a club we automatically
  // start the live listening session (Auto-Shazam). Promised in onboarding
  // slide "06 · Auto-Shazam".
  checkInManual: (club_id: string, lat: number, lng: number, accuracy?: number) =>
    request<{ ok: boolean; checkin_id: string; distance_m: number }>(
      '/checkins/manual',
      {
        method: 'POST',
        body: JSON.stringify({ club_id, lat, lng, accuracy }),
      },
    ),
  checkIn: async (club_id: string, confirmed: boolean) => {
    const res = await request<{ ok: boolean; checkin_id: string; confirmed: boolean }>(
      '/checkins',
      {
        method: 'POST',
        body: JSON.stringify({ club_id, confirmed }),
      },
    );
    if (confirmed) {
      // Fire-and-forget — never block check-in on Shazam side-effects.
      (async () => {
        try {
          const clubs = await request<any[]>('/clubs?radius_km=200');
          const club = clubs.find((c: any) => c.club_id === club_id);
          if (club) {
            const { startLiveListening } = await import('./audioRecognition');
            startLiveListening(club);
          }
          // Moment capture is temporarily disabled (native plugin
          // removed) — feature will return in a future build.
        } catch {
          // Live listening is best-effort.
        }
      })();
    }
    return res;
  },
  listCheckIns: () => request<any[]>('/checkins'),

  // Detected songs (live listening)
  addDetectedSong: (
    club_id: string,
    title: string,
    artist?: string,
    detected_at?: string,
    source: 'auto' | 'manual' = 'auto',
  ) =>
    request<{ ok: boolean; song_id: string }>('/checkins/song', {
      method: 'POST',
      body: JSON.stringify({ club_id, title, artist, detected_at, source }),
    }),
  listProfileSongs: () =>
    request<{
      total: number;
      clubs: {
        club_id: string;
        club_name: string;
        songs: { song_id: string; title: string; artist?: string; detected_at?: string; source?: string }[];
      }[];
    }>('/profile/songs'),
  deleteProfileSong: (song_id: string) =>
    request<{ ok: boolean }>(`/profile/songs/${song_id}`, { method: 'DELETE' }),
  // ── Partner bar (offre -10%) ──
  partnerInfo: (code: string) =>
    request<{ valid: boolean; club_name?: string; club_photo?: string | null; discount_pct?: number }>(
      `/partner/info?code=${encodeURIComponent(code)}`,
    ),
  claimPartner: (code: string) =>
    request<{ coupon: any; new: boolean }>('/partner/claim', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  myCoupons: () => request<{ coupons: any[] }>('/me/coupons'),
  adminGetPartnerBar: () => request<any>('/admin/partner-bar'),
  adminSetPartnerBar: (club_id: string, active: boolean, expires_days: number) =>
    request<any>('/admin/partner-bar', {
      method: 'PUT',
      body: JSON.stringify({ club_id, active, expires_days }),
    }),
  adminDisablePartnerBar: () => request<{ ok: boolean }>('/admin/partner-bar', { method: 'DELETE' }),

  // Bar claims — Phase 2 (Bar Vérifié)
  submitBarClaim: (payload: {
    club_id: string;
    owner_name: string;
    email: string;
    phone: string;
    role: string;
    id_document: string;
    kbis_document: string;
  }) =>
    request<{ ok: boolean; claim: BarClaim }>('/bars/claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  myBarClaims: () => request<{ claims: BarClaim[] }>('/me/bar-claims'),
  adminListBarClaims: (status?: 'pending' | 'approved' | 'rejected') =>
    request<{ claims: BarClaim[]; pending_count: number }>(
      `/admin/bar-claims${status ? `?status=${status}` : ''}`,
    ),
  adminBarClaimDetail: (claimId: string) =>
    request<BarClaim>(`/admin/bar-claims/${claimId}`),
  adminApproveBarClaim: (claimId: string) =>
    request<{ ok: boolean }>(`/admin/bar-claims/${claimId}/approve`, { method: 'POST' }),
  adminRejectBarClaim: (claimId: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/bar-claims/${claimId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Promotions payantes — Phase 3 (RevenueCat : validation admin PUIS paiement in-app)
  requestPromotion: (plan: '7d' | '30d') =>
    request<{ ok: boolean; promo: Promotion }>('/owner/promotions/request', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
  myPromotions: () =>
    request<{ promotions: Promotion[]; plans: Record<string, { amount: number; days: number; label: string; product_id: string }> }>(
      '/owner/promotions',
    ),
  confirmPromoPurchase: (promoId: string) =>
    request<{ ok: boolean; status: string; ends_at?: string }>(`/owner/promotions/${promoId}/confirm-purchase`, {
      method: 'POST',
    }),
  featuredPromotions: () => request<{ clubs: Club[] }>('/promotions/featured'),
  adminListPromotions: (status?: string) =>
    request<{ promotions: Promotion[]; pending_count: number }>(
      `/admin/promotions${status ? `?status=${status}` : ''}`,
    ),
  adminApprovePromotion: (promoId: string) =>
    request<{ ok: boolean }>(`/admin/promotions/${promoId}/approve`, { method: 'POST' }),
  adminRejectPromotion: (promoId: string, reason: string) =>
    request<{ ok: boolean; refund: string }>(`/admin/promotions/${promoId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Tableau de bord propriétaire — Phase 5
  ownerGetClub: () => request<Club & { menu?: MenuItem[] }>('/owner/club'),
  ownerUpdateClub: (payload: Partial<{
    description: string;
    avg_price: number;
    music_styles: string[];
    photos: string[];
    hours: Record<string, any>;
  }>) =>
    request<{ ok: boolean }>('/owner/club', { method: 'PATCH', body: JSON.stringify(payload) }),
  ownerSetMenu: (items: MenuItem[]) =>
    request<{ ok: boolean }>('/owner/club/menu', { method: 'PUT', body: JSON.stringify({ items }) }),
  ownerCreateEvent: (payload: {
    title: string;
    description?: string;
    dj?: string;
    date: string;
    entry_price?: number;
    photo?: string | null;
  }) =>
    request<NFEvent>('/owner/events', { method: 'POST', body: JSON.stringify(payload) }),
  ownerDeleteEvent: (eventId: string) =>
    request<{ ok: boolean }>(`/owner/events/${eventId}`, { method: 'DELETE' }),
  ownerStats: () =>
    request<{
      club_id: string;
      club_name: string;
      views: number;
      favorites: number;
      checkins: number;
      songs: number;
      active_promotion?: { ends_at: string; plan_label: string } | null;
    }>('/owner/stats'),
  ownerPartner: () =>
    request<{
      partner_code: string;
      qr_url: string;
      landing_url: string;
      discount_pct: number;
      stats: { issued: number; used: number };
    }>('/owner/partner'),
  ownerRedeemCoupon: (code: string) =>
    request<{ ok: boolean; discount_pct: number }>('/owner/coupons/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  // Admin — Phase 4
  adminOverview: () =>
    request<{ pending_claims: number; pending_promotions: number; active_promotions: number; verified_bars: number }>(
      '/admin/overview',
    ),
  adminRevokeVerified: (clubId: string) =>
    request<{ ok: boolean }>(`/admin/verified-bars/${clubId}/revoke`, { method: 'POST' }),
  adminRedeemCoupon: (code: string) =>
    request<{ ok: boolean }>('/admin/coupons/redeem', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  moveSong: (song_id: string, club_id: string) =>
    request<{ ok: boolean; club_id: string; club_name: string }>(
      `/profile/songs/${song_id}/club`,
      { method: 'PATCH', body: JSON.stringify({ club_id }) },
    ),

  // Friends
  setUsername: (username: string) =>
    request<{ ok: boolean; username: string }>('/profile/username', {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),
  setVisibility: (visibility: 'always' | 'clubs_only' | 'hidden') =>
    request<{ ok: boolean }>('/profile/visibility', {
      method: 'PUT',
      body: JSON.stringify({ visibility }),
    }),
  setPrivacy: (is_private: boolean) =>
    request<{ ok: boolean; is_private: boolean }>('/profile/privacy', {
      method: 'PUT',
      body: JSON.stringify({ is_private }),
    }),
  vipTables: (clubId: string, date: string) =>
    request<{ date: string; tables: VipTable[]; my_reservation: any }>(
      `/clubs/${clubId}/vip-tables?date=${date}`,
    ),
  vipReserve: (clubId: string, table_id: string, date: string, party_size: number) =>
    request<any>(`/clubs/${clubId}/vip-reservations`, {
      method: 'POST',
      body: JSON.stringify({ table_id, date, party_size }),
    }),
  myVipReservations: () => request<any[]>('/me/vip-reservations'),
  clubReviews: (clubId: string) =>
    request<{ avg: number | null; count: number; my_review: any; reviews: any[] }>(`/clubs/${clubId}/reviews`),
  submitClubReview: (clubId: string, rating: number, text: string) =>
    request<{ ok: boolean }>(`/clubs/${clubId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, text }),
    }),
  replyClubReview: (clubId: string, reviewId: string, text: string) =>
    request<{ ok: boolean }>(`/clubs/${clubId}/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  cancelVipReservation: (id: string) =>
    request<{ ok: boolean }>(`/vip-reservations/${id}`, { method: 'DELETE' }),
  searchFriends: (q: string) =>
    request<{ user_id: string; username: string; name: string }[]>(`/friends/search?q=${encodeURIComponent(q)}`),
  sendFriendRequest: (target_user_id: string) =>
    request<{ ok: boolean }>('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  acceptFriend: (friendship_id: string) =>
    request<{ ok: boolean }>(`/friends/${friendship_id}/accept`, { method: 'POST' }),
  rejectFriend: (friendship_id: string) =>
    request<{ ok: boolean }>(`/friends/${friendship_id}/reject`, { method: 'POST' }),
  removeFriend: (friend_user_id: string) =>
    request<{ ok: boolean }>(`/friends/${friend_user_id}`, { method: 'DELETE' }),
  listFriends: () =>
    request<{
      friends: any[];
      incoming: any[];
      outgoing: any[];
    }>('/friends/list'),
  activeFriends: () => request<ActiveFriend[]>('/friends/active'),
  getUserProfile: (userId: string) =>
    request<any>(`/users/${encodeURIComponent(userId)}/profile`),

  // Push notifications
  registerPush: (body: { user_id: string; platform: 'ios' | 'android'; device_token: string }) =>
    request<{ status: string; upstream_ok: boolean }>('/register-push', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Audd.io audio recognition — fast=true skips server-side preprocessing
  recognizeAudio: (club_id: string, audio_base64: string, fast = false) =>
    request<{ ok: boolean; recognised: boolean; song_id?: string; title?: string; artist?: string }>(
      '/recognize/audio',
      {
        method: 'POST',
        body: JSON.stringify({ club_id, audio_base64, fast }),
      },
    ),

  // Notifications
  listNotifications: () => request<any[]>('/notifications'),

  // Encaissement verres -10% (Stripe Connect) ----------------------
  ownerPaymentsOnboarding: () =>
    request<{ url: string; account_id: string }>('/owner/payments/onboarding', { method: 'POST' }),
  ownerPaymentsStatus: () =>
    request<{ configured: boolean; onboarded: boolean; charges_enabled: boolean; payouts_enabled?: boolean }>(
      '/owner/payments/status',
    ),
  ownerChargeDrink: (code: string, amount_cents: number) =>
    request<{ ok: boolean; order_id: string; checkout_url: string; amount_original: number; amount_discounted: number; platform_fee: number }>(
      '/owner/drinks/charge',
      { method: 'POST', body: JSON.stringify({ code, amount_cents }) },
    ),
  ownerDrinkOrder: (order_id: string) =>
    request<{ order_id: string; status: string; amount_discounted: number }>(`/owner/drinks/orders/${order_id}`),
  ownerDrinksSummary: () =>
    request<{ drinks_paid: number; revenue_cents: number; orders: any[] }>('/owner/drinks/summary'),

  // Abonnements (follow) -------------------------------------------
  toggleFollow: (userId: string) =>
    request<{ following: boolean; followers_count: number }>(`/users/${userId}/follow`, { method: 'POST' }),
  followInfo: (userId: string) =>
    request<{ following: boolean; followers_count: number; following_count: number }>(
      `/users/${userId}/follow-info`,
    ),


  // Club Moments (live-photo) ---------------------------------------
  uploadMoment: (clubId: string, image?: string, caption?: string, selfie?: string, audience?: 'public' | 'friends', video_media_id?: string) =>
    request<any>(`/clubs/${clubId}/moments`, {
      method: 'POST',
      body: JSON.stringify({
        image: image || null,
        caption: caption || null,
        selfie: selfie || null,
        audience: audience || 'public',
        video_media_id: video_media_id || null,
      }),
    }),
  // Instagram-style feed / stories / likes / comments
  momentsFeed: (limit = 30, clubId?: string, userId?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (clubId) q.set('club_id', clubId);
    if (userId) q.set('user_id', userId);
    return request<{ moments: FeedMoment[]; count: number }>(
      `/moments/feed?${q.toString()}`,
    );
  },
  momentsHighlights: () =>
    request<{ highlights: StoryHighlight[]; count: number }>('/moments/highlights'),
  likeMoment: (momentId: string) =>
    request<{ ok: boolean; likes_count: number; liked_by_me: boolean }>(
      `/moments/${momentId}/like`, { method: 'POST' },
    ),
  unlikeMoment: (momentId: string) =>
    request<{ ok: boolean; likes_count: number; liked_by_me: boolean }>(
      `/moments/${momentId}/like`, { method: 'DELETE' },
    ),
  momentComments: (momentId: string) =>
    request<{ comments: MomentComment[]; count: number }>(
      `/moments/${momentId}/comments`,
    ),
  addMomentComment: (momentId: string, text: string) =>
    request<MomentComment>(`/moments/${momentId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  deleteMomentComment: (momentId: string, commentId: string) =>
    request<{ ok: boolean }>(`/moments/${momentId}/comments/${commentId}`, {
      method: 'DELETE',
    }),
  listClubMoments: (clubId: string) =>
    request<any[]>(`/clubs/${clubId}/moments`),
  listMyMoments: () =>
    request<any[]>('/me/moments'),
  listActiveMomentClubs: () =>
    request<{ club_id: string; count: number; preview?: string | null }[]>(
      '/moments/active-clubs',
    ),
  momentWindowState: () =>
    request<{
      in_window: boolean;
      already_posted_here?: boolean;
      club_cooldown_hours_left?: number | null;
      club_name?: string | null;
      club_id?: string;
      expires_at?: string;
      seconds_left?: number;
    }>('/moments/window-state'),

  // ---- Apple compliance: block / report / delete / export ----
  checkImageModeration: (image: string) =>
    request<{ safe: boolean; nudity?: boolean; gore?: boolean; violence?: boolean; sexual_content?: boolean; hate_symbols?: boolean; reason?: string; fail_open?: boolean; latency_ms?: number }>(
      '/moderation/check-image',
      { method: 'POST', body: JSON.stringify({ image }) },
    ),
  blockUser: (target_user_id: string) =>
    request<{ ok: boolean }>('/blocks', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  unblockUser: (target_user_id: string) =>
    request<{ ok: boolean; removed: number }>(`/blocks/${target_user_id}`, {
      method: 'DELETE',
    }),
  listBlocks: () =>
    request<Array<{ user_id: string; name?: string; username?: string; photo?: string | null; blocked_at?: string }>>(
      '/blocks',
    ),
  reportUser: (target_user_id: string, reason: string, context?: string, details?: string) =>
    request<{ ok: boolean; report_id: string }>('/reports', {
      method: 'POST',
      body: JSON.stringify({ target_user_id, reason, context, details }),
    }),
  exportMyData: () => request<Record<string, any>>('/users/me/export'),
  deleteMyAccount: (confirm: 'DELETE', password?: string) =>
    request<{ ok: boolean; deleted_user_id: string }>('/users/me', {
      method: 'DELETE',
      body: JSON.stringify({ confirm, password }),
    }),
};
