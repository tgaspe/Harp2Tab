import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateRecordings, RECORDINGS_SCHEMA_VERSION } from './recordingsMigration';
import { recordingsStorage } from './storage';
import type { TabRecording, Tombstone } from '@/types';

interface RecordingsState {
  recordings: TabRecording[];
  /**
   * Deletions this device has made, kept after the recording itself is gone (7b-3).
   *
   * Appended by `deleteRecording` — *inside* the same `set()` as the deletion, so the two
   * cannot come apart. Read and cleared by the sync engine. Accumulates harmlessly while
   * signed out; nothing reads it until there is an account to reconcile against.
   */
  deletedIds: Tombstone[];

  saveRecording:   (recording: TabRecording) => void;
  deleteRecording: (id: string) => void;
  renameRecording: (id: string, title: string) => void;
  toggleFavorite:  (id: string) => void;

  /* ---- sync entry points (7b-3). Not for UI use; see the notes on each. ---- */
  applyRemote:      (recordings: TabRecording[]) => void;
  deleteFromRemote: (ids: string[]) => void;
  dropTombstones:   (ids: string[]) => void;
}

/**
 * Stamps `updatedAt`, so no mutator has to remember to. Copied from `useMidiProjectsStore`'s
 * `touch()` rather than asking each call site, for the reason that pattern exists: the one
 * mutator that forgets produces a record that looks older than it is, and in 7b that is a
 * record silently overwritten by a stale copy from another device.
 *
 * **The sync engine must not write through these mutators**, which is why `applyRemote` exists
 * below. A record arriving from the cloud carries its own `updatedAt`, and pushing it through
 * `saveRecording` would restamp it to now, making every downloaded record look locally-newer
 * and defeating the comparison it was downloaded for.
 */
const touch = (recording: TabRecording): TabRecording => ({
  ...recording,
  updatedAt: Date.now(),
});

export const useRecordingsStore = create<RecordingsState>()(
  persist(
    (set) => ({
      recordings: [],
      deletedIds: [],

      saveRecording: (recording) =>
        set((s) => ({
          // Newest first; replace rather than duplicate if the same id is saved twice.
          recordings: [touch(recording), ...s.recordings.filter((r) => r.id !== recording.id)],
          // A save of an id this device previously deleted is a recreation, and the stale
          // tombstone would otherwise delete it again on the next sync. Dropping it here rather
          // than leaving it to `merge.ts` is belt-and-braces — the merge handles it too, by
          // `updatedAt` — but it keeps the log from carrying entries that are already wrong.
          deletedIds: s.deletedIds.filter((t) => t.id !== recording.id),
        })),

      deleteRecording: (id) =>
        set((s) => ({
          recordings: s.recordings.filter((r) => r.id !== id),
          // The write that makes the deletion syncable. Atomic with the deletion on purpose: a
          // log kept in a separate persisted store would be a second `localStorage` write, and
          // a tab closed between the two resurrects the recording on the next sync.
          deletedIds: [
            ...s.deletedIds.filter((t) => t.id !== id),
            { id, deletedAt: Date.now(), kind: 'tab' as const },
          ],
        })),

      renameRecording: (id, title) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? touch({ ...r, title }) : r)),
        })),

      toggleFavorite: (id) =>
        set((s) => ({
          recordings: s.recordings.map((r) =>
            (r.id === id ? touch({ ...r, favorite: !r.favorite }) : r)),
        })),

      /**
       * Write documents that won a merge, **preserving their `updatedAt`**.
       *
       * This is the door the sync engine uses, and the reason it exists is in `touch()` above.
       *
       * **Local `frames` are kept.** They describe the same take, they never travel (7b-1
       * strips them at 112 KB a piece), and they are not what last-write-wins is arbitrating —
       * so a remote copy winning on a title edit must not also throw away this device's debug
       * capture of the same recording.
       *
       * Takes an array because a pull applies many documents at once, and one `set()` is one
       * render.
       */
      applyRemote: (incoming) =>
        set((s) => {
          if (incoming.length === 0) return s;
          const arriving = new Map(incoming.map((r) => [r.id, r]));

          // Replace in place, prepend only what is genuinely new. **Not a re-sort**: the list's
          // order is the order the user built it in, and a pull that reshuffled the library
          // every time another device saved something would be the most visible thing this
          // whole feature does — and the least wanted.
          const updated = s.recordings.map((local) => {
            const remote = arriving.get(local.id);
            if (!remote) return local;
            arriving.delete(local.id);
            // Local `frames` are kept. They describe the same take, they never travel (7b-1
            // strips them at 112 KB apiece), and they are not what last-write-wins is
            // arbitrating — so a remote copy winning on a title edit must not also throw away
            // this device's debug capture of the same recording.
            return local.frames && !remote.frames ? { ...remote, frames: local.frames } : remote;
          });

          const fresh = incoming.filter((r) => arriving.has(r.id));
          const applied = new Set(incoming.map((r) => r.id));

          return {
            recordings: [...fresh, ...updated],
            deletedIds: s.deletedIds.filter((t) => !applied.has(t.id)),
          };
        }),

      /**
       * Remove documents a tombstone beat, **without logging a new tombstone**.
       *
       * Separate from `deleteRecording` for a reason that is easy to miss: a delete driven by a
       * remote tombstone that wrote its own tombstone would have two devices echoing deletions
       * at each other forever, each refreshing `deletedAt` and keeping the record alive past
       * its own garbage collection.
       */
      deleteFromRemote: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const gone = new Set(ids);
          return { recordings: s.recordings.filter((r) => !gone.has(r.id)) };
        }),

      /** Forget tombstones the engine has pushed, or that expired. */
      dropTombstones: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const drop = new Set(ids);
          return { deletedIds: s.deletedIds.filter((t) => !drop.has(t.id)) };
        }),
    }),
    {
      name:    'harp2tab-recordings',
      storage: recordingsStorage,
      version: RECORDINGS_SCHEMA_VERSION,
      migrate: migrateRecordings,
      // Actions would otherwise be written to `localStorage` as `null` and read back over the
      // real ones. Implicit before `deletedIds` existed because the state was a single array;
      // spelled out now that the persisted shape has two fields and neither is the whole state.
      partialize: (s) => ({ recordings: s.recordings, deletedIds: s.deletedIds } as RecordingsState),
    },
  ),
);

export const selectRecordings = (s: RecordingsState) => s.recordings;
