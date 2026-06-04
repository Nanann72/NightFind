import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { api, User } from './api';
import { clearToken, getToken, saveToken } from './storage';

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
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
    async (email: string, password: string, name: string) => {
      const res = await api.register(email, password, name);
      await saveToken(res.token);
      setUser(res.user);
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === 'web') {
      const redirect = window.location.origin + '/';
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL('auth');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
    if (result.type !== 'success' || !result.url) return;
    const parsed = Linking.parse(result.url);
    // session_id can come as hash or query
    let sid: string | undefined;
    if (parsed.queryParams?.session_id) {
      sid = String(parsed.queryParams.session_id);
    } else {
      // try parsing fragment
      const idx = result.url.indexOf('session_id=');
      if (idx >= 0) {
        sid = result.url.substring(idx + 'session_id='.length).split('&')[0];
      }
    }
    if (!sid) return;
    const res = await api.googleSession(sid);
    await saveToken(res.token);
    setUser(res.user);
  }, []);

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
