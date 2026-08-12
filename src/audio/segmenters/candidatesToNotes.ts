/**
 * The spectral engine's cheap half: per-frame pitch candidates → committed notes.
 *
 * Pure, no DSP, one pass per pitch. Everything it reads was computed by the expensive pass,
 * which is what makes every parameter below legal under the registry's rule that a declared
 * param re-runs only this half (`algorithms/index.ts:55-69`). A slider drag costs a walk
 * over a few thousand small numbers, not a re-analysis.
 *
 * Note what is decided *here* rather than during analysis, and why: how many voices a frame
 * is allowed, and how much evidence an octave needs. Both are judgement calls that vary by
 * player, microphone and material, and both are answerable from stored numbers — so they
 * are controls rather than constants only the DSP knows about.
 */

import { POLYPHONY_GAMMA } from '../dsp/harmonicSalience';
import type { MidiNote } from '@/types';

/** Candidates retained per frame by the expensive pass. */
export const MAX_CANDIDATES = 6;

/**
 * The expensive pass's output. Flat `Float32Array`s indexed `frame * MAX_CANDIDATES + slot`,
 * rather than an array of objects per frame: a five-minute take is ~26,000 frames, and
 * 150,000 small objects is both slower to walk and several times the memory.
 *
 * Sparse by design. A dense pitch × time posteriogram at the ~10-cent resolution this
 * engine actually estimates to would be over 100MB at the five-minute cap; this is ~2MB and
 * keeps cent accuracy, which is what lets a bend survive to the editor.
 */
export interface SpectralCandidates {
  sampleRate:     number;
  hop:            number;
  frameSize:      number;
  frameCount:     number;
  /** MIDI pitch as a real number — fractional, so a bend is not rounded away here. NaN in
   *  unused slots. */
  pitch:          Float32Array;
  salience:       Float32Array;
  support:        Float32Array;
  octaveEvidence: Float32Array;
  /** Per frame. */
  rms:            Float32Array;
  flux:           Float32Array;
}

export interface SegmentConfig {
  /** Salience a candidate must reach to start a note. */
  onsetThreshold:   number;
  /** ...and to keep one alive. Kept below `onsetThreshold`; the gap is the hysteresis that
   *  stops a wobble becoming two notes. */
  sustainThreshold: number;
  /** How much amplitude evidence an octave above a sounding note needs before it is written
   *  down as a second note. */
  octaveEvidence:   number;
  minNoteLengthMs:  number;
  maxVoices:        number;
  /** Move each note's start back to the nearest preceding attack. */
  snapToAttacks:    boolean;
  /** Dropouts shorter than this don't end a note. */
  bridgeMs:         number;
}

/** A flux peak must beat the crossing frame's by this much before a note start is moved. */
const SNAP_MIN_FLUX_RATIO = 1.2;

/**
 * Defaults, tuned against Basic Pitch on a real 81-second harmonica take
 * (`scripts/compare-engines.ts --sweep`, 912 parameter sets over the cheap half).
 *
 * The shape the sweep found is worth stating, because it is not what the synthetic tones
 * suggested on their own: **a high onset bar with a low sustain floor and generous
 * bridging**. Real playing has a decisive attack and then a long, uneven tail — breath
 * changes, vibrato, the reed settling — so demanding confidence to *start* a note while
 * being forgiving about keeping it alive matches how a harmonica actually sounds. The
 * narrow hysteresis the synthetic tones tolerated fragments real notes into pieces.
 *
 * Agreement with Basic Pitch on that recording: F1 81% → 87%.
 */
export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  // Synthetic reference points, still valid: a clean single note sits at 0.58–0.85 salience,
  // a genuine second voice in a two-note chord at ~0.38, the spurious runner-up at ~0.04.
  onsetThreshold:   0.40,
  sustainThreshold: 0.08,
  // Real octave splits measure ~0.35–0.41 of unexplained even-harmonic energy; phantom
  // octaves on a single note measure ~0.08–0.11. Held at 0.20 rather than the 0.15 the
  // sweep marginally preferred — 0.15 sits inside the phantom range, and buying a fraction
  // of a point of F1 on one recording by loosening the engine's whole reason for existing
  // is a bad trade.
  octaveEvidence:   0.20,
  minNoteLengthMs:  40,
  maxVoices:        4,
  snapToAttacks:    true,
  bridgeMs:         70,
};

/** A frame's chosen pitches, reused across frames to keep the pass allocation-free. */
interface Selection {
  pitch: Float32Array;
  level: Float32Array;
  count: number;
}

