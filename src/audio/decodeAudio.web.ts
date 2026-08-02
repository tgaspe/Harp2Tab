/**
 * Web decoder: every format the browser itself can play (mp3, m4a, wav, ogg, flac) comes
 * for free through `decodeAudioData` — the same Web Audio API family the live capture path
 * already uses. This is a genuine platform split, not a hedge: there is no cross-platform
 * API that turns a compressed audio file into PCM.
 */

import {
  AudioImportError,
  assertDecodedWithinLimits,
  assertSizeWithinLimit,
  downmixToMono,
  type DecodedAudio,
  type PickedAudioFile,
} from './audioImport';
import { readFileBytes } from './readFileBytes';

export async function decodeAudioFile(picked: PickedAudioFile): Promise<DecodedAudio> {
  assertSizeWithinLimit(picked.size, picked.name);

  const bytes = await readFileBytes(picked);

  // A plain AudioContext decodes at the device's own sample rate — the same rate live
  // capture runs at, which keeps the analysis pass's frame timing identical between the
  // two creation paths.
  const ctx = new AudioContext();
  try {
    let buffer: AudioBuffer;
    try {
      // decodeAudioData wants an ArrayBuffer and detaches it; the byte-range copy keeps
      // that from depending on whether the view spans its whole buffer.
      buffer = await ctx.decodeAudioData(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    } catch {
      throw new AudioImportError(
        'unsupportedFormat',
        `"${picked.name}" couldn't be decoded. Try a WAV, MP3, or M4A file.`,
      );
    }

    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const audio: DecodedAudio = {
      samples:    downmixToMono(channels),
      sampleRate: buffer.sampleRate,
      durationMs: buffer.duration * 1000,
    };

    assertDecodedWithinLimits(audio, picked.name);
    return audio;
  } finally {
    void ctx.close();
  }
}
