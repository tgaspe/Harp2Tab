/**
 * Harness for the entitlement resolver — the rules that decide whether someone has paid.
 *
 * These are the rules that either take paid access away from a paying customer or hand it to
 * someone who stopped paying, and every one of them is a pure function of a document and a
 * clock. So they are driven here with hand-authored entitlements and an injected `now`, rather
 * than by subscribing in test mode and waiting a month for a renewal.
 *
 * Two halves, in the order the data flows:
 *   1. **8-2 · event → document** — what RevenueCat says happened, and what gets stored.
 *   2. **8-3 · document → access** — what is stored, and whether the app is unlocked.
 *
 * Run: npx tsx scripts/verify-entitlement.ts
 */

import {
  resolvePremium,
  ENTITLEMENT_GRACE_MS,
  type PremiumState,
} from '../src/store/entitlementState';
import type { Entitlement } from '../src/auth/entitlement';
import { mapEvent, isFresh, type RevenueCatEvent } from '../functions/src/revenuecat';

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function expect(name: string, actual: PremiumState, want: Partial<PremiumState>) {
  const wrong = (Object.keys(want) as (keyof PremiumState)[]).filter((k) => actual[k] !== want[k]);
  check(name, wrong.length === 0, wrong.map((k) => `${k}=${String(actual[k])}`).join(', '));
}

