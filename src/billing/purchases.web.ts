/**
 * The RevenueCat SDK's lifecycle, owned in one place (8-4).
 *
 * **Why this is not inside `useIAP.web.ts`.** That hook mounts on the paywall and nowhere else,
 * so anything it learns — the offering, the customer's portal link — exists only while that one
 * screen is open. `/profile` needs the portal link and never renders the paywall, which is
 * exactly how its Manage row ended up permanently absent while the configuration behind it was
 * perfectly correct.
 *
 * So configuration follows the *account*, not a screen, in the same shape as
 * `startAuthListener` and `startEntitlementListener`: one subscription started from the root
 * layout, writing plain state that every screen reads synchronously.
 */

import { Purchases } from '@revenuecat/purchases-js';

import { useAuthStore } from '@/auth/useAuthStore';
import { useEntitlementStore } from '@/store/useEntitlementStore';

/**
 * The publishable SDK key for the Stripe config in RevenueCat.
 *
 * Public by design — it reads offerings and starts a purchase for an already-identified user,
 * and nothing else. Sandbox until 8c connects the live Stripe account.
 */
const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_WEB_KEY ?? '';

/**
 * Configure the SDK for `uid`, or re-point it if someone else was signed in.
 *
 * **Never anonymous.** An anonymous purchase produces an entitlement belonging to
 * `$RCAnonymousID:…`, an identity no webhook can attach to an account — the reconciliation
 * problem Phase 8 exists to end, recreated on the one path that could. Returns `null` when
 * there is no key or no uid, so callers degrade to "nothing to sell" rather than throwing.
 */
export async function ensureConfigured(uid: string | null): Promise<Purchases | null> {
  if (!API_KEY || !uid) return null;

  if (!Purchases.isConfigured()) {
    Purchases.configure({ apiKey: API_KEY, appUserId: uid });
    return Purchases.getSharedInstance();
  }

  const instance = Purchases.getSharedInstance();

  // Sign out, sign in as someone else — a real sequence on a shared browser. Without this the
  // second person's purchase is recorded against the first person's uid.
  if (instance.getAppUserId() !== uid) await instance.changeUser(uid);

  return instance;
}

/**
 * Re-read what this customer holds, and store the portal link.
 *
 * `managementURL` is null for a customer with no active subscription — the lifetime buyer, or
 * anyone whose access came from a hand grant (8-7) — and `/profile` renders no Manage row in
 * that case rather than a link to a page that does not exist.
 */
export async function refreshCustomerInfo(uid: string | null): Promise<void> {
  const purchases = await ensureConfigured(uid);
  if (!purchases) return;

  try {
    const info = await purchases.getCustomerInfo();
    useEntitlementStore.getState().setManagementUrl(info.managementURL);

    if (__DEV__) {
      console.info('[iap] customerInfo', {
        managementURL: info.managementURL,
        active:        Object.keys(info.entitlements.active),
        subscriptions: [...info.activeSubscriptions],
      });
    }
  } catch (err) {
    // Never fatal: the portal link is an affordance, not access. Access comes from the
    // entitlement store, which has its own source of truth in Firestore.
    console.warn('[iap] could not read customer info —', err);
  }
}

/**
 * Start following the signed-in account. Called once from the root layout.
 *
 * Sign-out clears the link along with the rest of the entitlement state — `clear()` owns that,
 * so a shared browser cannot offer one person's billing page to the next.
 */
export function startPurchasesListener(): () => void {
  if (!API_KEY) return () => {};

  let lastUid: string | null | undefined;

  const apply = (uid: string | null) => {
    if (uid === lastUid) return;
    lastUid = uid;
    if (uid) void refreshCustomerInfo(uid);
  };

  apply(useAuthStore.getState().user?.uid ?? null);

  return useAuthStore.subscribe((state) => apply(state.user?.uid ?? null));
}
