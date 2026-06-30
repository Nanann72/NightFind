/**
 * Night Finder — i18n setup.
 *
 * Strategy:
 *  • Default language: French (the app was authored in FR).
 *  • At first launch, we auto-detect the device locale via expo-localization
 *    and snap to the closest supported language. The user can override this
 *    from Settings → Apparence → Langue.
 *  • Preference is persisted via SecureStore so it survives reinstalls of
 *    the dev build but is wiped on app uninstall (privacy-by-default).
 *  • Arabic is supported with RTL layout — when AR is active we toggle
 *    I18nManager.forceRTL so flexbox flips horizontally.
 */
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { I18nManager, Platform } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { storage } from './storage';

import fr from './i18n/fr';
import en from './i18n/en';
import es from './i18n/es';
import de from './i18n/de';
import it from './i18n/it';
import pt from './i18n/pt';
import ar from './i18n/ar';

export const SUPPORTED_LANGS = [
  { code: 'fr', label: 'Français', flag: '🇫🇷', native: 'Français' },
  { code: 'en', label: 'English', flag: '🇬🇧', native: 'English' },
  { code: 'es', label: 'Español', flag: '🇪🇸', native: 'Español' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪', native: 'Deutsch' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹', native: 'Italiano' },
  { code: 'pt', label: 'Português', flag: '🇵🇹', native: 'Português' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦', native: 'العربية' },
] as const;

export type LangCode = (typeof SUPPORTED_LANGS)[number]['code'];

const STORAGE_KEY = 'nf_lang';
const RTL_LANGS: LangCode[] = ['ar'];

export const i18n = new I18n({ fr, en, es, de, it, pt, ar });
i18n.enableFallback = true;
i18n.defaultLocale = 'fr';
i18n.locale = 'fr';

let listeners: Array<(lang: LangCode) => void> = [];

function detectFromDevice(): LangCode {
  try {
    const locales = Localization.getLocales();
    for (const loc of locales) {
      const code = (loc.languageCode || '').toLowerCase();
      if (SUPPORTED_LANGS.some((s) => s.code === code)) {
        return code as LangCode;
      }
    }
  } catch {}
  return 'fr';
}

export async function initI18n(): Promise<LangCode> {
  let chosen: LangCode = 'fr';
  try {
    const saved = await storage.get(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.some((s) => s.code === saved)) {
      chosen = saved as LangCode;
    } else {
      chosen = detectFromDevice();
      try { await storage.set(STORAGE_KEY, chosen); } catch {}
    }
  } catch {
    chosen = detectFromDevice();
  }
  // On first init we ONLY set the locale and (carefully) the RTL state
  // without ever calling forceRTL — that API requires a full app reload
  // and crashes if called during the initial mount cycle. RTL toggling
  // only happens when the user explicitly changes language afterwards.
  try {
    i18n.locale = chosen;
  } catch {}
  return chosen;
}

function applyLocale(code: LangCode) {
  try {
    i18n.locale = code;
  } catch {}
  // Toggle RTL only on native AND only when called from a user-driven
  // language change (not init). Wrapped in try/catch since forceRTL can
  // throw if called from an unsafe context.
  if (Platform.OS !== 'web') {
    const wantsRTL = RTL_LANGS.includes(code);
    try {
      I18nManager.allowRTL(wantsRTL);
      if (wantsRTL !== I18nManager.isRTL) {
        I18nManager.forceRTL(wantsRTL);
      }
    } catch {}
  }
  listeners.forEach((cb) => {
    try { cb(code); } catch {}
  });
}

export async function setLanguage(code: LangCode) {
  await storage.set(STORAGE_KEY, code);
  applyLocale(code);
}

/** React hook returning `t` and the active language. */
export function useTranslation() {
  const [lang, setLang] = useState<LangCode>((i18n.locale as LangCode) || 'fr');
  useEffect(() => {
    const cb = (code: LangCode) => setLang(code);
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  }, []);
  const t = useCallback(
    (key: string, opts?: Record<string, any>) => i18n.t(key, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  );
  return { t, lang, setLang: setLanguage };
}

export function isRTL(): boolean {
  return RTL_LANGS.includes((i18n.locale as LangCode) || 'fr');
}
