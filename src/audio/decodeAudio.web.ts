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

export async function decodeAudioFile(picked: PickedAudioFile): Promise<DecodedAudio> {
  assertSizeWithinLimit(picked.size, picked.name);

  const file = picked.file as File | undefined;
  // The picker hands back a real File on web; the uri fetch is only a fallback for a
  // blob:/data: uri arriving from somewhere else (a future drag-and-drop zone).
  const bytes = file ? await file.arrayBuffer() : await (await fetch(picked.uri)).arrayBuffer();

  // A plain AudioContext decodes at the device's own sample rate — the same rate live
  // capture runs at, which keeps the analysis pass's frame timing identical between the
  // two creation paths.
  const ctx = new AudioContext();
  try {
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(bytes);
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
