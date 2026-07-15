/**
 * RevenueCat / Premium subscription wrapper.
 *
 * Phase 1: works in DEV mode (mocked) so we can build & test the UX in web
 * preview and Expo Go. The native RevenueCat SDK is loaded lazily on iOS /
 * Android only when API keys are provided via env vars.
 *
 * Phase 2: provide EXPO_PUBLIC_RC_IOS_KEY / EXPO_PUBLIC_RC_ANDROID_KEY in
 * `.env` to switch automatically to real RevenueCat purchases on device.
 */
import { Platform } from 'react-native';
import { storage } from './storage';

export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const PRODUCT_MONTHLY = 'nightfinder_premium_monthly';
export const PRODUCT_ANNUAL = 'nightfinder_premium_annual';

const RC_IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY || '';
const RC_ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY || '';

const DEV_PREMIUM_KEY = 'nf_dev_premium';

export type PremiumPackage = {
  identifier: string;
  productId: string;
  title: string;
  priceString: string;
  period: 'month' | 'year';
  badge?: string;
  savings?: string;
  rawPackage?: any; // RevenueCat PurchasesPackage when in real mode
};

export type CustomerInfoLite = {
  isPremium: boolean;
  expirationDate?: string | null;
  willRenew?: boolean | null;
  productIdentifier?: string | null;
  source: 'real' | 'dev';
};

let configured = false;
let realModeAvailable = false;
let Purchases: any = null;
let lastOfferingsError: string | null = null;

/** Detailed diagnostics logger — every StoreKit/RevenueCat step is traced
 *  with the [purchases] prefix so issues are identifiable in device logs
 *  (Xcode console / `npx expo run` / Sentry breadcrumbs). */
function plog(...args: any[]) {
  try {
    console.log('[purchases]', ...args);
  } catch {}
}

export function getLastOfferingsError(): string | null {
  return lastOfferingsError;
}

export function isRealMode(): boolean {
  return realModeAvailable;
}

function isRealRevenueCatConfigured(): boolean {
  if (Platform.OS === 'web') return false;
  const key = Platform.OS === 'ios' ? RC_IOS_KEY : Platform.OS === 'android' ? RC_ANDROID_KEY : '';
  if (!key) return false;
  // CRITICAL: RevenueCat's native SDK calls fatalError() if configured with a
  // Test Store key ("test_...") in a RELEASE build (Configuration.swift:533,
  // checkForSimulatedStoreAPIKeyInRelease) → instant crash on TestFlight/App Store.
  // In release builds, only accept real store keys (appl_ for iOS, goog_ for Android).
  if (!__DEV__) {
    const expectedPrefix = Platform.OS === 'ios' ? 'appl_' : 'goog_';
    if (!key.startsWith(expectedPrefix)) return false;
  }
  return true;
}

export async function configurePurchases(): Promise<void> {
  if (configured) return;
  configured = true;
  realModeAvailable = isRealRevenueCatConfigured();
  plog('configure: platform=', Platform.OS, 'realMode=', realModeAvailable,
    'keyPrefix=', (Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY).slice(0, 5) || '(none)');
  if (!realModeAvailable) return;
  try {
    // Lazy import so web bundle never loads the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    Purchases = mod.default || mod;
    try {
      // Verbose SDK logs to diagnose StoreKit issues during App Review / sandbox
      Purchases.setLogLevel(mod.LOG_LEVEL?.DEBUG ?? 'DEBUG');
    } catch {}
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
    Purchases.configure({ apiKey });
    plog('configure: RevenueCat SDK configured OK');
  } catch (e: any) {
    // SDK not available (e.g. Expo Go) — fall back to dev mode
    plog('configure: SDK load FAILED →', e?.message || e);
    realModeAvailable = false;
    Purchases = null;
  }
}

export async function identifyUser(userId: string): Promise<void> {
  if (!realModeAvailable || !Purchases) return;
  try {
    await Purchases.logIn(userId);
  } catch {
    // ignore
  }
}

