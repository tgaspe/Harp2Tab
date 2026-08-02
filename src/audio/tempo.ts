// The scalar functions here are the *constant-tempo* API: a tab session has exactly one
// BPM and one meter, so a beat is the same length everywhere in it and 4/4 is assumed.
//
// The tempo-map API further down is the piecewise generalisation the MIDI Studio needs.
// A real SMF carries a tempo map and a meter map, and keeping only the first entry of each
// (what `parseMidiFile` did before Phase 11) makes bar lines drift further out of
// alignment with the music with every bar — which then corrupts snapping, since snapping
// quantizes against those bar lines.
//
// Both APIs coexist deliberately: a constant-tempo caller shouldn't have to build a map to
// ask how long a beat is, and `constantTempoMap()` bridges the two when it does.
export const BEATS_PER_BAR = 4;

export const DEFAULT_BPM = 100;

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
  /** Playback speed multiplier — web-only (OscillatorNode scheduling), ignored by the
   *  native (pre-rendered WAV) backend. Defaults to 1 when omitted. */
  rate?:            number;
  /** Set by the MIDI Studio, where tempo and meter vary; absent for a tab session, whose
   *  single `bpm` above is the whole story. Only the metronome reads it — note scheduling
   *  works from absolute times and doesn't care how they were arrived at. */
  tempoMap?:        TempoMap;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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

// ── Tempo map ─────────────────────────────────────────────────────────────────

/** A tempo change. `timeMs` is measured from the start of the piece. */
export interface TempoEvent {
  timeMs: number;
  bpm:    number;
}

/** A meter change. `denominator` is a note value in MIDI's sense — 4 = quarter, 8 = eighth. */
export interface TimeSignatureEvent {
  timeMs:      number;
  numerator:   number;
  denominator: number;
}

/**
 * One constant-tempo span, precomputed so lookups are a binary search rather than a walk.
 *
 * `startBeat` is the running position on the quarter-note axis, and that axis is the point:
 * beats are tempo-independent, so expressing everything musical as ms → beats → bars is
 * what makes bar arithmetic survive a tempo change. Time stretches; the music doesn't.
 */
export interface TempoSegment {
  startMs:   number;
  startBeat: number;
  bpm:       number;
  msPerBeat: number;
}

/** One constant-meter span, positioned on the beat axis for the same reason. */
export interface MeterSegment {
  startBeat:   number;
  /** 0-indexed internally; `msToBarInMap` adds the 1 that users see. */
  startBar:    number;
  /** Bar length in quarter notes — 6/8 is six eighths, i.e. three quarters. */
  beatsPerBar: number;
  numerator:   number;
  denominator: number;
}

export interface TempoMap {
  tempos: TempoSegment[];
  meters: MeterSegment[];
}

/** Bar length in quarter notes. 4/4 → 4, 3/4 → 3, 6/8 → 3, 7/8 → 3.5. */
function beatsPerBarOf(sig: { numerator: number; denominator: number }): number {
  return (sig.numerator * 4) / sig.denominator;
}

/** Last entry whose key is <= `value`. Never returns -1: every caller relies on there
 *  being a segment covering position 0, which `compileTempoMap` guarantees. */
