/**
 * The `?plan=` harness for 8a's UI pass, mirroring `auth/mockStates.ts` exactly.
 *
 * Every paid state the screens can be in, reachable as a URL rather than by getting a real
 * subscription into that condition. `?plan=grace` is one keystroke; producing a genuine failed
 * payment inside its retry window, on demand, repeatedly, is not — and `?plan=lapsed` would
 * otherwise mean waiting a month.
 *
 * **This file is deleted when 8b lands.** Nothing outside `usePremium.ts` may import it, and
 * no component may branch on whether a state came from here — the same rule that kept the auth
 * mock swap to one file. `grep -rn "mockPremium" src/` is the full list of call sites.
 */

import { ENTITLEMENT_GRACE_MS, type PremiumState } from './entitlementState';

const DAY = 24 * 60 * 60 * 1000;

export const MOCK_PREMIUM_STATES: Record<string, PremiumState> = {
  free: { premium: false, plan: 'free', inGrace: false, source: 'none' },

  monthly: {
    premium: true, plan: 'subscription', source: 'account', inGrace: false,
    expiresAt: Date.now() + 12 * DAY,
  },
  yearly: {
    premium: true, plan: 'subscription', source: 'account', inGrace: false,
    expiresAt: Date.now() + 210 * DAY,
  },
  lifetime: { premium: true, plan: 'lifetime', inGrace: false, source: 'account' },

  /** Bought on Google Play, signed out or signed in — the existing buyer's state. */
  device: { premium: true, plan: 'lifetime', inGrace: false, source: 'device' },

  /**
   * A card that failed, inside the retry window. Still paid, and the page must say why without
   * frightening someone whose bank is about to succeed on its own.
   */
  grace: {
    premium: true, plan: 'subscription', source: 'account', inGrace: true,
    expiresAt: Date.now() - Math.floor(ENTITLEMENT_GRACE_MS / 2),
  },

  /** Grace exhausted. The library is intact; only new sessions are gone. */
  lapsed: { premium: false, plan: 'free', inGrace: false, source: 'none' },

  /** Renewing tomorrow — the case where a date needs to read as reassurance, not a warning. */
  renewingSoon: {
    premium: true, plan: 'subscription', source: 'account', inGrace: false,
    expiresAt: Date.now() + DAY,
  },
};

export const MOCK_PREMIUM_KEYS = Object.keys(MOCK_PREMIUM_STATES);

/**
 * Latched for the page session, for the reason `useAuth` latches its own: `?plan=` belongs to
 * the route it was typed on, so without this, navigating from `/paywall` to `/profile` would
 * silently drop back to the real state mid-review.
 */
let latched: string | undefined;

export function resolveMockPremium(): PremiumState | undefined {
  if (!__DEV__ || typeof window === 'undefined') return undefined;

  const fromUrl = new URLSearchParams(window.location.search).get('plan') ?? undefined;
  if (fromUrl && fromUrl.length > 0) latched = fromUrl;

  return latched ? MOCK_PREMIUM_STATES[latched] : undefined;
}
