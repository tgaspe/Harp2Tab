/**
 * The one place auth state lives (7-2). `useAuth` reads from here; nothing else should.
 *
 * **The rule this store exists to keep: no screen ever awaits Firebase.** The subscription
 * below is the only auth listener in the app, and it writes plain state that every component
 * reads synchronously. If a component ends up needing a loading state of its own, the
 * boundary has been drawn in the wrong place.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { onAuthChange, reloadUser as reloadFromSdk } from './auth';
import { isFirebaseConfigured } from './firebase';
import { authStorage } from '@/store/storage';
import type { AuthStatus, AuthUser } from './types';

interface AuthStoreState {
  status: AuthStatus;
  user:   AuthUser | null;
  /**
   * The last uid seen on this device, kept across sign-out.
   *
   * Written now although only 7-11 reads it, because unlike the rest of that step's state it
   * cannot be reconstructed later — it is a fact about what happened on this device, and a
   * device that signs in for the first time after 7b ships has no way to know it was someone
   * else's a month earlier. (7-11's `adoptedUids` is the opposite case: it can be created
   * empty whenever that step lands, losing nothing, so it is not here.)
   */
  lastUid: string | null;

  /**
   * Accounts whose library this device's local documents already belong to (7-11).
   *
   * The guard against the case that corrupts data: sign in as A, sign out, sign in as B. A
   * naive adoption pushes A's entire library into B's account, which on a shared laptop is a
   * privacy incident rather than a bug. A uid in here means "this device's tabs are already
   * this account's, adopt freely"; a uid absent from it, on a device that holds documents and
   * has seen someone else, means ask first.
   *
   * Unlike `lastUid` this one *can* be created empty without losing anything — the worst it
   * costs is one extra prompt — which is why 7a persisted `lastUid` and left this to 7b.
   */
  adoptedUids: string[];

  setUser:     (user: AuthUser | null) => void;
  reload:      () => Promise<void>;
  markAdopted: (uid: string) => void;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set) => ({
      // Not `'signedOut'`. Firebase resolves a persisted session asynchronously, so starting
      // at the answer we hope is wrong would render the signed-out UI for a frame and then
      // swap — returning users watching their own account flicker into existence on every
      // load. Every consumer treats `'resolving'` as "render neither yet".
      status:      'resolving',
      user:        null,
      lastUid:     null,
      adoptedUids: [],

      setUser: (user) =>
        set((s) => ({
          user,
          status:  user ? 'signedIn' : 'signedOut',
          // Deliberately not cleared on sign-out — that is the whole point of the field.
          lastUid: user ? user.uid : s.lastUid,
        })),

      reload: async () => {
        const user = await reloadFromSdk();
        // `reload()` does not re-fire the auth listener, so the refreshed user has to be
        // pushed in by hand. Only meaningful once email/password exists (7-4); harmless and
        // correct before that.
        if (user) set({ user, status: 'signedIn' });
      },

      markAdopted: (uid) =>
        set((s) => (s.adoptedUids.includes(uid)
          ? s
          : { adoptedUids: [...s.adoptedUids, uid] })),
    }),
    {
      name:    'harp2tab-auth',
      storage: authStorage,
      // Only `lastUid` and `adoptedUids` — both facts about *this device's history*, which
      // nothing else records. Persisting `user` or `status` would mean the app trusts its own
      // copy of who is signed in over Firebase's — so a revoked, deleted or expired session
      // would still render as signed-in until the SDK got around to contradicting it. The SDK
      // already persists the real session; this store must not keep a second opinion.
      partialize: (s) => ({ lastUid: s.lastUid, adoptedUids: s.adoptedUids }),
    },
  ),
);

/**
 * Starts the one auth subscription. Called once from the root layout.
 *
 * Returns the unsubscribe so the caller can clean up, though in practice the root layout
 * lives for the whole session.
 */
export function startAuthListener(): () => void {
  // A build with no Firebase config (a fresh clone with no `.env`, or native before 7-14)
  // must not hang in `'resolving'` forever — that would leave the whole app in the state
  // every screen treats as "render neither yet". Signed-out is the correct answer.
  if (!isFirebaseConfigured()) {
    useAuthStore.setState({ status: 'signedOut', user: null });
    return () => {};
  }

  return onAuthChange((user) => useAuthStore.getState().setUser(user));
}

export const selectAuthUser = (s: AuthStoreState) => s.user;
