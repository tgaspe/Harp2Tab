/**
 * The audio-export contract, kept deliberately separate from `ExportFormat`.
 *
 * `ExportFormat` (TXT/CSV/MIDI/MusicXML/JSON) is consumed by `generateForFormat`, which
 * returns `{ content, encoding }` — a string. WAV/MP3/OGG have no string form, so widening
 * that union would put a case in every generator that cannot be written. They are a second,
 * parallel family instead, joined only at the popup that renders both (see
 * `ExportMenuSurface`).
 *
 * Web-only: the renderer behind these formats is an `OfflineAudioContext`, which native has
 * no equivalent of. See `renderMidiAudio.ts` for what native does instead.
 */

export type AudioExportFormat = 'WAV' | 'MP3' | 'OGG';

/**
 * What the offline renderer hands the encoders.
 *
 * Deliberately raw `Float32Array`s rather than an `AudioBuffer`: an `AudioBuffer` only
 * exists in a browser, and making it the currency here would put `encodeWav` permanently
 * out of reach of the Node harness. This shape is constructible from thin air in a test.
 */
export interface RenderedAudio {
  /** Left channel PCM, nominally -1..1 (the renderer does not clamp; the encoders do). */
  left:  Float32Array;
  /** Right channel PCM. Mono sources hand the same array twice. */
  right: Float32Array;
  sampleRate:  number;
  durationSec: number;
}

export interface AudioExportResult {
  blob:     Blob;
  /** Without the dot — `exportFileName` adds it. */
  ext:      string;
  mimeType: string;
}

/** The order they appear in the export popup's Audio section. */
export const AUDIO_EXPORT_FORMATS: AudioExportFormat[] = ['WAV', 'MP3', 'OGG'];

export const AUDIO_FORMAT_META: Record<
  AudioExportFormat,
  { label: string; description: string; icon: string }
> = {
  WAV: { label: 'WAV', description: 'Uncompressed audio, largest file',     icon: 'pulse-outline' },
  MP3: { label: 'MP3', description: 'Compressed audio, plays everywhere',   icon: 'musical-note-outline' },
  OGG: { label: 'OGG', description: 'Compressed audio, open Vorbis format', icon: 'disc-outline' },
};

/** Stereo at CD rate. Fixed rather than exposed: every consumer of an exported file handles
 *  44.1kHz, and a rate picker is a setting nobody has asked for. */
export const AUDIO_EXPORT_SAMPLE_RATE = 44100;

/** Silence rendered past the last note-off, so reverb tails and release envelopes are not
 *  cut mid-decay. One second is comfortably longer than the soundfont's longest release. */
export const AUDIO_EXPORT_TAIL_SEC = 1.0;

export const AUDIO_FORMAT_FILE: Record<AudioExportFormat, { ext: string; mimeType: string }> = {
  WAV: { ext: 'wav', mimeType: 'audio/wav'  },
  MP3: { ext: 'mp3', mimeType: 'audio/mpeg' },
  OGG: { ext: 'ogg', mimeType: 'audio/ogg'  },
};
