import { useAppStore } from './useAppStore';
import { useRecordingsStore } from './useRecordingsStore';
import { getFrames } from '@/audio/frameBuffer';
import type { TabRecording } from '@/types';

/**
 * Snapshots the current in-progress session into the recordings library.
 * Must be called BEFORE `reset()` — `reset()` wipes `tabNotes`/`selectedKey`/
 * `recordingId` in one shot, so this has to read them while they're still live.
 */
export function saveCurrentSessionToLibrary(): void {
  const { tabNotes, selectedKey, harmonicaType, recordingId, recordingStartTime, bpm } =
    useAppStore.getState();

  if (!selectedKey || !recordingId || tabNotes.length === 0) return;

  const last     = tabNotes[tabNotes.length - 1];
  const createdAt = recordingStartTime ?? Date.now();

  const recording: TabRecording = {
    id:            recordingId,
    title:         new Date(createdAt).toLocaleString(),
    key:           selectedKey,
    harmonicaType,
    tabNotes,
    createdAt,
    duration:      last.start_time + last.duration,
    frames:        getFrames(recordingId),
    bpm,
  };

  useRecordingsStore.getState().saveRecording(recording);
}
