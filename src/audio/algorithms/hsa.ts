/**
 * Native stub. HSA v2's CQT is a vendored WebAssembly module, and WASM does not run under
 * Hermes — so this engine is web-only, exactly as Basic Pitch is.
 *
 * This file exists purely so the native bundle resolves `./hsa`. The registry reads
 * `available` and hides the option rather than offering a choice that throws.
 *
 * **Native therefore has only the classic tracker.** The spectral engine this replaced was
 * pure TypeScript and ran on both bundles; it was the only polyphonic engine native could
 * ever have run. That narrowing is deliberate, and it is recorded with its reasoning in
 * `docs/plan/phase-16-hsa-engine.md` so Phase 15 inherits it explicitly rather than by
 * discovery.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import type { Prepared, Segmentation, TranscriptionAlgorithm } from './index';

export const hsaAlgorithm: TranscriptionAlgorithm = {
  id:             'hsa',
  label:          'Harmonic transcription (HSA v2)',
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
      'Harmonic transcription is only available on the web version.',
    );
  },

  async resegment(): Promise<Segmentation> {
    throw new AudioImportError(
      'unsupportedFormat',
      'Harmonic transcription is only available on the web version.',
    );
  },
};
