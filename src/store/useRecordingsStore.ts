import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recordingsStorage } from './storage';
import type { TabRecording } from '@/types';

interface RecordingsState {
  recordings: TabRecording[];
  saveRecording:   (recording: TabRecording) => void;
  deleteRecording: (id: string) => void;
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
    }),
    {
      name:    'harp2tab-recordings',
      storage: recordingsStorage,
    },
  ),
);

export const selectRecordings = (s: RecordingsState) => s.recordings;
