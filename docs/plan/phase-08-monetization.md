# Phase 8 — Better monetization + remaining web billing

*Part of the [Harp2Tab implementation plan](README.md).*

- RevenueCat + Stripe integration per the already-locked pricing/architecture decisions (see `project_web_version_plan` memory).
- **Plan it against 7a done and 7b not** (see the 2026-08-12 staging decision in Phase 7). The account exists by then, `/profile` has a plan block waiting for real data, `/entitlements/{uid}` exists with its read path and rules, and 7-6 already routes users into sign-in *before* the purchase call — so Phase 8 supplies the entitlement **writer**, not the identity. The sync engine (7b) follows Phase 8, not the other way round.
- **The lifetime buyers' claim path is a Phase 8 mechanism behind a Phase 7 door.** 7-6's voluntary sign-in carries the copy ("Bought Harp2Tab on Google Play? Sign in to keep your lifetime access on the web"); this phase makes it true.
- **Joint Phase 7/8 deliverable, not solely Phase 8's**: grandfathering existing `react-native-iap` Play Store lifetime buyers is an identity-linking problem — an existing anonymous Android purchaser has no Firebase UID until their first login. Needs an explicit reconciliation step (RevenueCat's Play-Store-purchase import tied to first sign-in, or a manual backfill), not something that falls out of the RevenueCat SDK integration by itself. **Settled 2026-08-13: there is exactly one existing buyer, known personally, so this is a manual grant — see 8-7.**

---

## Phase 8 — Detailed implementation plan (written 2026-08-13)

Expands the summary above against the code as it stands after 7a. **Five decisions were taken
by the user on 2026-08-13** and are settled below: Stripe Managed Payments behind RevenueCat,
making **Stripe the merchant of record**; the July prices stand, lifetime included; **web
only** — Android is untouched; **grandfathering is manual**, because there is exactly one
existing buyer; and the free tier does not change.

Two of those delete work the summary above assumed was necessary. One finding in the shipped
code adds work nothing had planned for.

## What the July decision has to be re-read as

"RevenueCat + Stripe" was locked on 2026-07-29 (`project_web_version_plan`). That phrase has
since split into three different products, and they differ in the one thing that matters:
**who is legally the seller** — whose name is on the receipt, and who owes each buyer's
government their sales tax. Digital goods are taxed where the buyer is, not where the seller
is, which is what makes this a decision rather than a checkbox.

| route | seller of record | $3.49/mo | $27.99/yr | $44.99 lifetime |
|---|---|---|---|---|
| RC Billing on our own Stripe + Stripe Tax | **us** | 12.7% | 5.0% | 4.6% |
| **Stripe Billing + Stripe Managed Payments** | **Stripe** | 15.0% | 8.5% | 8.1% |
| Paddle Billing | Paddle | 20.3% | 7.8% | 7.1% |

Stripe is 2.9% + $0.30; Managed Payments adds 3.5% **stacked on top of that**, not as a
replacement rate; Paddle is 5% + $0.50, which is why it is worst on a small monthly charge and
competitive on the annual one. RevenueCat's 1% is included throughout, though it only applies
above $2,500/month tracked revenue.

**RevenueCat is not one of the three.** It is the entitlement layer — it remembers who paid
for what across web/Play/App Store and tells the app. It never touches the money. That part
was never in question and stays in every option; the table is only about what sits underneath.

### What self-MoR would actually cost a **Belgian** seller

*Corrected 2026-08-13, after the seller's country was established. The first version of this
section said the EU sets no registration threshold, which is true for a **non-EU** seller and
false for this one. The decision below survives the correction; its reasoning changes.*

| where the buyer is | obligation as a Belgian seller | bites at |
|---|---|---|
| Belgium | small-business exemption ("franchise") up to **€25,000** turnover — no VAT charged, no returns, no input VAT reclaimed. Approved to rise to €30,000, pending legislation | €25k |
| Rest of EU | below **€10,000/yr** of cross-border B2C sales, charge Belgian VAT (21%) and report at home. Above it, each buyer's national rate and an **OSS** registration — one registration and a quarterly return, not 27 | €10k |
| **UK** | **nil threshold.** A non-UK-established seller of digital services to UK consumers registers from the **first B2C sale**, at 20% | **sale #1** |
| Norway / Australia / Canada / Switzerland | NOK 50k / A$75k / C$30k / CHF 100k | far away |
| US | state economic nexus, typically $100k or 200 transactions per state | far away |

So the honest version: **the EU is not the problem at this revenue — the UK is.** An
English-language harmonica app sells to the UK on day one, and that is a registration and four
returns a year from the first £3 charge. Everything else is comfortably over the horizon until
the product works.

### Decision: Stripe is the merchant of record — reasoning, restated

