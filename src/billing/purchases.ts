/**
 * Native half of the RevenueCat Web SDK's lifecycle — a stub, matching `auth/firebase.ts` and
 * `auth/entitlement.ts`.
 *
 * Android sells its one-time unlock through `react-native-iap` and Play Billing (8-1's "web
 * only" decision), so there is no RevenueCat SDK to configure here and no customer portal to
 * link to — Play owns subscription management on that platform.
 *
 * The `Purchases` type is imported for the signature only — TypeScript resolves this file, not
 * the `.web` one, so the return type here is what every caller is checked against. The value is
 * always `null`, which is the branch those callers already handle.
 */

import type { Purchases } from '@revenuecat/purchases-js';

export async function ensureConfigured(_uid: string | null): Promise<Purchases | null> {
  return null;
}

export async function refreshCustomerInfo(_uid: string | null): Promise<void> {
  /* no-op on native */
}

export function startPurchasesListener(): () => void {
  return () => {};
}
