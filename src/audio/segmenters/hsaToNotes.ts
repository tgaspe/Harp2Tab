/**
 * HSA v2's cheap half: per-frame voices → committed notes.
 *
 * Pure, no DSP, one pass per pitch. Everything it reads was computed by the expensive pass,
 * which is what makes every parameter here legal under the registry's rule that a declared
 * param re-runs only this half (`algorithms/index.ts:55-69`) — a slider drag walks a few
 * thousand small numbers instead of re-running a CQT.
 *
 * The state machine is carried over from the spectral engine's `candidatesToNotes`, not from
 * the notebook's `note_runs`. `note_runs` breaks a run on a single missing frame
 * (`i - prev > 1`) and has no gap tolerance at all; the hysteresis shape here — a high onset
 * bar, a low sustain floor, generous bridging — was measured at 81% → 87% F1 against Basic
 * Pitch on a real 81-second take during Phase 14. Changing the front end doesn't invalidate
 * that measurement.
 *
 * What it drops from `candidatesToNotes`: the octave bar and Klapuri's polyphony criterion.
 * HSA v2 decides polyphony during analysis instead, with `rel_threshold` against the frame's
 * strongest voice and a 3-bin separation mask, so re-deciding it here would be second-guessing
 * a measured algorithm with an unmeasured heuristic.
 */

import { MAX_VOICES } from '../dsp/hsaPoly';
import type { HsaAnalysis } from '../algorithms/hsa.web';
import { detectReattacks, DEFAULT_REATTACK_CONFIG, type ReattackConfig } from './reattack';
import type { MidiNote } from '../midiToNotes';

export interface HsaSegmentConfig {
  /** A voice must score at least this fraction of the frame's strongest voice to sound at
   *  all. The notebook's `rel_threshold`. */
  relThreshold:    number;
  /** ...and this much to *start* a note. Kept above `relThreshold`; the gap is the
   *  hysteresis that stops a wobble becoming two notes. */
  onsetThreshold:  number;
  maxVoices:       number;
  minNoteLengthMs: number;
  /** Dropouts shorter than this don't end a note. */
  bridgeMs:        number;
  /** Move each note's start back to the nearest preceding attack. */
  snapToAttacks:   boolean;
  /** Whether a confirmed re-attack breaks a held note in two. */
  splitRepeats:    boolean;
  reattack:        ReattackConfig;
}

export const DEFAULT_HSA_SEGMENT_CONFIG: HsaSegmentConfig = {
  relThreshold:    0.60,
  onsetThreshold:  0.75,
  maxVoices:       MAX_VOICES,
  minNoteLengthMs: 40,
  bridgeMs:        70,
  snapToAttacks:   true,
  splitRepeats:    true,
  reattack:        DEFAULT_REATTACK_CONFIG,
};

/** A flux peak must beat the crossing frame's by this much before an onset is moved. */
const SNAP_MIN_FLUX_RATIO = 1.2;
/** Frames searched either side when snapping. Deliberately small and symmetric: the CQT
 *  centres each frame on its own hop, so the threshold crossing is already close, and a long
 *  backward hunt would drag every onset earlier than the truth rather than closer to it. */
const SNAP_FRAMES = 4;

function frameMs(analysis: HsaAnalysis, frame: number): number {
  // Already the centre of the evidence: the transform centres each frame on `frame * hop`,
  // unlike the old STFT front end, which needed a half-window correction here.
  return (frame * analysis.hop * 1000) / analysis.sampleRate;
}

function snapOnset(analysis: HsaAnalysis, frame: number): number {
  const from = Math.max(0, frame - SNAP_FRAMES);
  const to   = Math.min(analysis.frameCount - 1, frame + SNAP_FRAMES);

  let best      = frame;
  let bestValue = analysis.flux[frame];
  for (let f = from; f <= to; f++) {
    // Strictly greater, so a run of equal values keeps the earliest — and so the first
    // frames of a take, which have no previous frame to difference against, never drag an
    // onset forward to an arbitrary later frame.
    if (analysis.flux[f] > bestValue) { bestValue = analysis.flux[f]; best = f; }
  }
  return bestValue > analysis.flux[frame] * SNAP_MIN_FLUX_RATIO ? best : frame;
}