At €10,000/year of revenue, 3.5 points is about **€350/year**. A UK VAT registration and its
quarterly returns cost more than that in accountant time alone, before the EU threshold is
ever approached — and crossing €10k EU-wide is a thing that happens on a good month, not a
scheduled event you prepare for.

**The counterfactual, stated so it is not pretended away:** if this sold only to Belgium and
the EU and stayed under €10k, self-MoR would be cheaper *and* fully legal. That is not the
product being built.

**MoR is not zero Belgian paperwork.** With Stripe as seller, the payout is an intra-EU B2B
supply from a Belgian business to a Stripe entity in Ireland — reverse-charge, with its own
declaration, and possibly incompatible with staying inside the franchise scheme. **This is the
one question in the phase worth an accountant's hour**, and it is a bookkeeping question, not
a blocker on any of the work below.

This is also the one decision in the phase that is expensive to reverse — **but only after the
first real charge.** Changing merchant of record with live subscribers means migrating them
between processors, and card details do not move: real customers get asked to re-enter payment
or their subscription lapses. **Before the first real charge it costs a product re-import and
nothing else**, because RevenueCat's Web SDK is the same API over RC Billing, Stripe Billing
and Paddle alike. The billing engine is a dashboard configuration, not an architecture, and no
client code in this phase knows which one is underneath.

That is what makes the staging below possible, and it is the reason this decision does not
have to be *acted on* before the code that depends on it exists.

**Two consequences that are not obvious and are now locked in:**

- **Products live in Stripe Billing, not RevenueCat Billing.** Managed Payments is not offered
  through RC's own billing engine. RC imports the Stripe products and sells them through the
  Web SDK; the setup is a few steps longer and the client code is identical.
- **No free trials, no coupons, no promo codes — ever, on this path.** RC's Stripe Billing
  integration does not support them, and only flat-rate pricing is supported. The 3-session
  free tier is the trial and always was, so the trial is not the loss; **launch discounts,
  "50% off the first year" and influencer codes are.** Recorded as a knowing trade, because it
  will be noticed later as an absence rather than a decision.

### ~~The prices stand: $3.49 / $27.99 / $44.99~~ → **€4.49 / €35.99 / €57.99, repriced 2026-08-14**

**Superseded by the user's decision on 2026-08-14, taken before RevenueCat imported the
catalogue** — the last moment it was free, since Stripe prices are immutable and no web
subscriber exists. Lifetime is still sold on web; only the numbers and the currency moved.
The original reasoning is kept below because the fee argument in it turned out to be wrong,
and that is worth not repeating.

**The ladder is a ratio, not three numbers.** Annual is 8 months of monthly (8.02 before,
8.02 after) and lifetime is 12.9 months (1.61× annual). Preserving those ratios at €4.49 is
what produces €35.99 and €57.99 — they were derived, not chosen.

**This is a ~48% rise, not the ~29% the headline numbers suggest.** At EUR/USD ≈ 1.154 the old
prices were €3.03 / €24.26 / €39.00. Taken knowingly, and on positioning rather than fees:
the category (Yousician ≈ €20/mo, Fender Play ≈ €10/mo, Ultimate Guitar Pro ≈ €40/yr) sits far
above us, and a €3 monthly cannibalises the annual plan the paywall pre-selects. That is open
question 5 — monthly's role — answered ahead of conversion data, because there is no
conversion data either way and repricing after launch costs grandfathering and an email.

**The fee correction that reshaped this section.** Every figure below was US pricing
(2.9% + $0.30). This account is Belgian, and Stripe charges by card origin — **EEA standard
1.5% + €0.25**, EEA premium 2.8%, UK 2.5%, international 3.15% (+2% on conversion) — with
Managed Payments' 3.5% on top. So the real numbers are **5% + €0.25 on an EEA card**: monthly
nets €4.02 of €4.49 (10.6%), annual €33.94 of €35.99 (5.7%), lifetime €54.84 of €57.99 (5.4%).
Unconfirmed: whether Stripe Billing's 0.7% stacks on top of Managed Payments.

The fixed-fee asymmetry is therefore real but much smaller than the 15%-vs-8.5% below — which
means monthly is still a conversion instrument rather than a revenue one, but for ladder
reasons rather than fee reasons. Which plan the paywall pre-selects remains a deliberate
choice (annual), not a layout accident.

**Open, and flagged at 8-1's product import:** prices are EUR-only, so US buyers — plausibly
the largest market, blues harp being what it is — see a foreign currency plus their bank's FX
fee. Options are EUR-only (chosen for now), a parallel USD price via Stripe multi-currency, or
whatever localised presentment Managed Payments does on its own. Revisit once traffic shows
where buyers actually are; it needs checking that RevenueCat surfaces multi-currency cleanly.

