/**
 * Automatic harmonica key detection for uploaded audio.
 *
 * Runs entirely on the `RawFrame[]` an analysis pass already produced, so it costs no
 * extra pitch detection: scoring a candidate key is just re-running the cheap
 * frames → notes step (framesToNotes.ts) and looking at what came out.
 *
 * The objective is **playability**, not musicology — the key whose layout covers the
 * recording with the fewest bends, overblows and unreachable notes wins. For a plain major
 * melody that's the 1st-position harp. Players who prefer cross harp aren't stranded: the
 * ranked alternates are labelled with their harmonica position relative to the winner, so
 * picking the 2nd-position harp is one tap rather than a re-import.
 */

import { framesToNotes } from './framesToNotes';
import type { NoteDetectorConfig } from './NoteDetector';
import { positionOf, scoreTabbedNotes, type KeyCandidate } from './notesToTabs';
import { midiOfFrequency, octaveShiftForMidiRange } from './pitchRange';
import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey, HarmonicaType, RawFrame } from '@/types';

// Both live in notesToTabs.ts, which owns the shared playability scoring MIDI import uses
// too; re-exported here so consumers of key detection don't need to know that.
export { positionOf, type KeyCandidate };

export interface KeyDetectionResult {
  best:     KeyCandidate;
  /** All 12 keys, best first. */
  ranked:   KeyCandidate[];
  /** Gap between the winner and runner-up, 0..1 — how much to trust `best`. */
  margin:   number;
  /** Whole-recording octave shift applied before scoring, in semitones (0 if none). */
  octaveShiftSemitones: number;
}

/** Frame-stream wrapper over the shared fold in pitchRange.ts — frequencies in, whole
 *  octaves out. MIDI import calls `octaveShiftForMidiRange` directly. */
export function octaveShiftForRange(frames: RawFrame[]): number {
  return octaveShiftForMidiRange(
    frames
      .filter((f) => Number.isFinite(f.frequency) && f.frequency > 0)
      .map((f) => midiOfFrequency(f.frequency)),
  );
}

export function shiftFrames(frames: RawFrame[], semitones: number): RawFrame[] {
  if (semitones === 0) return frames;
  const ratio = Math.pow(2, semitones / 12);
  return frames.map((f) => ({ ...f, frequency: f.frequency * ratio }));
}

/** Total voiced time in the frame stream — the denominator coverage is measured against.
 *  Notes that never mapped to a position simply never became notes, so they can only be
 *  counted here, not in the detector's output. */
function voicedDurationMs(frames: RawFrame[]): number {
  if (frames.length < 2) return 0;
  const frameMs = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1);
  const voiced  = frames.filter((f) => Number.isFinite(f.frequency) && f.frequency > 0).length;
  return voiced * frameMs;
}

function scoreKey(
  frames: RawFrame[],
  key: HarmonicaKey,
  harmonicaType: HarmonicaType,
  voicedMs: number,
  config?: Partial<NoteDetectorConfig>,
): Omit<KeyCandidate, 'position'> {
  // A pitch with no position on this harp never becomes a note at all here (unlike MIDI
  // import, which keeps it as `tab: ''`), so the unmapped share only shows up as coverage
  // missing from the voiced total — which is exactly what `voicedMs` is the denominator for.
  const notes = framesToNotes(frames, key, harmonicaType, config);
  return { key, ...scoreTabbedNotes(notes, voicedMs) };
}

export function detectHarmonicaKey(
  rawFrames: RawFrame[],
  harmonicaType: HarmonicaType,
  /**
   * The segmenter settings the transcription is being tuned with. Ranking has to use the
   * same ones the committed notes will: scoring is "re-run the cheap step and look at what
   * came out", so scoring with defaults while committing with tuned values would recommend
   * a harp for a segmentation the user is not going to get.
   */
  config?: Partial<NoteDetectorConfig>,
): KeyDetectionResult {
  const octaveShiftSemitones = octaveShiftForRange(rawFrames);
  const frames  = shiftFrames(rawFrames, octaveShiftSemitones);
  const voiced  = voicedDurationMs(frames);

  const scored = HARMONICA_KEYS.map((key) => scoreKey(frames, key, harmonicaType, voiced, config));
  scored.sort((a, b) => b.score - a.score);

  // The best-fitting harp is taken as 1st position, which is what every other position is
  // then measured against.
  const tonic  = scored[0].key;
  const ranked = scored.map((c) => ({ ...c, position: positionOf(c.key, tonic) }));

  return {
    best:   ranked[0],
    ranked,
    margin: ranked.length > 1 ? ranked[0].score - ranked[1].score : ranked[0].score,
    octaveShiftSemitones,
  };
}
