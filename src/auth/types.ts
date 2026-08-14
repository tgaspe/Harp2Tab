/**
 * The auth contract — deliberately ours, not Firebase's.
 *
 * Nothing outside `src/auth/` may import a Firebase type. That is what lets the web half
 * (the `firebase` JS SDK) and the native half (`@react-native-firebase/auth`) sit behind one
 * interface, and it is what lets this whole slice be built against a mock first: every
 * screen consumes these shapes and none of them knows where they came from.
 *
 * This file survives into 7-1 unchanged. `useAuth.ts` is the part that gets swapped.
 */

/** Sign-in methods this app offers. Apple joins in Phase 9, where it is obligatory once
 *  Google ships on iOS. */
export type AuthProviderId = 'google' | 'password';

export interface AuthUser {
  uid:           string;
  email:         string;
  /** Google supplies one; an email signup starts without. Editable either way. */
  displayName:   string | null;
  /**
   * Whether *we* consider the address confirmed — not a mirror of Firebase's own flag.
   *
   * Not cosmetic: sync is withheld until it is true (see 7-4), and it changes when the user
   * acts *outside* the app, so the SDK's cached value goes stale. Whatever populates this has
   * to reload the user explicitly rather than waiting for an auth event.
   *
   * **It is `true` for any account with a Google identity, whatever Firebase reports** —
   * Firebase clears its own flag when a password is linked to a Google account, without
   * sending anything to confirm. See the note in `auth.web.ts`'s `toAuthUser`, and note that
   * 7-12's Firestore rules have to apply the same definition or the two will disagree.
   */
  emailVerified: boolean;
  /** Every method linked to this account. Length > 1 after `linkWithCredential`. */
  providers:     AuthProviderId[];
  /** Epoch ms. Shown as "Member since". */
  createdAt:     number;
}

/**
 * Three states, not two. Firebase resolves a persisted session asynchronously, so a plain
 * `user === null` renders the signed-out UI for a frame and then swaps — returning users
 * watch their account flicker into existence on every load.
 *
 * The mock resolves synchronously and could have skipped this. It does not, deliberately:
 * otherwise the loading skeleton never gets built and 7-2 inherits it as a surprise.
 */
export type AuthStatus = 'resolving' | 'signedOut' | 'signedIn';

/**
 * What the sync row on `/profile` is reporting.
 *
 * **No state may be shown that is not true.** `'idle'` — the green tick — means a pull and a
 * push both completed; anything less is `'offline'`, `'error'` or `'unavailable'`. A green tick
 * with nothing behind it invites the user to trust a backup that is not there, which is the one
 * thing here that could cost someone real work. That rule is why 7a shipped `'unavailable'`
 * pinned, and it outlives 7a: the state still exists for every case where the engine is
 * deliberately not running.
 */
export type SyncState =
  | 'unavailable'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error'
  | 'discarded'
  /** Waiting on the user to say whose library this device holds — 7-11's second-account case.
   *  Deliberately not `'error'`: nothing failed, and calling it a failure would push someone
   *  towards "retry" when the only way out is a decision. */
  | 'needsChoice';

/** Why the engine is not running, for the `'unavailable'` row's second line. */
export type SyncUnavailableReason =
  /** Signed out. The library is local and complete, which is worth saying rather than implying
   *  something is broken. */
  | 'signedOut'
  /** Signed in, address not confirmed — 7-4's decision, enforced in `firestore.rules` too. */
  | 'unverified'
  /** `SYNC_ENABLED` is off, or Firebase is not configured in this build. */
  | 'disabled';

export interface SyncStatus {
  state:         SyncState;
  /** Epoch ms of the last successful sync. Present for `idle` and `discarded`. */
  lastSyncedAt?: number;
  /** Local writes waiting to be pushed. Present for `offline`. */
  pendingCount?: number;
  /** Present for `unavailable`. */
  reason?:       SyncUnavailableReason;
  /**
   * What last-write-wins replaced, for `discarded`.
   *
   * Named rather than silent on purpose: the failure mode of quiet LWW is a user who
   * believes the app ate their edit. Saying which document and when turns a data-loss bug
   * report into understood behaviour.
   */
  discarded?:    { title: string; at: number };
}

export interface AuthState {
  status: AuthStatus;
  /** Non-null exactly when `status === 'signedIn'`. */
  user:   AuthUser | null;
  sync:   SyncStatus;
}
