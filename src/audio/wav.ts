/**
 * RIFF/WAV reader — the inverse of `buildWavFile` in synthesizeWav.ts, which is why it
 * lives beside it rather than inside the platform-split decoder: native audio upload needs
 * to read WAV bytes, and the round-trip verification harness needs to read back exactly
 * what synthesizeWav wrote.
 *
 * Deliberately broader than what synthesizeWav emits (which is always mono 16-bit): an
 * uploaded WAV is whatever the user's recorder produced, so 8/16/24/32-bit integer,
 * 32/64-bit float, and multi-channel all have to parse.
 */

import { AudioImportError, downmixToMono, type DecodedAudio } from './audioImport';

const FORMAT_PCM        = 0x0001;
const FORMAT_IEEE_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe; // real format lives in the extension's first 2 bytes

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

interface FmtChunk {
  audioFormat:   number;
  channels:      number;
  sampleRate:    number;
  bitsPerSample: number;
}

export function parseWav(bytes: Uint8Array, name = 'file'): DecodedAudio {
  const fail = (code: 'unsupportedFormat' | 'decodeFailed', message: string): never => {
    throw new AudioImportError(code, message);
  };

  if (bytes.byteLength < 44) fail('decodeFailed', `"${name}" is too short to be a WAV file.`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    fail('unsupportedFormat', `"${name}" isn't a WAV file. On Android, only WAV files can be transcribed for now.`);
  }

  // Walk the chunk list rather than assuming the canonical 44-byte layout — real-world
  // WAVs routinely carry LIST/fact/bext chunks ahead of the data.
  let fmt: FmtChunk | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id   = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      let audioFormat = view.getUint16(body, true);
      const channels      = view.getUint16(body + 2, true);
      const sampleRate    = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (audioFormat === FORMAT_EXTENSIBLE && size >= 26) {
        audioFormat = view.getUint16(body + 24, true);
      }
      fmt = { audioFormat, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataOffset = body;
      // A streamed WAV can carry a bogus/0xFFFFFFFF data size — trust the actual buffer.
      dataLength = Math.min(size, bytes.byteLength - body);
    }

    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) fail('decodeFailed', `"${name}" has no WAV format header.`);
  if (dataOffset < 0) fail('decodeFailed', `"${name}" has no WAV audio data.`);

  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt!;
  if (audioFormat !== FORMAT_PCM && audioFormat !== FORMAT_IEEE_FLOAT) {
    fail('unsupportedFormat', `"${name}" uses a compressed WAV codec that can't be read directly.`);
  }
  if (channels < 1) fail('decodeFailed', `"${name}" reports ${channels} audio channels.`);

  const bytesPerSample = bitsPerSample / 8;
  const frameCount     = Math.floor(dataLength / (bytesPerSample * channels));
  const planes: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frameCount));

  const readSample = pickSampleReader(audioFormat, bitsPerSample, name);

  for (let frame = 0; frame < frameCount; frame++) {
    const frameStart = dataOffset + frame * bytesPerSample * channels;
    for (let ch = 0; ch < channels; ch++) {
      planes[ch][frame] = readSample(view, frameStart + ch * bytesPerSample);
    }
  }

  const samples = downmixToMono(planes);
  return { samples, sampleRate, durationMs: (frameCount / sampleRate) * 1000 };
}

/** Returns a reader normalizing one sample to the -1..1 range the pipeline works in. */
function pickSampleReader(
  audioFormat: number,
  bitsPerSample: number,
  name: string,
): (view: DataView, at: number) => number {
  if (audioFormat === FORMAT_IEEE_FLOAT) {
    if (bitsPerSample === 32) return (view, at) => view.getFloat32(at, true);
    if (bitsPerSample === 64) return (view, at) => view.getFloat64(at, true);
  } else {
    // 8-bit WAV is unsigned with 128 as the zero point; every wider depth is signed.
    if (bitsPerSample === 8)  return (view, at) => (view.getUint8(at) - 128) / 128;
    if (bitsPerSample === 16) return (view, at) => view.getInt16(at, true) / 0x8000;
    if (bitsPerSample === 24) {
      return (view, at) => {
        const unsigned = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
        // Sign-extend the 24-bit value into JS's 32-bit signed space.
        const signed = unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
        return signed / 0x800000;
      };
    }
    if (bitsPerSample === 32) return (view, at) => view.getInt32(at, true) / 0x80000000;
  }
  throw new AudioImportError('unsupportedFormat', `"${name}" uses ${bitsPerSample}-bit samples, which can't be read.`);
}
