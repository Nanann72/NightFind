import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
// expo-linking import removed — was unused and could fail autolinking on EAS builds.
import { api, User } from './api';
import { clearToken, getToken, saveToken } from './storage';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '';
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, dob: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) {
        setUser(null);
        return;
      }
      const me = await api.me();
      setUser(me);
      // Best-effort push registration on every authenticated session
      try {
        const { registerForPush } = await import('./push');
        registerForPush(me.user_id).catch(() => {});
      } catch {}
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  const processWebSessionId = useCallback(async () => {
    if (Platform.OS !== 'web') return false;
    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const params = new URLSearchParams(
        hash.startsWith('#') ? hash.slice(1) : search.startsWith('?') ? search.slice(1) : '',
      );
      const sid = params.get('session_id');
      if (!sid) return false;
      const res = await api.googleSession(sid);
      await saveToken(res.token);
      setUser(res.user);
      window.history.replaceState(null, '', window.location.pathname);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const handled = await processWebSessionId();
      if (!handled) await refresh();
      setLoading(false);
    })();
  }, [processWebSessionId, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    await saveToken(res.token);
    setUser(res.user);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, name: string, dob: string) => {
      const res = await api.register(email, password, name, dob);
      await saveToken(res.token);
      setUser(res.user);
    },
    [],
  );

  // ---- Google OAuth (classic) ----
  // expo-auth-session hook — provides request + promptAsync. Switches automatically
  // between native (iOS bundle ID) and web (Web Client ID) based on platform.
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    scopes: ['profile', 'email', 'openid'],
  });

  // Watch Google response — when user completes login, exchange the
  // access_token for a Night Finder JWT via /api/auth/google.
  useEffect(() => {
    (async () => {
      if (!googleResponse) return;
      if (googleResponse.type !== 'success') return;
      const accessToken =
        (googleResponse as any).authentication?.accessToken ||
        (googleResponse as any).params?.access_token;
      if (!accessToken) return;
      try {
        const res = await api.googleOAuth(accessToken);
        await saveToken(res.token);
        setUser(res.user);
      } catch {
        // ignore — caller already shows an error
      }
    })();
  }, [googleResponse]);

  const signInWithGoogle = useCallback(async () => {
    if (!GOOGLE_IOS_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID) {
      throw new Error('Google Sign-In non configuré');
    }
    if (!googleRequest) {
      throw new Error('Google Sign-In non prêt — réessaye dans une seconde');
    }
    const result = await googlePromptAsync();
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Connexion annulée');
    }
    if (result.type !== 'success') {
      throw new Error('Connexion Google échouée');
    }
    // The useEffect above will pick up googleResponse and finalize sign-in.
  }, [googleRequest, googlePromptAsync]);

  const signInWithApple = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign In disponible uniquement sur iOS');
    }
    const AppleAuthentication = await import('expo-apple-authentication');
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple Sign In échoué');
    const fullName = credential.fullName
      ? [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' ')
      : undefined;
    const res = await api.appleSignIn(
      credential.identityToken,
      credential.email || undefined,
      fullName,
    );
    await saveToken(res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, signInWithGoogle, signInWithApple, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
