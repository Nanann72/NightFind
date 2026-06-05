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
  if (!realModeAvailable) return;
  try {
    // Lazy import so web bundle never loads the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    Purchases = mod.default || mod;
    const apiKey = Platform.OS === 'ios' ? RC_IOS_KEY : RC_ANDROID_KEY;
    Purchases.configure({ apiKey });
  } catch (e) {
    // SDK not available (e.g. Expo Go) — fall back to dev mode
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
      const current = offerings?.current;
      if (current?.availablePackages?.length) {
        return current.availablePackages.map((p: any) => {
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
    } catch {
      // fallthrough
    }
  }
  // DEV mocked offerings — Mensuel 4,99 € + Annuel 79,99 €
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
  // DEV mode — simulate immediate success and persist
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
