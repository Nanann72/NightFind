import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { Appearance, useColorScheme, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, ThemeColors } from './theme';

type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedScheme: 'dark' | 'light';
  colors: ThemeColors;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = '@nf_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('dark');

  // Load persisted preference on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'system' || stored === 'dark' || stored === 'light') {
          setModeState(stored);
        }
      } catch {}
    })();
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  };

  const toggle = () => {
    const next: ThemeMode = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
    setMode(next);
  };

  const resolvedScheme: 'dark' | 'light' = useMemo(() => {
    if (mode === 'system') return (systemScheme ?? 'dark') as 'dark' | 'light';
    return mode;
  }, [mode, systemScheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    resolvedScheme,
    colors: resolvedScheme === 'dark' ? darkColors : lightColors,
    setMode,
    toggle,
  }), [mode, resolvedScheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback: dark theme if used outside provider (e.g. tests)
    return {
      mode: 'dark',
      resolvedScheme: 'dark',
      colors: darkColors,
      setMode: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}

export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}
