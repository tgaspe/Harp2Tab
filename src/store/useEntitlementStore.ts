/**
 * The cached copy of the account's entitlement, and the only module that fetches it (8-3).
 *
 * **This is the one place in the app that reads Firestore**, which keeps Phase 7's rule
 * intact: no screen, hook or selector gains a network dependency, a loading state or an error
 * state. Everything reads `usePremium()`, which reads this store synchronously. 7b's sync
 * engine takes the same shape deliberately — one module owns the network, everything else
 * reads a store.
 *
 * The cache is persisted because paid access has to survive a cold start on a plane. What it
 * must never do is survive *the wrong user*: the cached document is stamped with the uid it
 * belongs to, and `usePremium` ignores it unless that uid is the one currently signed in. That
 * makes signing out drop premium by construction rather than by remembering to call `clear()`.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState } from 'react-native';
import { entitlementStorage } from './storage';
import { fetchEntitlement, type Entitlement } from '@/auth/entitlement';
import { useAuthStore } from '@/auth/useAuthStore';
import type { AuthStatus } from '@/auth/types';

interface EntitlementStoreState {
  /** The last entitlement the server told us about. `null` means "told us there is none". */
  cached:    Entitlement | null;
  /** Whose entitlement `cached` is. Never trust `cached` without checking this. */
  uid:       string | null;
  /** When we last successfully *heard from* the server — not when we last tried. */
  fetchedAt: number | null;

  refresh:    (uid: string) => Promise<void>;
  applyLocal: (uid: string, entitlement: Entitlement | null) => void;
  clear:      () => void;
}

export const useEntitlementStore = create<EntitlementStoreState>()(
  persist(
    (set, get) => ({
      cached:    null,
      uid:       null,
      fetchedAt: null,

      /**
       * Re-read the entitlement for `uid`.
       *
       * **A failure leaves the cache exactly as it was.** `fetchEntitlement` throws on a
       * genuine failure and resolves `null` for "this account has no entitlement", and that
       * distinction is the whole contract — conflating them is how a subway tunnel takes paid
       * access away from someone who paid for it. Errors are swallowed on purpose: there is no
       * caller who could do anything useful with one, and every screen renders the cached
       * answer either way.
       */
      refresh: async (uid) => {
        try {
          const entitlement = await fetchEntitlement(uid);
          set({ cached: entitlement, uid, fetchedAt: Date.now() });
        } catch (err) {
          // Loud in development, harmless in production: the previous answer still stands.
          console.warn('[entitlement] refresh failed, keeping cached value —', err);
        }
      },

      /**
       * Write an entitlement we learned about without asking Firestore.
       *
       * 8-4 calls this with the RevenueCat SDK's response the instant a purchase succeeds. The
       * webhook that writes `/entitlements/{uid}` lands a second or two later, and making the
       * user watch a spinner until it does — for a purchase that has already gone through —
       * is the worst moment in the app to be pessimistic.
       */
      applyLocal: (uid, entitlement) => set({ cached: entitlement, uid, fetchedAt: Date.now() }),

      /** Sign-out. Deliberately does not touch `isPurchased`, which belongs to the device. */
      clear: () => {
        if (get().cached === null && get().uid === null) return;
        set({ cached: null, uid: null, fetchedAt: null });
      },
    }),
    {
      name:       'harp2tab-entitlement',
      storage:    entitlementStorage,
      partialize: (s) => ({ cached: s.cached, uid: s.uid, fetchedAt: s.fetchedAt }),
    },
  ),
);

/**
 * Starts the entitlement refreshes. Called once from the root layout, beside
 * `startAuthListener`.
 *
 * Three triggers, and no timer:
 * - **sign-in** (including the persisted session resolving on cold start), because that is
 *   when we first know whose entitlement to ask for;
 * - **sign-out**, which drops the cache;
 * - **foreground**, which is what catches a subscription that lapsed, was cancelled, or was
 *   bought on another device while this tab sat open.
 *
 * A polling interval would add nothing: the only events that change an entitlement happen on a
 * server, and the user has to come back to this tab before the answer can matter to them.
 */
export function startEntitlementListener(): () => void {
  const store = () => useEntitlementStore.getState();

  /**
   * **`'resolving'` must never clear the cache.** Firebase resolves a persisted session
   * asynchronously, so on every cold start there is a window where nobody is signed in *yet* —
   * and treating that as a sign-out would throw away the cached entitlement before the account
   * it belongs to has come back. A paying user who opened the app on a plane would be free,
   * permanently, because the fetch that would restore it cannot run offline. Only an actual
   * `'signedOut'` clears.
   *
   * Nothing renders wrong during the window either way: `usePremium` ignores a cache whose uid
   * is not the one signed in, and during `'resolving'` there is none.
   */
  const sync = (uid: string | null, status: AuthStatus) => {
    if (uid) void store().refresh(uid);
    else if (status === 'signedOut') store().clear();
  };

  const initial = useAuthStore.getState();
  sync(initial.user?.uid ?? null, initial.status);

  const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
    const uid = state.user?.uid ?? null;
    if (uid !== (previous.user?.uid ?? null) || state.status !== previous.status) {
      sync(uid, state.status);
    }
  });

  const appState = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    const uid = useAuthStore.getState().user?.uid ?? null;
    if (uid) void store().refresh(uid);
  });

  return () => {
    unsubscribeAuth();
    appState.remove();
  };
}
