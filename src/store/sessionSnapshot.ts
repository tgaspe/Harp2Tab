import { useAppStore } from './useAppStore';
import { useRecordingsStore } from './useRecordingsStore';
import { useSettingsStore } from './useSettingsStore';
import { resolveSessionGate, type SessionGateResult } from './sessionGate';
import { getFrames } from '@/audio/frameBuffer';
import type { TabRecording } from '@/types';

/** The title a recording gets if the user doesn't override it — also used to pre-fill the
 *  naming prompt shown at save time. */
export function getDefaultRecordingTitle(): string {
  const { recordingStartTime } = useAppStore.getState();
  return new Date(recordingStartTime ?? Date.now()).toLocaleString();
}

/**
 * Snapshots the current in-progress session into the recordings library.
 * Must be called BEFORE `reset()` — `reset()` wipes `tabNotes`/`selectedKey`/
 * `recordingId` in one shot, so this has to read them while they're still live.
 *
 * `asNew: true` always writes under a freshly generated id instead of the session's own
 * `recordingId`. This matters when the current session came from `loadRecording()` (i.e.
 * the user reopened an already-saved recording from the library) — in that case
 * `recordingId` is the *same* id as the persisted entry, so saving under it would upsert
 * (silently overwrite) that entry rather than create a new one. The "New Recording" flow
 * always wants a new entry — it means "commit this session as its own thing and start
 * fresh" — so it should pass `asNew: true`; the plain Save flow wants normal "save my
 * edits back" semantics and should not.
 */
export function saveCurrentSessionToLibrary(title?: string, options?: { asNew?: boolean }): void {
  const { tabNotes, selectedKey, harmonicaType, recordingId, recordingStartTime, bpm } =
    useAppStore.getState();

  if (!selectedKey || !recordingId || tabNotes.length === 0) return;

  const last     = tabNotes[tabNotes.length - 1];
  const createdAt = recordingStartTime ?? Date.now();
  const id = options?.asNew ? `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : recordingId;

  const recording: TabRecording = {
    id,
    title:         title?.trim() || new Date(createdAt).toLocaleString(),
    key:           selectedKey,
    harmonicaType,
    tabNotes,
    createdAt,
    duration:      last.start_time + last.duration,
    // Frames were buffered under the session's original recordingId regardless of which
    // id this gets saved under — always read via that, not `id`.
    frames:        getFrames(recordingId),
    bpm,
  };

  useRecordingsStore.getState().saveRecording(recording);
}

/**
 * Starts a brand new recording session in place — subject to the same free-tier gate
 * every other "start a new session" entry point respects (sessionGate.ts). Callers branch
 * on the returned result: 'allow' means startRecording() already ran and it's safe to
 * navigate straight to '/recording'; 'showRating'/'showPaywall' mean the caller must show
 * that UI instead (same as index.tsx's handleStart).
 *
 * Deliberately does NOT touch selectedKey/harmonicaType and is not a full reset() — "New
 * Recording" from the editor should drop you straight into recording again with whatever
 * key/harmonica you were already using, not send you back to key selection.
 */
export function startNewRecordingSession(): SessionGateResult {
  const { isPurchased, totalRecordingsUsed, ratingStatus } = useSettingsStore.getState();
  const gate = resolveSessionGate({ isPurchased, totalRecordingsUsed, ratingStatus });
  if (gate === 'allow') useAppStore.getState().startRecording();
  return gate;
}
