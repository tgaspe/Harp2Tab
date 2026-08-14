/**
 * The sync contract — wire shapes and merge results (7b-1, 7b-2).
 *
 * Deliberately free of Firebase types, for the same reason `auth/types.ts` is: `merge.ts` is a
 * pure function that has to be drivable from a harness with hand-authored data, and a type that
 * drags in `firebase/firestore` would drag the SDK into that harness with it.
 */

import type { SyncKind, Tombstone } from '@/types';

export type { SyncKind, Tombstone };

/**
 * How long a tombstone is honoured, on both sides.
 *
 * 90 days. Past it, a delete is forgotten and a device that still holds the document will push
 * it back. Accepted: the alternative is a `deleted` collection that only ever grows, and a
 * device offline for three months is not a case worth carrying that cost for.
 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The minimum a document must have for `merge.ts` to reconcile it.
 *
 * `title` is in here only so a discarded edit can be named to the user — LWW resolves conflicts
 * by throwing one side away, and the failure mode of doing that silently is someone who
 * concludes the app ate their work.
 */
export interface Syncable {
  id:        string;
  title:     string;
  updatedAt: number;
}

/** What last-write-wins threw away, carried up to the sync row on `/profile`. */
export interface DiscardedEdit {
  id:    string;
  title: string;
  /** Epoch ms of the winning document — i.e. when the edit that replaced this one was made. */
  at:    number;
}

/**
 * Everything the engine should do, decided without touching the network.
 *
 * Six lists rather than a stream of operations, because the unit of work here is the whole
 * document: an operation log would imply an ordering that last-write-wins specifically does not
 * need, and would need replaying after a failure. These lists are idempotent — re-running the
 * same plan produces the same result — which is what lets a failed push simply be retried on
 * the next trigger instead of queued.
 */
export interface MergePlan<T extends Syncable> {
  /** Remote won: write into the local store, **preserving `updatedAt`**. */
  toApply:        T[];
  /** Local won: upload. */
  toPush:         T[];
  /** A tombstone beat the local copy: remove it locally, without logging a new tombstone. */
  toDeleteLocal:  string[];
  /** A tombstone beat the remote copy: delete the cloud document. */
  toDeleteRemote: string[];
  /** Local deletions the cloud has not been told about yet. */
  toPushTomb:     Tombstone[];
  /** Local tombstones to forget — expired, or superseded by a recreation. */
  toDropTomb:     string[];
  /** Local edits last-write-wins discarded, newest last. */
  discarded:      DiscardedEdit[];
}

/**
 * A synced document as it is actually stored in Firestore.
 *
 * The body lives in `payload` as one string, and only the fields needed to *list* or
 * *reconcile* are real columns. That is not a stylistic choice: Firestore charges for every
 * field name in every array element, so a 3,000-note `tabNotes` array stored as expanded maps
 * is ~50 KB of repeated keys on every read and every write, forever (7-10 measured it).
 * `useMidiProjectsStore` already set this precedent for exactly the same reason.
 */
export interface SyncDoc {
  id:        string;
  title:     string;
  createdAt: number;
  updatedAt: number;
  /**
   * The persisted-schema version the `payload` was written at.
   *
   * **This is the field that stops a newer client silently corrupting an older one's library.**
   * Without it, a device on an older build parses a newer payload as its own shape, and —
   * because the merge then pushes whatever it holds — writes the misparse back over the good
   * copy. The loss is silent and it originates on the device least likely to be looked at. A
   * document above this client's version is never applied *and never overwritten*.
   */
  schemaVersion: number;
  /** JSON. For tabs, a `TabRecording` without `frames`; for projects, a `StoredProject`. */
  payload:   string;
}

export interface TabSyncDoc extends SyncDoc {
  duration: number;
  favorite: boolean;
  source?:  string;
}

export interface ProjectSyncDoc extends SyncDoc {
  durationMs: number;
  origin?:    string;
}

/**
 * The wire version for projects.
 *
 * Tabs reuse `RECORDINGS_SCHEMA_VERSION`, because a tab payload *is* a persisted-shape
 * `TabRecording` and can therefore be run through `migrateRecordings` on the way in — the
 * existing migration machinery, reused rather than duplicated. Projects have no equivalent:
 * `StoredProject` has never been versioned, its `merge()` survives partial payloads by
 * design, so this starts at 1 and exists purely so the skip rule above has something to
 * compare.
 */
export const PROJECT_WIRE_VERSION = 1;

/** The single settings document — a subset of `useSettingsStore`, never the whole object. */
export interface SettingsSyncDoc {
  updatedAt:  number;
  /** JSON of `SyncedSettings`. Opaque for the same reason the others are. */
  payload:    string;
  schemaVersion: number;
}

export const SETTINGS_WIRE_VERSION = 1;
