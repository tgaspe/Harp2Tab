/**
 * The one call the UI makes: standard MIDI bytes plus a format, out comes a downloadable
 * blob. Keeps the render/encode split (and the dynamic codec import) away from the popups.
 */

import { renderMidiAudio } from '@/audio/export/renderMidiAudio';
import type { AudioExportFormat, AudioExportResult } from './audioFormats';
import { encodeCompressed } from './encodeCompressed';
import { encodeWav } from './encodeWav';

/** Which stage is running, so the button can say `Rendering audio…` then `Encoding MP3…`
 *  rather than sitting on one spinner for both. */
export type AudioExportStage = 'rendering' | 'encoding';

export async function exportAudio(
  smf: Uint8Array,
  format: AudioExportFormat,
  onStage?: (stage: AudioExportStage) => void,
): Promise<AudioExportResult> {
  onStage?.('rendering');
  const audio = await renderMidiAudio(smf);

  onStage?.('encoding');
  return format === 'WAV' ? encodeWav(audio) : encodeCompressed(audio, format);
}
