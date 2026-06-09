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

function isRealRevenueCatConfigured(): boolean {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'ios') return !!RC_IOS_KEY;
  if (Platform.OS === 'android') return !!RC_ANDROID_KEY;
  return false;
}

export async function configurePurchases(): Promise<void> {
  if (configured) return;
  configured = true;
  realModeAvailable = isRealRevenueCatConfigured();
  // Debug logging — to help diagnose paywall/offering issues on TestFlight.
  // Prints which key family is baked into the build (test_ vs appl_) without
  // leaking the full secret.
  const debugKey =
    Platform.OS === 'ios'
      ? RC_IOS_KEY
      : Platform.OS === 'android'
        ? RC_ANDROID_KEY
        : '';
  const debugKeyPrefix = debugKey ? debugKey.slice(0, 6) + '…' : '(empty)';
  console.log(
    `[purchases] configure platform=${Platform.OS} realMode=${realModeAvailable} keyPrefix=${debugKeyPrefix}`,
  );
  if (!realModeAvailable) return;
  try {
    // Lazy import so web bundle never loads the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    Purchases = mod.default || mod;
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
    // Enable verbose RevenueCat logs in development/TestFlight so we can see
    // exactly why Offerings come back empty.
    try {
      const LogLevel = mod.LOG_LEVEL || mod.LogLevel;
      if (LogLevel && Purchases.setLogLevel) {
        Purchases.setLogLevel(LogLevel.DEBUG || LogLevel.debug || 'DEBUG');
      }
    } catch {
      // ignore
    }
    Purchases.configure({ apiKey });
    console.log('[purchases] Purchases.configure() OK');
  } catch (e: any) {
    console.warn('[purchases] configure failed:', String(e?.message || e));
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
      // Try .current first, then any other offering with packages.
      const candidate =
        offerings?.current?.availablePackages?.length
          ? offerings.current
          : Object.values(offerings?.all || {}).find(
              (o: any) => o?.availablePackages?.length,
            );
      if ((candidate as any)?.availablePackages?.length) {
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
      if (typeof console !== 'undefined') {
        console.warn(
          '[purchases] No offerings configured on RevenueCat dashboard. ' +
            'Check that the Offering is marked "Current" and that products ' +
            'are linked to App Store / Play Store.',
        );
      }
      return [];
    } catch (e: any) {
      if (typeof console !== 'undefined') {
        console.warn('[purchases] getOfferings error:', String(e?.message || e));
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

export async function purchasePackage(pkg: PremiumPackage): Promise<CustomerInfoLite> {
  if (realModeAvailable && Purchases && pkg.rawPackage) {
    const { customerInfo } = await Purchases.purchasePackage(pkg.rawPackage);
    const ent = customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
    return {
      isPremium: !!ent,
      expirationDate: ent?.expirationDate || null,
      willRenew: ent?.willRenew ?? null,
      productIdentifier: ent?.productIdentifier || null,
      source: 'real',
    };
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
  // DEV mode (Expo Go / web preview) — simulate immediate success and persist
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
  if (realModeAvailable && Purchases) {
    try {
      const info = await Purchases.restorePurchases();
      const ent = info?.entitlements?.active?.[PREMIUM_ENTITLEMENT_ID];
      return {
        isPremium: !!ent,
        expirationDate: ent?.expirationDate || null,
        willRenew: ent?.willRenew ?? null,
        productIdentifier: ent?.productIdentifier || null,
        source: 'real',
      };
    } catch {
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
