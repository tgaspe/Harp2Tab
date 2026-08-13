/**
 * Reads what the user has paid for — the entitlement *read* path (7-12).
 *
 * **Phase 8 supplies the writer; this is only the reader.** Nothing writes
 * `/entitlements/{uid}` from the client, and the rules forbid it: the document is written by
 * trusted server code (a RevenueCat webhook or a Cloud Function). A client that could write
 * its own entitlement is a paywall bypass, which is why `firestore.rules` denies it outright
 * and `verify-firestore-rules.ts` tests that it does.
 *
 * **Not wired into any screen yet, deliberately.** `/profile`'s plan block reads local
 * `isPurchased` and says plainly that billing is coming, because until Phase 8 writes these
 * documents every read would return `null` and the honest render is the local one. Phase 8
 * connects this; building it now is what lets that phase land a writer against a reader that
 * already exists and is already protected.
 *
 * **Firestore is imported dynamically, and that is the point.** Keeping it out of the static
 * graph is what stops a signed-out visitor downloading the Firestore chunk to look at the
 * landing page — see the note in `firebase.web.ts`. Every future Firestore consumer (7b's
 * sync engine especially) should reach it the same way.
 */

import { firebaseApp } from './firebase.web';

export type EntitlementPlan = 'lifetime' | 'subscription';

export interface Entitlement {
  plan: EntitlementPlan;
  /** Epoch ms the entitlement was granted. */
  since?: number;
  /** Where it came from — `play`, `stripe`, a manual grant. Useful when reconciling the
   *  existing Google Play lifetime buyers, which is Phase 8's grandfathering problem. */
  source?: string;
  /** Epoch ms a subscription lapses. Absent for `lifetime`. */
  expiresAt?: number;
}

/**
 * The user's entitlement, or `null` when they have none.
 *
 * `null` means "no document", which is the normal state for a free account and must not be
 * treated as an error. A genuine failure — offline, rules denial — throws, so a caller can
 * tell "definitely not paid" from "could not find out". Conflating those is how a network
 * blip turns into a paying customer being shown the paywall.
 */
export async function fetchEntitlement(uid: string): Promise<Entitlement | null> {
  const { getFirestore, doc, getDoc } = await import('firebase/firestore');

  const snapshot = await getDoc(doc(getFirestore(firebaseApp()), 'entitlements', uid));
  if (!snapshot.exists()) return null;

  // `plan` is widened to `string` deliberately: it is whatever the writer put there, and the
  // job of the checks below is to decide whether that is something this reader can honour.
  // Typing it as `EntitlementPlan` here would assume the answer to the question being asked.
  const data = snapshot.data() as Omit<Partial<Entitlement>, 'plan'> & { plan?: string };

  /**
   * The revoke tombstone — an expired, refunded or cancelled entitlement.
   *
   * The writer leaves this instead of deleting the document, because deleting it would take
   * the `updatedAt` watermark with it and let a retried pre-revoke event reinstate what was
   * just revoked (see `RevokedDoc` in `functions/src/revenuecat.ts`). It means exactly what a
   * missing document means here, and is silent for the same reason: it is a normal state, not
   * a disagreement between writer and reader.
   */
  if (data.plan === 'revoked') return null;

  if (data.plan !== 'lifetime' && data.plan !== 'subscription') {
    // A document whose plan we do not recognise is not an entitlement we can honour. Loud,
    // because it means the writer and this reader have drifted apart.
    console.error('[entitlement] Unrecognised plan on', uid, '—', data.plan);
    return null;
  }

  return {
    plan:      data.plan,
    since:     data.since,
    source:    data.source,
    expiresAt: data.expiresAt,
  };
}
