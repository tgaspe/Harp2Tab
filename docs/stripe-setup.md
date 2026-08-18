# Stripe + RevenueCat setup runbook

The click-by-click companion to [`plan/phase-08-monetization.md`](plan/phase-08-monetization.md)'s
8-1, written for someone who has not used Stripe before. The phase doc says *what* and *why*;
this says *which button*.

**Scope: this is 8b — Stripe sandbox, no real money, nothing irreversible.** Everything here
runs against an un-activated account with test cards. Part 6 lists what 8c adds, and 8c is the
only part that costs anything or commits you to anything.

---

## Vocabulary, once

| Term | What it actually is |
|---|---|
| **Sandbox** | An isolated copy of a Stripe account with its own keys, webhooks and data. Replaced the old test-mode toggle. Up to 5 per account, free. |
| **Activation** | Stripe verifying your identity and bank details. Needed for live mode only — not for anything in this document. |
| **Product vs Price** | The *product* is the thing sold; the *price* is an amount + interval attached to it. Prices are **immutable** — "changing" one means creating a new price and archiving the old. |
| **Entitlement** (RC) | The switch your app reads. Ours is `premium`. |
| **Offering** (RC) | The set of plans a paywall displays. Contains *packages*, one per product. |
| **Webhook** | An HTTP POST one service sends another when something happens. You configure exactly one: RevenueCat → your Cloud Function. Stripe↔RevenueCat is wired by the Marketplace app, not by you. |

---

## Part 1 — done already (2026-08-14)

- Managed Payments confirmed available for a Belgian account (8-1.1).
- Sandbox `acct_1U4QQhEE7XhRWEbE` — "Harp2Tab sandbox", country BE.
- Three products with EUR prices. Ids are in
  [`plan/phase-08-monetization.md`](plan/phase-08-monetization.md)'s **Setup state** table.

---

## Part 2 — RevenueCat

### Step 3 · Account and project

