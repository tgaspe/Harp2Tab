import { useAppStore } from './useAppStore';
import { useRecordingsStore } from './useRecordingsStore';
import { useSettingsStore } from './useSettingsStore';
import { getPremium } from '@/hooks/usePremium';
import { resolveSessionGate, type SessionGateResult } from './sessionGate';
import { decimateFrames, getFrames } from '@/audio/frameBuffer';
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
  const {
    tabNotes, selectedKey, harmonicaType, recordingId, recordingStartTime, bpm, sessionSource,
    noiseGate, durationFloorMs,
  } = useAppStore.getState();

  if (!selectedKey || !recordingId || tabNotes.length === 0) return;

  const last     = tabNotes[tabNotes.length - 1];
  const createdAt = recordingStartTime ?? Date.now();
  const id = options?.asNew ? `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : recordingId;

  const recording: TabRecording = {
    id,
    title:         title?.trim() || new Date(createdAt).toLocaleString(),
    key:           selectedKey,
    harmonicaType,
    // Every note, never the filtered subset — both floors are stored beside them and
    // re-applied on load, so hiding a note must not be a way to silently delete it from the
    // library.
    tabNotes,
    createdAt,
    // Not `createdAt` here, unlike a freshly converted tab: `createdAt` is when the *session
    // started*, and this snapshot runs when it is saved — after however long the take and the
    // edits took. Restamped by the store's `touch()` on the way in either way.
    updatedAt:     Date.now(),
    // Measured across all notes for the same reason: the take is as long as it is,
    // regardless of how much of it is currently hidden. A filtered duration would make the
    // library's listed length change every time either line moved.
    duration:      last.start_time + last.duration,
    // Frames were buffered under the session's original recordingId regardless of which
    // id this gets saved under — always read via that, not `id`. Thinned on the way into
    // storage: an imported audio file can carry thousands of frames, which the in-memory
    // buffer handles fine but AsyncStorage shouldn't be asked to.
    frames:        decimateFrames(getFrames(recordingId)),
    bpm,
    source:        sessionSource,
    noiseGate,
    durationFloorMs,
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
/**
 * Commits whatever take is in progress before the paywall's sign-in step can lose it (7-6).
 *
 * **This is the hard requirement of 7-6, and the one most likely to be skipped.** Creating an
 * account can end in a confirmation link that opens in a different browser entirely, and a
 * user who loses the take they were working on while going to pay for the app does not come
 * back. Everything else in the subscribe gate is ordering; this is the part that protects
 * work.
 *
 * Called from the paywall screen itself rather than from the ten places that route to it.
 * That is deliberate: a rule enforced at one door cannot be forgotten by the eleventh caller,
 * and there is no version of "we reached the paywall" where preserving the take is wrong.
 *
 * Not `asNew` — if this session came from reopening a library entry, the user's edits belong
 * back on that entry, not in a duplicate.
 *
 * Returns whether anything was actually saved, so the caller can say so. A save the user
 * cannot see is a save they will not trust.
 */
export function preserveSessionForPaywall(): boolean {
  const { tabNotes, selectedKey, recordingId } = useAppStore.getState();
  if (!selectedKey || !recordingId || tabNotes.length === 0) return false;

  saveCurrentSessionToLibrary(getDefaultRecordingTitle());
  return true;
}

export function startNewRecordingSession(): SessionGateResult {
  const { totalRecordingsUsed, ratingStatus } = useSettingsStore.getState();
  const gate = resolveSessionGate({ isPurchased: getPremium().premium, totalRecordingsUsed, ratingStatus });
  if (gate === 'allow') useAppStore.getState().startRecording();
  return gate;
}
