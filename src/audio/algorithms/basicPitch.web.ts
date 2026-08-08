/**
 * Spotify's Basic Pitch (https://github.com/spotify/basic-pitch-ts), Apache-2.0 in both its
 * code and its weights.
 *
 * A small CNN that emits note events directly — pitched, timed, and polyphonic, which is
 * the point: harmonica players play double-stops, and the classic tracker can only ever
 * report one of the two pitches. What comes out of here is deliberately *not* reduced to a
 * single voice; that decision belongs to whoever renders it.
 *
 * Three things about the model shape the code below:
 *
 *  - It only accepts 22050Hz mono, so audio decoded at the device rate is resampled here
 *    and *only* here. Decoding at 22050 globally would silently retune every NoteDetector
 *    threshold, all of which are calibrated against 2048-sample frames at the device rate.
 *  - TensorFlow.js is ~1MB and is useless to the classic tracker, so it loads behind a
 *    dynamic import. Expo splits async imports into their own web chunk in production.
 *  - Segmentation (`outputToNotesPoly`) is a pure function of the model's three output
 *    matrices, so it can be re-run with different thresholds without re-running inference —
 *    which is what will let Frame Inspector's tuning sliders feel instant.
 */

import { AudioImportError, type DecodedAudio } from '../audioImport';
import type { MidiNote } from '../midiToNotes';
import type { TranscribeOptions, TranscriptionAlgorithm, TranscriptionOutput } from './index';

/** The only rate the model accepts (basic-pitch `inference.ts`: AUDIO_SAMPLE_RATE). */
const MODEL_SAMPLE_RATE = 22050;

/** The model's STFT hop, in samples — one output frame per hop, so `MODEL_SAMPLE_RATE /
 *  FFT_HOP` ≈ 86 frames per second, or ~11.6ms each. */
const FFT_HOP = 256;

/** Served from `public/`, which Expo copies to the site root on export. Not `public/assets`
 *  — Metro reserves that path. */
const MODEL_URL = '/models/basic-pitch/model.json';

/**
 * Thresholds for turning the model's frame/onset matrices into notes.
 *
 * These match `outputToNotesPoly`'s own defaults (toMidi.ts:345-347), which are also what
 * the Python library uses — so a run here is directly comparable to a reference
 * `basic_pitch.predict()` on the same file. (Note the README's example snippet passes
 * 0.25/0.25, which are *not* the defaults.) Anything tuned away from these should move
 * because harmonica recordings demanded it and the verification harness shows it, not
 * because a code sample used different numbers.
 *
 * `minFrequency`/`maxFrequency` stay null on purpose. The library applies them as the very
 * first step of segmentation (`constrainFrequency`, toMidi.ts:364), zeroing whole
 * posteriogram bins *before* onset inference, peak-picking and the melodia trick have run —
 * so the later stages lose the neighbouring-bin context they use to track a line and to
 * subtract energy, and notes well inside the band go missing. Measured against a reference
 * Python run on the same recording, constraining here cost substantially more real notes
 * than it removed noise. Out-of-range material is rejected after segmentation instead, by
 * pitch rather than by frequency — see `isPlayableOnAnyHarmonica`. The knobs remain so the
 * comparison can be re-run, not because they should be on.
 */
export interface BasicPitchSegmentationConfig {
  onsetThreshold: number;
  frameThreshold: number;
  /** Milliseconds. The TS `outputToNotesPoly` counts this in model frames, but that's its
   *  own internal unit — every other duration in this app is in ms, and so is the Python
   *  API's `minimum_note_length`. Converted at the call site. */
  minNoteLengthMs: number;
  /** Hz. Null means unconstrained, which is both the library default and ours — see the
   *  note above on why constraining here loses real notes. */
  minFrequency: number | null;
  maxFrequency: number | null;
  //
  // Note there is deliberately no velocity gate here. Cutting quiet notes is the right way
  // to remove the model's noise, but doing it during transcription makes it destructive —
  // the discarded notes never reach the editor, so a control for it could only ever remove
  // more, never bring any back. It lives at the very end instead, as a non-destructive
  // filter over the committed notes, so its slider works in both directions.
  /** basic-pitch's port of the Melodia contour-tracking heuristic — follows a melodic line
   *  through moments where its onset activation dips. */
  melodiaTrick: boolean;
  /** Adds onsets where frame activation jumps sharply without the onset head firing. */
  inferOnsets: boolean;
  energyTolerance: number;
}