function segmentIndexAt<T>(segments: readonly T[], value: number, key: (s: T) => number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (key(segments[mid]) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Resolve raw events into the piecewise form everything else queries.
 *
 * Both lists are normalised to start at 0 — a file whose first tempo event sits at bar 5
 * still needs a defined tempo for bars 1–4, and every conversion below assumes segment 0
 * covers time 0. Events at an identical position collapse to the last one, matching how a
 * sequencer treats a redundant change and keeping the binary search unambiguous.
 */
export function compileTempoMap(
  tempos: readonly TempoEvent[] = [],
  timeSignatures: readonly TimeSignatureEvent[] = [],
): TempoMap {
  const sortedTempos = [...tempos]
    .filter((t) => Number.isFinite(t.timeMs) && t.bpm > 0)
    .sort((a, b) => a.timeMs - b.timeMs);
  if (sortedTempos.length === 0 || sortedTempos[0].timeMs > 0) {
    sortedTempos.unshift({ timeMs: 0, bpm: sortedTempos[0]?.bpm ?? DEFAULT_BPM });
  }

  const tempoSegments: TempoSegment[] = [];
  let beat = 0;
  let prevMs = 0;
  let prevMsPerBeat = beatDurationMs(sortedTempos[0].bpm);
  for (const t of sortedTempos) {
    beat += (t.timeMs - prevMs) / prevMsPerBeat;
    const msPerBeat = beatDurationMs(t.bpm);
    if (tempoSegments.length > 0 && t.timeMs === prevMs) tempoSegments.pop();
    tempoSegments.push({ startMs: t.timeMs, startBeat: beat, bpm: t.bpm, msPerBeat });
    prevMs = t.timeMs;
    prevMsPerBeat = msPerBeat;
  }

  const sortedSigs = [...timeSignatures]
    .filter((s) => Number.isFinite(s.timeMs) && s.numerator > 0 && s.denominator > 0)
    .sort((a, b) => a.timeMs - b.timeMs);
  if (sortedSigs.length === 0 || sortedSigs[0].timeMs > 0) {
    sortedSigs.unshift({ timeMs: 0, numerator: BEATS_PER_BAR, denominator: 4 });
  }

  // Meters are positioned by converting their ms to beats, which needs the tempo segments
  // already built — hence the two passes.
  const tempoOnly: TempoMap = { tempos: tempoSegments, meters: [] };
  const meterSegments: MeterSegment[] = [];
  let bar = 0;
  let prevBeat = 0;
  let prevBeatsPerBar = beatsPerBarOf(sortedSigs[0]);
  for (const s of sortedSigs) {
    const startBeat = msToBeat(tempoOnly, s.timeMs);
    bar += (startBeat - prevBeat) / prevBeatsPerBar;
    const beatsPerBar = beatsPerBarOf(s);
    if (meterSegments.length > 0 && startBeat === prevBeat) meterSegments.pop();
    meterSegments.push({
      startBeat,
      startBar:    bar,
      beatsPerBar,
      numerator:   s.numerator,
      denominator: s.denominator,
    });
    prevBeat = startBeat;
    prevBeatsPerBar = beatsPerBar;
  }

  return { tempos: tempoSegments, meters: meterSegments };
}

/** The degenerate one-tempo, one-meter map — the bridge from the scalar API above. */
export function constantTempoMap(bpm: number, beatsPerBar: number = BEATS_PER_BAR): TempoMap {
  return compileTempoMap(
    [{ timeMs: 0, bpm }],
    [{ timeMs: 0, numerator: beatsPerBar, denominator: 4 }],
  );
}

export function msToBeat(map: TempoMap, ms: number): number {
  const seg = map.tempos[segmentIndexAt(map.tempos, ms, (s) => s.startMs)];
  return seg.startBeat + (ms - seg.startMs) / seg.msPerBeat;
}

export function beatToMs(map: TempoMap, beat: number): number {
  const seg = map.tempos[segmentIndexAt(map.tempos, beat, (s) => s.startBeat)];
  return seg.startMs + (beat - seg.startBeat) * seg.msPerBeat;
}

/** Tempo in force at a point in time. */
export function bpmAt(map: TempoMap, ms: number): number {
  return map.tempos[segmentIndexAt(map.tempos, ms, (s) => s.startMs)].bpm;
}

/** Meter in force at a point on the beat axis. */
export function meterAtBeat(map: TempoMap, beat: number): MeterSegment {
  return map.meters[segmentIndexAt(map.meters, beat, (s) => s.startBeat)];
}

export function meterAt(map: TempoMap, ms: number): MeterSegment {
  return meterAtBeat(map, msToBeat(map, ms));
}

export function beatToBar(map: TempoMap, beat: number): number {
  const seg = meterAtBeat(map, beat);
  return seg.startBar + (beat - seg.startBeat) / seg.beatsPerBar;
}

export function barToBeat(map: TempoMap, bar: number): number {
  const seg = map.meters[segmentIndexAt(map.meters, bar, (s) => s.startBar)];
  return seg.startBeat + (bar - seg.startBar) * seg.beatsPerBar;
}

/** 1-indexed fractional bar, matching the scalar `msToBar`'s convention. */
export function msToBarInMap(map: TempoMap, ms: number): number {
  return beatToBar(map, msToBeat(map, ms)) + 1;
}

/** Inverse of `msToBarInMap` — takes the same 1-indexed bar number. */
export function barToMs(map: TempoMap, bar: number): number {
  return beatToMs(map, barToBeat(map, bar - 1));
}

/** Grid unit in quarter notes: 4 → 1 (quarter), 8 → 0.5 (eighth), 16 → 0.25 (16th). */
function unitBeatsOf(division: Exclude<SnapDivision, 'off'>): number {
  return 4 / division;
}

/**
 * Quantize a time to the grid.
 *
 * Snapping happens on the *beat* axis rather than in milliseconds, which is what makes it
 * correct across a tempo change: an eighth note is always half a beat, but its length in ms
 * differs on either side of the change. The scalar `snapMsToGrid` above is the same
 * operation in the case where that distinction can't arise.
 */
export function snapMsToGridInMap(map: TempoMap, ms: number, division: SnapDivision): number {
  if (division === 'off') return ms;
  const unit = unitBeatsOf(division);
  return beatToMs(map, Math.round(msToBeat(map, ms) / unit) * unit);
}

export interface GridLine {
  ms:     number;
  /** Bar boundaries are also beats; check `isBar` first when styling. */
  isBar:  boolean;
  isBeat: boolean;
  /** 1-indexed, present only on bar lines. */
  bar?:   number;
}

/**
 * Grid lines covering `[fromMs, toMs]`, walked bar by bar.
 *
 * Bar-by-bar rather than a uniform ms step because with a map neither spacing is constant:
 * bars change length at a meter change, and every line's ms position shifts at a tempo
 * change. Callers render what comes back instead of computing positions themselves.
 */
export function gridLines(
  map: TempoMap,
  fromMs: number,
  toMs: number,
  division: Exclude<SnapDivision, 'off'>,
): GridLine[] {
  if (!(toMs > fromMs)) return [];

  const unit = unitBeatsOf(division);
  // Subdivisions per beat — 4 → 1, 8 → 2, 16 → 4. Integer, so marking beat lines is an
  // index test rather than a float comparison.
  const subsPerBeat = Math.round(1 / unit);

  const lines: GridLine[] = [];
  const startBar = Math.floor(beatToBar(map, msToBeat(map, fromMs)));
  const endBar   = Math.ceil(beatToBar(map, msToBeat(map, toMs)));

  for (let bar = startBar; bar <= endBar; bar++) {
    const barStartBeat = barToBeat(map, bar);
    const meter = meterAtBeat(map, barStartBeat);
    const steps = Math.max(1, Math.round(meter.beatsPerBar / unit));
    for (let i = 0; i < steps; i++) {
      const ms = beatToMs(map, barStartBeat + i * unit);
      if (ms < fromMs || ms > toMs) continue;
      const isBar = i === 0;
      lines.push({
        ms,
        isBar,
        isBeat: i % subsPerBeat === 0,
        ...(isBar ? { bar: bar + 1 } : {}),
      });
    }
  }

  return lines;
}
