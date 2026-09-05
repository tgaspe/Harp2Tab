/**
 * The transcription-algorithm seam: decoded PCM in, timed pitches out.
 *
 * Two algorithms sit behind it and they disagree about what "timed pitches" even means,
 * which is why the output is a union rather than one shape:
 *
 *  - **pMPM** (the classic tracker) emits a continuous `RawFrame[]` pitch/loudness stream
 *    and leaves segmentation to NoteDetector, which segments on *tab identity*. That's what
 *    makes trying all 12 candidate keys cheap — re-running framesToNotes costs no DSP — and
 *    it's what Frame Inspector draws.
 *  - **Basic Pitch** (the neural model) emits note events directly and never produces a
 *    pitch track at all. So it joins the pipeline where MIDI import already joins it, at
 *    `rankKeysForMidi` / `notesToTabs`, and has nothing to give Frame Inspector.
 *
 * Collapsing those into one shape would mean either making NoteDetector key-agnostic (it
 * isn't, deliberately) or throwing away Basic Pitch's polyphony. The union keeps both
 * lanes honest and lets `runAudioImport` branch once.
 */

import type { DecodedAudio } from '../audioImport';
import type { MidiNote } from '../midiToNotes';
import type { NoteDetectorConfig } from '../NoteDetector';
import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey, HarmonicaType, RawFrame } from '@/types';

export type TranscriptionAlgorithmId = 'basicPitch' | 'hsa' | 'pmpm';

/** Decoding is one opaque blocking call and reports no fraction. Loading the model is a
 *  network fetch that only Basic Pitch has, and only on its first run per session. */
export type TranscriptionStage = 'decoding' | 'loadingModel' | 'analyzing';

export interface TranscriptionProgress {
  stage:    TranscriptionStage;
  /** 0..1 within the current stage. */
  fraction: number;
}

export type TranscriptionOutput =
  /** A pitch/loudness stream; notes come later, per candidate key. */
  | { kind: 'frames'; frames: RawFrame[] }
  /**
   * Committed note events, already pitched.
   *
   * May be polyphonic — a harmonica plays double-stops, and the neural model hears them.
   * Nothing here reduces to a single voice; callers that can't yet render simultaneities
   * decide that for themselves.
   */
  | { kind: 'notes'; notes: MidiNote[] };

export interface TranscribeOptions {
  onProgress?:   (progress: TranscriptionProgress) => void;
  /** Polled at chunk boundaries; returning true aborts with an AudioImportError('cancelled'). */
  shouldCancel?: () => boolean;
}

// ── Two-phase transcription ─────────────────────────────────────────────────────
//
// Both engines have the same shape underneath: one expensive pass over the audio, then a
// cheap re-reading of what that pass produced.
//
//   | engine      | expensive (once)        | cheap (per parameter change)          |
//   |-------------|-------------------------|---------------------------------------|
//   | Basic Pitch | evaluateModel — a CNN   | outputToNotesPoly — pure, 3 matrices  |
//   | pMPM        | analyzeSamples — NSDF   | framesToNotes — no DSP at all         |
//
// Splitting them is what makes a tuning screen affordable: every declared parameter below
// re-runs only the cheap half, so a slider drag costs milliseconds instead of a re-analysis.
// That is also the rule for what may be declared at all — anything needing a fresh pass over
// the audio (Basic Pitch's sample rate, pMPM's analysis hop) is a settings-level decision and
// deliberately isn't here, however tempting a slider for it looks.

/**
 * `HarmonicaKey | null` is the pitch-range kind's value — a key, or null for "no bound".
 * Widening this to carry a domain type rather than a bare number is deliberate: the bounds
 * it stands for are two frequencies, but *choosing* them by frequency is a fact about the
 * library, and the person choosing is thinking about which harp the recording was played on.
 */
export type ParamValue  = number | boolean | HarmonicaKey | null;
export type ParamValues = Record<string, ParamValue>;

interface ParamBase {
  /** Internal, and the key in `ParamValues` — the library's own name for the knob. */
  id:        string;
  /**
   * The user's name for it, not the library's. "onsetThreshold" is a fact about
   * `outputToNotesPoly`; "onset sensitivity" is a fact about the recording, and the person
   * dragging the slider is thinking about the recording.
   */
  label:     string;
  /** One line under the control. Says which direction does what, since no slider label can. */
  help?:     string;
  /** Hidden behind a disclosure. For knobs that are real but that nobody should have to
   *  meet to get a good transcription. */
  advanced?: boolean;
}