export const DEFAULT_BASIC_PITCH_CONFIG: BasicPitchSegmentationConfig = {
  onsetThreshold:  0.5,
  frameThreshold:  0.3,
  // The library default of 5 frames, stated in the unit the rest of the app uses.
  minNoteLengthMs: 58,
  minFrequency:    null,
  maxFrequency:    null,
  melodiaTrick:    true,
  inferOnsets:     true,
  energyTolerance: 11,
};

/**
 * Milliseconds → the model frames `outputToNotesPoly` counts in. Deliberately the same
 * arithmetic as the Python API's `minimum_note_length` conversion, so the two agree on
 * where the rounding boundaries fall rather than drifting a frame apart at some durations.
 */
function minNoteLengthFrames(ms: number): number {
  return Math.round((ms / 1000) * (MODEL_SAMPLE_RATE / FFT_HOP));
}

/** The model's three output matrices, kept so segmentation can be re-run against different
 *  thresholds without paying for inference again. */
export interface BasicPitchInference {
  frames:   number[][];
  onsets:   number[][];
  contours: number[][];
}

/** Thrown out of `percentCallback` to unwind `evaluateModel`, whose per-window loop offers
 *  no other way to interrupt it. Never escapes this module. */
class CancelledInference extends Error {}

/**
 * Resample to the model's rate using the browser's own resampler.
 *
 * `OfflineAudioContext` does this properly (windowed-sinc, not point sampling); hand-rolling
 * a linear interpolator here would alias the upper harmonics that the model reads to
 * distinguish a bend from the note above it.
 */
