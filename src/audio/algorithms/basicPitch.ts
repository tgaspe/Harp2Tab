/**
 * Native stub. Basic Pitch is a web-only engine for now: it needs TensorFlow.js and an
 * `OfflineAudioContext` to resample, neither of which exists in React Native without a
 * separate stack (`tfjs-react-native`).
 *
 * This file exists purely so the native bundle resolves `./basicPitch` — the registry reads
 * `available` and hides the option rather than offering a choice that throws. Native keeps
 * transcribing with the classic tracker.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import type { TranscriptionAlgorithm, TranscriptionOutput } from './index';

export const basicPitchAlgorithm: TranscriptionAlgorithm = {
  id:             'basicPitch',
  label:          'Neural transcription (Basic Pitch)',
  description:    'Not available on this platform yet.',
  available:      false,
  producesFrames: false,
  polyphonic:     true,

  async transcribe(_audio: DecodedAudio): Promise<TranscriptionOutput> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Neural transcription is only available on the web version.',
    );
  },
};
