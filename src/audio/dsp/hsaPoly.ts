/**
 * Multiple-F0 estimation over one CQT column, by iterative estimation and cancellation.
 *
 * A direct port of `compute_hsa_v2_poly` from `HSA_v2_polyphonic.ipynb` (cell 11). Every
 * constant below is that notebook's, and the port is checked frame-for-frame against its
 * output by `scripts/verify-hsa.ts`. **Do not re-tune anything here without re-running the
 * notebook** — the numbers were chosen together by a sweep, and moving one alone moves the
 * operating point the others were picked at.
 *
 * The method, in one paragraph: score every candidate fundamental by a weighted sum of its
 * first four harmonics, take the strongest, subtract what that note's own spectral envelope
 * predicts it contributed, and re-score the residual. Cancellation is what makes it
 * polyphonic — without it the second-strongest candidate is always a near-duplicate of the
 * first. It is subtracted as a *fitted rolloff* rather than as the measured partials, so a
 * co-sounding note sharing a bin keeps its own excess energy instead of being erased along
 * with the winner.
 *
 * One deliberate divergence from the notebook: it stops accepting voices as soon as one
 * scores below `rel_threshold × the first voice`, and this runs to all four regardless,
 * recording each voice's salience so the threshold can be applied later. That makes
 * `relThreshold` and `maxVoices` cheap-half parameters — a slider drag re-reads stored
 * numbers instead of re-running a CQT. It is exactly equivalent for any threshold value,
 * because the notebook's break happens *before* cancellation: a voice it would have rejected
 * can never have influenced the salience of a voice it would have kept.
 */

import type { CqtConfig, CqtResult } from './cqt';

/** Voices estimated per frame. The notebook's `MAX_VOICES`. */
export const MAX_VOICES = 4;

const NUM_HARMONICS = 4;
const ATTENUATION   = 0.84;
const F0_MIN        = 180.0;
const F0_MAX        = 3200.0;
const CANCEL_FACTOR = 0.85;
const CANCEL_WIDTH  = 1;
/** Bins masked either side of an accepted voice — 3 at 24 bins/octave is 1.5 semitones, so
 *  a quarter-tone-wide salience peak cannot be picked twice. */
const MIN_SEPARATION_BINS = 3;
/** Clamp on the fitted rolloff exponent, so a noisy fit can neither invent energy nor erase
 *  a partial it should have left alone. */
const BETA_MAX = 3.0;