*Original reasoning, superseded:*

> Confirmed against the fee table rather than re-derived. What the table adds is one number
> worth having in front of the paywall design: **monthly nets $2.97 of $3.49, annual nets
> $25.90 of $27.99.** Fixed per-transaction cost is what does it — 15% on the monthly charge
> against 8.5% on the annual one, for the same customer.
>
> That does not make monthly wrong; it makes monthly a conversion instrument rather than a
> revenue one. Which plan the paywall pre-selects is therefore a deliberate choice (annual), not
> a layout accident.

### Web only — Android is not touched by this phase

Android keeps `react-native-iap` and its one-time `harp2tab_premium` SKU; native entitlement
stays the local `isPurchased` flag exactly as it works in production today. No
`react-native-purchases` migration, no Play subscription SKUs, no native release in this
phase. Consistent with `feedback_web_first_no_mobile_hedging`, and native billing stays a
Phase 15 question.

The platform seam already makes this free: `useIAP.web.ts` is the only file that changes,
`useIAP.ts` is untouched, and that is precisely what the seam was built for.

### Grandfathering is a conversation, not a mechanism

**There is one existing Play Store lifetime buyer, and the user knows him personally.** That
single fact deletes a sub-project: no order-ID claim form, no Play Developer Orders API
integration, no server-side receipt import, no `react-native-purchases` on Android, no
first-sign-in reconciliation hook. The grant is made by hand in the RevenueCat dashboard once
he signs in on web (8-7).

**What survives is the promise, not the machinery.** 7-6's voluntary door carries the copy
"Bought Harp2Tab on Google Play? Sign in to keep your lifetime access on the web"
(`profile.tsx:302` and the sign-in modal). That sentence is the reason the voluntary door is
mandatory at all, and it stays — backed by a support address and a written runbook rather than
by code. Deleting it because there is currently only one buyer would remove the door's
justification along with its cost.

### The free tier does not change

Three sessions per device, counted in local storage, trivially resettable — unchanged from
Phase 7's decision, which parked "revisit with Phase 8" and is hereby revisited and left
alone. Server-enforcing it still costs a Cloud Function on every session start, and the free
tier's job is to demonstrate the app, not to defend a boundary.

## The staging: 8a / 8b / 8c — and where money actually enters

**User decision, 2026-08-13**, on the same reasoning as 7a-UI: build everything that does not
require a commitment first, and let the commitment land against finished code. The phase
splits three ways, and **only the third one costs anything or is hard to undo.**

| | contents | what it commits |
|---|---|---|
| **8a — no money anywhere** | 8-3 revocable entitlement · 8-2 the writer, on the emulator · 8-5 the three-plan paywall on mock offerings · 8-6 `/profile` · `verify-entitlement.ts` | **nothing.** No accounts, no cards, no vendor. Firebase emulator only |
| **8b — test mode** | 8-1 setup · 8-4 the Web SDK · real purchases with Stripe test cards · the real webhook round trip | **nothing.** A Stripe account with no business details and no bank account can *only* do test mode |
| **8c — go live** | Stripe activation · Managed Payments on · the domain · 8-9 legal pages · Blaze · 8-8 the free-tier flip | identity, a Belgian bank account, the MoR decision, and the domain |

**8a is most of the phase's code and none of its risk.** The largest single change — making
`isPurchased` revocable, below — has nothing to do with who processes payments; it would be
identical under Paddle, under RC Billing, or under a hand-rolled Stripe integration. It is
driven entirely by entitlement documents, which can be written by hand into the Firestore
emulator. The paywall's three-plan layout is the same work whether the prices come from Stripe
or from a mock, and `src/auth/mockStates.ts` already set the pattern for exactly this during
7a-UI.

**8b costs nothing either, and this is the part that is easy to disbelieve.** A Stripe account
created today, with no legal name, no tax details and no bank account, runs in test mode
immediately — and RevenueCat automatically routes sandbox purchases to Stripe's test mode. An
un-activated Stripe account is *incapable* of taking a real payment, which makes it the safest
possible place to build a purchase flow. Test card `4242 4242 4242 4242` produces a real
purchase, a real webhook, and a real entitlement document.

So **8b is also where 8-1.6 gets answered for free**: whether the $44.99 lifetime sells through
Stripe Billing is a test-mode purchase, not a commitment.

**Managed Payments is switched on in 8c, not 8b.** It requires an activated account, and it
changes nothing in the code — which is the whole point of the paragraph above. Everything is
built and proven against plain Stripe Billing test mode first; the merchant-of-record decision
is executed as a dashboard setting at the end, against a purchase flow that already works.

## The finding that reshapes the code: `isPurchased` is a one-way latch

```ts
setPurchased: () => set({ isPurchased: true }),   // useSettingsStore.ts:83
```

