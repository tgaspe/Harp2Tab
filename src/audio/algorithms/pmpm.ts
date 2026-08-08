/**
 * The classic tracker, as an algorithm-registry entry.
 *
 * A thin wrapper over `analyzeSamples` — the pitch detection itself is unchanged and stays
 * where it is, since the live mic path calls straight into `detectPitch` and must keep
 * bypassing this seam entirely (a 2s neural window is no use to a real-time HUD).
 */

import { analyzeSamples } from '../analyzeSamples';
import type { DecodedAudio } from '../audioImport';
import type { TranscribeOptions, TranscriptionAlgorithm, TranscriptionOutput } from './index';

export const pmpmAlgorithm: TranscriptionAlgorithm = {
  id:             'pmpm',
  label:          'Classic pitch tracker',
  description:
    'Instant, runs entirely offline, and tuned for a solo harmonica line. Hears one note '
    + 'at a time, and is the only engine that records data for the Frame Inspector.',
  available:      true,
  producesFrames: true,
  polyphonic:     false,

  async transcribe(audio: DecodedAudio, options: TranscribeOptions = {}): Promise<TranscriptionOutput> {
    const frames = await analyzeSamples(audio, {
      onProgress:   (fraction) => options.onProgress?.({ stage: 'analyzing', fraction }),
      shouldCancel: options.shouldCancel,
    });
    return { kind: 'frames', frames };
  },
};
