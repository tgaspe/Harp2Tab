/**
 * RevenueCat webhook event → entitlement document. The mapping half of 8-2, as a pure
 * function.
 *
 * **Deliberately dependency-free.** No firebase-admin, no SDK, no clock, no network — so
 * `scripts/verify-entitlement.ts` can drive every rule below with hand-authored events. These
 * are the rules that decide whether someone who paid keeps access and whether someone who
 * stopped keeps it too, and they are worth more test coverage than the transport around them.
 *
 * The document shape is not chosen here. It was fixed in 7a by `src/auth/entitlement.web.ts`,
 * which reads it, and by `firestore.rules`, which lets nothing else write it.
 */

/** The one entitlement identifier. All three products grant it — see 8-1.4. */
export const PREMIUM_ENTITLEMENT_ID = 'premium';

/** RevenueCat's placeholder for a customer who was never identified. */
const ANONYMOUS_PREFIX = '$RCAnonymousID:';

export type EntitlementPlan = 'lifetime' | 'subscription';

/** Exactly the document `entitlement.web.ts` reads, plus the field only the writer uses. */
export interface EntitlementDoc {
  plan:       EntitlementPlan;
  since?:     number;
  source?:    string;
  expiresAt?: number;
  /** `event_timestamp_ms` of the event that produced this. The staleness guard reads it. */
  updatedAt:  number;
}

/**
 * The subset of RevenueCat's event body this cares about.
 *
 * Typed as optional almost everywhere because it arrives over the wire from someone else's
 * system: a field this code requires is a field that can take the webhook down when RevenueCat
 * adds an event type that omits it.
 */
export interface RevenueCatEvent {
  type:                string;
  id?:                 string;
  app_user_id?:        string;
  entitlement_ids?:    string[] | null;
  product_id?:         string;
  store?:              string;
  environment?:        'SANDBOX' | 'PRODUCTION' | string;
  period_type?:        string;
  purchased_at_ms?:    number | null;
  expiration_at_ms?:   number | null;
  event_timestamp_ms?: number;
  cancel_reason?:      string | null;
  expiration_reason?:  string | null;
}

export type WriteAction =
  | { kind: 'upsert'; uid: string; doc: EntitlementDoc }
  | { kind: 'revoke'; uid: string; at: number }
  /** Not a failure. Most event types are none of this function's business. */
  | { kind: 'ignore'; reason: string }
  /** Something that should never arrive did. Ignored, but the caller should shout. */
  | { kind: 'alert';  reason: string };

export interface MapOptions {
  /**
   * Whether `SANDBOX` events may write real entitlements.
   *
   * **False in production, and this matters.** RevenueCat delivers sandbox and production
   * events to the same endpoint, so a test-mode purchase against a production webhook would
   * otherwise grant real paid access for free — a paywall bypass anyone could run. True only
   * on the emulator and in 8b's test-mode work.
   */
  acceptSandbox: boolean;
}

/** Grant events: the subscription is (still) alive and paid for. */
const GRANTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);

/** Events that carry no entitlement consequence at all. Listed so they are silent, not noisy. */
const INFORMATIONAL = new Set([
  'PAYWALL_IMPRESSION',
  'PAYWALL_CLOSE',
  'PAYWALL_CANCEL',
  'EXPERIMENT_ENROLLMENT',
  'INVOICE_ISSUANCE',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'PRICE_INCREASE_CONSENT_REQUIRED',
  'PRICE_INCREASE_CONSENT_APPROVED',
]);