async function resampleToModelRate(audio: DecodedAudio): Promise<Float32Array> {
  if (audio.sampleRate === MODEL_SAMPLE_RATE) return audio.samples;

  const targetLength = Math.max(
    1,
    Math.ceil((audio.samples.length * MODEL_SAMPLE_RATE) / audio.sampleRate),
  );
  const ctx = new OfflineAudioContext(1, targetLength, MODEL_SAMPLE_RATE);

  const sourceBuffer = ctx.createBuffer(1, audio.samples.length, audio.sampleRate);
  // `.set` rather than `copyToChannel`, which is typed against a plain-ArrayBuffer-backed
  // Float32Array and rejects the decoder's. Same single copy either way.
  sourceBuffer.getChannelData(0).set(audio.samples);

  const source = ctx.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(ctx.destination);
  source.start();

  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Loaded once per session and shared — the weights are ~900KB and the graph compile isn't
 * free, so constructing per transcription would make every run as slow as the first.
 *
 * `new BasicPitch(url)` returns immediately and does the fetch inside its own `.model`
 * promise, so that promise is awaited here: otherwise a failed download would surface
 * mid-inference, long past the point where it can be reported as a load failure.
 */
let instancePromise: Promise<any> | null = null;

function loadBasicPitch(): Promise<any> {
  instancePromise ??= (async () => {
    const { BasicPitch } = await import('@spotify/basic-pitch');
    const instance = new BasicPitch(MODEL_URL);
    await instance.model;
    return instance;
  })();
  return instancePromise;
}

/**
 * Run inference only. Split from segmentation so callers that want to re-threshold (Frame
 * Inspector) can hold onto the matrices and skip straight to `segment`.
 */
export async function runInference(
  audio: DecodedAudio,
  options: TranscribeOptions = {},
): Promise<BasicPitchInference> {
  options.onProgress?.({ stage: 'loadingModel', fraction: 0 });

  const samples = await resampleToModelRate(audio);
  if (options.shouldCancel?.()) {
    throw new AudioImportError('cancelled', 'Transcription cancelled.');
  }

  let basicPitch;
  try {
    basicPitch = await loadBasicPitch();
  } catch {
    // A failed model fetch is the one failure a user can actually act on (they're offline,
    // or the deploy is missing public/models), so it says so rather than reading as a
    // corrupt file. Cleared so a retry isn't permanently poisoned by one bad fetch.
    instancePromise = null;
    throw new AudioImportError(
      'decodeFailed',
      'The transcription model could not be loaded. Check your connection, or switch to the classic pitch tracker.',
    );
  }

  const frames:   number[][] = [];
  const onsets:   number[][] = [];
  const contours: number[][] = [];

  try {
    await basicPitch.evaluateModel(
      samples,
      (f: number[][], o: number[][], c: number[][]) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (fraction: number) => {
        if (options.shouldCancel?.()) throw new CancelledInference();
        options.onProgress?.({ stage: 'analyzing', fraction });
      },
    );
  } catch (err) {
    if (err instanceof CancelledInference) {
      throw new AudioImportError('cancelled', 'Transcription cancelled.');
    }
    throw err;
  }

  options.onProgress?.({ stage: 'analyzing', fraction: 1 });
  return { frames, onsets, contours };
}

/**
 * Model output → notes. Pure, and cheap relative to inference — this is the half that
 * re-runs when a tuning slider moves.
 */
export async function segment(
  inference: BasicPitchInference,
  config: BasicPitchSegmentationConfig = DEFAULT_BASIC_PITCH_CONFIG,
): Promise<MidiNote[]> {
  const { addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } =
    await import('@spotify/basic-pitch');

  // `outputToNotesPoly` starts by calling `constrainFrequency`, which zeroes every
  // posteriogram bin outside the band **in place** (toMidi.ts:263-281, and its own comment
  // says so). Passing the cached matrices directly would destroy them on the first call:
  // a later run with a wider band would be reading already-zeroed bins and could never
  // recover them, silently returning fewer notes with no indication why. Re-segmenting the
  // same inference is the entire reason this function is separate from `runInference`, so
  // the copy is the feature, not overhead.
  const frames = inference.frames.map((row) => row.slice());
  const onsets = inference.onsets.map((row) => row.slice());

  const events = noteFramesToTime(
    addPitchBendsToNoteEvents(
      inference.contours,
      outputToNotesPoly(
        frames,
        onsets,
        config.onsetThreshold,
        config.frameThreshold,
        minNoteLengthFrames(config.minNoteLengthMs),
        config.inferOnsets,
        config.maxFrequency,
        config.minFrequency,
        config.melodiaTrick,
        config.energyTolerance,
      ),
    ),
  );

  return events
    .map((event) => ({
      midi:       event.pitchMidi,
      timeMs:     event.startTimeSeconds * 1000,
      durationMs: event.durationSeconds * 1000,
      // The model's per-note activation, which is what basic-pitch itself writes as MIDI
      // velocity. It saturates near the top of its range, so it reads as "was this note
      // clearly sounded" more than "how hard" — good enough to drive the breath-force lane,
      // and comparable against signal RMS once Frame Inspector can offer the choice.
      velocity:   Math.max(1, Math.min(127, Math.round(event.amplitude * 127))),
    }))
    // Chronological: the poly segmenter walks pitch by pitch, so its output is grouped by
    // frequency bin rather than by time, and everything downstream assumes onset order.
    .sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);
}

export const basicPitchAlgorithm: TranscriptionAlgorithm = {
  id:    'basicPitch',
  label: 'Neural transcription (Basic Pitch)',
  description:
    'A neural model that reads real recordings far more accurately, and hears chords and '
    + 'double-stops. Downloads a small model on first use and takes longer to run.',
  available:      true,
  producesFrames: false,
  polyphonic:     true,

  async transcribe(audio: DecodedAudio, options: TranscribeOptions = {}): Promise<TranscriptionOutput> {
    const inference = await runInference(audio, options);
    return { kind: 'notes', notes: await segment(inference) };
  },
};
