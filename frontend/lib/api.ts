import { getToken } from './storage';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

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
  events?: NFEvent[];
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
  is_premium?: boolean;
  premium_expires_at?: string | null;
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
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.detail || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    const err: any = new Error(detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  register: (email: string, password: string, name: string, dob: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, dob }),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
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
    request<{ ok: boolean; already_swiped?: boolean }>('/swipe/like', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  swipePass: (target_user_id: string) =>
    request<{ ok: boolean; already_swiped?: boolean }>('/swipe/pass', {
      method: 'POST',
      body: JSON.stringify({ target_user_id }),
    }),
  updateSwipeFields: (body: {
    dob?: string;
    bio?: string;
    city?: string;
    instagram?: string;
    photos?: string[];
    fav_clubs?: string[];
  }) =>
    request<{ ok: boolean; updated: string[] }>('/profile/swipe-fields', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Match requests + chat
  listMatchRequests: () => request<any[]>('/match-requests'),
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
  sendMessage: (match_id: string, text: string) =>
    request<any>(`/matches/${match_id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
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
          // BeReal-style 5min capture window — open camera screen
          try {
            const { router } = await import('expo-router');
            // Best-effort navigation; if no router available, the user can
            // also access it from the map via the "moments" badge.
            (router as any)?.push?.({
              pathname: '/bereal-capture',
              params: { clubId: club_id, clubName: club?.name || '' },
            });
          } catch {
            // silently ignore — bereal is optional
          }
        } catch {
          // Live listening + bereal are best-effort.
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

  // Push notifications
  registerPush: (body: { user_id: string; platform: 'ios' | 'android'; device_token: string }) =>
    request<{ status: string; upstream_ok: boolean }>('/register-push', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Audd.io audio recognition
  recognizeAudio: (club_id: string, audio_base64: string) =>
    request<{ ok: boolean; recognised: boolean; song_id?: string; title?: string; artist?: string }>(
      '/recognize/audio',
      {
        method: 'POST',
        body: JSON.stringify({ club_id, audio_base64 }),
      },
    ),

  // Notifications
  listNotifications: () => request<any[]>('/notifications'),

  // Club Moments (BeReal-style) ---------------------------------------
  uploadMoment: (clubId: string, image: string, caption?: string) =>
    request<any>(`/clubs/${clubId}/moments`, {
      method: 'POST',
      body: JSON.stringify({ image, caption: caption || null }),
    }),
  listClubMoments: (clubId: string) =>
    request<any[]>(`/clubs/${clubId}/moments`),
  listActiveMomentClubs: () =>
    request<{ club_id: string; count: number; preview?: string | null }[]>(
      '/moments/active-clubs',
    ),
  momentWindowState: () =>
    request<{
      in_window: boolean;
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
