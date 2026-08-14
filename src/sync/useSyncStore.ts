/**
 * What sync is doing, and how far it has got (7b-4).
 *
 * Same shape as `useEntitlementStore`: one module owns the network, everything else reads a
 * store synchronously. `/profile` renders `status` and nothing on any screen ever awaits
 * Firestore.
 *
 * **Only the watermark is persisted.** A persisted `'syncing'` would be a lie on the next cold
 * start, and a persisted `'idle'` would claim a backup that this session has not verified —
 * so status always starts from what the engine can currently prove.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncStorage } from '@/store/storage';
import type { SyncStatus, SyncUnavailableReason } from '@/auth/types';
import type { DiscardedEdit } from './types';

/** The second-account prompt (7-11), raised by the engine and answered from `/profile`. */
export interface AdoptionChoice {
  uid:          string;
  tabCount:     number;
  projectCount: number;
}

interface SyncStoreState {
  status: SyncStatus;

  /**
   * Whose watermark `lastPulledAt` is. Never trust the watermark without checking this — the
   * same reasoning as `useEntitlementStore.uid`. A watermark carried across a sign-in to a
   * different account would skip every document that account wrote before this moment, and the
   * user would see a partial library with no error anywhere.
   */
  uid: string | null;

  /**
   * The highest `updatedAt` this device has actually seen from the cloud.
   *
   * **Deliberately not "when we last synced".** Wall-clock fails under clock skew in the
   * direction that loses data: a device whose clock runs fast writes a watermark into the
   * future and never pulls the documents written in between. A max-observed watermark cannot
   * skip a document it has not seen.
   */
  lastPulledAt: number;

  /**
   * When the *synced subset* of settings last changed on this device (7b-6). 0 means never.
   *
   * Lives here rather than in `useSettingsStore` deliberately: that store has never had a
   * `version` or a `migrate`, and adding a persisted field to it — for a value only the sync
   * engine reads — would be a schema change to the one store with no machinery to absorb one.
   */
  settingsUpdatedAt: number;

  /** Set while 7-11 is waiting on the user. Blocks the engine; see `syncEngine.ts`. */
  pendingChoice: AdoptionChoice | null;

  setStatus:        (status: SyncStatus) => void;
  setUnavailable:   (reason: SyncUnavailableReason) => void;
  markSynced:       (at: number, discarded?: DiscardedEdit) => void;
  advanceTo:        (uid: string, watermark: number) => void;
  setSettingsStamp: (at: number) => void;
  askChoice:        (choice: AdoptionChoice | null) => void;
  resetFor:         (uid: string | null) => void;
}

const INITIAL: SyncStatus = { state: 'unavailable', reason: 'signedOut' };

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set, get) => ({
      status:            INITIAL,
      uid:               null,
      lastPulledAt:      0,
      settingsUpdatedAt: 0,
      pendingChoice:     null,

      setStatus: (status) => set({ status }),

      setUnavailable: (reason) => set({ status: { state: 'unavailable', reason } }),

      /**
       * A completed pass.
       *
       * `discarded` promotes the row from "Synced" to the variant that names what
       * last-write-wins replaced. That disclosure is the whole mitigation for whole-document
       * LWW: resolving a conflict by throwing one side away is fine, doing it silently is what
       * makes a user conclude the app ate their edit.
       */
      markSynced: (at, discarded) =>
        set({
          status: discarded
            ? { state: 'discarded', lastSyncedAt: at, discarded }
            : { state: 'idle', lastSyncedAt: at },
        }),

      /** Move the watermark forward, never back. Rebinds it if the account changed. */
      advanceTo: (uid, watermark) =>
        set((s) => ({
          uid,
          lastPulledAt: s.uid === uid ? Math.max(s.lastPulledAt, watermark) : watermark,
        })),

      setSettingsStamp: (at) =>
        set((s) => ({ settingsUpdatedAt: Math.max(s.settingsUpdatedAt, at) })),

      askChoice: (pendingChoice) => set({ pendingChoice }),

      /**
       * Sign-out, or a switch to a different account: the watermark belongs to neither.
       *
       * `settingsUpdatedAt` is deliberately **not** reset. It describes when this device last
       * changed a preference, which is true of the device regardless of who is signed in —
       * clearing it would make a freshly signed-in account's cloud settings beat a change the
       * user made here five minutes ago.
       */
      resetFor: (uid) => {
        if (get().uid === uid) return;
        set({ uid, lastPulledAt: 0, pendingChoice: null });
      },
    }),
    {
      name:    'harp2tab-sync',
      storage: syncStorage,
      // Not `status`: a persisted `'syncing'` would be a lie on the next cold start, and a
      // persisted `'idle'` would claim a backup this session has not verified.
      partialize: (s) => ({
        uid:               s.uid,
        lastPulledAt:      s.lastPulledAt,
        settingsUpdatedAt: s.settingsUpdatedAt,
      }),
    },
  ),
);

export const selectSyncStatus = (s: SyncStoreState) => s.status;
