import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'nf_onboarding';

export type OnboardingData = {
  name?: string;
  goal?: string;
  music?: string[];
  frequency?: string;
  vibes?: string[];
  // Swipe profile preview (collected during onboarding, persisted to account on signup)
  photos?: string[]; // base64 data URIs, max 3
  dob?: string; // YYYY-MM-DD
  bio?: string;
  city?: string;
  instagram?: string;
  done?: boolean;
};

export async function saveOnboarding(data: OnboardingData) {
  const v = JSON.stringify(data);
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(KEY, v);
    } catch {}
  } else {
    await SecureStore.setItemAsync(KEY, v);
  }
}

export async function loadOnboarding(): Promise<OnboardingData> {
  try {
    let v: string | null = null;
    if (Platform.OS === 'web') {
      v = window.localStorage.getItem(KEY);
    } else {
      v = await SecureStore.getItemAsync(KEY);
    }
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

export async function clearOnboarding() {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.removeItem(KEY);
    } catch {}
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}