export interface NumberParam extends ParamBase {
  kind:    'number';
  min:     number;
  max:     number;
  step:    number;
  default: number;
  /** Renders the value with its unit. Slider values are bare numbers; "58 ms" is not. */
  format:  (v: number) => string;
  /**
   * What each end of the track means, in outcomes rather than in magnitudes — "Split Notes"
   * / "Merge Notes" rather than "low" / "high".
   *
   * Optional, but the pair earns its keep wherever `help` states what the number *is*
   * without stating which way to drag it: a threshold whose name is honest ("Model
   * Confidence Threshold") says nothing about whether more confidence means more notes or
   * fewer. Both or neither — one lone caption reads as a label for the whole slider.
   */
  minLabel?: string;
  maxLabel?: string;
}

export interface BooleanParam extends ParamBase {
  kind:    'boolean';
  default: boolean;
}

/**
 * A pitch band, chosen as the harmonica it belongs to.
 *
 * The engine holds the frequencies; this holds the key, and `null` for "don't bound at all".
 * Keeping the key rather than the two frequencies is what lets the control be the same grid
 * the rest of the app picks a harp with, and what makes the value legible when it is read
 * back out of storage a month later — "G" survives a layout change, "196.0 Hz" doesn't.
 */
export interface PitchRangeParam extends ParamBase {
  kind:    'pitchRange';
  default: HarmonicaKey | null;
  /** The switch's label when nothing is bounded. */
  offLabel: string;
}

export type TranscriptionParam = NumberParam | BooleanParam | PitchRangeParam;

/** The engine's own defaults, as a plain bag the tune screen can reset to. */
export function defaultParams(algorithm: TranscriptionAlgorithm): ParamValues {
  const values: ParamValues = {};
  for (const param of algorithm.params) values[param.id] = param.default;
  return values;
}

/**
 * A user's saved values, made safe to use.
 *
 * Anything the schema no longer declares is dropped and anything newly declared falls back
 * to its default, so a schema change can't strand someone on a value that has no control —
 * these are persisted per engine and outlive any single build.
 */
export function withDefaults(algorithm: TranscriptionAlgorithm, saved?: ParamValues): ParamValues {
  const values = defaultParams(algorithm);
  if (!saved) return values;
  for (const param of algorithm.params) {
    const value = saved[param.id];
    if (param.kind === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      values[param.id] = Math.max(param.min, Math.min(param.max, value));
    } else if (param.kind === 'boolean' && typeof value === 'boolean') {
      values[param.id] = value;
    } else if (param.kind === 'pitchRange') {
      // `null` is a real saved value here, not an absent one, so it can't ride the same
      // `if (!saved)` path a missing key takes — an explicit "no bound" has to survive a
      // reload. Anything that isn't null and isn't one of the twelve keys (a key renamed
      // between builds, a hand-edited store) falls through to the default rather than
      // reaching `getPlayablePositions`, which would have no layout for it.
      if (value === null || (typeof value === 'string' && (HARMONICA_KEYS as readonly string[]).includes(value))) {
        values[param.id] = value as HarmonicaKey | null;
      }
    }
  }
  return values;
}

/**
 * The expensive pass's result, held so the cheap half can be re-run against it.
 *
 * Opaque on purpose: the tune screen drives both engines through this without knowing which
 * it has. `dispose()` is not optional politeness — Basic Pitch's three matrices come to
 * ~90MB on a five-minute take, which dwarfs the retained PCM in either format and is the
 * single biggest memory lever in the flow.
 */
export interface Prepared {
  algorithm:  TranscriptionAlgorithmId;
  durationMs: number;
  /** Engine-private. Nothing outside the engine that made it may read this. */
  data:       unknown;
  dispose(): void;
}

export interface PrepareOptions extends TranscribeOptions {
  /**
   * Only the frame lane uses these, and it genuinely needs them: NoteDetector segments on
   * *tab identity*, so a frame stream cannot become notes without a harmonica to read it
   * against. That asymmetry is deliberate and is what makes scoring all 12 candidate keys
   * cheap in the first place. The note lane ignores both.
   */
  harmonicaType?: HarmonicaType;
  harmonicaKey?:  HarmonicaKey;
}

