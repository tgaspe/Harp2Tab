/**
 * The transcription-algorithm seam: decoded PCM in, timed pitches out.
 *
 * Two algorithms sit behind it and they disagree about what "timed pitches" even means,
 * which is why the output is a union rather than one shape:
 *
 *  - **pMPM** (the classic tracker) emits a continuous `RawFrame[]` pitch/loudness stream
 *    and leaves segmentation to NoteDetector, which segments on *tab identity*. That's what
 *    makes trying all 12 candidate keys cheap — re-running framesToNotes costs no DSP — and
 *    it's what Frame Inspector draws.
 *  - **Basic Pitch** (the neural model) emits note events directly and never produces a
 *    pitch track at all. So it joins the pipeline where MIDI import already joins it, at
 *    `rankKeysForMidi` / `notesToTabs`, and has nothing to give Frame Inspector.
 *
 * Collapsing those into one shape would mean either making NoteDetector key-agnostic (it
 * isn't, deliberately) or throwing away Basic Pitch's polyphony. The union keeps both
 * lanes honest and lets `runAudioImport` branch once.
 */

import type { DecodedAudio } from '../audioImport';
import type { MidiNote } from '../midiToNotes';
import type { RawFrame } from '@/types';

export type TranscriptionAlgorithmId = 'basicPitch' | 'pmpm';

/** Decoding is one opaque blocking call and reports no fraction. Loading the model is a
 *  network fetch that only Basic Pitch has, and only on its first run per session. */
export type TranscriptionStage = 'decoding' | 'loadingModel' | 'analyzing';

export interface TranscriptionProgress {
  stage:    TranscriptionStage;
  /** 0..1 within the current stage. */
  fraction: number;
}

export type TranscriptionOutput =
  /** A pitch/loudness stream; notes come later, per candidate key. */
  | { kind: 'frames'; frames: RawFrame[] }
  /**
   * Committed note events, already pitched.
   *
   * May be polyphonic — a harmonica plays double-stops, and the neural model hears them.
   * Nothing here reduces to a single voice; callers that can't yet render simultaneities
   * decide that for themselves.
   */
  | { kind: 'notes'; notes: MidiNote[] };

export interface TranscribeOptions {
  onProgress?:   (progress: TranscriptionProgress) => void;
  /** Polled at chunk boundaries; returning true aborts with an AudioImportError('cancelled'). */
  shouldCancel?: () => boolean;
}

export interface TranscriptionAlgorithm {
  id:          TranscriptionAlgorithmId;
  /** Shown in the picker. Deliberately not the internal name — "pMPM" means nothing to a
   *  harmonica player. */
  label:       string;
  description: string;
  /** False when the platform can't run it at all, which is how the picker knows to hide it
   *  rather than offering a choice that throws. */
  available:   boolean;
  /** Whether this algorithm retains the `RawFrame[]` Frame Inspector draws. */
  producesFrames: boolean;
  /** Whether it can hear more than one note at a time. */
  polyphonic:  boolean;
  transcribe(audio: DecodedAudio, options?: TranscribeOptions): Promise<TranscriptionOutput>;
}

import { basicPitchAlgorithm } from './basicPitch';
import { pmpmAlgorithm } from './pmpm';

/** Registration order is display order in the picker. */
export const TRANSCRIPTION_ALGORITHMS: readonly TranscriptionAlgorithm[] = [
  basicPitchAlgorithm,
  pmpmAlgorithm,
];

export const DEFAULT_ALGORITHM_ID: TranscriptionAlgorithmId = 'basicPitch';

/** Falls back to pMPM rather than throwing: the id can come from persisted settings written
 *  on another platform (or an older build), and an unavailable engine must not strand a
 *  user on a screen with no way to transcribe anything. */
export function getAlgorithm(id: TranscriptionAlgorithmId): TranscriptionAlgorithm {
  const found = TRANSCRIPTION_ALGORITHMS.find((a) => a.id === id);
  return found?.available ? found : pmpmAlgorithm;
}

export function availableAlgorithms(): TranscriptionAlgorithm[] {
  return TRANSCRIPTION_ALGORITHMS.filter((a) => a.available);
}
