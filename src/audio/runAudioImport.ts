/**
 * Orchestrates one audio-file import: decode → analyze → (for diatonic) detect the key.
 * Kept out of the import screen so the pipeline can be driven headlessly — the
 * verification harness in scripts/ runs exactly these steps — and so the screen only deals
 * with progress, cancellation and errors.
 *
 * Note what this deliberately does *not* do: turn frames into notes. That step is cheap and
 * key-dependent, so it happens after the user has confirmed (or overridden) the detected
 * key, and can be re-run for a different key without touching the audio again.
 */

import { analyzeSamples } from './analyzeSamples';
import { AudioImportError, type PickedAudioFile } from './audioImport';
import { decodeAudioFile } from './decodeAudio';
import { detectHarmonicaKey, shiftFrames, type KeyDetectionResult } from './keyDetection';
import type { HarmonicaType, RawFrame } from '@/types';

/** Decoding is one opaque blocking call (the browser's codec / a WAV read), so it reports
 *  no fraction; analysis knows its exact frame count and does. */
export type ImportStage = 'decoding' | 'analyzing';

export interface ImportProgress {
  stage:    ImportStage;
  /** 0..1 within the current stage; always 0 while decoding. */
  fraction: number;
}

export interface AudioAnalysisResult {
  /** Octave-shifted already, when detection decided the recording sat outside the
   *  harmonica's range — so these frames match the notes and tabs derived from them. */
  frames:     RawFrame[];
  durationMs: number;
  /** Null for chromatic harmonicas: a 12-hole chromatic covers every semitone in its
   *  range, so all 12 keys score nearly identically and the result would carry no
   *  information. Detection is a diatonic feature. */
  detection:  KeyDetectionResult | null;
}

export interface RunAudioImportParams {
  picked:        PickedAudioFile;
  harmonicaType: HarmonicaType;
  onProgress?:   (progress: ImportProgress) => void;
  shouldCancel?: () => boolean;
}

export async function runAudioImport({
  picked,
  harmonicaType,
  onProgress,
  shouldCancel,
}: RunAudioImportParams): Promise<AudioAnalysisResult> {
  onProgress?.({ stage: 'decoding', fraction: 0 });
  const audio = await decodeAudioFile(picked);

  if (shouldCancel?.()) throw new AudioImportError('cancelled', 'Transcription cancelled.');

  const rawFrames = await analyzeSamples(audio, {
    onProgress: (fraction) => onProgress?.({ stage: 'analyzing', fraction }),
    shouldCancel,
  });

  if (!rawFrames.some((f) => Number.isFinite(f.frequency) && f.frequency > 0)) {
    throw new AudioImportError(
      'noAudio',
      `No playable notes were found in "${picked.name}". It may be silent, or too quiet to transcribe.`,
    );
  }

  if (harmonicaType === 'chromatic') {
    return { frames: rawFrames, durationMs: audio.durationMs, detection: null };
  }

  const detection = detectHarmonicaKey(rawFrames, harmonicaType);
  return {
    frames:     shiftFrames(rawFrames, detection.octaveShiftSemitones),
    durationMs: audio.durationMs,
    detection,
  };
}