export interface Segmentation {
  output: TranscriptionOutput;
  /**
   * Frame-lane only: how these parameters configure the segmenter that turns the stream
   * into notes.
   *
   * The frame lane's notes genuinely do not exist yet at this point — segmenting is
   * key-dependent, and the key isn't settled until detection has run over these very frames
   * — so the parameters travel as configuration rather than as a result, and the one place
   * that knows the key applies them. Null for the note lane, which has already committed
   * its notes and has no segmenter to configure.
   */
  detectorConfig: Partial<NoteDetectorConfig> | null;
}

export interface TranscriptionAlgorithm {
  id:          TranscriptionAlgorithmId;
  /** Shown in the picker. Deliberately not the internal name — "pMPM" means nothing to a
   *  harmonica player. */
  label:       string;
  description: string;
  /** False when the platform can't run it at all, which is how the picker knows to hide it
   *  rather than offering a choice that throws. */
  available:   boolean;
  /** Whether this algorithm retains the `RawFrame[]` Frame Inspector draws. */
  producesFrames: boolean;
  /** Whether it can hear more than one note at a time. */
  polyphonic:  boolean;
  /** What the tune screen renders. Order is display order. */
  params:      readonly TranscriptionParam[];
  /** The expensive half. Reports progress and honours cancellation; run once per take. */
  prepare(audio: DecodedAudio, options?: PrepareOptions): Promise<Prepared>;
  /**
   * The cheap half. Pure with respect to `prepared`, which is what lets it be called on
   * every slider tick — an implementation that consumed or mutated its input would degrade
   * silently over a tuning session rather than failing outright.
   *
   * Returns an empty result rather than throwing when nothing survives. Empty is an ordinary
   * intermediate state while dragging a threshold, not a failure.
   */
  resegment(prepared: Prepared, params: ParamValues): Promise<Segmentation>;
}

import { basicPitchAlgorithm } from './basicPitch';
import { hsaAlgorithm } from './hsa';
import { pmpmAlgorithm } from './pmpm';

/** Registration order is display order in the picker. */
export const TRANSCRIPTION_ALGORITHMS: readonly TranscriptionAlgorithm[] = [
  basicPitchAlgorithm,
  hsaAlgorithm,
  pmpmAlgorithm,
];

export const DEFAULT_ALGORITHM_ID: TranscriptionAlgorithmId = 'basicPitch';

/**
 * The engines a user is currently offered a choice between.
 *
 * A **product** gate, not a capability one. Every engine in the registry still runs, and
 * `availableAlgorithms` still answers the different question of what this platform can
 * execute — this says only what is worth putting in front of someone.
 *
 * Basic Pitch is alone here because it is the only engine whose output has been measured
 * against real playing. HSA v2's re-attack segmentation is unresolved (see
 * `docs/plan/phase-16-hsa-engine.md`: separating a tongued repeat from a deep throat vibrato
 * by amplitude alone may not be possible, and it needs recorded material that does not exist
 * yet), and pMPM's offline pass is strictly worse than the live pass the recording screen
 * already offers directly. Shipping a picker whose extra rows are worse answers costs the
 * user a decision and buys nothing.
 *
 * Widening this is adding an id to the array; nothing else is gated on it.
 */
export const SELECTABLE_ALGORITHM_IDS: readonly TranscriptionAlgorithmId[] = ['basicPitch'];

/** The engine every offline transcription runs while the list above holds one id. */
export const TRANSCRIBE_ALGORITHM_ID: TranscriptionAlgorithmId = 'basicPitch';

/** Falls back to pMPM rather than throwing: the id can come from persisted settings written
 *  on another platform (or an older build), and an unavailable engine must not strand a
 *  user on a screen with no way to transcribe anything. */
export function getAlgorithm(id: TranscriptionAlgorithmId): TranscriptionAlgorithm {
  const found = TRANSCRIPTION_ALGORITHMS.find((a) => a.id === id);
  return found?.available ? found : pmpmAlgorithm;
}

export function availableAlgorithms(): TranscriptionAlgorithm[] {
  return TRANSCRIPTION_ALGORITHMS.filter((a) => a.available);
}

/** What a picker should list. Empty or single-entry means there is no choice to present, and
 *  the screens above check exactly that rather than assuming a count. */
export function selectableAlgorithms(): TranscriptionAlgorithm[] {
  return availableAlgorithms().filter((a) => SELECTABLE_ALGORITHM_IDS.includes(a.id));
}
