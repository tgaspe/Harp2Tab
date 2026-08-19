/**
 * Web purchases through RevenueCat, with Stripe as the merchant of record (8-4).
 *
 * Native's `useIAP.ts` is untouched and still owns Play Billing's one-time SKU — see 8-1's
 * "web only" decision. This file is the same hook shape for the web bundle, plus the two
 * things only web has: a plan to choose, and prices that come from the store rather than from
 * a constant.
 *
 * **The SDK is configured with the Firebase uid and never anonymously.** An anonymous purchase
 * produces an entitlement belonging to `$RCAnonymousID:…`, which is an identity no webhook can
 * attach to an account — exactly the reconciliation problem Phase 8 exists to end, recreated
 * on the one code path that could. `configureFor` below refuses to run without a uid, and the
 * paywall already blocks purchase until the user is signed in *and* verified (7-4).
 *
 * **The purchase result is the truth for the seconds before the webhook lands.** RevenueCat
 * returns `CustomerInfo` synchronously; the entitlement document at `/entitlements/{uid}`
 * arrives a moment later, written by `revenuecatWebhook`. Making a customer who has just paid
 * watch a spinner until Firestore catches up is the worst possible moment to be pessimistic,
 * so the store is updated from the SDK's answer immediately (`applyLocal`) and the webhook's
 * document simply confirms it.
 *
 * **`setPurchased()` is deliberately not called here.** That flag is the device-local Play
 * unlock and a one-way latch; web access is revocable and lives in the entitlement store.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ErrorCode,
  PurchasesError,
  type CustomerInfo,
  type Offering,
  type Package,
} from '@revenuecat/purchases-js';

import { ensureConfigured } from '@/billing/purchases';

import { useAuthStore } from '@/auth/useAuthStore';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { MOCK_WEB_PLANS, type WebPlan, type WebPlanId } from '@/billing/plans';
import type { Entitlement } from '@/auth/entitlement';

/** Kept for shape parity with native, which uses it as the Play SKU id. Unused on web. */
export const PRODUCT_SKU = 'harp2tab_premium';

/**
 * The entitlement identifier, which must equal `PREMIUM_ENTITLEMENT_ID` in
 * `functions/src/revenuecat.ts`. Both sides read the same string RevenueCat sends: the client
 * to unlock optimistically, the webhook to decide whether an event is even about us.
 */
const PREMIUM_ENTITLEMENT_ID = 'premium';

/** Our three plans, in the order RevenueCat's package accessors expose them. */
const PACKAGE_BY_PLAN: Record<WebPlanId, (offering: Offering) => Package | null> = {
  monthly:  (o) => o.monthly,
  yearly:   (o) => o.annual,
  lifetime: (o) => o.lifetime,
};

interface IAPState {
  product:    null;
  purchasing: boolean;
  restoring:  boolean;
  error:      string | null;
  purchased:  boolean;
}

/**
 * Turn RevenueCat's `CustomerInfo` into the document shape the rest of the app reads.
 *
 * Deliberately the same shape `entitlement.web.ts` reads out of Firestore, so the optimistic
 * value and the webhook's value are indistinguishable to every consumer. `null` means the SDK
 * says this customer holds nothing — a real answer, not a failure.
 */
function toEntitlement(info: CustomerInfo): Entitlement | null {
  const active = info.entitlements.active[PREMIUM_ENTITLEMENT_ID];
  if (!active) return null;

  return {
    // No expiry is what a one-time purchase looks like here. The webhook applies the stricter
    // test (`isLifetimeGrant`) because it is writing durable state from someone else's
    // payload; this value is replaced by that document within seconds either way.
    plan:      active.expirationDate ? 'subscription' : 'lifetime',
    since:     active.originalPurchaseDate?.getTime(),
    source:    'stripe',
    productId: active.productIdentifier,
    expiresAt: active.expirationDate?.getTime(),
  };
}

/** Error copy per failure mode. Anything unrecognised keeps the SDK's own message. */
function messageFor(err: unknown): string | null {
  if (!(err instanceof PurchasesError)) {
    return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  }

  switch (err.errorCode) {
    // Closing the checkout window is not an error the user needs told about — they did it.
    case ErrorCode.UserCancelledError:
      return null;
    case ErrorCode.NetworkError:
      return 'Network problem — your card was not charged. Please try again.';
    case ErrorCode.ProductAlreadyPurchasedError:
      return 'You already own this. Press Restore to bring it back.';
    case ErrorCode.PaymentPendingError:
      return 'Your payment is still processing. Access unlocks as soon as it clears.';
    case ErrorCode.ProductNotAvailableForPurchaseError:
      return 'That plan is unavailable right now. Please try another or come back later.';
    default:
      return err.message || 'The purchase could not be completed.';
  }
}

