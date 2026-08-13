/**
 * The entitlement writer (8-2) — the only thing in the system that may write
 * `/entitlements/{uid}`.
 *
 * `firestore.rules` denies that path to every client (`allow write: if false`), and
 * `verify-firestore-rules.ts` tests that it does. This runs with the Admin SDK, which bypasses
 * rules, so the rule stays exactly as strict as it reads: the client cannot write its own
 * entitlement, and a paywall bypass would have to go through this endpoint.
 *
 * **Which is why the first thing it does is authenticate.** Anything that can POST here can
 * grant itself paid access forever.
 *
 * All the interesting decisions live in `revenuecat.ts`, which is pure and tested. This file is
 * transport: verify, parse, guard against stale deliveries, write.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { isFresh, mapEvent, type EntitlementDoc, type RevenueCatEvent } from './revenuecat';

initializeApp();

/**
 * The value RevenueCat sends in the `Authorization` header, set on the webhook in their
 * dashboard. Held in Secret Manager rather than in config, because it is the only thing
 * standing between the internet and free premium.
 */
const REVENUECAT_WEBHOOK_SECRET = defineSecret('REVENUECAT_WEBHOOK_SECRET');

/**
 * Sandbox events are refused unless this is explicitly set to `'true'`.
 *
 * RevenueCat delivers sandbox and production events to the same endpoint. 8b does its whole
 * build against test mode, so this is `true` there and must be `false` the moment the endpoint
 * is reachable in production — otherwise a test-mode purchase grants real access.
 */
const ACCEPT_SANDBOX = process.env.RC_ACCEPT_SANDBOX === 'true';

export const revenuecatWebhook = onRequest(
  // `us-central1` because the Firestore database is `nam5` (US multi-region). The write below
  // is a transaction — a read, then a write — so a function sitting in Europe would cross the
  // Atlantic twice per webhook for no benefit. Co-locate the function with the data, not with
  // the developer.
  { secrets: [REVENUECAT_WEBHOOK_SECRET], region: 'us-central1', cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    if (!timingSafeEqual(req.get('authorization') ?? '', REVENUECAT_WEBHOOK_SECRET.value())) {
      // No detail in the response: an error that distinguishes "wrong secret" from "malformed"
      // is an oracle for guessing it.
      logger.warn('Rejected webhook with bad or missing Authorization header');
      res.status(401).send('Unauthorized');
      return;
    }

    const event = (req.body?.event ?? null) as RevenueCatEvent | null;
    if (!event?.type) {
      logger.warn('Webhook body had no event');
      res.status(400).send('Bad request');
      return;
    }

    const action = mapEvent(event, { acceptSandbox: ACCEPT_SANDBOX });

    /**
     * **Every outcome answers 200, including the ones that did nothing.**
     *
     * A non-2xx tells RevenueCat to retry, and retrying an event this code has correctly
     * decided to ignore just means receiving it again for days. Failures that deserve a retry
     * are the ones that throw below.
     */
    switch (action.kind) {
      case 'ignore':
        logger.debug('Ignored event', { type: event.type, reason: action.reason });
        break;

      case 'alert':
        // Deliberately loud and deliberately still 200 — a retry would not fix any of these.
        logger.error('Entitlement event needs a human', {
          type:   event.type,
          id:     event.id,
          reason: action.reason,
        });
        break;

      case 'upsert':
        await applyWrite(action.uid, event, action.doc);
        break;

      case 'revoke':
        await applyWrite(action.uid, event, null);
        break;
    }

    res.status(200).send('ok');
  },
);

/**
 * Write the entitlement, unless a newer event already has.
 *
 * The read and the write are in a transaction because retries and out-of-order deliveries
 * arrive concurrently, and the staleness check is worthless if another delivery can land
 * between reading `updatedAt` and writing the new one.
 *
 * A revoke deletes the document rather than writing `plan: 'none'`. `fetchEntitlement` already
 * treats a missing document as "no entitlement" — the normal state of every free account — so
 * deletion needs no new state on the read side and cannot be misread as a plan the client does
 * not recognise.
 */
async function applyWrite(uid: string, event: RevenueCatEvent, doc: EntitlementDoc | null) {
  const ref = getFirestore().collection('entitlements').doc(uid);

  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const storedUpdatedAt = snapshot.exists
      ? (snapshot.data()?.updatedAt as number | undefined)
      : undefined;

    if (!isFresh(event, storedUpdatedAt)) {
      logger.info('Dropped stale event', {
        type: event.type,
        eventAt: event.event_timestamp_ms,
        storedUpdatedAt,
      });
      return;
    }

    if (doc) tx.set(ref, doc);
    else tx.delete(ref);
  });

  logger.info(doc ? 'Entitlement written' : 'Entitlement revoked', { uid, type: event.type });
}

/** Constant-time compare, so the secret cannot be recovered a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
