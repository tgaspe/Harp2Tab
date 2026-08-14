/**
 * Reconcile a local library against a cloud one (7b-2).
 *
 * **Pure, and that is the whole point of the file.** Same reasoning as `recordingsMigration.ts`
 * and `entitlementState.ts`: this is the one module in the phase where a bug destroys a user's
 * work rather than showing them something wrong, and a merge that only ever runs inside a live
 * store against a real Firestore is a merge nobody can test before it ships.
 * `scripts/verify-sync-merge.ts` drives every row of the table below with hand-authored states.
 *
 * Nothing here reads a clock, a store or the network. `now` is a parameter because tombstone
 * expiry is time-dependent, and a pure function that reads the clock cannot be tested at the
 * boundary that matters.
 *
 * Generic over the document type, so tabs and projects share one implementation — they differ
 * only in how they map to and from a Firestore document, which is `wire.ts`'s job.
 *
 * ## The rules
 *
 * | local | remote | tombstone | result |
 * |---|---|---|---|
 * | present | absent  | none                        | push |
 * | absent  | present | none                        | apply |
 * | present | present | none                        | higher `updatedAt` wins, whole document |
 * | present | present | tie                         | remote wins — deterministic |
 * | present | any     | newer than the doc          | delete locally (and remotely, if still there) |
 * | absent  | present | older than the remote doc   | recreated after the delete → apply, drop the tombstone |
 * | present | absent  | older than the local doc    | edited after the delete propagated → push, drop the tombstone |
 * | absent  | absent  | any                         | carry the tombstone until it expires |
 * | present | absent  | expired                     | push, drop the tombstone |
 *
 * A document whose `schemaVersion` is above this client's never reaches this function —
 * `wire.ts` refuses to decode it, and the engine counts it as skipped. That keeps the "never
 * apply *and never overwrite*" rule in one place rather than as a special case in every row.
 */

import { TOMBSTONE_TTL_MS, type DiscardedEdit, type MergePlan, type Syncable, type Tombstone } from './types';

export interface MergeInput<T extends Syncable> {
  local:            T[];
  remote:           T[];
  /** This device's unpushed deletions. */
  localTombstones:  Tombstone[];
  /** `/users/{uid}/deleted` — deletions any device has reported. */
  remoteTombstones: Tombstone[];
  now:              number;
}

const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));

/**
 * The effective tombstone for each id: the latest deletion either side knows about.
 *
 * Taking the max rather than preferring one side matters when both have one — a document
 * deleted, recreated and deleted again has two tombstones with different times, and only the
 * later one describes the state the user is actually in.
 */
function effectiveTombstones(local: Tombstone[], remote: Tombstone[]): Map<string, Tombstone> {
  const merged = new Map<string, Tombstone>();
  for (const tomb of [...remote, ...local]) {
    const seen = merged.get(tomb.id);
    if (!seen || tomb.deletedAt > seen.deletedAt) merged.set(tomb.id, tomb);
  }
  return merged;
}

export function mergeDocuments<T extends Syncable>({
  local,
  remote,
  localTombstones,
  remoteTombstones,
  now,
}: MergeInput<T>): MergePlan<T> {
  const localById  = byId(local);
  const remoteById = byId(remote);
  const tombs      = effectiveTombstones(localTombstones, remoteTombstones);
  const remoteTombById = byId(remoteTombstones);

  const plan: MergePlan<T> = {
    toApply:        [],
    toPush:         [],
    toDeleteLocal:  [],
    toDeleteRemote: [],
    toPushTomb:     [],
    toDropTomb:     [],
    discarded:      [],
  };

  const ids = new Set([...localById.keys(), ...remoteById.keys(), ...tombs.keys()]);

  for (const id of ids) {
    const localDoc  = localById.get(id);
    const remoteDoc = remoteById.get(id);
    const tomb      = tombs.get(id);

    const expired = tomb !== undefined && now - tomb.deletedAt > TOMBSTONE_TTL_MS;

    // An expired tombstone is forgotten before anything else is decided, so the rest of this
    // loop only ever sees a live one. It is dropped locally whether or not this device is the
    // one holding it; `toDropTomb` is a set of ids, and dropping one that was never there is
    // free.
    if (expired) plan.toDropTomb.push(id);

    const live = tomb !== undefined && !expired ? tomb : undefined;

    if (live) {
      // Does either copy post-date the deletion? If so the document was recreated or edited
      // after the delete, and the deletion is stale rather than the document.
      const localSurvives  = localDoc  !== undefined && localDoc.updatedAt  > live.deletedAt;
      const remoteSurvives = remoteDoc !== undefined && remoteDoc.updatedAt > live.deletedAt;

      if (localSurvives || remoteSurvives) {
        plan.toDropTomb.push(id);
        // Fall through to the ordinary comparison below with the tombstone out of the way.
        // Not duplicated here: "recreated on one side, still deleted on the other" is just
        // "present on one side" once the deletion is known to be stale.
        resolvePair(plan, localDoc, remoteDoc);
        continue;
      }

      // The deletion stands. Remove whatever is left of the document on either side, and make
      // sure the cloud has heard about it.
      if (localDoc)  plan.toDeleteLocal.push(id);
      if (remoteDoc) plan.toDeleteRemote.push(id);

      const known = remoteTombById.get(id);
      if (!known || known.deletedAt < live.deletedAt) plan.toPushTomb.push(live);

      continue;
    }

    resolvePair(plan, localDoc, remoteDoc);
  }

  return plan;
}

/** The no-tombstone case: whichever copy exists, or whichever is newer. */
function resolvePair<T extends Syncable>(
  plan: MergePlan<T>,
  localDoc: T | undefined,
  remoteDoc: T | undefined,
): void {
  if (localDoc && !remoteDoc) {
    plan.toPush.push(localDoc);
    return;
  }

  if (!localDoc && remoteDoc) {
    plan.toApply.push(remoteDoc);
    return;
  }

  if (!localDoc || !remoteDoc) return; // Neither side has it: nothing to do.

  if (localDoc.updatedAt > remoteDoc.updatedAt) {
    plan.toPush.push(localDoc);
    return;
  }

  if (localDoc.updatedAt < remoteDoc.updatedAt) {
    plan.toApply.push(remoteDoc);
    // The local copy is about to be replaced by a newer one from elsewhere. Whether that
    // destroyed anything depends on whether the two actually differ, which this function
    // cannot know — but reporting it is still right: the user is being told "your copy of X
    // was replaced by a newer edit", which is true either way and is the only warning they get.
    plan.discarded.push(discard(localDoc, remoteDoc.updatedAt));
    return;
  }

  // Equal timestamps. Remote wins, deterministically, so two devices reconciling the same pair
  // reach the same answer without talking to each other. Not reported as discarded: a tie means
  // the two copies were written at the same millisecond, which in practice means one is the
  // echo of the other, and claiming an edit was thrown away would be crying wolf.
  plan.toApply.push(remoteDoc);
}

const discard = <T extends Syncable>(loser: T, at: number): DiscardedEdit =>
  ({ id: loser.id, title: loser.title, at });

/** Tombstones worth keeping in the local log. Applied after a plan is executed. */
export function pruneTombstones(tombstones: Tombstone[], now: number): Tombstone[] {
  return tombstones.filter((tomb) => now - tomb.deletedAt <= TOMBSTONE_TTL_MS);
}