There is no `setUnpurchased`, and nothing anywhere sets it back to `false`. That is exactly
right for a one-time Play unlock — a lifetime purchase never stops being true — and it is
wrong for everything this phase sells. **Subscriptions lapse, cards fail, people cancel, and
refunds happen.** Under Phase 8, paid access becomes a value with an expiry that can go from
true to false while the user does nothing on this device.

Nothing in the roadmap had planned for that, and it is the largest code change in the phase.
The model:

```
  precedence, highest first
  1. RC Web SDK customerInfo    live truth on web, requires network, authoritative at purchase
  2. /entitlements/{uid}        the cross-platform mirror — 7a's reader, 8-2's writer
  3. local cached entitlement   survives offline and cold start, carries its own expiry
  4. legacy local isPurchased   native's Play unlock. true means lifetime, forever, unrevoked
```

Rules that fall out of it, each one a bug if missed:

- **`resolveSessionGate` does not change.** It takes a boolean (`sessionGate.ts:15-27`); the
  boolean simply stops being a latch. No entry point, no screen and no gate call site moves.
- **Never revoke on a network error.** "Could not find out" and "definitely not paid" are
  different answers, and `entitlement.web.ts` already documents that distinction. Conflating
  them shows the paywall to a paying customer over a dropped connection.
- **Grace, not a cliff.** A cached subscription is honoured until `expiresAt` plus a 3-day
  grace, which covers Stripe's billing retries. `BILLING_ISSUE` is not expiry.
- **Sign-out clears the cached entitlement — and must not touch `isPurchased`.** They are two
  different flags with two different owners: one belongs to the account, one to the device's
  Play purchase. Merging them either strips the native buyer on sign-out or leaves a
  signed-out browser permanently premium. Both directions have shipped in other apps.

## 8-1 · Accounts, products, and the setup that is not code

Sequential; each step blocks the next.

1. **Confirm Stripe Managed Payments eligibility for a Belgian account, before anything
   else.** It is a rollout product built from Stripe's Lemon Squeezy acquisition and is not
   universally available. Stripe's own availability list appears to include Belgium, but that
   was read off a marketing page and **is not confirmation** — confirm it in the dashboard
   during onboarding, as step one. If it is unavailable, the fallback is **Paddle**: the
   decision is re-taken between MoR providers, *not* silently downgraded to self-MoR, because
   self-MoR carries the UK obligation from the first sale either way.
2. Stripe account (Belgium) + business identity verification — a sole trader with a KBO/BCE
   number is sufficient; this does not require a company. Create three flat-rate
   products/prices.
3. Install RevenueCat's app from the Stripe Marketplace; create the Stripe configuration in
   RC; import the products into RC's product catalog; group them into one Offering.
4. **One entitlement identifier — `premium` — granted by all three products.** One identifier
   is what keeps the client from ever branching on a product id, which is how paywall bypasses
   and "the annual plan doesn't unlock export" bugs happen.
5. Register payment domains so Apple Pay / Google Pay appear in checkout.
6. **Verify that the one-time lifetime product actually sells through this path.** RC Billing
   documents one-time purchase support; the Stripe Billing integration documents that *repeat
   consumable* purchases are unavailable, which implies a non-consumable one-time product is
   fine but does not say so. **Resolve with a test-mode purchase before the paywall is built
   around three plans.** Fallbacks in order of preference: keep lifetime as a Stripe one-time
   price if it imports; otherwise drop lifetime from the web paywall and leave it a legacy
   grant; otherwise run lifetime alone through RC Billing and accept being MoR for that one
   product — the worst option, and a conscious choice if it happens, not a default.
7. **`TODO(domain)` — the fourth thing blocked on the custom domain.** Stripe's onboarding
   wants a public business URL describing the product, its prices, a refund policy and a
   contact. This does not reverse the 2026-08-13 deferral: everything in this phase can be
   built and tested in Stripe test mode against nothing, and the domain gates **go-live**, not
   the build. Add it to the fix-up checklist (`grep -rn "TODO(domain)" src/`).

### Setup state — 8b complete, 2026-08-19

**A sandbox purchase works end to end**: Web SDK → Stripe checkout → RevenueCat → the deployed
`revenuecatWebhook` → `/entitlements/{uid}` → paid access, with cancellation revoking it. The
click-by-click record, including the divergences from the plan below, is in
[`../stripe-setup.md`](../stripe-setup.md). What that surfaced, in order of how much it matters:

- **Trials and coupons are supported after all.** RevenueCat's Stripe Billing docs, re-read
  2026-08-18: *"Free trials are supported in RevenueCat purchase flows"*, *"Stripe coupons are
  supported"*. The paragraph below recording "no promo codes or free trials are possible on this
  billing path" as a knowing trade **is wrong** and the trade is off the table. Whether to
  actually offer a trial is now an open product decision, cheapest to take at product-import time.