1. Sign up at [revenuecat.com](https://www.revenuecat.com) and create a **project**. Name it
   `Harp2Tab`.
2. **Do not connect Google Play.** Android runs `react-native-iap` and keeps its own one-time
   `harp2tab_premium` SKU — that is 8-1's "web only" decision. Connecting Play here would start
   reconciling entitlements you deliberately chose to grant by hand (8-7).

### Step 4 · Connect the Stripe sandbox

RevenueCat connects through a **Stripe Marketplace app**, not an API key. You will never paste
a secret key.

1. In Stripe, switch into the `harp2tab-dev` sandbox. **Whichever account is active when you
   start this flow is the one that gets connected** — this is the easiest thing to get wrong.
2. In RevenueCat: account settings → **Connect Stripe**. It redirects you to Stripe to install
   the RevenueCat app.
3. Accept the permissions. (Uninstalling the app revokes all of them.)
4. Back in Stripe, click **View Stripe app settings** and sign in with your RevenueCat
   credentials — this is the step that links the two accounts, and it is easy to skip.
5. Confirm the connected account appears in RevenueCat's settings. Refresh the page if it
   doesn't.

> A sandbox is a separate account, so it needs **its own RevenueCat config**. The connection
> you make here does not carry over to live — at 8c you repeat steps 4–7 against the activated
> account. That is expected, not a mistake.

### Step 5 · Import the products

1. RevenueCat → **Product Catalog → Products**.
2. Select the Stripe config, click **Import**.
3. Select all three products, import. Successful ones show **Published**.

⚠️ **Only one price can be imported per product.** This answers the open EUR-vs-USD
presentment question in the negative: you cannot attach a parallel USD price to the same
product and have RevenueCat offer both. Multi-currency, if it's ever wanted, means separate
products or a different mechanism — not a second price.

### Step 6 · One entitlement

**Product Catalog → Entitlements** → create one with the identifier exactly `premium`, and
attach **all three** products to it.

One identifier is the whole point: the client never branches on a product id, which is how
"the annual plan doesn't unlock export" bugs and paywall bypasses happen.

### Step 7 · One offering

**Product Catalog → Offerings** → create an offering, then add three **packages**, one per
imported product. This is what the Web SDK reads in 8-4 and what replaces `MOCK_WEB_PLANS`
in `src/billing/plans.ts`.

### Step 8 · Two settings that are easy to miss

- **Tax behaviour** (in the Stripe config): whether your listed prices include tax. Affects
  *revenue reporting only*, not what customers are charged. Configs created after 2026-05-01
  default to tax-excluded.
- **Customer Portal URL** (Stripe config → subscription management tab): Stripe's hosted page
  where a subscriber cancels or updates a card. RevenueCat returns it in `CustomerInfo`, and
  8-6's `/profile` plan block needs it — without it there is no cancel path and Stripe's
  review at 8c will care.

### Step 9 · Payment domains — partly deferred

RevenueCat auto-registers its own hosted domains (`pay.rev.cat`, `signup.cat`). If checkout
runs on **your** domain via the Web SDK, that domain must be registered in Stripe manually.

**This is a fifth `TODO(domain)` item.** It does not block 8b — RevenueCat's hosted flow works
without it. `grep -rn "TODO(domain)" src/`

---

## Part 3 — the webhook

This is the only part where RevenueCat talks to code you wrote.

### Step 10 · Give the function a public URL

`revenuecatWebhook` must be reachable over HTTPS. Two options:

- **Blaze plan** and `npx firebase deploy --only functions`. A card on file; ~$0 at this volume.
- **A tunnel** (ngrok or similar) to the local emulator, if you'd rather not add a card yet.

Take the URL **printed by the deploy** rather than constructing one — Firebase v2 functions get
a Cloud Run style hostname, not the classic `cloudfunctions.net` pattern.

### Step 11 · Set the function's configuration

| Name | Where | Value |
|---|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | `npx firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET` | A long random string you invent. Already present in `functions/.secret.local` for the emulator. |
| `RC_LIFETIME_PRODUCT_IDS` | `functions/.env` | `prod_V4Zi9i9aFBYHoS` |
| `RC_ACCEPT_SANDBOX` | `functions/.env` | `true` — **for 8b only** |

`functions/.env` is covered by `.gitignore`.

⚠️ **`RC_ACCEPT_SANDBOX=true` is not optional during 8b.** RevenueCat flags test-mode purchases
as sandbox, and the writer ignores sandbox events by default (`functions/src/index.ts:43`).
Leave it off and every test purchase is silently dropped — you will spend an afternoon
debugging a system that is working exactly as designed. **Turn it back off before 8c**, or
production access can be granted by anyone who can reach the endpoint with a sandbox payload.

### Step 12 · Create the webhook in RevenueCat

**Integrations → Webhooks → Add new configuration:**

| Field | Value |
|---|---|
| Name | `entitlement-writer` |
| URL | the deployed function URL |
| Authorization header | the same string as `REVENUECAT_WEBHOOK_SECRET` — **raw, no `Bearer` prefix** |
| Environment | **Sandbox** during 8b; both, or production, at 8c |
| Scope / event types | all |

The header is compared byte-for-byte against the secret (`functions/src/index.ts:57`). A
`Bearer ` prefix is the most likely reason for a 401.

RevenueCat's dashboard can **send test events** and **Retry** failed deliveries — use both
before assuming the function is broken.

---

## Part 4 — the test that answers 8-1.6

Buy all three plans with test card `4242 4242 4242 4242`, any future expiry, any CVC.

Check after each:

1. RevenueCat's customer view shows the `premium` entitlement active.
2. A document appears at `/entitlements/{uid}` in Firestore.
3. The app reads it — paid access appears without a reload loop.

**The lifetime purchase is the real experiment.** RevenueCat supports one-time prices but not
*repeat consumables*, and 8-1.6 has been waiting on an empirical answer. If lifetime cannot be
bought through this path, the fallbacks in order are: drop lifetime from the web paywall and
keep it a legacy grant; or run lifetime alone through RevenueCat Billing and accept being
merchant of record for that one product — the worst option, and a conscious choice if it
happens.

Also confirm a **revocation**: cancel the subscription in Stripe, let `EXPIRATION` arrive, and
watch access drop. `isPurchased` was a one-way latch before 8a; this is the test that proves it
isn't any more.

---

## Part 5 — limitations that apply to us

Confirmed in RevenueCat's Stripe Billing docs, 2026-08-14:

- **No free trials and no coupon entry** in RevenueCat's Stripe purchase flows. Already a known
  trade — the 3-session free tier is the trial, and launch discounts and influencer codes are
  given up.
- **No repeat consumables** — fine; nothing here is bought twice.
- **No tiered, usage-based or customer-chooses pricing** — fine; all three prices are flat.
- **Asynchronous payment methods unsupported** (bank debits, transfers, cash vouchers). Cards
  and wallets only.
- **Cancellations can take up to two hours** to reflect in RevenueCat. Do not treat a two-minute
  delay as a bug.
- **Stripe Test Clocks are not fully supported**, so renewal-over-time cannot be simulated
  cleanly.
- **Proration is not factored into revenue calculations.**

---

## Part 6 — what 8c adds (not now)

Only when everything above works end to end:

1. Stripe **activation**: identity, KBO/BCE number, Belgian bank account.
2. **Managed Payments switched on** — a dashboard setting against a purchase flow that already
   works.
3. **The domain**, then the five `TODO(domain)` fix-ups, then 8-9's legal pages — Stripe's
   onboarding wants a public business URL with prices, a refund policy and a contact.
4. Repeat steps 4–7 and 12 against the **live** account: new Stripe config in RevenueCat, new
   product import, new webhook. Set `RC_ACCEPT_SANDBOX` back to `false`.
5. **8-7** the lifetime buyer, by hand.
6. **8-8** flip `FREE_TIER_ENABLED`, last and on its own commit.
