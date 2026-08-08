/**
 * Recorded loudness → note velocity, for the classic pitch tracker.
 *
 * The caveat that makes this non-trivial: microphone RMS is **not** how hard the note was
 * played. It conflates that with how close the mic was, what the input gain was set to,
 * and how reflective the room is. Used raw, the lane would display "how near was the
 * microphone", and a user would reasonably read that as the app getting it wrong.
 *
 * So the mapping is *relative to the take*: the recording's own loud passages define the
 * top of the scale and its own quiet ones the bottom. That's the right frame musically as
 * well as technically — dynamics are relative anyway, and a player wants to know which
 * notes in this piece are the hard ones.
 *
 * Which is exactly why the result is stamped `velocitySource: 'takeRelativeRms'`. The
 * other two producers (a MIDI file's stated velocity, the neural engine's per-note
 * activation) land on the same 0–127 scale meaning something else entirely, and nothing
 * downstream can compare them without knowing which it holds.
 */

import type { RawFrame, TabNote } from '@/types';

/**
 * A note's velocity, tolerating the pre-rename `breathForce` field.
 *
 * The migration in `useRecordingsStore` rewrites the key on load, so this fallback should
 * never actually fire. It exists so that a rollback to the previous build — or a payload
 * written by one running alongside this one — degrades to correct behaviour instead of
 * silently flattening every saved tab's dynamics, disabling its filter and exporting flat
 * MIDI. Safe to delete one release after the migration has shipped.
 */
export function noteVelocity(note: Pick<TabNote, 'velocity'>): number | undefined {
  return note.velocity ?? (note as { breathForce?: number }).breathForce;
}

/**
 * Does a note clear a velocity floor?
 *
 * The `?? 127` is the back-compat guarantee that keeps the filter from being a data-loss
 * bug: every recording saved before velocity existed, every MIDI import that didn't state
 * one, and every note drawn by hand has `velocity === undefined`. Treating those as silent
 * would empty the editor the moment the line left the bottom.
 *
 * Lives here, not in `useAudibleNotes`, because three non-React callers need exactly this
 * rule — the Studio's playback merge, its MIDI export, and track conversion. A second
 * inlined copy of `>= floor` is how the roll and the exporter drift apart.
 */
export function passesVelocityFloor(velocity: number | undefined, floor: number): boolean {
  return (velocity ?? 127) >= floor;
}

/** Below this share of the take's dynamic range there's nothing to normalise against —
 *  a recording at one constant level would otherwise have its noise floor stretched into
 *  a full range of fake dynamics. */
const MIN_USEFUL_RANGE = 1e-4;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
}

export interface VelocityScale {
  quietRms: number;
  loudRms:  number;
  /** False when the take has too little dynamic variation to normalise against. */
  usable:   boolean;
}

/**
 * Establish the take's own dynamic range.
 *
 * Percentiles rather than min/max, so one clipped peak or one frame of silence can't
 * define the whole scale — the same reason the key detector uses a median.
 */
export function velocityScaleFor(frames: readonly RawFrame[]): VelocityScale {
  const voiced = frames
    .map((f) => f.rms)
    .filter((rms) => Number.isFinite(rms) && rms > 0)
    .sort((a, b) => a - b);

  if (voiced.length === 0) return { quietRms: 0, loudRms: 0, usable: false };

  const quietRms = percentile(voiced, 0.10);
  const loudRms  = percentile(voiced, 0.95);
  return { quietRms, loudRms, usable: loudRms - quietRms >= MIN_USEFUL_RANGE };
}

/** Mean loudness over a note's own span → 0–127, against the take's scale. */
export function velocityForSpan(
  frames: readonly RawFrame[],
  startMs: number,
  durationMs: number,
  scale: VelocityScale,
): number | undefined {
  if (!scale.usable) return undefined;

  let sum = 0;
  let count = 0;
  const endMs = startMs + durationMs;
  for (const frame of frames) {
    if (frame.t < startMs) continue;
    if (frame.t > endMs) break; // frames are in time order
    if (!Number.isFinite(frame.rms)) continue;
    sum += frame.rms;
    count++;
  }
  if (count === 0) return undefined;

  const mean = sum / count;
  const normalized = (mean - scale.quietRms) / (scale.loudRms - scale.quietRms);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 127);
}

/**
 * Annotate detected notes with velocity. Returns the same array when the take has no
 * usable dynamics, so a flat recording is left unannotated rather than given invented ones.
 */
export function withVelocity<T extends Omit<TabNote, 'id'>>(
  notes: T[],
  frames: readonly RawFrame[],
): T[] {
  const scale = velocityScaleFor(frames);
  if (!scale.usable) return notes;

  return notes.map((note) => {
    const velocity = velocityForSpan(frames, note.start_time, note.duration, scale);
    return velocity === undefined
      ? note
      : { ...note, velocity, velocitySource: 'takeRelativeRms' as const };
  });
}