/**
 * Which candidates in one frame are actually sounding.
 *
 * Two different admissions, because two different questions are being asked. An ordinary
 * candidate has to survive Klapuri's polyphony criterion — `S_p / p^γ` must keep rising as
 * voices are added, which is what lets a clean single note stop at one voice instead of
 * padding itself out to `maxVoices`. An octave probe never went through that: it exists
 * because the note an octave below it was accepted, and the only question about it is
 * whether the even-harmonic energy is genuinely more than the lower note can explain.
 */
function selectFrame(
  data: SpectralCandidates,
  frame: number,
  config: SegmentConfig,
  into: Selection,
): void {
  const base = frame * MAX_CANDIDATES;
  into.count = 0;

  // ── 1. Everything audible in this frame ───────────────────────────────────────
  const pitches   = scratchPitch;
  const saliences = scratchLevel;
  let available = 0;
  for (let slot = 0; slot < MAX_CANDIDATES; slot++) {
    const pitch = data.pitch[base + slot];
    if (!Number.isFinite(pitch)) continue;
    if (data.salience[base + slot] < config.sustainThreshold) continue;
    pitches[available]   = pitch;
    saliences[available] = data.salience[base + slot];
    scratchSlot[available] = slot;
    available++;
  }

  // ── 2. The octave bar, before anything is selected ────────────────────────────
  //
  // Ordering is load-bearing and was got wrong once. Running this *after* selection looks
  // equivalent and is not: in a note's release the octave above briefly outscores the note
  // itself, the polyphony criterion below then drops the real note as the weaker second
  // voice, and the ghost is left with no octave partner for this test to find. Every
  // spurious note in the synthetic suite came from that hole.
  //
  // The evidence is amplitude, not frequency — an octave above a sounding note produces no
  // partial the lower note doesn't already produce, so there is nothing else it could be.
  let survivors = 0;
  for (let i = 0; i < available; i++) {
    let hasLowerOctave = false;
    for (let j = 0; j < available; j++) {
      if (j !== i && Math.abs(pitches[i] - pitches[j] - 12) < 0.5) { hasLowerOctave = true; break; }
    }
    if (hasLowerOctave && data.octaveEvidence[base + scratchSlot[i]] < config.octaveEvidence) continue;
    pitches[survivors]   = pitches[i];
    saliences[survivors] = saliences[i];
    survivors++;
  }

  // ── 3. Klapuri's polyphony criterion over what's left ─────────────────────────
  //
  // Strongest first, so "does adding another voice still improve the explanation" is asked
  // in the order that makes it meaningful.
  for (let i = 1; i < survivors; i++) {
    for (let j = i; j > 0 && saliences[j] > saliences[j - 1]; j--) {
      const p = pitches[j];   pitches[j]   = pitches[j - 1];   pitches[j - 1]   = p;
      const s = saliences[j]; saliences[j] = saliences[j - 1]; saliences[j - 1] = s;
    }
  }

  let running   = 0;
  let bestScore = 0;
  for (let i = 0; i < survivors && into.count < config.maxVoices; i++) {
    // Evaluated against what accepting this candidate *would* make the running total, so the
    // first voice is always admitted and later ones have to earn their place.
    const score = (running + saliences[i]) / Math.pow(into.count + 1, POLYPHONY_GAMMA);
    if (into.count > 0 && score <= bestScore) continue;
    running   += saliences[i];
    bestScore  = score;
    into.pitch[into.count] = pitches[i];
    into.level[into.count] = saliences[i];
    into.count++;
  }
}

// Frame-local scratch, so the per-frame walk allocates nothing across ~26,000 frames.
const scratchPitch = new Float32Array(MAX_CANDIDATES);
const scratchLevel = new Float32Array(MAX_CANDIDATES);
const scratchSlot  = new Int32Array(MAX_CANDIDATES);

/**
 * Per-semitone activation over time.
 *
 * Notes are committed on the semitone, because that is what a tab is — the fractional pitch
 * survives in the candidate data for anything that later wants a bend, but a note either is
 * or isn't hole 4 draw.
 */
function buildRows(data: SpectralCandidates, config: SegmentConfig): Map<number, Float32Array> {
  const rows = new Map<number, Float32Array>();
  const selection: Selection = {
    pitch: new Float32Array(MAX_CANDIDATES),
    level: new Float32Array(MAX_CANDIDATES),
    count: 0,
  };

  for (let frame = 0; frame < data.frameCount; frame++) {
    selectFrame(data, frame, config, selection);
    for (let i = 0; i < selection.count; i++) {
      const midi = Math.round(selection.pitch[i]);
      let row = rows.get(midi);
      if (!row) {
        row = new Float32Array(data.frameCount);
        rows.set(midi, row);
      }
      // Max, not overwrite: two candidates can round to the same semitone when a bend sits
      // between them, and the note is as strong as its strongest evidence.
      if (selection.level[i] > row[frame]) row[frame] = selection.level[i];
    }
  }
  return rows;
}