- **RevenueCat keys imported products on the Stripe _price_ id.** So `RC_LIFETIME_PRODUCT_IDS` is
  `prod_V4Zi9i9aFBYHoS,price_1U4QkIEE7XhRWEbEYDYqI4tK`, and `PLAN_BY_PRODUCT_ID`
  (`src/billing/plans.ts`) maps both forms.
- **`EntitlementDoc` gained `productId`** (`functions/src/revenuecat.ts`), written from
  `event.product_id`. Without it `/profile` can only say "Premium" — and the tempting shortcut of
  deriving the term from the dates is wrong, because `since` is the *original* purchase, so after
  twelve renewals a monthly subscription spans a year.
- **A custom checkout domain is impossible on this path**: *"Custom domains aren't supported for
  Managed Payments."* Checkout stays on Stripe's domain and receipts say *Sold through Link*.
- **Open measurement**: whether Managed Payments treats listed prices as tax-inclusive. It
  withholds indirect taxes at completion, which on a €4.49 EU B2C sale is ~€0.78 before card and
  MP fees — a materially different margin from the one the pricing section below assumes.

**8-4/8-5/8-6 shipped** with it: `useIAP.web.ts` on `@revenuecat/purchases-js`, the three-plan
paywall reading the offering, and `/profile`'s plan block with the Stripe customer-portal link.
Two defects were found and fixed while testing, both worth remembering:

- `paywall.tsx` called `setPurchased()` on **every** successful purchase including web. That flag
  is the device-local one-way latch, so a cancelled web subscriber would have stayed premium on
  that browser forever with the entitlement store saying "revoked" — the exact latch problem 8-3
  set out to end, surviving on the one path that still called it. Now native-only.
- SDK configuration lived inside `useIAP`, a hook that mounts only on the paywall, so `/profile`
  never had `managementURL` and its Manage row never appeared. Configuration now follows the
  *account* (`src/billing/purchases.web.ts`, started from the root layout beside the auth and
  entitlement listeners).

### What exists in Stripe — as of 2026-08-14

