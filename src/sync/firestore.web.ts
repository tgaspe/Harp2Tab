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

import { firebaseApp } from '@/auth/firebase';

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
 * Point the SDK at the local emulator instead of the real project.
 *
 * **This is what makes cloud sync safe to develop against.** Without it the only way to watch
 * the engine actually write anything is to write it into the project that will hold real
 * libraries — and the first live run of a merge is exactly the moment you want a database you
 * can throw away.
 *
 * Set `EXPO_PUBLIC_FIREBASE_EMULATOR=1` in `.env` and start it with
 * `npx firebase emulators:start --only firestore`; the UI at `localhost:4000` shows the
 * documents appearing. **Auth is deliberately left pointing at the real project**, so Google
 * sign-in still works — the Firestore emulator decodes a genuine ID token without verifying it,
 * which is enough for `request.auth` and therefore for the rules to be exercised properly.
 *
 * Written as a complete `process.env.X` member expression, not a lookup through a variable.
 * Expo 55 rewrites these to a virtual env module (`_expoVirtualEnv.env.X`) at build time, and
 * that rewrite is a syntactic match on the full expression — `process.env[key]` is not a form it
 * can see. Verified in the emitted bundle rather than assumed.
 */
export const isEmulator = (): boolean =>
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR === '1';

const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8080;

/**
 * Memoised, because `connectFirestoreEmulator` must run before the instance is used for
 * anything else and throws if it is called twice. Every call below goes through here, so there
 * is exactly one instance and exactly one connect.
 */
let instance: ReturnType<Awaited<ReturnType<typeof api>>['getFirestore']> | undefined;

async function db() {
  if (instance) return instance;

  const { getFirestore, connectFirestoreEmulator } = await api();
  instance = getFirestore(firebaseApp());

  if (isEmulator()) {
    connectFirestoreEmulator(instance, EMULATOR_HOST, EMULATOR_PORT);
    // Loud on purpose. A build silently talking to an emulator looks exactly like a build whose
    // sync is broken — no documents appear in the console and nothing errors.
    console.info(`[sync] Firestore → emulator ${EMULATOR_HOST}:${EMULATOR_PORT} (not the real project)`);
  }

  return instance;
}

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