export function useIAP() {
  const uid   = useAuthStore((s) => s.user?.uid ?? null);
  const email = useAuthStore((s) => s.user?.email ?? null);
  const applyLocal = useEntitlementStore((s) => s.applyLocal);
  const setManagementUrl = useEntitlementStore((s) => s.setManagementUrl);

  const [state, setState] = useState<IAPState>({
    product:    null,
    purchasing: false,
    restoring:  false,
    error:      null,
    purchased:  false,
  });

  /** Prices as the store reports them — formatted and localised there, never formatted here. */
  const [prices, setPrices] = useState<Partial<Record<WebPlanId, string>>>({});
  const offeringRef = useRef<Offering | null>(null);

  /**
   * Configure, or re-point an already-configured SDK at whoever is signed in now.
   *
   * `configure` throws if called twice, and sign-out → sign-in as someone else is a real
   * sequence on a shared browser, so identity changes go through `changeUser`. Without it the
   * second person's purchase would be recorded against the first person's uid.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Configuration and the customer-portal link belong to `purchases.web.ts`, which
        // follows the account rather than this screen. All this hook needs is the offering.
        const purchases = await ensureConfigured(uid);
        if (!purchases || cancelled) return;

        const offerings = await purchases.getOfferings();
        const current   = offerings.current;
        if (cancelled || !current) return;

        offeringRef.current = current;
        setPrices({
          monthly:  current.monthly?.webBillingProduct.currentPrice.formattedPrice,
          yearly:   current.annual?.webBillingProduct.currentPrice.formattedPrice,
          lifetime: current.lifetime?.webBillingProduct.currentPrice.formattedPrice,
        });
      } catch (err) {
        // A failed offering fetch must not block the paywall: it falls back to the copy's own
        // prices, which are the same numbers configured in Stripe. Loud in the console because
        // a silent divergence between the two is exactly what nobody notices.
        console.warn('[iap] could not load offerings —', err);
      }
    })();

    return () => { cancelled = true; };
  }, [uid]);

  const buy = useCallback(async (planId: WebPlanId) => {
    const offering = offeringRef.current;
    const rcPackage = offering ? PACKAGE_BY_PLAN[planId](offering) : null;

    if (!uid || !rcPackage) {
      setState((s) => ({ ...s, error: 'That plan is unavailable right now. Please try again.' }));
      return;
    }

    setState((s) => ({ ...s, purchasing: true, error: null }));
    try {
      // `customerEmail` skips RevenueCat asking for an address it already has — and the one it
      // would ask for could differ from the verified account address, which is the address the
      // entitlement actually belongs to.
      // Configured through the shared module rather than assumed: `buy` can be pressed on a
      // cold load of `/paywall` before any other effect has run.
      const purchases = await ensureConfigured(uid);
      if (!purchases) {
        setState((s) => ({ ...s, purchasing: false, error: 'Purchases are unavailable right now.' }));
        return;
      }

      const result = await purchases.purchase({
        rcPackage,
        customerEmail: email ?? undefined,
      });

      applyLocal(uid, toEntitlement(result.customerInfo));
      setManagementUrl(result.customerInfo.managementURL);
      setState((s) => ({ ...s, purchasing: false, purchased: true, error: null }));
    } catch (err) {
      setState((s) => ({ ...s, purchasing: false, error: messageFor(err) }));
    }
  }, [uid, email, applyLocal, setManagementUrl]);

  /**
   * "Restore" means something different here than on native.
   *
   * Play's version re-reads the device's purchase history. There is no such thing in a
   * browser: the purchase belongs to the account, so restoring is asking RevenueCat what this
   * account currently holds. It is also the button that collects a manual grant (8-7).
   */
  const restore = useCallback(async () => {
    if (!uid) return false;

    setState((s) => ({ ...s, restoring: true, error: null }));
    try {
      const purchases = await ensureConfigured(uid);
      if (!purchases) {
        setState((s) => ({ ...s, restoring: false, error: 'Purchases are unavailable right now.' }));
        return false;
      }

      const info = await purchases.getCustomerInfo();
      const entitlement = toEntitlement(info);
      applyLocal(uid, entitlement);
      setManagementUrl(info.managementURL);

      setState((s) => ({
        ...s,
        restoring: false,
        purchased: !!entitlement,
        error:     entitlement ? null : 'No purchase found on this account.',
      }));
      return !!entitlement;
    } catch (err) {
      setState((s) => ({ ...s, restoring: false, error: messageFor(err) }));
      return false;
    }
  }, [uid, applyLocal, setManagementUrl]);

  /** The three plans with store prices where the store answered, copy prices otherwise. */
  const plans: WebPlan[] = MOCK_WEB_PLANS.map((plan) => (
    prices[plan.id] ? { ...plan, price: prices[plan.id]! } : plan
  ));

  return { ...state, plans, buy, restore };
}