const NOW = Date.UTC(2026, 7, 13, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// 8-2 · event → document
// ─────────────────────────────────────────────────────────────────────────────

const UID = 'firebase-uid-abc';

/** A plausible event, overridden per case. Defaults to a grant of our entitlement. */
function ev(over: Partial<RevenueCatEvent> = {}): RevenueCatEvent {
  return {
    type:               'INITIAL_PURCHASE',
    id:                 'evt_1',
    app_user_id:        UID,
    entitlement_ids:    ['premium'],
    product_id:         'harp2tab_monthly',
    store:              'STRIPE',
    environment:        'PRODUCTION',
    period_type:        'NORMAL',
    purchased_at_ms:    NOW,
    expiration_at_ms:   NOW + 30 * DAY,
    event_timestamp_ms: NOW,
    ...over,
  };
}

const PROD = { acceptSandbox: false };

function kindOf(over: Partial<RevenueCatEvent>, opts = PROD) {
  return mapEvent(ev(over), opts).kind;
}

console.log('\nGrants');
{
  const action = mapEvent(ev(), PROD);
  check('INITIAL_PURCHASE upserts', action.kind === 'upsert', action.kind);
  if (action.kind === 'upsert') {
    check('  …for the right uid', action.uid === UID, action.uid);
    check('  …as a subscription', action.doc.plan === 'subscription', action.doc.plan);
    check('  …carrying the expiry', action.doc.expiresAt === NOW + 30 * DAY);
    check('  …stamped with the event time', action.doc.updatedAt === NOW);
    check('  …recording the store', action.doc.source === 'stripe', action.doc.source);
  }
}
check('RENEWAL upserts', kindOf({ type: 'RENEWAL' }) === 'upsert');
check('PRODUCT_CHANGE upserts', kindOf({ type: 'PRODUCT_CHANGE' }) === 'upsert');
check('UNCANCELLATION upserts', kindOf({ type: 'UNCANCELLATION' }) === 'upsert');
check('REFUND_REVERSED upserts', kindOf({ type: 'REFUND_REVERSED' }) === 'upsert');
{
  const action = mapEvent(ev({ type: 'NON_RENEWING_PURCHASE', expiration_at_ms: null }), PROD);
  check('NON_RENEWING_PURCHASE is the lifetime product',
    action.kind === 'upsert' && action.doc.plan === 'lifetime' && action.doc.expiresAt === undefined);
}
{
  const action = mapEvent(ev({ expiration_at_ms: null }), PROD);
  check('a grant with no expiry is a non-expiring entitlement (the 8-7 manual grant)',
    action.kind === 'upsert' && action.doc.plan === 'lifetime');
}

console.log('\nCANCELLATION — the one that is always got wrong');
check('a cancelled subscription is NOT revoked', kindOf({ type: 'CANCELLATION' }) === 'upsert');
check('  …and keeps its paid-through date',
  (() => {
    const a = mapEvent(ev({ type: 'CANCELLATION' }), PROD);
    return a.kind === 'upsert' && a.doc.expiresAt === NOW + 30 * DAY;
  })());
check('every non-refund cancel reason still keeps access',
  ['UNSUBSCRIBE', 'BILLING_ERROR', 'DEVELOPER_INITIATED', 'PRICE_INCREASE', 'UNKNOWN']
    .every((cancel_reason) => kindOf({ type: 'CANCELLATION', cancel_reason }) === 'upsert'));
check('a support refund DOES revoke, immediately',
  kindOf({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }) === 'revoke');

console.log('\nRevocations, and the one that must not be');
check('EXPIRATION revokes', kindOf({ type: 'EXPIRATION' }) === 'revoke');
check('SUBSCRIPTION_PAUSED revokes', kindOf({ type: 'SUBSCRIPTION_PAUSED' }) === 'revoke');
check('BILLING_ISSUE does nothing — grace covers the retry window',
  kindOf({ type: 'BILLING_ISSUE' }) === 'ignore');

console.log('\nEvents that are not ours');
check('another app\'s entitlement is ignored',
  kindOf({ entitlement_ids: ['some_other_thing'] }) === 'ignore');
check('an event with no entitlement_ids is ignored in both directions',
  kindOf({ entitlement_ids: null }) === 'ignore'
  && kindOf({ type: 'EXPIRATION', entitlement_ids: null }) === 'ignore');
check('paywall analytics are ignored silently',
  kindOf({ type: 'PAYWALL_IMPRESSION' }) === 'ignore');

console.log('\nThings that need a human, not a guess');
check('an anonymous purchase alerts rather than granting',
  kindOf({ app_user_id: '$RCAnonymousID:9f8e7d' }) === 'alert');
check('a missing app_user_id alerts', kindOf({ app_user_id: undefined }) === 'alert');
check('TRANSFER alerts rather than moving access', kindOf({ type: 'TRANSFER' }) === 'alert');
check('an unknown future event type alerts', kindOf({ type: 'SOMETHING_NEW_IN_2027' }) === 'alert');

console.log('\nSandbox must not grant production access');
check('a SANDBOX event is ignored in production',
  kindOf({ environment: 'SANDBOX' }) === 'ignore');
check('  …and is honoured when sandbox is explicitly accepted (8b)',
  kindOf({ environment: 'SANDBOX' }, { acceptSandbox: true }) === 'upsert');

console.log('\nRetries and out-of-order delivery');
check('a first event is always fresh', isFresh(ev(), undefined));
check('a replay of the same event still applies (idempotent, same document)',
  isFresh(ev({ event_timestamp_ms: NOW }), NOW));
check('a newer event applies', isFresh(ev({ event_timestamp_ms: NOW + 1000 }), NOW));
check('a RENEWAL arriving after the EXPIRATION that followed it is dropped',
  !isFresh(ev({ type: 'RENEWAL', event_timestamp_ms: NOW - 1000 }), NOW));

// ─────────────────────────────────────────────────────────────────────────────
// 8-3 · document → access
// ─────────────────────────────────────────────────────────────────────────────

const sub = (expiresAt: number): Entitlement => ({ plan: 'subscription', source: 'stripe', expiresAt });
const lifetime: Entitlement = { plan: 'lifetime', source: 'stripe' };

console.log('\nNo entitlement anywhere');
expect('signed-out free user is free',
  resolvePremium({ cached: null, isPurchased: false, now: NOW }),
  { premium: false, plan: 'free', source: 'none' });

console.log('\nThe device unlock (Play Store, one-time)');
expect('isPurchased alone grants lifetime',
  resolvePremium({ cached: null, isPurchased: true, now: NOW }),
  { premium: true, plan: 'lifetime', source: 'device' });

console.log('\nAn active subscription');
expect('a month from expiry',
  resolvePremium({ cached: sub(NOW + 30 * DAY), isPurchased: false, now: NOW }),
  { premium: true, plan: 'subscription', source: 'account', inGrace: false });
expect('one second from expiry is still paid',
  resolvePremium({ cached: sub(NOW + 1000), isPurchased: false, now: NOW }),
  { premium: true, inGrace: false });
expect('exactly at expiry is still paid',
  resolvePremium({ cached: sub(NOW), isPurchased: false, now: NOW }),
  { premium: true, inGrace: false });

console.log('\nGrace — a failed payment is not a cancelled one');
expect('one second past expiry is in grace, not revoked',
  resolvePremium({ cached: sub(NOW - 1000), isPurchased: false, now: NOW }),
  { premium: true, plan: 'subscription', inGrace: true, source: 'account' });
expect('the last instant of grace is still paid',
  resolvePremium({ cached: sub(NOW - ENTITLEMENT_GRACE_MS), isPurchased: false, now: NOW }),
  { premium: true, inGrace: true });
expect('one second past grace is free',
  resolvePremium({ cached: sub(NOW - ENTITLEMENT_GRACE_MS - 1000), isPurchased: false, now: NOW }),
  { premium: false, plan: 'free', source: 'none' });

console.log('\nLifetime, by account');
expect('a lifetime entitlement never expires',
  resolvePremium({ cached: lifetime, isPurchased: false, now: NOW + 4000 * DAY }),
  { premium: true, plan: 'lifetime', source: 'account', inGrace: false });

console.log('\nThe two sources do not erase each other');
expect('an expired subscription falls through to the device unlock',
  resolvePremium({ cached: sub(NOW - 400 * DAY), isPurchased: true, now: NOW }),
  { premium: true, plan: 'lifetime', source: 'device' });
expect('an active subscription outranks the device unlock',
  resolvePremium({ cached: sub(NOW + DAY), isPurchased: true, now: NOW }),
  { premium: true, plan: 'subscription', source: 'account' });

console.log('\nMalformed documents read as paid, not as free');
expect('a subscription with no expiry is honoured',
  resolvePremium({ cached: { plan: 'subscription', source: 'stripe' }, isPurchased: false, now: NOW }),
  { premium: true, plan: 'subscription', source: 'account' });

console.log('\nThe grace window is the one it claims to be');
check('ENTITLEMENT_GRACE_MS is three days', ENTITLEMENT_GRACE_MS === 3 * DAY,
  `${ENTITLEMENT_GRACE_MS}ms`);

console.log(failures === 0 ? '\nAll entitlement cases pass.\n' : `\n${failures} failing case(s).\n`);
process.exit(failures === 0 ? 0 : 1);
