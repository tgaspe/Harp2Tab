/**
 * Does this user have paid access? The one answer the whole app reads (8-3).
 *
 * Replaces every direct read of `useSettingsStore.isPurchased` outside the Play Store purchase
 * path. That flag still exists and still means what it always meant — this device bought the
 * one-time Android unlock — but it is now one of two inputs rather than the answer, because
 * a subscription can end and a latch cannot express that.
 *
 * **`resolveSessionGate` does not change.** It takes a boolean, and it still does; the boolean
 * it is given simply stops being permanent. No gate, entry point or screen moved for this.
 */

import { useMemo } from 'react';
import { useAuthStore } from '@/auth/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useEntitlementStore } from '@/store/useEntitlementStore';
import { resolvePremium, type PremiumState } from '@/store/entitlementState';
import { resolveMockPremium } from '@/store/mockPremium';
import type { Entitlement } from '@/auth/entitlement';

/**
 * The cached entitlement, but only if it belongs to whoever is signed in *now*.
 *
 * This is the cross-account guard, and putting it here rather than in a sign-out handler is
 * what makes it hold. A browser that signs out — or signs into a second account before the
 * first refresh lands — cannot keep the previous account's paid access, because the uid on the
 * cache no longer matches and the cache is ignored. No cleanup call to forget.
 */
function ownedBy(uid: string | null, cacheUid: string | null, cached: Entitlement | null) {
  if (!uid || !cacheUid || uid !== cacheUid) return null;
  return cached;
}

export function usePremium(): PremiumState {
  const uid         = useAuthStore((s) => s.user?.uid ?? null);
  const cached      = useEntitlementStore((s) => s.cached);
  const cacheUid    = useEntitlementStore((s) => s.uid);
  const isPurchased = useSettingsStore((s) => s.isPurchased);

  // `?plan=` (8a review harness, dev-only, deleted with 8b). Read before the real state rather
  // than blended with it, so a mock is never half-applied — see `mockPremium.ts`.
  const mocked = resolveMockPremium();

  // Memoised on the inputs rather than on the clock, so this does not churn every render.
  // The cost is that an expiry crossed while a tab sits open is not noticed until something
  // re-renders — which is exactly what the foreground refresh in `startEntitlementListener`
  // is for, and it arrives with fresh data rather than merely a fresh clock reading.
  return useMemo(
    () => mocked
      ?? resolvePremium({ cached: ownedBy(uid, cacheUid, cached), isPurchased, now: Date.now() }),
    [mocked, uid, cacheUid, cached, isPurchased],
  );
}

/**
 * The same answer, outside React.
 *
 * Four gate call sites run in event handlers and plain modules rather than in render —
 * `edit.tsx`, `studio.tsx`, `AppSidebar.tsx` and `sessionSnapshot.ts` all reach for
 * `useSettingsStore.getState()` today. They get this instead, so there is exactly one
 * definition of paid access and not a hook version and a getter version that can drift.
 */
export function getPremium(): PremiumState {
  const mocked = resolveMockPremium();
  if (mocked) return mocked;

  const uid         = useAuthStore.getState().user?.uid ?? null;
  const entitlement = useEntitlementStore.getState();
  const isPurchased = useSettingsStore.getState().isPurchased;

  return resolvePremium({
    cached:      ownedBy(uid, entitlement.uid, entitlement.cached),
    isPurchased,
    now:         Date.now(),
  });
}
