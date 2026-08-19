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
 * Prices locked 2026-07-29, reconfirmed 2026-08-13, and **repriced into euros 2026-08-14**
 * before RevenueCat imported anything — the last moment the change was free, since no web
 * subscriber exists and Stripe prices are immutable once sold against.
 *
 * The ladder is a ratio, not three numbers: annual is 8 months of monthly, lifetime is 12.9.
 * That held at $3.49/$27.99/$44.99 and it holds here, which is why these are the euro figures
 * and not a currency conversion (at EUR/USD ≈ 1.154 the old prices were €3.03/€24.26/€39.00,
 * so this is a deliberate ~48% rise, taken on positioning: the category sits far above us).
 *
 * Worth knowing while reading them: on an EEA card the fee is 5% + €0.25 (Stripe Belgium's
 * 1.5% + €0.25 plus Managed Payments' 3.5% — *not* the US 2.9% + $0.30 this file used to
 * assume), so monthly nets €4.02 and annual €33.94. Annual is not merely better for the user.
 */
export const MOCK_WEB_PLANS: WebPlan[] = [
  {
    id:      'yearly',
    name:    'Yearly',
    price:   '€35.99',
    cadence: 'per year',
    note:    '€3.00 a month — save 33%',
    badge:   'Best value',
  },
  {
    id:      'monthly',
    name:    'Monthly',
    price:   '€4.49',
    cadence: 'per month',
    note:    'Cancel any time',
  },
  {
    id:      'lifetime',
    name:    'Lifetime',
    price:   '€57.99',
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

/**
 * Store product ids → the plan they were bought as (8-6).
 *
 * `/profile` reads this to name a plan "Yearly" rather than "Premium". The entitlement document
 * carries the store's product id (`productId`, written by the webhook), and this is the only
 * place that knows what those ids mean.
 *
 * **Why not derive it from the dates?** `since` is the *original* purchase, so after twelve
 * renewals a monthly subscription spans a year and is indistinguishable from an annual one.
 * The product id is the only durable fact about which plan was chosen.
 *
 * These are the **sandbox** price ids. The live account issues different ones at 8c — add them
 * here rather than replacing, so a sandbox document written today still reads correctly after
 * the switch. An id that is missing is not an error: the label falls back to "Premium", which
 * is true, just less specific.
 */
export const PLAN_BY_PRODUCT_ID: Record<string, WebPlanId> = {
  price_1U4QkFEE7XhRWEbEBUTxzoIb: 'monthly',
  price_1U4QkGEE7XhRWEbE2shVLHvB: 'yearly',
  price_1U4QkIEE7XhRWEbEYDYqI4tK: 'lifetime',
  prod_V4ZiRNhE4Z46KV:            'monthly',
  prod_V4ZiiNm4QnNCqp:            'yearly',
  prod_V4Zi9i9aFBYHoS:            'lifetime',
};

/** The plan's display name for a store product id, or `null` when the id is unknown. */
export function planNameForProduct(productId: string | undefined): string | null {
  if (!productId) return null;
  const id = PLAN_BY_PRODUCT_ID[productId];
  return id ? (MOCK_WEB_PLANS.find((p) => p.id === id)?.name ?? null) : null;
}
