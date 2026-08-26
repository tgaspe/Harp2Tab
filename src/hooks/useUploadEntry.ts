/**
 * The "start something from a file" entry point, in one place.
 *
 * Home (`app.tsx`) and the web rail (`AppSidebar`) each carried their own byte-identical
 * copy of this: check the free-tier gate, open a picker, park the result in `pendingImport`,
 * push `/import`. Drag-and-drop would have made a third copy, and the part that must never
 * drift between copies is the *gate* — a path that forgets it is a path that gives away
 * transcriptions the paywall is supposed to hold.
 *
 * The gate stays inside the hook rather than being reported back to the caller because two
 * of its three outcomes are UI (the rating prompt, the paywall push). A version that
 * returned "showRating" would make every host re-implement the same two branches, which is
 * the duplication this is here to remove. `showRatingModal` is owned here for the same
 * reason; hosts render `<RatingModal>` from it.
 *
 * `checkGate` is exported for Record, which shares the gate but not the file handling.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';

import { AudioImportError, assertSizeWithinLimit } from '@/audio/audioImport';
import { classifyDroppedFile, toPickedFile, unsupportedFileMessage } from '@/audio/droppedFile';
import { setPendingImport } from '@/audio/pendingImport';
import { pickAudioFile } from '@/audio/pickAudioFile';
import { pickMidiFile } from '@/audio/pickMidiFile';
import { usePremium } from '@/hooks/usePremium';
import { resolveSessionGate } from '@/store/sessionGate';
import { selectKey, useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';

export function useUploadEntry() {
  const router = useRouter();

  const selectedKey         = useAppStore(selectKey);
  const totalRecordingsUsed = useSettingsStore((s) => s.totalRecordingsUsed);
  const ratingStatus        = useSettingsStore((s) => s.ratingStatus);
  // Paid access, not the `isPurchased` latch (8-3) — a subscription can lapse.
  const { premium }         = usePremium();

  const [showRatingModal, setShowRatingModal] = useState(false);
  // Only for failures that happen before the import screen exists (an oversized file, or a
  // drop of something that isn't audio) — everything after that is reported on /import.
  const [uploadError, setUploadError] = useState<string | null>(null);

  /** True when the caller may proceed. Falsy outcomes have already shown their own UI. */
  const checkGate = useCallback((): boolean => {
    const gate = resolveSessionGate({ isPurchased: premium, totalRecordingsUsed, ratingStatus });
    if (gate === 'showRating')  { setShowRatingModal(true); return false; }
    if (gate === 'showPaywall') { router.push('/paywall'); return false; }
    return true;
  }, [premium, totalRecordingsUsed, ratingStatus, router]);

  // `kind` is what tells /import to parse rather than transcribe — everything either side of
  // that step is shared between the two.
  const startImport = useCallback((picked: ReturnType<typeof toPickedFile>, kind: 'audio' | 'midi') => {
    setPendingImport(picked);
    setUploadError(null);
    if (kind === 'midi') router.push({ pathname: '/import', params: { kind: 'midi' } });
    else                 router.push('/import');
  }, [router]);

  const reportFailure = useCallback((err: unknown) => {
    // Only the pre-read size check can fail this early; everything else surfaces on the
    // import screen, which has room to explain it properly.
    setUploadError(err instanceof AudioImportError ? err.message : "That file couldn't be opened.");
  }, []);

  // The file dialog opens inside the press handler, not on the import screen, because
  // browsers only allow it during a real user gesture.
  const uploadAudio = useCallback(async () => {
    if (!selectedKey || !checkGate()) return;
    try {
      const picked = await pickAudioFile();
      if (!picked) return; // dismissed the picker — nothing started, nothing consumed
      startImport(picked, 'audio');
    } catch (err) {
      reportFailure(err);
    }
  }, [selectedKey, checkGate, startImport, reportFailure]);

  const uploadMidi = useCallback(async () => {
    if (!selectedKey || !checkGate()) return;
    try {
      const picked = await pickMidiFile();
      if (!picked) return;
      startImport(picked, 'midi');
    } catch (err) {
      reportFailure(err);
    }
  }, [selectedKey, checkGate, startImport, reportFailure]);

  /**
   * The drop path. Same destination as the buttons, reached without one.
   *
   * The file is checked *before* the gate, which is the opposite order to the buttons — and
   * deliberate. A button has nothing to check yet at gate time; a drop already holds the
   * file, and "that's a PDF" is true whether or not the user has imports left. Gating first
   * would send someone to the paywall to buy a conversion of a file that could never be
   * converted.
   */
  const importDroppedFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      // `pendingImport` holds exactly one entry, so this is the honest limit rather than a
      // policy — better said out loud than papered over by silently taking the first.
      setUploadError('Drop one file at a time.');
      return;
    }

    const file = files[0];
    const kind = classifyDroppedFile(file.name, file.type);
    if (kind === 'unsupported') {
      setUploadError(unsupportedFileMessage(file.name));
      return;
    }

    // The buttons can afford to no-op without a key (they're visibly disabled, which says
    // why). A drop has no disabled state to read, so silence here would be a dead end.
    if (!selectedKey) {
      setUploadError('Pick a harmonica key first, then drop your file.');
      return;
    }
    if (!checkGate()) return;

    try {
      const picked = toPickedFile(file);
      // Checked before anything reads the file, exactly as the pickers do.
      assertSizeWithinLimit(picked.size, picked.name);
      startImport(picked, kind);
    } catch (err) {
      reportFailure(err);
    }
  }, [selectedKey, checkGate, startImport, reportFailure]);

  return {
    uploadAudio,
    uploadMidi,
    importDroppedFiles,
    checkGate,
    uploadError,
    clearUploadError: useCallback(() => setUploadError(null), []),
    showRatingModal,
    setShowRatingModal,
  };
}
