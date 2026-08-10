/**
 * The transcription pipeline: decoded audio in, ranked harmonica keys and committed notes
 * out. Kept out of the import screen so it can be driven headlessly — the verification
 * harness in scripts/ runs exactly these steps — and so the screen only deals with progress,
 * cancellation and errors.
 *
 * Deliberately free of `decodeAudio`, which is platform-split and drags React Native in with
 * it. That import is what `runAudioImport.ts` exists for, and keeping it one module away is
 * what lets a plain `tsx` script exercise everything below.
 *
 * Note what this deliberately does *not* do: commit to a key. Turning pitches into tabs is
 * cheap and key-dependent, so it happens after the user has confirmed (or overridden) the
 * ranking, and can be re-run for a different key without touching the audio again.
 *
 * Which engine ran decides the shape of what comes back, and the two need different
 * treatment (see `algorithms/index.ts`): a frame stream still has to be segmented per
 * candidate key, while note events are already pitched and rank exactly like MIDI import's
 * do. Both converge on one `KeyCandidate[]` and one `MidiNote[]`, so only this file knows
 * there are two lanes.
 *
 * Two entry points, at the expensive/cheap seam:
 *
 *  - `runTranscription` — both halves, back to back. What a straight import uses.
 *  - `prepareTranscription` + `resegmentTranscription` — the same work split, so the tune
 *    screen can re-run the cheap half on every slider change without paying for the
 *    expensive one again. `runTranscription` is this pair run together.
 */

import {
  getAlgorithm, type ParamValues, type PrepareOptions, type Prepared, type Segmentation,
  type TranscriptionAlgorithmId, type TranscriptionOutput,
} from './algorithms';
import { AudioImportError, type DecodedAudio } from './audioImport';
import { framesToNotes } from './framesToNotes';
import { noteNameToMidi } from './HarmonicaMapper';
import { detectHarmonicaKey, shiftFrames, type KeyDetectionResult } from './keyDetection';
import type { MidiNote } from './midiToNotes';
import type { NoteDetectorConfig } from './NoteDetector';
import { rankKeysForMidi, shiftMidiNotes } from './notesToTabs';
import { isPlayableOnAnyHarmonica, octaveShiftForMidiRange } from './pitchRange';
import type { HarmonicaKey, HarmonicaType } from '@/types';

export type { TranscriptionStage as ImportStage } from './algorithms';

export interface AudioAnalysisResult {
  /**
   * Octave-shifted already, when the recording sat outside the harmonica's range — so this
   * matches the notes and tabs derived from it.
   */
  output:     TranscriptionOutput;
  /**
   * What this transcription actually produced, both lanes, already shifted and filtered.
   *
   * Computed here rather than left to each caller because the frame lane's version is not
   * derivable from `output` alone: segmenting frames needs a key *and* the segmenter
   * settings the parameters chose, and this is the only place that holds both.
   */
  notes:      MidiNote[];
  durationMs: number;
  /**
   * Null for chromatic harmonicas: a 12-hole chromatic covers every semitone in its range,
   * so all 12 keys score nearly identically and the result would carry no information.
   * Ranking is a diatonic feature.
   */
  detection:  KeyDetectionResult | null;
  /**
   * Per-key counts of notes that land nowhere on that harp. Only the note lane can report
   * this — the frame lane never creates a note for an unmappable pitch in the first place,
   * so there is nothing to count. Null there rather than zeroes, which would read as
   * "everything fits".
   */
  unplayableByKey: Record<HarmonicaKey, number> | null;
}

export interface RunTranscriptionParams {
  audio:         DecodedAudio;
  harmonicaType: HarmonicaType;
  algorithm:     TranscriptionAlgorithmId;
  /** Omitted means the engine's own defaults. */
  params?:       ParamValues;
  /**
   * The frame lane's provisional harmonica, used only when ranking is skipped (chromatic).
   * A frame stream cannot become notes without one — see `PrepareOptions`.
   */
  segmentationKey?: HarmonicaKey;
  /** Named in the "nothing was found" messages, so they say which take they mean. */
  sourceName?:   string;
  onProgress?:   (progress: { stage: string; fraction: number }) => void;
  shouldCancel?: () => boolean;
}

/** True when nothing usable came out of the engine — said here so both lanes report an
 *  empty result the same way, rather than each failing further downstream. */
function isEmpty(output: TranscriptionOutput): boolean {
  return output.kind === 'frames'
    ? !output.frames.some((f) => Number.isFinite(f.frequency) && f.frequency > 0)
    : output.notes.length === 0;
}

