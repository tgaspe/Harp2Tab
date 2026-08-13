/**
 * Server-side entitlement work: the writer (8-2), and the cleanup that account deletion
 * cannot do from the client (7-13).
 *
 * `firestore.rules` denies `/entitlements/{uid}` to every client (`allow write: if false`), and
 * `verify-firestore-rules.ts` tests that it does. Both functions here run with the Admin SDK,
 * which bypasses rules, so the rule stays exactly as strict as it reads: the client cannot
 * write its own entitlement, and a paywall bypass would have to go through this endpoint.
 *
 * **Which is why the first thing the webhook does is authenticate.** Anything that can POST
 * there can grant itself paid access forever.
 *
 * All the interesting decisions live in `revenuecat.ts`, which is pure and tested. This file is
 * transport: verify, parse, guard against stale deliveries, write.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as functionsV1 from 'firebase-functions/v1';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  isAmbiguousGrant, isFresh, mapEvent, type RevenueCatEvent, type StoredDoc,
} from './revenuecat';

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
        // Granted either way — but an expiry-less grant with no lifetime signal is either a
        // product id missing from `RC_LIFETIME_PRODUCT_IDS` or a malformed subscription event,
        // and both are worth a human seeing before a customer does.
        if (isAmbiguousGrant(event)) {
          logger.error('Grant has no expiry and no lifetime signal — stored as a subscription', {
            type:       event.type,
            id:         event.id,
            productId:  event.product_id,
            periodType: event.period_type,
          });
        }
        await applyWrite(action.uid, event, action.doc);
        break;

      case 'revoke':
        await applyWrite(action.uid, event, action.doc);
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
 * **A revoke writes a tombstone rather than deleting.** Deleting the document destroys the
 * `updatedAt` watermark the staleness check depends on, so the next delivery — including a
 * retried event from *before* the revoke — reads no watermark, passes `isFresh`, and reinstates
 * the entitlement that was just taken away. `RevokedDoc` exists to keep the watermark alive; the
 * read side already treats an unrecognised plan as no entitlement, so nothing there changes.
 */
async function applyWrite(uid: string, event: RevenueCatEvent, doc: StoredDoc) {
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

    tx.set(ref, doc);
  });

  logger.info(doc.plan === 'revoked' ? 'Entitlement revoked' : 'Entitlement written',
    { uid, type: event.type });
}

/** Constant-time compare, so the secret cannot be recovered a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Erase a deleted account's server-side data (7-13).
 *
 * **The client cannot do this, by design.** `firestore.rules` denies every client a write to
 * `/entitlements/{uid}`, and a browser cannot reliably delete a subtree even where it is
 * allowed to — a tab closed halfway through leaves a half-deleted account, which is worse than
 * an undeleted one. So deletion runs here, triggered by the Auth deletion itself, and it
 * cannot be skipped by the client going away.
 *
 * `deleteAccount()` in `auth.web.ts` deletes the Auth user and nothing else; this is the other
 * half, and the reason its docstring no longer has to claim there is nothing server-side to
 * remove. That claim was true when it was written — Phase 8 made it false by creating the
 * entitlement document, and nothing failed loudly when it did.
 *
 * **What this does not do is cancel a subscription.** Stripe holds the billing relationship,
 * not Firebase, so deleting the account here does not stop the money. The paywall path warns
 * about that before deletion (`ConfirmDeleteModal`) because it is the user's to act on, not
 * something this function can quietly fix.
 *
 * A v1 trigger deliberately: `beforeUserDeleted` is a blocking function and needs Identity
 * Platform, which this project does not use, while `auth.user().onDelete()` works against
 * plain Firebase Auth. Failures here are logged rather than thrown — a retry storm on a
 * deleted account helps nobody, and the entitlement is unreachable regardless once the uid
 * it is keyed to can never sign in again.
 */
export const onAccountDeleted = functionsV1
  .region('us-central1')
  .auth.user()
  .onDelete(async (user) => {
    const db = getFirestore();

    try {
      await db.collection('entitlements').doc(user.uid).delete();
    } catch (err) {
      logger.error('Failed to delete entitlement for deleted account', { uid: user.uid, err });
    }

    // The synced library (7b). Empty today because the sync engine does not exist yet — done
    // now anyway, so that shipping 7b is not also a silent re-break of account deletion.
    try {
      await db.recursiveDelete(db.collection('users').doc(user.uid));
    } catch (err) {
      logger.error('Failed to delete user subtree for deleted account', { uid: user.uid, err });
    }

    logger.info('Erased server-side data for deleted account', { uid: user.uid });
  });
