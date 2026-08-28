/**
 * Native stub — see `renderMidiAudio.ts`. Nothing on native can produce a `RenderedAudio` to
 * hand this in the first place; it exists so the module graph resolves off web.
 */

import type { AudioExportResult, RenderedAudio } from './audioFormats';

export async function encodeCompressed(
  _audio: RenderedAudio,
  _format: 'MP3' | 'OGG',
): Promise<AudioExportResult> {
  throw new Error('Audio export is only available on the web version.');
}