/** The frame lane's committed notes, as the note lane's currency. A pitch that doesn't
 *  parse is dropped rather than written as middle C, the same rule MIDI export applies —
 *  silently altering the music is the worse failure. */
function framesToMidiNotes(
  frames: Parameters<typeof framesToNotes>[0],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  config?: Partial<NoteDetectorConfig>,
): MidiNote[] {
  return framesToNotes(frames, key, harmonicaType, config).flatMap((n) => {
    const midi = noteNameToMidi(n.note);
    return midi === null ? [] : [{
      midi,
      timeMs:     n.start_time,
      durationMs: n.duration,
      velocity:   n.velocity,
    }];
  });
}

/** Start the expensive half. Held by the tune screen for as long as it is tuning, and
 *  released with `prepared.dispose()` the moment it isn't. */
export function prepareTranscription(
  audio: DecodedAudio,
  algorithm: TranscriptionAlgorithmId,
  options: PrepareOptions = {},
): Promise<Prepared> {
  return getAlgorithm(algorithm).prepare(audio, options);
}

export interface ResegmentParams {
  prepared:      Prepared;
  params:        ParamValues;
  harmonicaType: HarmonicaType;
  segmentationKey?: HarmonicaKey;
  sourceName?:   string;
  /**
   * Interactive tuning, where an empty result is an ordinary intermediate state — the user
   * is one slider-drag away from a good one, and an error screen would throw away the
   * parameters that got them there. The one-shot paths leave this off and get the throw,
   * which is right for an import that has nowhere else to go.
   */
  allowEmpty?:   boolean;
}

/**
 * Run the cheap half and everything downstream of it: fold the register, reject what no
 * harmonica can play, score the keys.
 *
 * Fast enough to sit under a debounced slider — no DSP and no inference, just the engine's
 * own segmentation plus a few hundred `noteToTab` calls per candidate key.
 */
export async function resegmentTranscription({
  prepared, params, harmonicaType, segmentationKey, sourceName, allowEmpty,
}: ResegmentParams): Promise<AudioAnalysisResult> {
  const engine       = getAlgorithm(prepared.algorithm);
  const segmentation = await engine.resegment(prepared, params);
  return finalize(segmentation, {
    durationMs: prepared.durationMs,
    harmonicaType,
    segmentationKey,
    sourceName,
    allowEmpty,
  });
}

interface FinalizeContext {
  durationMs:    number;
  harmonicaType: HarmonicaType;
  segmentationKey?: HarmonicaKey;
  sourceName?:   string;
  allowEmpty?:   boolean;
}

