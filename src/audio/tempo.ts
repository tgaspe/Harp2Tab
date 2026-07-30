// Assumes 4/4 time — Harp2Tab has no time-signature concept, and 4/4 is by far the
// most common case; revisit if/when that becomes a real, requested feature.
export const BEATS_PER_BAR = 4;

export function beatDurationMs(bpm: number): number {
  return 60000 / bpm;
}

export function barDurationMs(bpm: number): number {
  return beatDurationMs(bpm) * BEATS_PER_BAR;
}

/** 1-indexed bar position (bar 1 starts at ms 0), fractional — e.g. 3.5 is halfway through bar 3. */
export function msToBar(ms: number, bpm: number): number {
  return ms / barDurationMs(bpm) + 1;
}

export interface PlaybackOptions {
  bpm:              number;
  metronomeEnabled: boolean;
}

export type SnapDivision = 'off' | 4 | 8 | 16;

/** Grid unit in ms for a given snap division (e.g. 8 = an eighth note), or null if snap is off. */
export function snapDivisionMs(division: SnapDivision, bpm: number): number | null {
  if (division === 'off') return null;
  return (beatDurationMs(bpm) * 4) / division;
}

export function snapMsToGrid(ms: number, division: SnapDivision, bpm: number): number {
  const unit = snapDivisionMs(division, bpm);
  if (unit === null || unit <= 0) return ms;
  return Math.round(ms / unit) * unit;
}
