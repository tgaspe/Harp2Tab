/**
 * Recorded loudness → breath force.
 *
 * The caveat that makes this non-trivial: microphone RMS is **not** breath force. It
 * conflates how hard the player blew with how close the mic was, what the input gain was
 * set to, and how reflective the room is. Used raw, the lane would display "how near was
 * the microphone", and a user would reasonably read that as the app getting it wrong.
 *
 * So the mapping is *relative to the take*: the recording's own loud passages define the
 * top of the scale and its own quiet ones the bottom. That's the right frame musically as
 * well as technically — dynamics are relative anyway, and a player wants to know which
 * notes in this piece are the hard ones.
 */

import type { RawFrame, TabNote } from '@/types';

/** MIDI velocity for a note whose loudness can't be established. Matches the default the
 *  scheduler already assumes for an unstated velocity, so nothing changes audibly. */
export const DEFAULT_BREATH_FORCE = 80;

/** Below this share of the take's dynamic range there's nothing to normalise against —
 *  a recording at one constant level would otherwise have its noise floor stretched into
 *  a full range of fake dynamics. */
const MIN_USEFUL_RANGE = 1e-4;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];
}

export interface BreathScale {
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
export function breathScaleFor(frames: readonly RawFrame[]): BreathScale {
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
export function breathForceForSpan(
  frames: readonly RawFrame[],
  startMs: number,
  durationMs: number,
  scale: BreathScale,
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
 * Annotate detected notes with breath force. Returns the same array when the take has no
 * usable dynamics, so a flat recording is left unannotated rather than given invented ones.
 */
export function withBreathForce<T extends Omit<TabNote, 'id'>>(
  notes: T[],
  frames: readonly RawFrame[],
): T[] {
  const scale = breathScaleFor(frames);
  if (!scale.usable) return notes;

  return notes.map((note) => {
    const force = breathForceForSpan(frames, note.start_time, note.duration, scale);
    return force === undefined ? note : { ...note, breathForce: force };
  });
}
