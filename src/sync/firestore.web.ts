/**
 * The only module in the app that speaks Firestore for a user's library (7b-4).
 *
 * **A façade, not a re-export.** `syncEngine.ts` orchestrates and `merge.ts` decides; neither
 * may hold a Firebase type, for the same reason no screen may: it is what keeps the web SDK and
 * the eventual native one (`@react-native-firebase/firestore`, 7-14) behind one interface, and
 * it is what lets the engine be reasoned about without the SDK in the room.
 *
 * **Firestore is imported dynamically, and that is the point.** Keeping it out of the static
 * graph is what stops a signed-out visitor downloading the Firestore chunk to look at the
 * landing page — see the note in `firebase.web.ts`, and the same call in `entitlement.web.ts`.
 */

import { firestoreDb, isEmulator } from '@/auth/firebase';

export { isEmulator };

/** The three collections under `/users/{uid}/`. Named rather than free-form so a typo cannot
 *  write a library into a path the security rules do not cover. */
export type RemotePath = 'tabs' | 'projects' | 'deleted';

export interface RemoteDoc {
  id:   string;
  data: Record<string, unknown>;
}

export type WriteOp =
  | { op: 'set';    path: RemotePath; id: string; data: Record<string, unknown> }
  | { op: 'delete'; path: RemotePath; id: string };

/**
 * Firestore's hard cap is 500 writes per batch. 400 leaves room to be wrong about what counts
 * as a write without turning a large library into a failed sync.
 */
const BATCH_LIMIT = 400;

const api = () => import('firebase/firestore');

/**
 * The shared handle. `firebase.web.ts` owns the instance and the emulator connect — see the
 * note there for why this cannot be a per-module memo.
 */
const db = firestoreDb;

/**
 * Documents written since `since`.
 *
 * A single-field inequality on one collection needs **no composite index**, which is why
 * `firestore.indexes.json` stays empty — an index would mean a deploy step this phase otherwise
 * does not have, and a missing one fails at runtime rather than at build time.
 */
export async function listDocsSince(
  uid: string,
  path: RemotePath,
  since: number,
): Promise<RemoteDoc[]> {
  const { collection, getDocs, query, where } = await api();
  const snap = await getDocs(query(
    collection(await db(), 'users', uid, path),
    where('updatedAt', '>', since),
  ));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
}

/**
 * Every tombstone, not an incremental slice.
 *
 * Deliberate: a tombstone carries `deletedAt`, not `updatedAt`, so it would not match the
 * watermark query — and a deletion that the watermark skipped is a deletion that silently
 * resurrects. The collection is `{ deletedAt, kind }` per deleted document and is garbage
 * collected at 90 days, so reading it whole stays cheap.
 */
export async function listTombstones(uid: string): Promise<RemoteDoc[]> {
  const { collection, getDocs } = await api();
  const snap = await getDocs(collection(await db(), 'users', uid, 'deleted'));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
}

export async function getSettings(uid: string): Promise<Record<string, unknown> | null> {
  const { doc, getDoc } = await api();
  const snap = await getDoc(doc(await db(), 'users', uid, 'settings', 'prefs'));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

export async function setSettings(uid: string, data: Record<string, unknown>): Promise<void> {
  const { doc, setDoc } = await api();
  await setDoc(doc(await db(), 'users', uid, 'settings', 'prefs'), data);
}

/**
 * Commit a plan's writes, split at `BATCH_LIMIT`.
 *
 * Batched rather than one round trip per document: a first sign-in uploads a whole library, and
 * a hundred sequential writes over a phone connection is the difference between sync taking a
 * second and taking a minute.
 */
export async function commit(uid: string, operations: WriteOp[]): Promise<void> {
  if (operations.length === 0) return;

  const { doc, writeBatch } = await api();
  const store = await db();

  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = writeBatch(store);
    for (const operation of operations.slice(i, i + BATCH_LIMIT)) {
      const ref = doc(store, 'users', uid, operation.path, operation.id);
      if (operation.op === 'set') batch.set(ref, operation.data);
      else batch.delete(ref);
    }
    await batch.commit();
  }
}

/**
 * Whether a failure was the network rather than a refusal.
 *
 * The two must read differently to the user: one resolves itself, the other needs them. Claiming
 * to be offline while online is the version of this that costs someone their trust in the row,
 * so anything unrecognised is *not* offline.
 */
export function isOfflineError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return code === 'unavailable'
    || code === 'deadline-exceeded'
    || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
