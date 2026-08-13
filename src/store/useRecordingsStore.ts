import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateRecordings, RECORDINGS_SCHEMA_VERSION } from './recordingsMigration';
import { recordingsStorage } from './storage';
import type { TabRecording } from '@/types';

interface RecordingsState {
  recordings: TabRecording[];
  saveRecording:   (recording: TabRecording) => void;
  deleteRecording: (id: string) => void;
  renameRecording: (id: string, title: string) => void;
  toggleFavorite:  (id: string) => void;
}

/**
 * Stamps `updatedAt`, so no mutator has to remember to. Copied from `useMidiProjectsStore`'s
 * `touch()` rather than asking each call site, for the reason that pattern exists: the one
 * mutator that forgets produces a record that looks older than it is, and in 7b that is a
 * record silently overwritten by a stale copy from another device.
 *
 * **7b note — the sync engine must not write through these mutators.** A record arriving from
 * the cloud carries its own `updatedAt`, and pushing it through `saveRecording` would restamp
 * it to now, making every downloaded record look locally-newer and defeating the comparison
 * it was downloaded for. The merge engine needs its own store entry point that preserves the
 * timestamp; this is the trap it exists to avoid.
 */
const touch = (recording: TabRecording): TabRecording => ({
  ...recording,
  updatedAt: Date.now(),
});

export const useRecordingsStore = create<RecordingsState>()(
  persist(
    (set) => ({
      recordings: [],

      saveRecording: (recording) =>
        set((s) => ({
          // Newest first; replace rather than duplicate if the same id is saved twice.
          recordings: [touch(recording), ...s.recordings.filter((r) => r.id !== recording.id)],
        })),

      deleteRecording: (id) =>
        set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) })),

      renameRecording: (id, title) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? touch({ ...r, title }) : r)),
        })),

      toggleFavorite: (id) =>
        set((s) => ({
          recordings: s.recordings.map((r) =>
            (r.id === id ? touch({ ...r, favorite: !r.favorite }) : r)),
        })),
    }),
    {
      name:    'harp2tab-recordings',
      storage: recordingsStorage,
      version: RECORDINGS_SCHEMA_VERSION,
      migrate: migrateRecordings,
    },
  ),
);

export const selectRecordings = (s: RecordingsState) => s.recordings;
