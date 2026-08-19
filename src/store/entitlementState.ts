/**
 * What the user is entitled to, right now, as a pure function (8-3).
 *
 * **This file exists because `isPurchased` is a one-way latch.** `setPurchased()` sets it to
 * `true` and nothing anywhere sets it back (`useSettingsStore.ts`). That is correct for the
 * Play Store's one-time unlock — a lifetime purchase never stops being true — and wrong for
 * everything Phase 8 sells. Subscriptions lapse, cards fail, people cancel and refunds happen,
 * so paid access has to be a value with an expiry that can go from true to false while the
 * user does nothing on this device.
 *
 * Pure and store-free on purpose, following `sessionGate.ts` and `recordingsMigration.ts`:
 * every rule below is a rule about money, and the harness (`verify-entitlement.ts`) can drive
 * all of them with hand-authored inputs and a fake clock. Nothing here reads a store, a clock
 * or the network — the callers in `usePremium.ts` supply all three.
 */

import type { Entitlement } from '@/auth/entitlement';

/**
 * How long a lapsed subscription keeps working.
 *
 * Stripe retries a failed payment over several days, so the window between "the card was
 * declined" and "this person actually stopped paying" is a normal, recoverable state — not a
 * moment to take the app away. Revoking at the instant of expiry would lock out a paying
 * customer over a bank's fraud heuristic, and they would experience it as the app breaking.
 *
 * Three days is the shape of that retry window. It is deliberately not longer: this also runs
 * on the cached copy, so it is the maximum time a genuinely cancelled subscriber keeps access
 * on a device that never reconnects.
 */
export const ENTITLEMENT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** `'free'` is a real answer here, not the absence of one. */
export type PremiumPlan = Entitlement['plan'] | 'free';

/** Where the entitlement came from — which is also who can take it away. */
export type PremiumSource =
  /** The signed-in account's entitlement document. Revocable. */
  | 'account'
  /** This device's Play Store unlock (`isPurchased`). Permanent, and nothing revokes it. */
  | 'device'
  | 'none';

export interface PremiumState {
  /** The only field `resolveSessionGate` needs. Everything else is for `/profile`. */
  premium:    boolean;
  plan:       PremiumPlan;
  /** Epoch ms the subscription lapses. Absent for lifetime and free. */
  expiresAt?: number;
  /** The store product this came from, so `/profile` can name the plan (8-6). */
  productId?: string;
  /** Past `expiresAt` but still inside `ENTITLEMENT_GRACE_MS` — paid, and worth saying so. */
  inGrace:    boolean;
  source:     PremiumSource;
}

export interface ResolvePremiumParams {
  /**
   * The account's entitlement, or `null` when there is none.
   *
   * **`null` must mean "this account has no entitlement", never "we could not find out".** A
   * failed fetch has to leave the previous value in place rather than pass `null` here, or a
   * dropped connection revokes a paying customer — see `useEntitlementStore.refresh`.
   */
  cached:      Entitlement | null;
  /** The legacy local Play unlock. True means lifetime, forever, and is never revoked here. */
  isPurchased: boolean;
  /** Injected rather than read, so the harness can sit on either side of an expiry. */
  now:         number;
}

const FREE: PremiumState = { premium: false, plan: 'free', inGrace: false, source: 'none' };

/**
 * Resolve the two sources of paid access into one answer.
 *
 * Account first, device second. The order matters in one case that will really happen: an
 * Android buyer whose web subscription has lapsed is still a lifetime buyer on his own phone,
 * so an expired account entitlement must fall through to the device unlock rather than
 * override it. The two flags have different owners and neither one is allowed to erase the
 * other — which is also why sign-out clears the cached entitlement and never touches
 * `isPurchased`.
 */
export function resolvePremium({ cached, isPurchased, now }: ResolvePremiumParams): PremiumState {
  const fromAccount = resolveAccount(cached, now);
  if (fromAccount) return fromAccount;

  if (isPurchased) {
    return { premium: true, plan: 'lifetime', inGrace: false, source: 'device' };
  }

  return FREE;
}

/** The account half. Returns `null` when the account grants nothing *at this moment*. */
function resolveAccount(cached: Entitlement | null, now: number): PremiumState | null {
  if (!cached) return null;

  if (cached.plan === 'lifetime') {
    return {
      premium: true, plan: 'lifetime', inGrace: false, source: 'account',
      productId: cached.productId,
    };
  }

  // A subscription with no `expiresAt` is a malformed document — but the safe reading of
  // malformed is "paid", not "not paid". The writer only creates these documents in response
  // to money changing hands, so the failure mode of trusting it is a few unpaid days; the
  // failure mode of distrusting it is billing someone and locking them out anyway.
  if (cached.expiresAt === undefined) {
    return {
      premium: true, plan: 'subscription', inGrace: false, source: 'account',
      productId: cached.productId,
    };
  }

  if (now <= cached.expiresAt) {
    return {
      premium:   true,
      plan:      'subscription',
      expiresAt: cached.expiresAt,
      inGrace:   false,
      source:    'account',
      productId: cached.productId,
    };
  }

  if (now <= cached.expiresAt + ENTITLEMENT_GRACE_MS) {
    return {
      premium:   true,
      plan:      'subscription',
      expiresAt: cached.expiresAt,
      inGrace:   true,
      source:    'account',
      productId: cached.productId,
    };
  }

  return null;
}
