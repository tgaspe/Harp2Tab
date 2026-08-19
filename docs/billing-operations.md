# Running billing — Stripe + RevenueCat operations

Day-two notes: how to change a price, refund someone, grant access by hand, and work out why a
customer who paid cannot get in. [`stripe-setup.md`](stripe-setup.md) is how the system was
*built*; this is how it is *run*.

Written 2026-08-19, against the sandbox. Everything here applies to the live account too, but
none of it has been done in anger yet — nothing has ever been sold on the web.

---

## Who owns what

```
your app  →  RevenueCat  →  Stripe  →  the customer
   ▲            (catalogue,   (money, tax,
   │             entitlement   disputes,
   │             truth)        portal)
   └──── revenuecatWebhook → /entitlements/{uid} ────┘
```

- **Stripe** holds products, prices, subscriptions, invoices, refunds, the customer portal, and
  — because Managed Payments is on — is the **merchant of record**: it calculates and remits
  VAT, handles disputes, and appears on the buyer's statement as *Sold through Link*.
- **RevenueCat** holds the catalogue the app reads (products → entitlement → offering →
  packages) and is the thing that decides someone "has `premium`". It never holds money.
- **Your app** never asks either of them at render time. `revenuecatWebhook` writes
  `/entitlements/{uid}` and the client reads a cached copy of that document.

The consequence worth internalising: **money questions go to Stripe, access questions go to
RevenueCat, and "why is the app not showing it" goes to Firestore and the function logs.**

---

## Changing a price

**Stripe prices are immutable.** There is no edit. Changing a price means creating a new one and
archiving the old, which is why the EUR reprice on 2026-08-14 left the product ids intact and
replaced only the price ids.

1. **Stripe** → the product → **Add another price**. Set the new amount and interval.
2. **Archive** the old price. Archiving does *not* touch existing subscribers — they keep paying
   the old amount until you migrate them deliberately (see below). This is the mechanism by which
   grandfathering happens, and it happens by default.
3. **RevenueCat** → Product Catalog → Products → **Import** the new price. Remember only **one
   price per product** can be imported; importing the new one replaces which price the app sells.
4. **Offering** → point the package at the newly imported product.
5. **Code**, in the same commit:
   - `PLAN_BY_PRODUCT_ID` in `src/billing/plans.ts` — **add** the new price id, don't replace the
     old one. Existing subscribers' entitlement documents still carry the old id, and `/profile`
     reads its plan name from that map.
   - `MOCK_WEB_PLANS` — the fallback price strings and the "€3.00 a month — save 33%" style notes,
     which are *copy*, not derived. The paywall renders live prices from the offering, so these
     only show when the offering fetch fails — but they are also what the landing page publishes.
   - `RC_LIFETIME_PRODUCT_IDS` in `functions/.env`, if the lifetime price changed, then redeploy.
6. **Landing page** — the pricing section is hardcoded marketing copy. It is the one place a stale
   number is publicly visible.

**Migrating existing subscribers to a new price** is a separate, deliberate act: Stripe →
the subscription → update the subscription item's price, choosing whether to prorate. RevenueCat
sends `PRODUCT_CHANGE`, which `GRANTS` treats as "still paid" and rewrites the document with the
new product id. Consider announcing it first; a surprise price rise is the classic way to convert
a subscriber into a chargeback.

---

## Adding a trial or a coupon

Both are supported on this path (corrected 2026-08-18 — the original plan wrongly recorded them
as impossible).

- **Free trial**: attached to a price **when you import it into RevenueCat**. Adding one later
  means a new import, so decide before you publish a price you intend to keep.
- **Coupon**: created in Stripe (Products → Coupons), honoured in RevenueCat's purchase flow.

A trial arrives as `INITIAL_PURCHASE` with `period_type: 'TRIAL'` and a real `expiration_at_ms`,
so it grants access and expires on its own — no code change. Watch that the paywall copy tells the
truth about when the first charge lands; that sentence is the one regulators and chargebacks care
about.

---

## Granting access by hand (8-7)

The grandfathering mechanism, and the answer to any "I paid and something broke" incident.

1. Get the customer's **Firebase uid** — it is their RevenueCat customer id, because the SDK is
   configured with the uid and never anonymously. `/profile` shows the account email; Firebase
   Console → Authentication maps email → uid.
2. **RevenueCat** → Customers → that customer → **Grant entitlement** → `premium`, with a duration
   (or lifetime).
3. The grant arrives at the webhook with `period_type: 'PROMOTIONAL'`, which `isLifetimeGrant`
   accepts as an open-ended grant, so an expiry-less promotional grant is stored as `lifetime`.
   A dated grant stores its expiry and lapses on its own.
4. Tell them to press **"Already paid? Restore access"** on `/paywall`, or just to reload — the
   entitlement listener re-reads on sign-in and on foreground.

To take it back, revoke the grant in RevenueCat. There is no client-side path to grant anything:
`firestore.rules` denies every client a write to `/entitlements/{uid}`, and
`verify-firestore-rules.ts` tests that it does.

---

## Refunds, cancellations and disputes

