/**
 * Native half of the sync backend — a stub, matching `auth/firebase.ts` and
 * `auth/entitlement.ts`.
 *
 * **A deliberate stub, not an oversight.** Native has no accounts until 7-14, `isFirebaseConfigured()`
 * is `false` there, and the engine's entry condition therefore never reaches any of this. Web
 * ships first (`feedback_web_first_no_mobile_hedging`); the native half is scoped as Phase 15
 * rather than deferred silently.
 *
 * The functions throw rather than resolving empty. An empty pull is a *meaningful* answer — "the
 * cloud has nothing" — and returning it here would let a native build conclude the user's cloud
 * library was empty and push a device-local library into a uid that does not exist. Throwing
 * turns a wiring mistake into a caught error and an `'error'` row; the entry condition is what
 * is supposed to prevent it.
 */

export type RemotePath = 'tabs' | 'projects' | 'deleted';

export interface RemoteDoc {
  id:   string;
  data: Record<string, unknown>;
}

export type WriteOp =
  | { op: 'set';    path: RemotePath; id: string; data: Record<string, unknown> }
  | { op: 'delete'; path: RemotePath; id: string };

const notOnNative = (): never => {
  throw new Error(
    'Cloud sync is not available on native yet — accounts are web-first (7-14). ' +
    'The engine gates on `isFirebaseConfigured()` and should never reach this.',
  );
};

export async function listDocsSince(_uid: string, _path: RemotePath, _since: number): Promise<RemoteDoc[]> {
  return notOnNative();
}

export async function listTombstones(_uid: string): Promise<RemoteDoc[]> {
  return notOnNative();
}

export async function getSettings(_uid: string): Promise<Record<string, unknown> | null> {
  return notOnNative();
}

export async function setSettings(_uid: string, _data: Record<string, unknown>): Promise<void> {
  return notOnNative();
}

export async function commit(_uid: string, _operations: WriteOp[]): Promise<void> {
  return notOnNative();
}

/** Never reached, but the signature has to exist for the engine's catch block to compile. */
export function isOfflineError(_error: unknown): boolean {
  return false;
}

/** No emulator on native, because there is no native sync to point at one. */
export const isEmulator = (): boolean => false;
