/**
 * Shared vocabulary for the audio-upload path — the decoded-PCM shape, the picked-file
 * shape, and the typed failures both platforms' decoders raise. Lives apart from
 * `decodeAudio` itself because that module is platform-split (`.web.ts` uses
 * `decodeAudioData`, native parses WAV bytes) and both halves need these types.
 */

/** Mono PCM, the only form the analysis pass understands. */
export interface DecodedAudio {
  samples:    Float32Array;
  sampleRate: number;
  durationMs: number;
}

/**
 * A file handed over by the picker, normalized across platforms. Native identifies a file
 * by `uri`; on web the `File` object itself is what matters (`decodeAudioData` needs the
 * bytes, and a blob: uri is a needless round-trip).
 */
export interface PickedAudioFile {
  name:      string;
  uri:       string;
  mimeType?: string | null;
  size?:     number | null;
  /** Web only — a DOM `File`. Typed loosely so this module stays DOM-free. */
  file?:     unknown;
}

export type ImportErrorCode =
  | 'unsupportedFormat'  // container/codec this platform can't decode
  | 'tooLarge'           // over MAX_FILE_BYTES
  | 'tooLong'            // over MAX_DURATION_MS
  | 'sampleRateTooLow'   // under MIN_SAMPLE_RATE — MPM has no headroom
  | 'decodeFailed'       // corrupt/truncated file
  | 'noAudio'            // decoded fine but contains no detectable notes
  | 'cancelled';         // user backed out mid-analysis

/** Every failure the import flow can show the user, as one catchable type with a code the
 *  UI switches on — so the import screen never has to string-match an error message. */
export class AudioImportError extends Error {
  constructor(readonly code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'AudioImportError';
  }
}

// Ceilings chosen against the analysis cost, not arbitrary politeness: pitch detection is
// ~2M multiply-adds per 46ms frame, so a 5-minute file is already ~6,500 detectPitch calls.
export const MAX_FILE_BYTES  = 25 * 1024 * 1024;
export const MAX_DURATION_MS = 5 * 60 * 1000;
// pitchDetector's FREQ_MAX is 3200Hz; below ~16kHz there isn't enough headroom above
// Nyquist for the upper harmonica range to survive decoding.
export const MIN_SAMPLE_RATE = 16000;

export function assertSizeWithinLimit(bytes: number | null | undefined, name: string): void {
  if (bytes != null && bytes > MAX_FILE_BYTES) {
    throw new AudioImportError(
      'tooLarge',
      `"${name}" is ${(bytes / 1024 / 1024).toFixed(0)} MB. Files up to ${MAX_FILE_BYTES / 1024 / 1024} MB can be transcribed.`,
    );
  }
}

export function assertDecodedWithinLimits(audio: DecodedAudio, name: string): void {
  if (audio.sampleRate < MIN_SAMPLE_RATE) {
    throw new AudioImportError(
      'sampleRateTooLow',
      `"${name}" is recorded at ${audio.sampleRate} Hz, too low to detect harmonica pitches reliably.`,
    );
  }
  if (audio.durationMs > MAX_DURATION_MS) {
    throw new AudioImportError(
      'tooLong',
      `"${name}" is ${Math.round(audio.durationMs / 60000)} minutes long. Recordings up to ${MAX_DURATION_MS / 60000} minutes can be transcribed.`,
    );
  }
  if (audio.samples.length === 0) {
    throw new AudioImportError('noAudio', `"${name}" contains no audio.`);
  }
}

/** Averages interleaved-by-channel PCM down to the single channel the pipeline expects.
 *  Averaging (not just taking channel 0) keeps a hard-panned take from going silent. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const mono   = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= channels.length;
  return mono;
}