| What happened | Where you do it | What the app does |
|---|---|---|
| Customer wants to cancel | They use the **customer portal** (`/profile` → Billing → Manage). You can also cancel from Stripe → the subscription | `CANCELLATION` is **ignored** — they paid through the period. `EXPIRATION` at period end writes the revoke tombstone |
| Cancel immediately | Stripe → subscription → cancel immediately | `EXPIRATION` lands within minutes; access drops on the next refresh |
| Refund | Stripe → the payment → **Refund** | Arrives as `CANCELLATION` with `cancel_reason: 'CUSTOMER_SUPPORT'`, which **revokes immediately** — the money went back, so the access goes with it |
| Refund reversed | Stripe | `REFUND_REVERSED` is in `GRANTS`; access returns |
| Chargeback / dispute | **Stripe handles it** — Managed Payments makes disputes theirs, including the evidence | Whatever entitlement event follows |
| Payment failed | Nothing — the bank retries for days | `BILLING_ISSUE` is deliberately ignored; `ENTITLEMENT_GRACE_MS` (3 days) covers the retry window, and `/profile` says "Payment due" |

**Cancellations can take up to two hours to reach RevenueCat.** A quiet ten minutes is not a bug.

---

## "I paid but I don't have access" — the checklist

Work down it; each step tells you which system to blame.

1. **RevenueCat → Customers →** the uid. Is `premium` active?
   - **No** → the purchase never completed, or it was attached to a different account. Check
     Stripe for a payment at that time; if there is one, the identity is the problem.
2. **RevenueCat → Integrations → Webhooks →** delivery history. Any non-200?
   - **401** → the `Authorization` header and `REVENUECAT_WEBHOOK_SECRET` disagree. Note that a new
     secret version does nothing until the function is redeployed.
   - **5xx** → check the function logs; RevenueCat retries, so a transient failure heals itself.
3. **Function logs** — `npx firebase functions:log --only revenuecatWebhook`.
   - `Ignored event — does not grant premium` → the entitlement identifier is wrong in RevenueCat.
     It must be exactly `premium`.
   - `Ignored event` on a sandbox purchase in production → `RC_ACCEPT_SANDBOX=false`, correctly.
   - `Dropped stale event` → an out-of-order delivery was refused; check the stored `updatedAt`.
   - `Grant has no expiry and no lifetime signal` → a product id is missing from
     `RC_LIFETIME_PRODUCT_IDS`; the customer *is* let in, recorded as a subscription.
4. **Firestore → `/entitlements/{uid}`.** Present and not `plan: 'revoked'`?
   - Present but the app disagrees → it is a client cache problem. The store re-reads on sign-in
     and on foreground; a reload settles it.
5. **Still nothing** → grant by hand (above), then find out why afterwards. A paying customer
   waiting on a diagnosis is the wrong order.

---

## Things that will bite

- **The sandbox is a different account.** Nothing configured there — connection, products,
  offering, portal URL, branding, webhook, API key — exists in live. All of it is redone at 8c.
- **`RC_ACCEPT_SANDBOX` must be `false` in production.** With it `true`, anyone who can reach the
  endpoint with the secret and a sandbox payload grants themselves access.
- **Secret versions are pinned at deploy.** Rotating without redeploying changes nothing; the
  function keeps using the old version.
- **`TRANSFER` is unhandled.** RevenueCat sends it when a purchase moves between app user ids. It
  falls to the `alert` branch — logged loudly, no write. It cannot happen while every customer id
  is a Firebase uid and purchases are never anonymous, but if it ever appears in the logs, that
  assumption has broken somewhere.
- **Stripe Test Clocks are not fully supported** by RevenueCat, so renewal-over-time cannot be
  simulated. Renewal behaviour is first observed in production.
- **No custom checkout domain**, ever, on this path — Managed Payments excludes it.
- **The lifetime product is still unproven.** It has never been bought, in sandbox or live.

---

## Money

- **Fees**: Stripe Belgium's 1.5% + €0.25 on EEA cards, plus Managed Payments' 3.5% — about
  **5% + €0.25**, which on €4.49 is roughly €0.47.
- **Tax**: withheld by Stripe at completion in the 80+ countries Managed Payments covers,
  including the whole EU. Verify empirically whether your listed price is treated as
  tax-inclusive — on a €4.49 Belgian B2C sale, 21% VAT is ~€0.78, which is the difference between
  the price being what you receive and what the buyer pays.
- **Payouts**: Stripe → Balances. Nothing pays out until the account is activated with a Belgian
  bank account (8c).
- **Revenue reporting** lives in both dashboards and they will not match exactly. RevenueCat's
  figures ignore proration and are net of nothing; Stripe's are the ones that reconcile to the
  bank.

---

## Periodic checks worth doing

- **Webhook delivery failures** in RevenueCat — the only place a silently-lost entitlement shows.
- **`Grant has no expiry and no lifetime signal`** in the function logs, which means a new product
  id needs adding to `RC_LIFETIME_PRODUCT_IDS`.
- **Stripe → Customer portal settings** after any Stripe change; the cancel path is a legal
  expectation, and `/profile`'s Manage row disappears silently if the URL is cleared.
- **Prices in three places agreeing**: Stripe, `MOCK_WEB_PLANS`, and the landing page.