export interface PolyFrames {
  frameCount: number;
  /** `frame * MAX_VOICES + slot`. Fractional MIDI — a bend is not rounded away here.
   *  NaN in unused slots. */
  pitch:    Float32Array;
  /** Same indexing. Raw harmonic-sum salience, not normalised. */
  salience: Float32Array;
  /** Per frame: the first (strongest) voice's salience, which every threshold is relative
   *  to. Zero on ungated frames. */
  sFirst:   Float32Array;
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function analyzePoly(
  cqt: CqtResult,
  config: CqtConfig,
  voiced: Uint8Array,
): PolyFrames {
  const { nBins, frameCount, data } = cqt;
  const { fmin, binsPerOctave } = config;

  // Candidate bins: those whose centre frequency is a plausible fundamental.
  const cand: number[] = [];
  for (let b = 0; b < nBins; b++) {
    const f = fmin * Math.pow(2, b / binsPerOctave);
    if (f >= F0_MIN && f <= F0_MAX) cand.push(b);
  }

  const offsets = new Int32Array(NUM_HARMONICS);
  const weights = new Float64Array(NUM_HARMONICS);
  for (let h = 0; h < NUM_HARMONICS; h++) {
    offsets[h] = Math.round(binsPerOctave * Math.log2(h + 1));
    weights[h] = Math.pow(ATTENUATION, h);
  }

  const out: PolyFrames = {
    frameCount,
    pitch:    new Float32Array(frameCount * MAX_VOICES).fill(NaN),
    salience: new Float32Array(frameCount * MAX_VOICES),
    sFirst:   new Float32Array(frameCount),
  };
  if (cand.length === 0 || frameCount === 0) return out;

  // Candidate × harmonic bin lookup, built once. `used` normalises by the weights actually
  // available, so a candidate high enough that its 4th harmonic falls off the top of the
  // spectrum is not penalised for a harmonic that could never have been measured.
  const idxTab  = new Int32Array(cand.length * NUM_HARMONICS);
  const inside  = new Uint8Array(cand.length * NUM_HARMONICS);
  const usedTab = new Float64Array(cand.length);
  for (let c = 0; c < cand.length; c++) {
    for (let h = 0; h < NUM_HARMONICS; h++) {
      const p = cand[c] + offsets[h];
      idxTab[c * NUM_HARMONICS + h] = p;
      if (p < nBins) {
        inside[c * NUM_HARMONICS + h] = 1;
        usedTab[c] += weights[h];
      }
    }
  }

  // Per-frame scratch, so the hot path allocates nothing across ~26,000 frames.
  const residual = new Float64Array(nBins);
  const sal      = new Float64Array(cand.length);
  const accepted = new Int32Array(MAX_VOICES);
  const amps     = new Float64Array(NUM_HARMONICS);
  const model    = new Float64Array(NUM_HARMONICS);

  for (let frame = 0; frame < frameCount; frame++) {
    if (!voiced[frame]) continue;
    for (let b = 0; b < nBins; b++) residual[b] = data[frame * nBins + b];

    let acceptedCount = 0;
    for (let voice = 0; voice < MAX_VOICES; voice++) {
      for (let c = 0; c < cand.length; c++) {
        let sum = 0;
        for (let h = 0; h < NUM_HARMONICS; h++) {
          const i = c * NUM_HARMONICS + h;
          if (inside[i]) sum += weights[h] * residual[idxTab[i]];
        }
        sal[c] = sum / Math.max(usedTab[c], 1e-12);
      }

      // Never re-pick a bin adjacent to a voice already taken this frame. Indices are
      // candidate-relative, hence the `- cand[0]`: `cand` is a contiguous run of bins, so
      // candidate index and bin index differ by a constant.
      for (let a = 0; a < acceptedCount; a++) {
        const lo = Math.max(0, accepted[a] - MIN_SEPARATION_BINS - cand[0]);
        const hi = Math.min(cand.length, accepted[a] + MIN_SEPARATION_BINS + 1 - cand[0]);
        for (let c = lo; c < hi; c++) sal[c] = Number.NEGATIVE_INFINITY;
      }

      let k = 0;
      for (let c = 1; c < cand.length; c++) if (sal[c] > sal[k]) k = c;
      if (!Number.isFinite(sal[k])) break;

      if (voice === 0) out.sFirst[frame] = sal[k];

      // Parabolic interpolation across the salience peak, so a bend survives the
      // quarter-tone bin grid instead of being quantised to it.
      let d = 0;
      if (k > 0 && k < cand.length - 1
          && Number.isFinite(sal[k - 1]) && Number.isFinite(sal[k + 1])) {
        const den = 2 * (2 * sal[k] - sal[k - 1] - sal[k + 1]);
        if (Math.abs(den) > 1e-12) {
          d = Math.max(-0.5, Math.min(0.5, (sal[k + 1] - sal[k - 1]) / den));
        }
      }

      const hz = fmin * Math.pow(2, (cand[k] + d) / binsPerOctave);
      out.pitch[frame * MAX_VOICES + voice]    = hzToMidi(hz);
      out.salience[frame * MAX_VOICES + voice] = sal[k];
      accepted[acceptedCount++] = cand[k];

      // ── Cancellation, envelope mode ──────────────────────────────────────────
      //
      // Subtracting the winner's *measured* partials would also remove a co-sounding note's
      // energy wherever they share a bin. Fitting a smooth rolloff through the four partials
      // and subtracting that instead removes only what this note's own envelope predicts,
      // and leaves the excess — which is the co-sounding note. `min(model, amps)` keeps the
      // fit from ever subtracting more than is there.
      let count = 0;
      for (let h = 0; h < NUM_HARMONICS; h++) {
        const p = cand[k] + offsets[h];
        if (p < nBins) amps[count++] = residual[p];
      }
      if (count >= 2 && amps[0] > 0) {
        // Least-squares line through log-amplitude against log-harmonic-number.
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (let h = 0; h < count; h++) {
          const x = Math.log(h + 1);
          const y = Math.log(Math.max(amps[h], 1e-12));
          n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
        }
        const den   = n * sxx - sx * sx;
        const slope = Math.abs(den) > 1e-12 ? (n * sxy - sx * sy) / den : 0;
        const beta  = Math.max(0, Math.min(BETA_MAX, -slope));
        for (let h = 0; h < count; h++) {
          model[h] = Math.min(amps[0] * Math.pow(h + 1, -beta), amps[h]);
        }
      } else {
        for (let h = 0; h < count; h++) model[h] = amps[h];
      }

      let j = 0;
      for (let h = 0; h < NUM_HARMONICS; h++) {
        const p = cand[k] + offsets[h];
        if (p >= nBins) continue;
        const lo = Math.max(0, p - CANCEL_WIDTH);
        const hi = Math.min(nBins, p + CANCEL_WIDTH + 1);
        for (let i = lo; i < hi; i++) {
          const taper = 1 - Math.abs(i - p) / (CANCEL_WIDTH + 1);
          residual[i] = Math.max(0, residual[i] - CANCEL_FACTOR * model[j] * taper);
        }
        j++;
      }
    }
  }

  return out;
}