function finalize(segmentation: Segmentation, ctx: FinalizeContext): AudioAnalysisResult {
  const { output, detectorConfig } = segmentation;
  const { durationMs, harmonicaType, segmentationKey, sourceName, allowEmpty } = ctx;
  const named = sourceName ? `"${sourceName}"` : 'this recording';

  if (isEmpty(output)) {
    if (!allowEmpty) {
      throw new AudioImportError(
        'noAudio',
        `No playable notes were found in ${named}. It may be silent, or too quiet to transcribe.`,
      );
    }
    return {
      output,
      notes: [],
      durationMs,
      detection: null,
      unplayableByKey: null,
    };
  }

  if (output.kind === 'frames') {
    // ── Frame lane ────────────────────────────────────────────────────────────
    //
    // The order here is load-bearing: fold the register *first*, then segment the shifted
    // stream. A pitch with no position on the harp never becomes a note at all in this lane,
    // so segmenting before the fold would silently delete exactly the out-of-register takes
    // the fold exists to rescue.
    if (harmonicaType === 'chromatic') {
      // No ranking to do — a 12-hole chromatic covers every semitone — so the key chosen on
      // Home stands, and there is no shift to apply either.
      const key = segmentationKey ?? 'C';
      return {
        output,
        notes: framesToMidiNotes(output.frames, key, harmonicaType, detectorConfig ?? undefined),
        durationMs,
        detection: null,
        unplayableByKey: null,
      };
    }

    const detection = detectHarmonicaKey(output.frames, harmonicaType, detectorConfig ?? undefined);
    const frames    = shiftFrames(output.frames, detection.octaveShiftSemitones);
    return {
      output: { kind: 'frames', frames },
      notes:  framesToMidiNotes(frames, detection.best.key, harmonicaType, detectorConfig ?? undefined),
      durationMs,
      detection,
      unplayableByKey: null,
    };
  }

  // ── Note lane ───────────────────────────────────────────────────────────────
  //
  // Measured against a reference Python run of the same model on the same recording, the
  // post-processing here used to throw away 60% of what the model found — 165 in, 66 out.
  // Two of those steps were removed; nothing should be added back without numbers from the
  // verification harness showing what it costs.
  //
  //  - Monophonic reduction is gone. The model hears double-stops, harmonica players play
  //    them, and collapsing them lost 45 notes on that recording. PianoRoll is a pitch×time
  //    grid and draws simultaneities already; the list and text exports render them
  //    sequentially until they learn to group, which is a display limitation and not a
  //    reason to destroy the transcription.
  //  - The 110ms minimum-note filter is gone. The engine already applies the minimum note
  //    length it was configured with (58ms by default); re-filtering at nearly twice that
  //    afterwards silently overrode the setting and cost another 25 notes. That setting is
  //    now a slider on the tune screen, which makes a second hidden one worse still.
  // What removes noise instead is the editor's noise gate: applied last, non-destructive,
  // and tunable while looking at the result.
  //
  // The octave fold stays, because it moves notes rather than discarding them.
  const shift = octaveShiftForMidiRange(output.notes.map((n) => n.midi));
  //
  // Reject pitches no harmonica can play — after the octave fold, never before. The fold
  // exists to rescue material recorded outside the harp's register, so filtering first
  // would delete exactly the recordings it's there to save.
  //
  // By pitch, not by frequency: the engine applies a frequency band by zeroing posteriogram
  // bins before onset inference and the melodia trick have run, which measurably costs real
  // notes (see basicPitch.web.ts). Testing committed notes is exact and can't disturb
  // segmentation, because segmentation is already over.
  //
  // "Playable on *some* harmonica" is the deliberately wide test — 12 keys, both types,
  // unioned. Whether a pitch fits the harp the user finally picks is a narrower question
  // that `rankKeysForMidi` already answers per key without discarding anything.
  const notes = shiftMidiNotes(output.notes, shift)
    .filter((n) => isPlayableOnAnyHarmonica(n.midi));

  if (notes.length === 0) {
    if (!allowEmpty) {
      throw new AudioImportError(
        'noAudio',
        `Nothing in ${named} is long enough to play as a note. It may not be a solo melodic line.`,
      );
    }
    return { output: { kind: 'notes', notes }, notes, durationMs, detection: null, unplayableByKey: null };
  }

  const shifted: TranscriptionOutput = { kind: 'notes', notes };

  if (harmonicaType === 'chromatic') {
    return { output: shifted, notes, durationMs, detection: null, unplayableByKey: null };
  }

  const ranking = rankKeysForMidi(notes, harmonicaType, shift);
  return {
    output: shifted,
    notes,
    durationMs,
    // Rebuilt into the shape the confirm screen already reads. `margin` is what tells the
    // user how much to trust the winner, and means the same thing either lane it came from.
    detection: {
      best:   ranking.ranked[0],
      ranked: ranking.ranked,
      margin: ranking.ranked.length > 1
        ? ranking.ranked[0].score - ranking.ranked[1].score
        : ranking.ranked[0].score,
      octaveShiftSemitones: shift,
    },
    unplayableByKey: ranking.unplayableByKey,
  };
}

/**
 * One shot: the expensive half and the cheap half back to back.
 *
 * The entry point for anything that isn't tuning — a straight import, a "use the defaults"
 * press, the verification harness. `prepared` is released here rather than handed back,
 * because a caller that didn't ask to keep it can't be expected to know it should free it.
 */
export async function runTranscription({
  audio, harmonicaType, algorithm, params, segmentationKey, sourceName, onProgress, shouldCancel,
}: RunTranscriptionParams): Promise<AudioAnalysisResult> {
  const engine   = getAlgorithm(algorithm);
  const prepared = await engine.prepare(audio, {
    onProgress, shouldCancel, harmonicaType, harmonicaKey: segmentationKey,
  });

  try {
    if (shouldCancel?.()) throw new AudioImportError('cancelled', 'Transcription cancelled.');
    return await resegmentTranscription({
      prepared,
      params: params ?? defaultsFor(algorithm),
      harmonicaType,
      segmentationKey,
      sourceName,
    });
  } finally {
    prepared.dispose();
  }
}

function defaultsFor(algorithm: TranscriptionAlgorithmId): ParamValues {
  const engine: ParamValues = {};
  for (const param of getAlgorithm(algorithm).params) engine[param.id] = param.default;
  return engine;
}

