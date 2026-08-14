/**
 * The three things the web paywall sells (8-5).
 *
 * **Every price here is a placeholder.** In 8-4 these come from the RevenueCat Offering, whose
 * strings are already localised and formatted by the store — the paywall renders
 * `plan.price` either way, so the swap is this file's `MOCK_WEB_PLANS` becoming a mapped
 * Offering and nothing else. A price hardcoded into a component is one that drifts from Stripe
 * the first time either changes, which is why they are all in one place even while fake.
 *
 * Native does not use any of this. Android keeps its single one-time `harp2tab_premium` SKU
 * through `react-native-iap` — see 8-1's "web only" decision — so `PlanPicker.tsx` (native)
 * renders the price it already rendered, and only `PlanPicker.web.tsx` reads this file.
 */

export type WebPlanId = 'monthly' | 'yearly' | 'lifetime';

export interface WebPlan {
  id:       WebPlanId;
  name:     string;
  /** Display string, already formatted and localised. Never a number to format at render. */
  price:    string;
  /** What the price is *per*. Empty for one-time purchases. */
  cadence:  string;
  /** The second line — the reason to pick this one over the one above it. */
  note?:    string;
  badge?:   string;
}

/**
 * Prices locked 2026-07-29, reconfirmed 2026-08-13 against the merchant-of-record fee table.
 * Worth knowing while reading them: after fees the monthly plan nets $2.97 and the annual one
 * $25.90, so annual is not merely better for the user.
 */
export const MOCK_WEB_PLANS: WebPlan[] = [
  {
    id:      'yearly',
    name:    'Yearly',
    price:   '$27.99',
    cadence: 'per year',
    note:    'About $2.33 a month — save 33%',
    badge:   'Best value',
  },
  {
    id:      'monthly',
    name:    'Monthly',
    price:   '$3.49',
    cadence: 'per month',
    note:    'Cancel any time',
  },
  {
    id:      'lifetime',
    name:    'Lifetime',
    price:   '$44.99',
    cadence: 'one time',
    note:    'Pay once, keep it forever',
  },
];

/**
 * Which plan the paywall opens on.
 *
 * Annual, deliberately — see the fee note above. This is a revenue decision expressed as a
 * default, not a layout accident, and it is written down here so that changing it is a
 * decision too.
 */
export const DEFAULT_PLAN_ID: WebPlanId = 'yearly';

/**
 * What the free plan will include once web checkout opens: this many transcriptions, counted
 * across all three sources — microphone, audio upload and MIDI import.
 *
 * **Nothing enforces this yet.** `FREE_TIER_ENABLED` in `useSettingsStore.ts` is false on web
 * and everything is unlimited during the beta; this constant exists because the landing page
 * *publishes* the number, and a promise printed on the marketing page must not drift from the
 * gate that will later have to honour it. When that gate is built, it reads this — not its own
 * literal, and not `RECORDING_LIMIT`, which is the separate, tighter Play-app allowance.
 */
export const FREE_TIER_TRANSCRIPTIONS = 10;

/** What every plan includes. One list — the plans differ in price, not in what they unlock. */
export const PLAN_PERKS = [
  'Unlimited recordings',
  'Export to TXT, CSV, MIDI, MusicXML & JSON',
  'All future updates included',
];