export async function getCustomerInfo(): Promise<CustomerInfoLite> {
  if (realModeAvailable && Purchases) {
    try {
      const info = await Purchases.getCustomerInfo();
      const ent = info?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
      return {
        isPremium: !!ent,
        expirationDate: ent?.expirationDate || null,
        willRenew: ent?.willRenew ?? null,
        productIdentifier: ent?.productIdentifier || null,
        source: 'real',
      };
    } catch {
      // fallthrough to dev
    }
  }
  const stored = await storage.get(DEV_PREMIUM_KEY);
  return {
    isPremium: stored === '1',
    expirationDate: null,
    willRenew: null,
    productIdentifier: null,
    source: 'dev',
  };
}

export async function getOfferings(): Promise<PremiumPackage[]> {
  if (realModeAvailable && Purchases) {
    try {
      const offerings = await Purchases.getOfferings();
      plog('getOfferings: current=', offerings?.current?.identifier || null,
        'currentPackages=', offerings?.current?.availablePackages?.length ?? 0,
        'allOfferings=', Object.keys(offerings?.all || {}));
      // Try .current first, then any other offering with packages.
      const candidate =
        offerings?.current?.availablePackages?.length
          ? offerings.current
          : Object.values(offerings?.all || {}).find(
              (o: any) => o?.availablePackages?.length,
            );
      if ((candidate as any)?.availablePackages?.length) {
        lastOfferingsError = null;
        return (candidate as any).availablePackages.map((p: any) => {
          const id = String(p?.product?.identifier || '').toLowerCase();
          const isAnnual =
            id.includes('annual') || id.includes('yearly') || p.packageType === 'ANNUAL';
          return {
            identifier: p.identifier,
            productId: p.product.identifier,
            title: isAnnual ? 'Annuel' : 'Mensuel',
            priceString: p.product.priceString,
            period: isAnnual ? 'year' : 'month',
            badge: isAnnual ? 'MEILLEURE OFFRE' : undefined,
            savings: isAnnual ? 'Économise 33%' : undefined,
            rawPackage: p,
          } as PremiumPackage;
        });
      }
      // Real RC is up but no offerings found → tell the caller honestly,
      // do NOT return DEV mocks here (would cause a "fake price → fail"
      // experience when the user taps Continue).
      lastOfferingsError =
        'Les abonnements ne sont pas encore approuvés par Apple.\n\n' +
        '👉 Étapes à faire dans App Store Connect :\n' +
        '1) Créer une nouvelle version de l\'app.\n' +
        '2) Y attacher les abonnements Premium (Mensuel + Annuel).\n' +
        '3) Soumettre la version + les abonnements ensemble pour review.\n\n' +
        'Une fois approuvés (24–48h), les prix apparaîtront ici automatiquement.';
      if (typeof console !== 'undefined') {
        console.warn('[purchases]', lastOfferingsError);
      }
      return [];
    } catch (e: any) {
      lastOfferingsError = String(e?.message || e || 'RevenueCat error');
      if (typeof console !== 'undefined') {
        console.warn('[purchases] getOfferings error:', lastOfferingsError);
      }
      return [];
    }
  }
  // DEV mocked offerings — only when real RC is NOT configured
  return [
    {
      identifier: 'monthly',
      productId: PRODUCT_MONTHLY,
      title: 'Mensuel',
      priceString: '4,99 €',
      period: 'month',
    },
    {
      identifier: 'annual',
      productId: PRODUCT_ANNUAL,
      title: 'Annuel',
      priceString: '79,99 €',
      period: 'year',
      badge: 'MEILLEURE OFFRE',
      savings: 'Économise 33%',
    },
  ];
}

/**
 * Achat d'un produit consommable "mise en avant de bar" (promobar7d / promobar30d).
 * Déclenche la feuille de paiement native Apple. Nécessite un build natif
 * (indisponible en Expo Go / web preview).
 */
