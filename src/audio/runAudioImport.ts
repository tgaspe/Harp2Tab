/**
 * Orchestrates one audio-file import: decode → transcribe → rank the harmonica keys.
 * Kept out of the import screen so the pipeline can be driven headlessly — the
 * verification harness in scripts/ runs exactly these steps — and so the screen only deals
 * with progress, cancellation and errors.
 *
 * Note what this deliberately does *not* do: commit to a key. Turning pitches into tabs is
 * cheap and key-dependent, so it happens after the user has confirmed (or overridden) the
 * ranking, and can be re-run for a different key without touching the audio again.
 *
 * Which engine ran decides the shape of what comes back, and the two need different
 * treatment (see `algorithms/index.ts`): a frame stream still has to be segmented per
 * candidate key, while note events are already pitched and rank exactly like MIDI import's
 * do. Both converge on one `KeyCandidate[]`, so only this file knows there are two lanes.
 */

import { getAlgorithm, type TranscriptionAlgorithmId, type TranscriptionOutput } from './algorithms';
import { AudioImportError, type PickedAudioFile } from './audioImport';
import { decodeAudioFile } from './decodeAudio';
import { detectHarmonicaKey, shiftFrames, type KeyDetectionResult } from './keyDetection';
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

export interface RunAudioImportParams {
  picked:        PickedAudioFile;
  harmonicaType: HarmonicaType;
  algorithm:     TranscriptionAlgorithmId;
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

export async function runAudioImport({
  picked,
  harmonicaType,
  algorithm,
  onProgress,
  shouldCancel,
}: RunAudioImportParams): Promise<AudioAnalysisResult> {
  onProgress?.({ stage: 'decoding', fraction: 0 });
  const audio = await decodeAudioFile(picked);

  if (shouldCancel?.()) throw new AudioImportError('cancelled', 'Transcription cancelled.');

  const engine = getAlgorithm(algorithm);
  const output = await engine.transcribe(audio, { onProgress, shouldCancel });

  if (isEmpty(output)) {
    throw new AudioImportError(
      'noAudio',
      `No playable notes were found in "${picked.name}". It may be silent, or too quiet to transcribe.`,
    );
  }

  if (output.kind === 'frames') {
    if (harmonicaType === 'chromatic') {
      return { output, durationMs: audio.durationMs, detection: null, unplayableByKey: null };
    }
    const detection = detectHarmonicaKey(output.frames, harmonicaType);
    return {
      output:          { kind: 'frames', frames: shiftFrames(output.frames, detection.octaveShiftSemitones) },
      durationMs:      audio.durationMs,
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
  //    afterwards silently overrode the setting and cost another 25 notes.
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
    throw new AudioImportError(
      'noAudio',
      `Nothing in "${picked.name}" is long enough to play as a note. It may not be a solo melodic line.`,
    );
  }

  const shifted: TranscriptionOutput = { kind: 'notes', notes };

  if (harmonicaType === 'chromatic') {
    return { output: shifted, durationMs: audio.durationMs, detection: null, unplayableByKey: null };
  }

  const ranking = rankKeysForMidi(notes, harmonicaType, shift);
  return {
    output:     shifted,
    durationMs: audio.durationMs,
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
