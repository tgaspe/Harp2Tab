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

export const useRecordingsStore = create<RecordingsState>()(
  persist(
    (set) => ({
      recordings: [],

      saveRecording: (recording) =>
        set((s) => ({
          // Newest first; replace rather than duplicate if the same id is saved twice.
          recordings: [recording, ...s.recordings.filter((r) => r.id !== recording.id)],
        })),

      deleteRecording: (id) =>
        set((s) => ({ recordings: s.recordings.filter((r) => r.id !== id) })),

      renameRecording: (id, title) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? { ...r, title } : r)),
        })),

      toggleFavorite: (id) =>
        set((s) => ({
          recordings: s.recordings.map((r) => (r.id === id ? { ...r, favorite: !r.favorite } : r)),
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
