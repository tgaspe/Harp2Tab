/** Native stub — see `renderMidiAudio.ts`. */

import type { AudioExportFormat, AudioExportResult } from './audioFormats';

export type AudioExportStage = 'rendering' | 'encoding';

export async function exportAudio(
  _smf: Uint8Array,
  _format: AudioExportFormat,
  _onStage?: (stage: AudioExportStage) => void,
): Promise<AudioExportResult> {
  throw new Error('Audio export is only available on the web version.');
}
