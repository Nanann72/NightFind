import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth';
import {
  CustomerInfoLite,
  configurePurchases,
  devResetPremium,
  getCustomerInfo,
  getOfferings,
  identifyUser,
  isInDevMode,
  purchasePackage,
  PremiumPackage,
  restorePurchases,
} from './purchases';

type Ctx = {
  isPremium: boolean;
  loading: boolean;
  customerInfo: CustomerInfoLite | null;
  offerings: PremiumPackage[];
  refreshOfferings: () => Promise<void>;
  buy: (pkg: PremiumPackage) => Promise<CustomerInfoLite>;
  restore: () => Promise<CustomerInfoLite>;
  devReset: () => Promise<void>;
  devMode: boolean;
};

const PremiumCtx = createContext<Ctx | undefined>(undefined);

export const PremiumProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfoLite | null>(null);
  const [offerings, setOfferings] = useState<PremiumPackage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await configurePurchases();
      const [info, offers] = await Promise.all([getCustomerInfo(), getOfferings()]);
      setCustomerInfo(info);
      setIsPremium(info.isPremium);
      setOfferings(offers);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    identifyUser(user.user_id).then(async () => {
      const info = await getCustomerInfo();
      setCustomerInfo(info);
      setIsPremium(info.isPremium);
    });
  }, [user?.user_id]);

  const refreshOfferings = useCallback(async () => {
    const offers = await getOfferings();
    setOfferings(offers);
  }, []);

  const buy = useCallback(async (pkg: PremiumPackage) => {
    const info = await purchasePackage(pkg);
    setCustomerInfo(info);
    setIsPremium(info.isPremium);
    return info;
  }, []);

  const restore = useCallback(async () => {
    const info = await restorePurchases();
    setCustomerInfo(info);
    setIsPremium(info.isPremium);
    return info;
  }, []);

  const devReset = useCallback(async () => {
    await devResetPremium();
    const info = await getCustomerInfo();
    setCustomerInfo(info);
    setIsPremium(info.isPremium);
  }, []);

  return (
    <PremiumCtx.Provider
      value={{
        isPremium,
        loading,
        customerInfo,
        offerings,
        refreshOfferings,
        buy,
        restore,
        devReset,
        devMode: isInDevMode(),
      }}
    >
      {children}
    </PremiumCtx.Provider>
  );
};

export function usePremium(): Ctx {
  const ctx = useContext(PremiumCtx);
  if (!ctx) throw new Error('usePremium must be used inside PremiumProvider');
  return ctx;
}