8-1 steps 1 and 2 are done. **Belgium is eligible for Managed Payments** (8-1.1 answered —
this closes the phase's blocking open question and takes the Paddle fallback off the table).

The account is a **sandbox** — Stripe replaced the old test-mode toggle with sandboxes, which
are isolated copies carrying their own API keys, webhooks and data. Consequence for 8c: the
RevenueCat connection and the webhook built against this sandbox **do not carry over to live**
and get redone against the activated account.

| | id |
|---|---|
| account | `acct_1U4QQhEE7XhRWEbE` — "Harp2Tab sandbox", country BE, `charges_enabled: false`, `details_submitted: false` |
| publishable key | `pk_test_51U4QQhEE7XhRWEbEpK9RXbmEVju5Mg09QixyFdqaA5TTfkn9G3UUOsC94fbpgosaEhyrzTVvBksTjkGbhklq1D0300NuXtJCly` |
| monthly | `prod_V4ZiRNhE4Z46KV` → `price_1U4QkFEE7XhRWEbEBUTxzoIb` (€4.49/month) |
| annual | `prod_V4ZiiNm4QnNCqp` → `price_1U4QkGEE7XhRWEbE2shVLHvB` (€35.99/year) |
| lifetime | `prod_V4Zi9i9aFBYHoS` → `price_1U4QkIEE7XhRWEbEYDYql4tK` (€57.99 one-time) |

**`prod_V4Zi9i9aFBYHoS` is the value for `RC_LIFETIME_PRODUCT_IDS`** — not yet set. Until it
is, a lifetime purchase arrives with no expiry and no lifetime signal, and `isAmbiguousGrant`
logs it rather than granting permanent access (`functions/src/index.ts:99`).

The three USD prices created earlier the same day are archived, not deleted — Stripe prices are
immutable, so the euro reprice was create-new + archive-old. Product ids survived it, which is
why the id above stays valid across the change.

Not done: RevenueCat account, the Marketplace app, the product import, the `premium`
entitlement, the Offering, payment-domain registration (8-1 steps 3–5), and 8-1.6's lifetime
test purchase.

### The database is real, and it is in the US

*Recorded 2026-08-13. Established by asking, after 8a-1 became the first code in the app that
actually calls Firestore — 7a's reader existed but was deliberately unwired, so until then the
question had never come up in practice.*

- **The Firestore database exists and `firestore.rules` is deployed to it.** Everything before
  today — 7a's rules, 7a's reader, 8-2's writer — had only ever run against the emulator.
- **Its location is `nam5` (US multi-region), and that is permanent.** A Firestore database's
  location cannot be changed after creation; the only "change" is a second database and a
  migration.

Two consequences, one technical and one legal:

- **Cloud Functions go in `us-central1`, not Europe.** The writer's Firestore access is a
  transaction — a read and then a write — so a function in `europe-west1` would cross the
  Atlantic twice per webhook. Co-locate with the data. (This corrects an `europe-west1` that
  was written into `functions/src/index.ts` on the assumption of an EU database.)
- **The privacy policy has to say data is stored in the United States**, and 8-9 owns that
  sentence. Lawful — Google is certified under the EU–US Data Privacy Framework, so the
  transfer has an adequacy basis — but it is a disclosure obligation, not a silent detail, and
  it is the second thing about this project that is EU-facing while the infrastructure is not.

**Not worth undoing.** The read path is one cached document fetched on sign-in and on
foreground, and Phase 7's rule that no screen ever awaits Firestore means the extra ~150ms of
transatlantic latency is invisible by construction. This architecture is the best possible one
for a distant database. The real cost is the privacy-policy line, not the milliseconds.

## 8-2 · The entitlement writer — RevenueCat webhook → Cloud Function → `/entitlements/{uid}`

The one piece Phase 7 explicitly left for this phase. The document shape is already fixed by
7a's reader (`entitlement.web.ts`: `{plan, since, source, expiresAt}`), the rules already deny
every client write, and `verify-firestore-rules.ts` already tests that they do. The Admin SDK
bypasses rules, so `allow write: if false` stays exactly as written.

- **Firebase Functions v2**, which requires the Blaze plan — a new billing dependency for the
  project, small at this volume but not zero.
- **Verify the shared secret.** RC sends a configurable `Authorization` header; hold it in
  Secret Manager and reject anything else. This endpoint grants paid access to whoever can
  POST to it.
- **Make the write a projection of current state, not an application of an event.** RC retries
  on failure and events can arrive out of order; an out-of-order `RENEWAL` landing after an
  `EXPIRATION` would resurrect a dead subscription. Compare `event_timestamp_ms` against the
  document's stored `updatedAt` and drop anything older.
- **Event mapping, with the one that is always got wrong called out:**
  `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE` → write/extend. `NON_RENEWING_PURCHASE` →
  `plan: 'lifetime'`, no `expiresAt`. `EXPIRATION` → revoke. `BILLING_ISSUE` → **do not
  revoke**, grace applies. **`CANCELLATION` → do not revoke** — a cancelled subscription is
  paid through the end of its period, and revoking on cancellation takes away time someone
  paid for. `REFUND`/`TRANSFER` → revoke.
- **Events for an anonymous app user id (`$RCAnonymousID:…`) have no uid to write to.** Log
  loudly and drop. This case existing at all means 8-4's "never configure the SDK signed out"
  rule was violated.
- **Known gap, carried deliberately into 8b (2026-08-13): the function has never been
  executed.** Its decisions are covered by 47 harness cases, and both type-check and build are
  clean, but the transport around them — the 401 on a bad `Authorization` header, the write
  landing in the shape `fetchEntitlement` reads, the revoke deleting rather than half-writing,
  and the transaction holding under concurrent delivery — is unproven. Blocked twice over: the
  Firestore emulator now requires JDK 21 (this machine has 18, which also means 7a's
  `verify-firestore-rules.ts` has never run here), and the alternative of running against the
  real project is unsafe on a machine whose `GOOGLE_APPLICATION_CREDENTIALS` points at a
  *different* Firebase project. **8b's first test-mode purchase exercises all four**, so this
  is a sequencing choice, not an accepted risk — but if it is still unproven when 8b's webhook
  misbehaves, this is the first place to look.
- **Alternative considered and rejected: RevenueCat's official Firebase Extension**
  (`firestore-revenuecat-purchases`). It stores RC's own customer and event shapes in
  collections of its choosing and can set Auth custom claims. Adopting it means either
  rewriting 7a's reader, rules and rules-tests around a foreign document shape, or writing a
  second function to project its output into ours. Custom claims also go stale until the token
  refreshes. Our own ~100-line function against a document we designed is smaller than the
  adapter would be.

## 8-3 · Entitlement becomes revocable client state

A new persisted store — `useEntitlementStore` — holding `{plan, expiresAt, source, fetchedAt}`
and exposing the derived `hasPremium` that implements the precedence order and the grace
window above. It is the only consumer of `fetchEntitlement`.

- **Refresh points:** sign-in, cold start, window focus, post-purchase, and the RC SDK's
  customerInfo listener. Not on a timer.
- **It is the only module that reads Firestore**, which keeps Phase 7's rule intact — no
  screen, hook or selector gains a network dependency. It is the same shape 7b's sync engine
  will take, deliberately: one module owns the network, everything else reads a store.
- **`setPurchased()` stops being called on web.** It remains for native's Play path only, and
  its docstring should say so, because a future reader will otherwise assume it is dead code.

## 8-4 · The RevenueCat Web SDK on the client

`@revenuecat/purchases-js`, web only, dropped into `src/hooks/useIAP.web.ts` — the file that
currently returns "Purchases on the web are coming soon." Native `useIAP.ts` does not change.

- **Configure with `appUserId` = the Firebase UID. Never configure anonymously.** An anonymous
  purchase produces an entitlement with no identity to attach it to, which is the exact
  reconciliation problem this phase exists to end — recreating it on purpose, on the one code
  path that could.
- Prices render from the Offering, per plan, the way `paywall.tsx:54` already renders
  `product?.displayPrice ?? '...'`. **No price string is hardcoded in the app**, or the
  paywall and Stripe drift the first time either changes.
- On success the SDK returns customerInfo synchronously; that is the truth for the seconds
  before the webhook lands. Set the entitlement store from it and never block the UI on
  Firestore catching up.
- Sign-out must tear down the SDK's configured user as well as clearing the store.

## 8-5 · The paywall, rewritten

`paywall.tsx` today sells one thing. It becomes a three-plan screen on web while staying
exactly as it is on native.

- **`"one-time purchase · no subscription"` (`paywall.tsx:79`) is now false on web** and must
  go there. **On native it stays true and stays put** — Android still sells the one-time
  unlock, and that line is the promise made to the buyer who already has one. Split the price
  block by platform rather than editing it in place.
- **Verified email is required before purchase.** 7-4 flagged this and this is where it lands:
  an entitlement attached to an unverified address is attached to nobody. The account step
  (`paywall.tsx:113-127`) gains a third state between signed-out and signed-in — signed in but
  unverified, purchase disabled, with `VerifyBanner`'s resend affordance inline.
- **"Restore Purchase" means different things per platform.** On native it is Play's
  `getAvailablePurchases`. On web it is "re-read my entitlement" — the same button, a
  different verb, and on web it is also the button the manual lifetime grant is collected by.
- The take-preservation effect (`paywall.tsx:46`) is untouched and now also covers the
  checkout redirect, which is a second way to leave the page mid-flow.
- Error states to write copy for: declined card, checkout window closed without paying,
  network failure mid-purchase, and already-entitled.

## 8-6 · `/profile` — the plan block, for real

Replaces the placeholders at `profile.tsx:410-427`, including the `Billing` row whose copy
currently reads "Subscriptions and web billing arrive with the next release" (`:419-423`) —
this is the release. Real plan name, renewal or expiry date, a manage-billing link into
Stripe's customer portal, cancel, and the lifetime badge.

7-7's honest-placeholder rule inverts here: the reason that row was allowed to be a
placeholder was that rendering a fake subscription would be a lie, and now there is a real one
to render.

**Say what lapsing costs, on the page, before it happens.** A lapsed subscriber keeps their
entire library — storage is local-first, nothing is deleted — and loses the ability to start
new sessions. That is already what `resolveSessionGate` does; the only failure would be
letting them discover it.

## 8-7 · The lifetime buyer, by hand

One person, known personally. He signs in on web; his `premium` entitlement is granted against
his Firebase UID in the RevenueCat dashboard. The code that has to exist is only the door 7-6
already built.

What this phase adds is **a support email address behind the promise and a runbook in
`docs/development.md`**, so that the second such grant — if there is ever one — is executed rather
than re-derived. That is the whole of the grandfathering deliverable that Phase 7 and the
summary above both budgeted a reconciliation subsystem for.

## 8-8 · Turning the free tier back on

`FREE_TIER_ENABLED = false` (`useSettingsStore.ts:24`) is development-only and has been since
Phase 0. **While it is false no web user can reach the paywall at all**, so every purchase
path in this phase is unreachable in a real session until it flips.

Flip it locally to exercise the gate throughout the phase; flip it for real as the phase's
last commit, after a test-mode purchase of all three plans has round-tripped through the
webhook. It is the switch that turns billing on, and it should be its own commit.

## 8-9 · The legal surface, which Stripe will actually check

Merchant of record moves the tax liability, not the disclosure obligations:

- A **public pricing page** (12-3's landing page becomes it), a **refund and cancellation
  policy**, a contact route, and **terms of service — which do not exist in this repo at all**.
- `PRIVACY_POLICY.md` was rewritten in 7-13 for accounts and now needs its payment paragraph:
  what Stripe and RevenueCat hold, and that the app never sees or stores card data.
- All of these are public URLs, which is the same dependency as 8-1.7.

## What Phase 8 does not do

7b's sync engine — it still follows this phase · any change to Android billing, and no native
release · Play subscription SKUs · promo codes, coupons and free trials (unsupported on this
path — see the decision) · RC's paywall builder, web-to-app funnels and paywall A/B testing
(a separate body of work, and premature at one buyer) · server-side free-tier enforcement
(decision unchanged) · self-service refunds · family or team plans · anything on iOS.

## Verification

- **Test-mode purchase of each of the three plans**, end to end, including the lifetime one —
  which is also how 8-1.6's open question gets answered.
- **Replay every webhook event type** from RC's dashboard against the deployed function and
  assert the resulting document. **`CANCELLATION` must not revoke; `EXPIRATION` must.** Replay
  one of them twice, and one of them out of order, to prove the projection is idempotent.
- **The revocation pass, which has no unit test:** subscribe in test mode, cancel, force
  expiry, confirm the app returns to the free gate on next focus and that **the library is
  fully intact**.
- **Offline:** entitled, go offline, hard-reload — still premium. Advance past
  `expiresAt` + grace — free. Kill the network mid-refresh — still premium, never revoked on
  an error.
- **Sign out on a paid browser → free. Sign back in → paid.** Then the native check: the
  device's `isPurchased` is untouched by either.
- **An unverified account cannot reach the purchase call**, and **a signed-out user cannot
  configure the SDK** — the two invariants that keep entitlements attached to identities.
- **Fee reconciliation, once:** put a real $3.49 charge through and compare the payout against
  the table at the top of this phase. Numbers taken from vendor docs are worth confirming once
  against a bank statement.
- The 7a no-regression check still stands: **signed out, everything except starting a session
  past the limit works exactly as it does today.**

## Suggested build order

### 8a — no accounts, no cards, no vendor (now)

1. **8-3 the entitlement store and revocation.** The biggest change in the phase and the one
   least connected to billing. Driven by entitlement documents written by hand into the
   Firestore emulator. Ends with paid access that can expire, revoke, survive offline and
   clear on sign-out — with no way to buy anything.
2. **8-2 the writer**, against the Functions + Firestore emulators, driven by hand-authored
   RevenueCat webhook payloads. It is the only component that can silently grant or strip paid
   access, so it gets built where it is cheapest to be wrong. Paired with
   **`verify-entitlement.ts`** — a pure harness over the event→document mapping, following
   `verify-sync.ts`'s intent: `CANCELLATION` does not revoke, `EXPIRATION` does, replays are
   idempotent, out-of-order events are dropped, grace is honoured.
3. **8-5 the paywall and 8-6 `/profile`, on mock offerings.** Three plans, the
   signed-in-but-unverified state, every error state, the lapsed-subscriber copy — reviewable
   at `?mock=` URLs exactly as 7a-UI's screens were, with no SDK present.

### 8b — Stripe test mode (still free, still reversible)

4. **8-1 setup**: a Stripe account with nothing filled in, products created in test mode, the
   RevenueCat app installed from the Stripe Marketplace, products imported, one `premium`
   entitlement, one Offering. **8-1.6's lifetime question is answered here**, by trying it.
5. **8-4 the Web SDK** wired into `useIAP.web.ts`, replacing 8a's mock. Real test-card
   purchases of all three plans, through the real webhook, into the real document, read by the
   store built in step 1.

### 8c — the commitments (only when the rest works)

6. **Stripe activation** (identity, Belgian bank account) and **Managed Payments switched on**
   — a dashboard setting against a purchase flow that already works end to end.
7. **The domain**, then **8-9 legal pages** + **8-7 the manual-grant runbook**.
8. **Blaze plan** and the function deployed for real.
9. **8-8 flip `FREE_TIER_ENABLED`.** Last, deliberately, and on its own commit.

## Open questions

1. **Does the $44.99 lifetime sell through Stripe Billing?** (8-1.6) Blocking, cheap to
   answer, three fallbacks ranked.
2. **Is Stripe Managed Payments available to a Belgian account?** (8-1.1) Blocking, and
   answered in the dashboard rather than by reading marketing pages. If not, the choice is
   Paddle, not self-MoR.
   **Adjacent, and not a code question:** whether Stripe's reverse-charge payouts are
   compatible with staying inside the Belgian franchise scheme. One accountant's hour.
3. **The custom domain** — now four items on the deferred fix-up pass. Gates go-live, not the
   build, so the 2026-08-13 deferral holds.
4. **Which side is authoritative, the RC SDK or the Firestore document?** Settled above as
   "SDK live, document as the cross-platform mirror" — but 7b's sync engine has to answer the
   same question for its own state, and the two answers should be the same shape.
5. **Monthly's role at these fees.** Not a decision for now; revisit against real conversion
   data rather than against the fee table.
