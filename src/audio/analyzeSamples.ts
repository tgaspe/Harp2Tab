/**
 * Offline pitch analysis: decoded PCM → `RawFrame[]`, the same frame stream the live mic
 * path produces. This is the expensive, *key-agnostic* half of audio import — no harmonica
 * key is involved here, since `frequencyToTab` only enters later inside NoteDetector
 * (see framesToNotes.ts). Keeping the split at this boundary is what makes trying all 12
 * candidate keys cheap for automatic key detection, and it hands Frame Inspector its data
 * for free, since `RawFrame[]` is exactly what it already reads.
 */

import { computeRms, detectPitch, PITCH_WINDOW_SIZE } from './pitchDetector';
import { AudioImportError, type DecodedAudio } from './audioImport';
import type { RawFrame } from '@/types';

/**
 * Non-overlapping windows: the live web capture path runs a 2048-sample
 * ScriptProcessorNode (AudioCapture.web.ts), so frames arrive ~46ms apart at 44.1kHz, and
 * every NoteDetector threshold (graceMs 150, confirmMs 40, minDurationMs 110, minDipMs 50)
 * is tuned against that spacing. Matching the hop to the live frame rate is what makes an
 * uploaded file segment into notes the same way a recording does — overlapping hops would
 * silently retune the whole detector.
 */
const HOP = PITCH_WINDOW_SIZE;

/** Frames analyzed between event-loop yields — small enough that Cancel stays responsive
 *  and the progress bar moves, large enough that yielding isn't itself the bottleneck. */
const FRAMES_PER_CHUNK = 64;

/** Frame RMS below `peak × this` is treated as silence and skipped without running pitch
 *  detection (~-24dB). Mirrors the live path's `rms >= threshold` gate, which can't be
 *  reused directly: that threshold comes from the user's mic-sensitivity setting, which
 *  means nothing for a file someone else recorded. Also the single biggest CPU saving
 *  here, since silence is where a real recording spends much of its length. */
const SILENCE_RATIO = 0.06;
/** Floor for the gate above, so a near-silent file doesn't set an absurdly low threshold
 *  and spend minutes detecting pitches in room tone. */
const SILENCE_ABSOLUTE_FLOOR = 1e-4;

export interface AnalyzeOptions {
  /** 0..1, called at chunk boundaries. Exact, not estimated — the frame count is known up front. */
  onProgress?:  (fraction: number) => void;
  /** Polled at chunk boundaries; returning true aborts with an AudioImportError('cancelled'). */
  shouldCancel?: () => boolean;
}

function yieldToEventLoop(): Promise<void> {
  // setTimeout, not a microtask — a resolved promise wouldn't let React paint the
  // progress bar or let a Cancel press be delivered between chunks.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Loudness of every window, computed up front. Cheap relative to pitch detection (one
 *  pass over the samples vs. ~2M multiply-adds per window) and it's what lets the silence
 *  gate be relative to this particular file rather than an absolute guess. */
function frameRmsValues(audio: DecodedAudio, frameCount: number): Float32Array {
  const values = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    values[i] = computeRms(audio.samples.subarray(i * HOP, i * HOP + PITCH_WINDOW_SIZE));
  }
  return values;
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index  = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

export async function analyzeSamples(
  audio: DecodedAudio,
  options: AnalyzeOptions = {},
): Promise<RawFrame[]> {
  // A trailing partial window is dropped rather than zero-padded — padding would fabricate
  // a decaying edge that reads as a note ending, and it's under 46ms of audio.
  const frameCount = Math.floor((audio.samples.length - PITCH_WINDOW_SIZE) / HOP) + 1;
  if (frameCount <= 0) return [];

  const rmsValues = frameRmsValues(audio, frameCount);
  const threshold = Math.max(SILENCE_ABSOLUTE_FLOOR, percentile(rmsValues, 0.95) * SILENCE_RATIO);

  const frames: RawFrame[] = new Array(frameCount);

  for (let i = 0; i < frameCount; i++) {
    const rms = rmsValues[i];
    // Gated frames still get emitted (with NaN frequency, same as the live path's silence
    // frames) — Frame Inspector draws their loudness, and NoteDetector folds them into its
    // ambient-noise-floor estimate.
    const frequency = rms >= threshold
      ? detectPitch(audio.samples.subarray(i * HOP, i * HOP + PITCH_WINDOW_SIZE), audio.sampleRate)
      : NaN;

    frames[i] = { frequency, rms, t: Math.round((i * HOP * 1000) / audio.sampleRate) };

    if ((i + 1) % FRAMES_PER_CHUNK === 0) {
      if (options.shouldCancel?.()) {
        throw new AudioImportError('cancelled', 'Transcription cancelled.');
      }
      options.onProgress?.((i + 1) / frameCount);
      await yieldToEventLoop();
    }
  }

  options.onProgress?.(1);
  return frames;
}