/**
 * When a frame's evidence happened, in milliseconds.
 *
 * **The centre of the window, not its start**, and this is load-bearing rather than a
 * detail. Salience is scale-invariant — it is normalised against the frame's own strongest
 * peak — so it measures "is a clean harmonic tone present", not "how much of this window is
 * that tone". A window only 40% filled by a new note already scores a confident salience,
 * which means the threshold crossing happens while the window is still mostly the previous
 * note or silence. Timing a note from the window's leading edge therefore reports it up to
 * a full window early; timing it from the centre puts it within about 10ms of the truth.
 */
function frameMs(data: SpectralCandidates, frame: number): number {
  return ((frame * data.hop + data.frameSize / 2) * 1000) / data.sampleRate;
}

/**
 * Refine a note's start to the nearest attack.
 *
 * Deliberately a *small symmetric* search rather than a backward hunt over a whole window.
 * With centre-based timing the threshold crossing is already close, so a long backward
 * search would drag every onset earlier than the truth rather than closer to it — and in a
 * fast passage it can reach back past the previous note's attack and snap to that instead.
 */
function snapOnset(data: SpectralCandidates, frame: number, searchFrames: number): number {
  const from = Math.max(0, frame - searchFrames);
  const to   = Math.min(data.frameCount - 1, frame + searchFrames);

  let best      = frame;
  let bestValue = data.flux[frame];
  for (let f = from; f <= to; f++) {
    // Strictly greater, so a run of equal values keeps the earliest — and so a region with
    // no flux at all (the first frames of a take, where there is no previous frame to
    // difference against) never drags the onset forward to an arbitrary later frame.
    if (data.flux[f] > bestValue) {
      bestValue = data.flux[f];
      best      = f;
    }
  }
  // Only move for a peak that is clearly an attack rather than ordinary variation.
  return bestValue > data.flux[frame] * SNAP_MIN_FLUX_RATIO ? best : frame;
}

export function candidatesToNotes(
  data: SpectralCandidates,
  config: SegmentConfig = DEFAULT_SEGMENT_CONFIG,
): MidiNote[] {
  if (data.frameCount === 0) return [];

  const hopMs        = (data.hop * 1000) / data.sampleRate;
  const bridgeFrames = Math.max(0, Math.round(config.bridgeMs / hopMs));
  /** Half a window — enough to find the attack, short enough not to reach the previous
   *  note's in a run of 16ths. */
  const snapFrames   = Math.max(1, Math.round(data.frameSize / data.hop / 2));
  const notes: MidiNote[] = [];

  // Loudness reference for velocity: the take's 95th percentile rather than its maximum, so
  // one clipped attack doesn't push every other note down the scale.
  const loudnessRef = percentile(data.rms, 0.95) || 1;

  for (const [midi, row] of buildRows(data, config)) {
    let start   = -1;
    let gap     = 0;
    let peak    = 0;
    let peakRms = 0;

    for (let frame = 0; frame <= data.frameCount; frame++) {
      const level  = frame < data.frameCount ? row[frame] : 0;
      const active = level >= config.sustainThreshold;

      if (start < 0) {
        // Onset needs the higher bar; sustain only needs the lower one.
        if (level >= config.onsetThreshold) {
          start   = config.snapToAttacks ? snapOnset(data, frame, snapFrames) : frame;
          gap     = 0;
          peak    = level;
          peakRms = data.rms[frame];
        }
        continue;
      }

      if (active) {
        gap = 0;
        if (level > peak) peak = level;
        if (frame < data.frameCount && data.rms[frame] > peakRms) peakRms = data.rms[frame];
        continue;
      }

      gap++;
      if (gap <= bridgeFrames && frame < data.frameCount) continue;

      const end        = frame - gap + 1;
      const startMs    = frameMs(data, start);
      const durationMs = ((end - start) * data.hop * 1000) / data.sampleRate;
      if (durationMs >= config.minNoteLengthMs) {
        notes.push({
          midi,
          timeMs:     Math.round(startMs),
          durationMs: Math.round(durationMs),
          velocity:   velocityFor(peak, peakRms, loudnessRef),
        });
      }
      start = -1;
    }
  }

  // Chronological. The walk above is per pitch, so its natural order is by pitch — and
  // everything downstream assumes onset order (`basicPitch.web.ts:277` had to learn this).
  return notes.sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);
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
