# Stripe + RevenueCat setup runbook

**Setup only.** Running the thing afterwards — price changes, refunds, manual grants, support
triage — is [`billing-operations.md`](billing-operations.md).

The click-by-click companion to [`plan/phase-08-monetization.md`](plan/phase-08-monetization.md)'s
8-1, written for someone who has not used Stripe before. The phase doc says *what* and *why*;
this says *which button*.

**Scope: this is 8b — Stripe sandbox, no real money, nothing irreversible.** Everything here
runs against an un-activated account with test cards. Part 6 lists what 8c adds, and 8c is the
only part that costs anything or commits you to anything.

> **Status 2026-08-19: 8b is done and a sandbox purchase works end to end.** RevenueCat is
> configured against the Stripe sandbox, `revenuecatWebhook` is deployed and authenticated, and
> a monthly subscription has been bought, written to `/entitlements/{uid}`, cancelled and
> revoked. The steps below are recorded as they were actually performed — several diverge from
> the plan, and each divergence is called out where it happens. What is still untested is in
> Part 4.

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

### Step 3 · Account, project, and the fork that matters

1. Sign up at [revenuecat.com](https://www.revenuecat.com) and create a **project** named
   `Harp2Tab`.
2. **Do not connect Google Play.** Android runs `react-native-iap` and keeps its own one-time
   `harp2tab_premium` SKU — that is 8-1's "web only" decision. Connecting Play here would start
   reconciling entitlements you deliberately chose to grant by hand (8-7).

⚠️ **The project's "Start selling on the web" wizard offers three tabs: RevenueCat Billing,
Paddle Billing, Stripe Billing. Ours is Stripe Billing.** RevenueCat Billing makes *RevenueCat*
the merchant of record, which is the precise thing 8-1 rejected — it would silently reverse the
Managed Payments decision, the fee arithmetic and who owes Belgian VAT. Two things make the
wrong tab easy to pick:

- the RevenueCat Billing tab also shows a **"Connect Stripe"** step, because RC Billing uses
  Stripe as its *processor* while remaining the seller;
- its next step is "**Create** web product", whereas Stripe Billing says "**Import**". Ours are
  already in Stripe, so import is the tell.

Picking wrong is recoverable: delete the RevenueCat Billing app and its products, then create
the Stripe config. Leaving it in place is not harmless — two web configs mean two public API
keys, and shipping the wrong one routes every purchase through RC-as-merchant-of-record with no
error to say so.

### Step 4 · Connect the Stripe sandbox

The connection is **account-level**, not per project, and it goes through a **Stripe Marketplace
app** rather than an API key. You will never paste a secret key.

1. In Stripe, switch into the sandbox — `acct_1U4QQhEE7XhRWEbE`. **Whichever account is active
   when you start this flow is the one that gets connected.**
2. RevenueCat → **account settings** → **Connect Stripe account** → install the RevenueCat app.
3. Accept the permissions. (Uninstalling the app revokes all of them.)
4. Back in Stripe, click **View Stripe app settings** and sign in with your RevenueCat
   credentials — this is the step that links the two accounts, and it is easy to skip.
5. Confirm the connected account is listed in RevenueCat's account settings.
6. **Then** the project: **Web** in the lower part of the project sidebar → create the Stripe
   **config**. Enable **"Use Managed Payments when Available"** — inert in a sandbox, and it is
   the switch 8c relies on.

> A sandbox is a separate account, so it needs **its own RevenueCat config**. Nothing here
> carries over to live; at 8c you repeat steps 4–9 against the activated account. That is
> expected, not a mistake.

### Step 5 · Import the products

1. RevenueCat → **Product Catalog → Products**.
2. Select the Stripe config, click **Import**.
3. Select all three, import. Successful ones show **Published**.

⚠️ **Only one price can be imported per product**, which answers the EUR-vs-USD presentment
question in the negative: you cannot attach a parallel USD price to the same product and have
RevenueCat offer both.

⚠️ **RevenueCat keys the imported products on the Stripe _price_ id, not the product id.** The
webhook therefore receives `price_1U4Qk…` as `product_id`, which is why `RC_LIFETIME_PRODUCT_IDS`
lists both forms, and why `PLAN_BY_PRODUCT_ID` in `src/billing/plans.ts` maps both.

### Step 6 · One entitlement, and its identifier is load-bearing

**Product Catalog → Entitlements** → create one with the identifier **exactly `premium`**, and
attach all three products.

⚠️ **A different identifier fails silently.** `functions/src/revenuecat.ts:162` ignores any event
whose `entitlement_ids` does not contain `premium`, and an ignored event answers **200** by
design. The failure looks like: a real payment, a healthy webhook, a green dashboard, and no
entitlement document. RevenueCat's default suggestion during onboarding is a *display-style*
name (`Harp2Tab Pro`), so this is the likely mistake, not an unlikely one.

### Step 7 · One offering, and it must be Current

**Product Catalog → Offerings** → create an offering with three **packages**, using the
predefined identifiers `$rc_monthly`, `$rc_annual`, `$rc_lifetime`. The SDK exposes those as
`offering.monthly` / `.annual` / `.lifetime`, which is what `useIAP.web.ts` reads.

The offering's own name does not matter — the client fetches `offerings.current` and never names
one — but **exactly one offering must be marked Current**, and its packages must point at the
**Stripe** products. A stale offering left current, or packages still pointing at products from a
deleted config, renders an empty paywall with no error to explain it.

### Step 8 · Two settings that are easy to miss

- **Customer Portal URL** (Stripe config → subscription management). Stripe's hosted page where a
  subscriber cancels or updates a card. RevenueCat returns it as `CustomerInfo.managementURL`,
  and `/profile`'s Billing row (8-6) renders **Manage** only when it is present. Configure the
  portal itself first at Stripe → **Settings → Billing → Customer portal**, then paste the link
  here. Ours (sandbox): `https://billing.stripe.com/p/login/test_7sY4gz0iK90IeMt3q41ck00`.
- **Tax behaviour** (Stripe config): whether listed prices include tax. Affects *revenue
  reporting only*, not what customers are charged.

### Step 9 · Payment domains, branding, and one thing that is not possible

- RevenueCat auto-registers its own hosted domains (`pay.rev.cat`, `signup.cat`). A domain of
  ours running checkout needs registering in Stripe by hand.
- **Branding**: Stripe → Settings → Branding. Brand `#0E7180` (`accentDeep`) for fills and
  `#0cc0df` (`accent`) for links is the pairing that survives Stripe's contrast rules; plain
  `#0cc0df` is ~2.2:1 on white. Sandbox branding does **not** carry to live.
- ⚠️ **A custom checkout domain is not available to us at all.** Stripe's custom-domains page
  states plainly: *"Custom domains aren't supported for Managed Payments."* It is also a paid
  feature and unsupported in sandboxes. Checkout stays on Stripe's domain, and receipts say
  *Sold through Link* — the trade already accepted in exchange for Stripe carrying the tax.

---

## Part 3 — the webhook

This is the only part where RevenueCat talks to code you wrote. **Done on 2026-08-18.**

### Step 10 · Give the function a public URL

`revenuecatWebhook` must be reachable over HTTPS. The project is on **Blaze**, and the function
is deployed:

```
npx firebase deploy --only functions:revenuecatWebhook
```

Live at `https://us-central1-harp2tab.cloudfunctions.net/revenuecatWebhook` (Cloud Run also
answers on `https://revenuecatwebhook-mfunwuhb5a-uc.a.run.app` — same function, either works).
The deploy warns about a missing artifact cleanup policy; `npx firebase functions:artifacts:setpolicy`
clears it and costs nothing to defer.

### Step 11 · Set the function's configuration

| Name | Where | Value |
|---|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | Secret Manager | A long random string you invent — nobody issues it |
| `RC_LIFETIME_PRODUCT_IDS` | `functions/.env` | `prod_V4Zi9i9aFBYHoS,price_1U4QkIEE7XhRWEbEYDYqI4tK` |
| `RC_ACCEPT_SANDBOX` | `functions/.env` | `true` — **8b only** |

⚠️ **Generate the secret as hex and write it without a trailing newline.** The interactive
`functions:secrets:set` prompt captured the newline from a paste, which stored `…=\n` and made
every delivery a 401 that no amount of re-pasting in RevenueCat could fix (`index.ts:158` compares
byte-for-byte). This form avoids both hazards:

```bash
S=$(openssl rand -hex 32); printf '%s' "$S" | npx firebase functions:secrets:set REVENUECAT_WEBHOOK_SECRET --data-file -; echo "$S"
```

A new secret version is **not** used until the function is redeployed — the deploy pins a version.

⚠️ **`RC_ACCEPT_SANDBOX=true` is not optional during 8b.** RevenueCat flags test-mode purchases as
sandbox and the writer ignores sandbox events by default (`functions/src/index.ts:43`). **Turn it
back off before 8c**, or anyone who can reach the endpoint with a sandbox payload and the secret
can grant themselves access.

### Step 12 · Create the webhook in RevenueCat

**Integrations → Webhooks → Add new configuration:**

| Field | Value |
|---|---|
| Name | `entitlement-writer` |
| URL | the deployed function URL |
| Authorization header | the secret — **raw, no `Bearer` prefix** |
| Environment | **both** Sandbox and Production is fine: no production events can exist until 8c, and it saves re-pointing later. `RC_ACCEPT_SANDBOX` is the setting that actually gates safety |
| Event types | all |
| Send paywall events | **off** — those are impression events for RevenueCat's hosted paywalls, which we do not use. Every one would be an invocation that logs "Ignored event" |

RevenueCat's **Send test event** returns 200 and logs *"Ignored event — does not grant premium"*.
That is correct: a synthetic ping names no entitlement.

---

## Part 4 — what has been tested, and what has not

**Confirmed working (2026-08-18/19), monthly plan, card `4242 4242 4242 4242`:**

- Purchase → `premium` active in RevenueCat → `INITIAL_PURCHASE` → document at
  `/entitlements/{uid}` → paid access in the app.
- Cancel → `EXPIRATION` writes the revoke tombstone, access drops on the next refresh.
- An out-of-order `CANCELLATION` was correctly refused by `isFresh`, leaving the tombstone intact
  — the staleness guard doing exactly its job.

**Still untested, in priority order:**

1. **The lifetime purchase**, which is what answers 8-1.6. RevenueCat supports one-time prices but
   not repeat consumables; if lifetime cannot be bought through this path the fallbacks are to
   drop it from the web paywall, or run it alone through RevenueCat Billing and accept being
   merchant of record for that one product (the worse option).
2. `4000 0000 0000 9995` — declined card, confirming the error copy.
3. `4000 0025 0000 3155` — a 3-D Secure challenge, which is ordinary for EU cards under SCA.
4. Whether Managed Payments treats the listed price as **tax-inclusive**. It withholds indirect
   taxes at completion, which would take ~€0.78 of a €4.49 EU B2C sale before card and MP fees —
   materially different from the margin assumed in `phase-08-monetization.md`.

Card details: any future expiry, any CVC, any name; the address decides the tax treatment.

---

## Part 5 — limitations that apply to us

Re-checked against RevenueCat's Stripe Billing docs, 2026-08-18:

- ✅ **Free trials and coupons _are_ supported** — *"Free trials are supported in RevenueCat
  purchase flows. Add a trial to a price when you import it into RevenueCat"* and *"Stripe coupons
  are supported in RevenueCat purchase flows."* **This reverses the 2026-08-13 note in
  `phase-08-monetization.md`**, which recorded giving up launch discounts and influencer codes as
  a knowing trade. The trade is off the table; whether to take a trial is now an open product
  decision, and it is cheapest at import time (a trial is attached to a price).
- **No repeat consumables** — fine; nothing here is bought twice.
- **No tiered, usage-based or customer-chooses pricing** — fine; all three prices are flat.
- **Asynchronous payment methods unsupported** (bank debits, transfers, cash vouchers). Cards and
  wallets only.
- **Cancellations can take up to two hours** to reflect in RevenueCat.
- **Stripe Test Clocks are not fully supported**, so renewal-over-time cannot be simulated.
- **Proration is not factored into revenue calculations.**

---

## Part 6 — what 8c adds (not now)

Only when Part 4's untested list is clear:

1. Stripe **activation**: identity, KBO/BCE number, Belgian bank account.
2. **Managed Payments switched on** for the live account.
3. The five `TODO(domain)` fix-ups (`grep -rn "TODO(domain)" src/`) and 8-9's legal pages —
   Stripe's onboarding wants a public business URL with prices, a refund policy and a contact.
   `harp2tab.com` is bought and serving; `www` still 404s until it is added as a second custom
   domain in Firebase Hosting.
4. Repeat steps 4–9 and 12 against the **live** account: new Stripe config in RevenueCat, new
   product import, new offering packages, new portal URL, new branding, new webhook environment.
   Add the live price ids to `PLAN_BY_PRODUCT_ID` (add, don't replace — sandbox documents should
   still read correctly).
5. Set `RC_ACCEPT_SANDBOX` back to `false`, **rotate `REVENUECAT_WEBHOOK_SECRET`**, and redeploy.
6. Replace `EXPO_PUBLIC_REVENUECAT_WEB_KEY` with the live config's key.
7. **8-7** the lifetime buyer, by hand.
8. **8-8** flip `FREE_TIER_ENABLED`, last and on its own commit.
