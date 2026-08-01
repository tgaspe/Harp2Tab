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
import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey, HarmonicaType, RawFrame, TabNote } from '@/types';

/** Weights for the awkward positions. An overblow is penalized harder than a bend because
 *  it's the harder technique, and a tab full of them usually means the wrong harp. */
const BEND_PENALTY     = 0.35;
const OVERBLOW_PENALTY = 0.6;

/** Semitone offsets of each key from C, for position arithmetic. */
const KEY_SEMITONES: Record<HarmonicaKey, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5,
  'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
};

/** Median MIDI pitch of the layouts the mapper covers (~C4–C7). A recording centred far
 *  from here is in the wrong octave for every key, not badly keyed. */
const LAYOUT_MEDIAN_MIDI = 78;
/** Don't shift unless the recording is at least this far off — a few semitones of
 *  difference is just a melody sitting high or low in the harp's range. */
const SHIFT_THRESHOLD_SEMITONES = 8;

export interface KeyCandidate {
  key:   HarmonicaKey;
  /** 0..1 — mapped coverage, discounted by how much of it needs bends/overblows. */
  score: number;
  /** Share of voiced audio that landed on a real position at all. */
  mappedFraction:   number;
  /** Shares of the mapped notes needing a bend / an overblow. */
  bendFraction:     number;
  overblowFraction: number;
  /** Harmonica position relative to the winning key (1 = straight harp, 2 = cross harp).
   *  Derived from the winner, on the assumption that the best-fitting harp is 1st position. */
  position: number;
}

export interface KeyDetectionResult {
  best:     KeyCandidate;
  /** All 12 keys, best first. */
  ranked:   KeyCandidate[];
  /** Gap between the winner and runner-up, 0..1 — how much to trust `best`. */
  margin:   number;
  /** Whole-recording octave shift applied before scoring, in semitones (0 if none). */
  octaveShiftSemitones: number;
}

/** A bend is written with apostrophes, an overblow/overdraw with a trailing "o" — the tab
 *  vocabulary already encodes technique, so no lookup table is needed. */
function isBend(tab: string): boolean     { return tab.includes("'"); }
function isOverblow(tab: string): boolean { return tab.endsWith('o'); }

function midiOf(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/**
 * How far the whole recording has to move to sit inside the harmonica's range. Uploaded
 * audio can be an octave or two below the harp (a guitar line, a low whistle), where
 * `frequencyToTab` returns null for *every* key and scoring would be meaningless.
 * Returns 0, ±12 or ±24 semitones.
 */
export function octaveShiftForRange(frames: RawFrame[]): number {
  const midis = frames
    .filter((f) => Number.isFinite(f.frequency) && f.frequency > 0)
    .map((f) => midiOf(f.frequency))
    .sort((a, b) => a - b);

  if (midis.length === 0) return 0;

  const median = midis[Math.floor(midis.length / 2)];
  const offset = LAYOUT_MEDIAN_MIDI - median;
  if (Math.abs(offset) < SHIFT_THRESHOLD_SEMITONES) return 0;

  // Only whole octaves — anything else would transpose the music into a different key.
  const octaves = Math.max(-2, Math.min(2, Math.round(offset / 12)));
  return octaves * 12;
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
): Omit<KeyCandidate, 'position'> {
  const notes = framesToNotes(frames, key, harmonicaType);

  let total = 0;
  let bend = 0;
  let overblow = 0;
  for (const note of notes as Omit<TabNote, 'id'>[]) {
    total += note.duration;
    if (isBend(note.tab))     bend     += note.duration;
    if (isOverblow(note.tab)) overblow += note.duration;
  }

  // Detected note durations can slightly exceed the voiced frame total (a note's run spans
  // the frames on either side of its onset), so coverage is clamped rather than allowed
  // above 1 where it would reward the wrong key.
  const mappedFraction   = voicedMs > 0 ? Math.min(1, total / voicedMs) : 0;
  const bendFraction     = total > 0 ? bend / total : 0;
  const overblowFraction = total > 0 ? overblow / total : 0;

  // Multiplicative rather than subtractive: the penalties scale what was actually covered,
  // so a key that maps very little can't out-score a key that maps everything cleanly.
  const score = mappedFraction * Math.max(
    0,
    1 - BEND_PENALTY * bendFraction - OVERBLOW_PENALTY * overblowFraction,
  );

  return { key, score, mappedFraction, bendFraction, overblowFraction };
}

/**
 * Harmonica position of `key` when the tune sits in `tonic` — 1st position (straight harp)
 * is the same key, 2nd (cross harp) is the harp a fourth below the tune, and each further
 * position is another fifth around the circle.
 */
export function positionOf(key: HarmonicaKey, tonic: HarmonicaKey): number {
  const distance = (KEY_SEMITONES[tonic] - KEY_SEMITONES[key] + 12) % 12;
  // distance = 7 × (position − 1) mod 12; 7 and 12 are coprime, so stepping fifths finds it.
  for (let position = 1; position <= 12; position++) {
    if ((7 * (position - 1)) % 12 === distance) return position;
  }
  return 1;
}

export function detectHarmonicaKey(
  rawFrames: RawFrame[],
  harmonicaType: HarmonicaType,
): KeyDetectionResult {
  const octaveShiftSemitones = octaveShiftForRange(rawFrames);
  const frames  = shiftFrames(rawFrames, octaveShiftSemitones);
  const voiced  = voicedDurationMs(frames);

  const scored = HARMONICA_KEYS.map((key) => scoreKey(frames, key, harmonicaType, voiced));
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
