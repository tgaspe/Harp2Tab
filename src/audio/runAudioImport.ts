/**
 * The audio-upload path: decode a picked file, then transcribe it.
 *
 * Split from `transcription.ts` at the decode seam for two reasons. A retained take arrives
 * already decoded and joins one step further in, so decoding cannot be part of the pipeline
 * itself; and `decodeAudio` is platform-split — the web half calls `decodeAudioData`, the
 * native half parses WAV bytes — which pulls React Native into anything that imports it,
 * including a plain `tsx` verification script.
 *
 * Everything else lives in `transcription.ts` and is re-exported here, so the screens and the
 * harness that already import from this module keep working unchanged.
 */

import { AudioImportError, type PickedAudioFile } from './audioImport';
import { decodeAudioFile } from './decodeAudio';
import { runTranscription, type AudioAnalysisResult, type RunTranscriptionParams } from './transcription';

export * from './transcription';

export interface RunAudioImportParams extends Omit<RunTranscriptionParams, 'audio' | 'sourceName'> {
  picked: PickedAudioFile;
}

/** The upload path: decode the picked file, then transcribe it. Split at the decode seam so
 *  a retained take — which arrives already decoded — can join at `runTranscription`. */
export async function runAudioImport({
  picked, harmonicaType, algorithm, params, segmentationKey, onProgress, shouldCancel,
}: RunAudioImportParams): Promise<AudioAnalysisResult> {
  onProgress?.({ stage: 'decoding', fraction: 0 });
  const audio = await decodeAudioFile(picked);

  if (shouldCancel?.()) throw new AudioImportError('cancelled', 'Transcription cancelled.');

  return runTranscription({
    audio, harmonicaType, algorithm, params, segmentationKey,
    sourceName: picked.name, onProgress, shouldCancel,
  });
}