/** Per-semitone activation over time, valued as a fraction of the frame's strongest voice. */
function buildRows(analysis: HsaAnalysis, config: HsaSegmentConfig): Map<number, Float32Array> {
  const rows = new Map<number, Float32Array>();

  for (let frame = 0; frame < analysis.frameCount; frame++) {
    const first = analysis.sFirst[frame];
    if (!(first > 0)) continue;

    let admitted = 0;
    for (let slot = 0; slot < MAX_VOICES && admitted < config.maxVoices; slot++) {
      const pitch = analysis.pitch[frame * MAX_VOICES + slot];
      if (!Number.isFinite(pitch)) continue;

      const level = analysis.salience[frame * MAX_VOICES + slot] / first;
      // Voice 0 is always admitted — it defines the reference the others are scored against,
      // exactly as the notebook's first voice is taken unconditionally.
      if (slot > 0 && level < config.relThreshold) continue;
      admitted++;

      // Notes are committed on the semitone, because that is what a tab is: the fractional
      // pitch survives in the analysis for anything that later wants a bend, but a note
      // either is or isn't hole 4 draw.
      const midi = Math.round(pitch);
      let row = rows.get(midi);
      if (!row) { row = new Float32Array(analysis.frameCount); rows.set(midi, row); }
      // Max, not overwrite: two voices can round to the same semitone when a bend sits
      // between them, and the note is as strong as its strongest evidence.
      if (level > row[frame]) row[frame] = level;
    }
  }

  return rows;
}

/** Salience says how clearly the note was heard, RMS how loudly it was played. Velocity
 *  wants the second, anchored by the first so a confidently-heard quiet note isn't written
 *  as silence. Same 1..127 clamp Basic Pitch's adapter uses. */
function velocityFor(peak: number, peakRms: number, loudnessRef: number): number {
  const loudness = Math.min(1, peakRms / loudnessRef);
  const scaled   = Math.sqrt(loudness) * (0.5 + 0.5 * Math.min(1, peak));
  return Math.max(1, Math.min(127, Math.round(scaled * 127)));
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index  = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

export function hsaToNotes(
  analysis: HsaAnalysis,
  config: HsaSegmentConfig = DEFAULT_HSA_SEGMENT_CONFIG,
): MidiNote[] {
  if (analysis.frameCount === 0) return [];

  const hopMs        = (analysis.hop * 1000) / analysis.sampleRate;
  const bridgeFrames = Math.max(0, Math.round(config.bridgeMs / hopMs));
  // The take's 95th percentile rather than its maximum, so one clipped attack doesn't push
  // every other note down the velocity scale.
  const loudnessRef  = percentile(analysis.rms, 0.95) || 1;

  // One broadband envelope for the whole take, so a re-attack ends every note sounding at
  // that instant. A harmonica double-stop is articulated by one breath — both notes of a
  // chord genuinely do re-attack together.
  const splitFrames = config.splitRepeats
    ? new Set(detectReattacks(analysis.rms, analysis.voiced, hopMs, config.reattack))
    : new Set<number>();

  const notes: MidiNote[] = [];

  for (const [midi, row] of buildRows(analysis, config)) {
    let start   = -1;
    let gap     = 0;
    let peak    = 0;
    let peakRms = 0;

    const begin = (frame: number, level: number, snap: boolean): void => {
      start   = snap && config.snapToAttacks ? snapOnset(analysis, frame) : frame;
      gap     = 0;
      peak    = level;
      peakRms = analysis.rms[frame] ?? 0;
    };

    const commit = (endFrame: number): void => {
      const durationMs = ((endFrame - start) * analysis.hop * 1000) / analysis.sampleRate;
      if (durationMs >= config.minNoteLengthMs) {
        notes.push({
          midi,
          timeMs:     Math.round(frameMs(analysis, start)),
          durationMs: Math.round(durationMs),
          velocity:   velocityFor(peak, peakRms, loudnessRef),
        });
      }
      start = -1;
    };

    for (let frame = 0; frame <= analysis.frameCount; frame++) {
      const level  = frame < analysis.frameCount ? row[frame] : 0;
      const active = level >= config.relThreshold;

      // A confirmed re-attack ends the note here and lets it start again on the same frame,
      // bypassing the bridge entirely. Bridging and re-attack pull in opposite directions by
      // design: a tongued repeat's gap looks exactly like a 70ms dropout, and the envelope is
      // the only evidence that tells them apart. Not snapped — the re-attack frame *is* the
      // attack, and snapping could pull it back across the split it just made.
      if (start >= 0 && frame < analysis.frameCount && splitFrames.has(frame)) {
        commit(frame);
        if (active) begin(frame, level, false);
        continue;
      }

      if (start < 0) {
        // Onset needs the higher bar; sustain only needs the lower one.
        if (level >= config.onsetThreshold) begin(frame, level, true);
        continue;
      }

      if (active) {
        gap = 0;
        if (level > peak) peak = level;
        if (frame < analysis.frameCount && analysis.rms[frame] > peakRms) peakRms = analysis.rms[frame];
        continue;
      }

      gap++;
      if (gap <= bridgeFrames && frame < analysis.frameCount) continue;
      commit(frame - gap + 1);
    }
  }

  // Chronological. The walk above is per pitch, so its natural order is by pitch — and
  // everything downstream assumes onset order.
  return notes.sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);
}
