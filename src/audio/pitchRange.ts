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