export async function purchasePromoProduct(productId: string): Promise<boolean> {
  plog('promoPurchase: start product=', productId, 'realMode=', realModeAvailable);
  if (!realModeAvailable || !Purchases) {
    throw new Error("Le paiement in-app nécessite l'application iOS (build natif).");
  }
  const products = await Purchases.getProducts([productId]);
  plog('promoPurchase: getProducts →', products?.length || 0);
  const product = products?.[0];
  if (!product) {
    throw new Error("Produit indisponible sur l'App Store. Réessaie dans un instant.");
  }
  await Purchases.purchaseStoreProduct(product);
  plog('promoPurchase: SUCCESS', productId);
  return true;
}

export async function purchasePackage(pkg: PremiumPackage): Promise<CustomerInfoLite> {
  plog('purchase: start product=', pkg.productId, 'pkg=', pkg.identifier,
    'realMode=', realModeAvailable, 'hasRawPackage=', !!pkg.rawPackage);
  if (realModeAvailable && Purchases && pkg.rawPackage) {
    // ✅ Real RevenueCat purchase — triggers the native Apple/Google payment sheet.
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg.rawPackage);
      const ent = customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
      plog('purchase: SUCCESS entitlementActive=', !!ent,
        'product=', ent?.productIdentifier || null,
        'expires=', ent?.expirationDate || null);
      return {
        isPremium: !!ent,
        expirationDate: ent?.expirationDate || null,
        willRenew: ent?.willRenew ?? null,
        productIdentifier: ent?.productIdentifier || null,
        source: 'real',
      };
    } catch (e: any) {
      plog('purchase: FAILED code=', e?.code, 'message=', e?.message,
        'userCancelled=', e?.userCancelled,
        'underlyingError=', e?.underlyingErrorMessage || e?.userInfo?.NSUnderlyingError || null);
      throw e;
    }
  }
  // PRODUCTION SAFETY: if real RC is configured but no rawPackage was attached
  // (i.e. RevenueCat dashboard has no Offering / no products mapped), refuse
  // the purchase rather than silently granting Premium for free.
  if (realModeAvailable && !pkg.rawPackage) {
    throw new Error(
      "L'abonnement Premium n'est pas disponible actuellement. " +
        "Veuillez réessayer dans quelques instants.",
    );
  }
  // 🚨 CRITICAL: In any RELEASE / PRODUCTION build (TestFlight, App Store, Play
  // Store), NEVER fall back to a silent "DEV grant". This was the root cause of
  // the "pay automatically without payment sheet" bug: when the native
  // RevenueCat SDK failed to load (or returned no offerings), the code below
  // would mark the user as Premium for free without ever showing the Apple/Play
  // payment sheet. We now refuse the purchase loudly so the user knows
  // something is wrong and we never give Premium away for free.
  if (!__DEV__) {
    throw new Error(
      "Le paiement n'est pas disponible. " +
        "Vérifie ta connexion ou réessaie dans quelques instants.",
    );
  }
  // DEV mode (Expo Go / web preview / __DEV__ builds only) — simulate immediate
  // success and persist locally so we can test the UX without StoreKit.
  await storage.set(DEV_PREMIUM_KEY, '1');
  return {
    isPremium: true,
    expirationDate: null,
    willRenew: true,
    productIdentifier: pkg.productId,
    source: 'dev',
  };
}

export async function restorePurchases(): Promise<CustomerInfoLite> {
  plog('restore: start realMode=', realModeAvailable);
  if (realModeAvailable && Purchases) {
    try {
      const info = await Purchases.restorePurchases();
      const ent = info?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
      plog('restore: done entitlementActive=', !!ent, 'product=', ent?.productIdentifier || null);
      return {
        isPremium: !!ent,
        expirationDate: ent?.expirationDate || null,
        willRenew: ent?.willRenew ?? null,
        productIdentifier: ent?.productIdentifier || null,
        source: 'real',
      };
    } catch (e: any) {
      plog('restore: FAILED code=', e?.code, 'message=', e?.message);
      // fallthrough
    }
  }
  return getCustomerInfo();
}

/** DEV-only helper to cancel premium so we can re-test the paywall. */
export async function devResetPremium(): Promise<void> {
  await storage.remove(DEV_PREMIUM_KEY);
}

export function isInDevMode(): boolean {
  return !realModeAvailable;
}