export function mapEvent(event: RevenueCatEvent, { acceptSandbox }: MapOptions): WriteAction {
  if (event.environment === 'SANDBOX' && !acceptSandbox) {
    return { kind: 'ignore', reason: 'sandbox event on a production webhook' };
  }

  const uid = event.app_user_id;
  if (!uid) return { kind: 'alert', reason: `${event.type} with no app_user_id` };

  /**
   * An anonymous purchase has no account to attach paid access to. 8-4 forbids configuring the
   * SDK signed out precisely so this cannot happen, so one arriving means that rule was broken
   * somewhere — which is worth a human looking, not a silent drop.
   */
  if (uid.startsWith(ANONYMOUS_PREFIX)) {
    return { kind: 'alert', reason: `anonymous purchase (${event.type}) — no account to grant` };
  }

  if (INFORMATIONAL.has(event.type)) {
    return { kind: 'ignore', reason: `informational (${event.type})` };
  }

  /**
   * **A transfer is not automated on purpose.** It moves an entitlement between app user ids,
   * which is two writes against two accounts and a real chance of leaving paid access on the
   * wrong one. It can only arise from anonymous purchases or redemption links, neither of
   * which this app creates — so if one lands, the right response is a person, not a guess.
   */
  if (event.type === 'TRANSFER') {
    return { kind: 'alert', reason: 'TRANSFER needs a manual reconciliation — see 8-7' };
  }

  /**
   * Only act on events that name our entitlement.
   *
   * When `entitlement_ids` is absent the event is ignored in **both** directions, including
   * revokes. That is safe rather than lax: the document carries its own `expiresAt`, and
   * `resolvePremium` expires on it without needing to be told. So a missed `EXPIRATION` costs
   * nothing, while a guessed one would take access from someone who is paid up.
   */
  const ids = event.entitlement_ids;
  if (!ids || !ids.includes(PREMIUM_ENTITLEMENT_ID)) {
    return { kind: 'ignore', reason: `does not grant ${PREMIUM_ENTITLEMENT_ID}` };
  }

  const at = event.event_timestamp_ms ?? 0;

  /**
   * **The one everybody gets wrong: `CANCELLATION` is not the end of access.**
   *
   * Turning off auto-renew is what it usually means, and the customer has paid through the end
   * of the current period. Revoking here bills someone for a month and locks them out of it —
   * the loudest possible way to lose a customer who was merely undecided. `EXPIRATION` is the
   * event that ends access, and it arrives later, when the period actually ends.
   *
   * The exception is a support-issued refund, where the money went back and the access should
   * go with it, immediately rather than at the end of a period nobody paid for.
   */
  if (event.type === 'CANCELLATION') {
    if (event.cancel_reason === 'CUSTOMER_SUPPORT') {
      return { kind: 'revoke', uid, at };
    }
    return { kind: 'upsert', uid, doc: buildDoc(event, at) };
  }

  if (event.type === 'EXPIRATION' || event.type === 'SUBSCRIPTION_PAUSED') {
    return { kind: 'revoke', uid, at };
  }

  /**
   * A failed payment is not a cancelled subscription. The bank retries for days, and
   * `ENTITLEMENT_GRACE_MS` on the client is exactly the window that covers it — so the correct
   * action here is none at all. Writing anything would only move the expiry earlier.
   */
  if (event.type === 'BILLING_ISSUE') {
    return { kind: 'ignore', reason: 'billing issue — grace period covers it' };
  }

  /** The lifetime product. The only non-renewing thing this app sells. */
  if (event.type === 'NON_RENEWING_PURCHASE') {
    return {
      kind: 'upsert',
      uid,
      doc: {
        plan:      'lifetime',
        since:     event.purchased_at_ms ?? at,
        source:    sourceOf(event),
        updatedAt: at,
      },
    };
  }

  if (GRANTS.has(event.type)) {
    return { kind: 'upsert', uid, doc: buildDoc(event, at) };
  }

  // An event type RevenueCat added after this was written. Ignored — but loudly, because the
  // alternative is discovering it when a customer writes in.
  return { kind: 'alert', reason: `unhandled event type ${event.type}` };
}

function buildDoc(event: RevenueCatEvent, at: number): EntitlementDoc {
  const expiresAt = event.expiration_at_ms ?? undefined;

  // No expiry on a subscription event means a non-expiring grant — RevenueCat sends this for
  // lifetime entitlements granted outside a subscription, which is what 8-7's manual grant to
  // the existing Play buyer will look like when it arrives here.
  return {
    plan:      expiresAt === undefined ? 'lifetime' : 'subscription',
    since:     event.purchased_at_ms ?? at,
    source:    sourceOf(event),
    expiresAt,
    updatedAt: at,
  };
}

function sourceOf(event: RevenueCatEvent): string {
  return (event.store ?? 'unknown').toLowerCase();
}

/**
 * Should this event be applied, given what is already stored?
 *
 * RevenueCat retries on failure and does not guarantee ordering, so a `RENEWAL` can land after
 * the `EXPIRATION` that followed it. Applying that resurrects a dead subscription — the
 * failure mode that makes the whole write a projection of current state rather than a
 * sequence of edits.
 *
 * Equal timestamps are applied: a retry of the same event is idempotent by construction, since
 * it produces the same document.
 */
export function isFresh(event: RevenueCatEvent, storedUpdatedAt: number | undefined): boolean {
  if (storedUpdatedAt === undefined) return true;
  return (event.event_timestamp_ms ?? 0) >= storedUpdatedAt;
}
