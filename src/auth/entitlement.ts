/**
 * Native half of the entitlement reader — a stub, matching `auth.ts` and `firebase.ts`.
 *
 * Native has no accounts until 7-14, so there is no uid to read an entitlement for. Native
 * paid access runs through Play Billing and the local `isPurchased` flag, exactly as it does
 * on the live app today; nothing here changes that.
 *
 * Returns `null` rather than throwing, because "no entitlement document" is a legitimate
 * answer that callers already handle, and it keeps the free-tier path working on native
 * without a `Platform.OS` branch at the call site.
 */

export type EntitlementPlan = 'lifetime' | 'subscription';

export interface Entitlement {
  plan:       EntitlementPlan;
  since?:     number;
  source?:    string;
  expiresAt?: number;
}

export async function fetchEntitlement(_uid: string): Promise<Entitlement | null> {
  return null;
}
