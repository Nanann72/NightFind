/**
 * Partner bar helpers — pending code capture (deep link / signup field)
 * and coupon claim after authentication.
 */
import { Linking } from 'react-native';
import { storage } from './storage';
import { api } from './api';

const PENDING_KEY = 'nf_pending_partner_code';

export async function setPendingPartnerCode(code: string) {
  if (!code?.trim()) return;
  try { await storage.set(PENDING_KEY, code.trim().toUpperCase()); } catch {}
}

function extractCode(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?&](?:code|ref)=([A-Za-z0-9-]+)/);
  return m ? m[1].toUpperCase() : null;
}

/** Capture a partner code from the app launch URL (QR / deep link). */
export async function capturePartnerCodeFromUrl() {
  try {
    const initial = await Linking.getInitialURL();
    const code = extractCode(initial);
    if (code) await setPendingPartnerCode(code);
  } catch {}
}

/**
 * If a pending partner code exists, claim the -10% coupon.
 * Returns the coupon only when it was newly unlocked (to show the 🎉 modal).
 */
export async function claimPendingPartnerCode(): Promise<any | null> {
  try {
    const code = await storage.get(PENDING_KEY);
    if (!code) return null;
    const res = await api.claimPartner(code);
    await storage.remove(PENDING_KEY);
    return res?.new ? res.coupon : null;
  } catch (e: any) {
    // Invalid/inactive code → drop it so we don't retry forever
    if (e?.status === 400 || e?.status === 404) {
      try { await storage.remove(PENDING_KEY); } catch {}
    }
    return null;
  }
}
