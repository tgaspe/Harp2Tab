/**
 * Whole-octave register fitting, shared by both import paths.
 *
 * Uploaded material — a guitar line, a low whistle, a bass part in a MIDI arrangement —
 * can sit an octave or two outside the harmonica's range, where *every* key maps nothing
 * and playability scoring is meaningless. Moving the whole piece by whole octaves fixes
 * the register without transposing it into a different key.
 *
 * Kept apart from `keyDetection` because MIDI arrives as pitch numbers, not frequencies:
 * the logic is the same, only the input representation differs.
 */

import { getPlayablePositions } from './HarmonicaMapper';
import { HARMONICA_KEYS } from '@/constants/keys';
import type { HarmonicaKey } from '@/types';

/** Median MIDI pitch of the layouts the mapper covers (~C4–C7). Material centred far from
 *  here is in the wrong octave for every key, not badly keyed. */
export const LAYOUT_MEDIAN_MIDI = 78;

/** Don't shift unless the material is at least this far off — a few semitones of
 *  difference is just a melody sitting high or low in the harp's range. */
const SHIFT_THRESHOLD_SEMITONES = 8;

/**
 * How far a set of pitches has to move to sit inside the harmonica's range.
 * Returns 0, ±12 or ±24 semitones — only whole octaves, since anything else would
 * transpose the music into a different key.
 */
export function octaveShiftForMidiRange(midis: number[]): number {
  const sorted = midis.filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;

  const median = sorted[Math.floor(sorted.length / 2)];
  const offset = LAYOUT_MEDIAN_MIDI - median;
  if (Math.abs(offset) < SHIFT_THRESHOLD_SEMITONES) return 0;

  const octaves = Math.max(-2, Math.min(2, Math.round(offset / 12)));
  return octaves * 12;
}

export function midiOfFrequency(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

/** The inverse. Fractional input is meaningful and used: a bound placed half a semitone
 *  off a note sits unambiguously inside that note's bin rather than on its edge. */
export function frequencyOfMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * The MIDI span of a harmonica in `key`, across both instrument types.
 *
 * Both layouts happen to cover exactly 60-97 in C-space today, so the union is a no-op and
 * the answer depends only on the key — which is why nothing that calls this has to ask which
 * instrument the user holds. It is written as a union anyway, for the same reason
 * `PLAYABLE_MIDI` is: widening a layout should widen every consumer with it, not leave one
 * call site quietly reporting the narrower of two ranges.
 */
export function harmonicaMidiRange(key: HarmonicaKey): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const type of ['diatonic', 'chromatic'] as const) {
    for (const position of getPlayablePositions(key, type)) {
      if (position.midi < min) min = position.midi;
      if (position.midi > max) max = position.midi;
    }
  }
  return { min, max };
}

/**
 * Every MIDI pitch that lands on a real hole, bend or overblow of *some* harmonica this app
 * supports — all 12 keys, both types, unioned.
 *
 * Built from the layout tables rather than stated as a range, so it stays right if a layout
 * changes. It's the widest possible "could this ever be a tab" test: a pitch outside it can
 * only be noise or an instrument that isn't the harmonica, whereas a pitch inside it may
 * still be unplayable on the *particular* harp the user picks — which is a different
 * question, and one `rankKeysForMidi` already answers per key without discarding anything.
 */
const PLAYABLE_MIDI: ReadonlySet<number> = (() => {
  const set = new Set<number>();
  for (const key of HARMONICA_KEYS) {
    for (const type of ['diatonic', 'chromatic'] as const) {
      for (const position of getPlayablePositions(key, type)) set.add(position.midi);
    }
  }
  return set;
})();

/** True when `midi` sits on a real position of at least one supported harmonica. */
export function isPlayableOnAnyHarmonica(midi: number): boolean {
  return PLAYABLE_MIDI.has(Math.round(midi));
}

/**
 * The outer bounds of the set above.
 *
 * Derived here, from the same layout tables, so that widening a layout widens every consumer
 * of this range with it rather than silently leaving notes unreachable.
 *
 * **Nothing reads it as of Phase 16.** The spectral engine was its only consumer — it searched
 * only inside these bounds, which is what made a subharmonic ghost below the harmonica
 * structurally impossible there rather than merely unlikely. HSA v2 has no such bar; the note
 * lane rejects out-of-range pitches after the fact via `isPlayableOnAnyHarmonica` instead.
 * Kept because any engine that wants to bound its search wants exactly this, and deriving it
 * again elsewhere is how the two definitions drift apart.
 */
export const PLAYABLE_MIDI_RANGE: { min: number; max: number } = (() => {
  let min = Infinity;
  let max = -Infinity;
  for (const midi of PLAYABLE_MIDI) {
    if (midi < min) min = midi;
    if (midi > max) max = midi;
  }
  return { min, max };
})();
