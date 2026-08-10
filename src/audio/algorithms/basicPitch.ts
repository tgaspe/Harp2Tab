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
import type { Prepared, Segmentation, TranscriptionAlgorithm } from './index';

export const basicPitchAlgorithm: TranscriptionAlgorithm = {
  id:             'basicPitch',
  label:          'Neural transcription (Basic Pitch)',
  description:    'Not available on this platform yet.',
  available:      false,
  producesFrames: false,
  polyphonic:     true,
  // Nothing declares a parameter it can't run. An empty schema also means that if this
  // engine ever did surface here by mistake, the tune screen would render an empty rail
  // rather than controls wired to nothing.
  params:         [],

  async prepare(_audio: DecodedAudio): Promise<Prepared> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Neural transcription is only available on the web version.',
    );
  },

  async resegment(): Promise<Segmentation> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Neural transcription is only available on the web version.',
    );
  },
};
