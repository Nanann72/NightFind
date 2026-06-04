import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'nf_token';

export async function saveToken(token: string) {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken() {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

/** Generic K/V helper used for caches, cooldowns, prefs. */
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
      return;
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
      } catch {}
      return;
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
