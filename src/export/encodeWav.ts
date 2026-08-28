/**
 * `RenderedAudio` → a 16-bit stereo WAV blob.
 *
 * spessasynth ships `audioBufferToWav`, and this exists instead of using it for one reason:
 * that function takes an `AudioBuffer`, a type with no existence outside a browser. Writing
 * the forty lines of RIFF here keeps every WAV assertion — header, rate, channel count,
 * length, clipping, determinism — inside `verify-audio-export.ts`, which runs under plain
 * `npx tsx` like every other harness in this repo. A format this stable is worth owning to
 * get that.
 *
 * Platform-neutral on purpose: it touches no browser API except `Blob`, so the pure PCM half
 * (`encodeWavBytes`) is callable from Node.
 */

import { AUDIO_FORMAT_FILE, type AudioExportResult, type RenderedAudio } from './audioFormats';

const BITS_PER_SAMPLE = 16;
const CHANNELS = 2;
const HEADER_BYTES = 44;

/** Signed 16-bit range. Positive full scale is 32767, not 32768, so +1.0 and -1.0 are not
 *  scaled asymmetrically into a wrap. */
const INT16_MAX = 32767;
const INT16_MIN = -32768;

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * The complete `.wav` file as bytes.
 *
 * Samples are **clamped**, not normalised. Normalising would make the output depend on the
 * loudest sample in the take, so exporting the same project twice after an unrelated edit
 * could change every byte — and a quiet passage would come back louder than the user heard
 * it. Clamping is what a DAW does and is deterministic.
 */
export function encodeWavBytes(audio: RenderedAudio): Uint8Array {
  const { left, right, sampleRate } = audio;
  // A mono render hands the same array in twice; a ragged pair would be a renderer bug, so
  // the shorter one wins rather than reading past the end.
  const frames = Math.min(left.length, right.length);

  const bytesPerFrame = CHANNELS * (BITS_PER_SAMPLE / 8);
  const dataBytes = frames * bytesPerFrame;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);   // file size after this field
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);              // PCM fmt chunk length
  view.setUint16(20, 1, true);               // format 1 = uncompressed PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);  // byte rate
  view.setUint16(32, bytesPerFrame, true);   // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < frames; i++) {
    for (const channel of [left, right]) {
      const scaled = Math.round(channel[i] * INT16_MAX);
      const clamped = scaled > INT16_MAX ? INT16_MAX : scaled < INT16_MIN ? INT16_MIN : scaled;
      view.setInt16(offset, clamped, true);
      offset += 2;
    }
  }

  return out;
}

export function encodeWav(audio: RenderedAudio): AudioExportResult {
  const { ext, mimeType } = AUDIO_FORMAT_FILE.WAV;
  const bytes = encodeWavBytes(audio);
  // `bytes.buffer` is exactly these bytes — `encodeWavBytes` allocates it and never subviews.
  return { blob: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), ext, mimeType };
}
