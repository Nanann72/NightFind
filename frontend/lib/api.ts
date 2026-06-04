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
  register: (email: string, password: string, name: string) =>
    request<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
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

  // Check-ins
  checkIn: (club_id: string, confirmed: boolean) =>
    request<{ ok: boolean; checkin_id: string; confirmed: boolean }>('/checkins', {
      method: 'POST',
      body: JSON.stringify({ club_id, confirmed }),
    }),
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

  // Notifications
  listNotifications: () => request<any[]>('/notifications'),
};
